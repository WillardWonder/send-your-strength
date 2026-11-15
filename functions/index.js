/**
 * Send Your Strength – Cloud Functions
 *
 * Team-specific settings (names, schedule, prices, time zone, default text) come from team.json,
 * which scripts/sync-config.js copies here from the repo root.
 *
 * Browsers only read (see firestore.rules). Every write happens here, so nobody can mark a day paid,
 * change a total, publish a page, or read an athlete's notes from devtools.
 *
 * Roles live in Firebase Auth custom claims and are re-checked by claimRoles on every sign-in:
 *   admin: true          – email is in the ADMIN_EMAILS parameter
 *   wrestlerId: "<id>"   – email was on the roster CSV an organizer imported (and she's still active)
 *
 * Privacy model
 *   - Each athlete's page is link-only: https://<site>/p/<slug>-<id>. The id is Firestore's random 20-character
 *     document id, and the rules let a browser GET one athlete by id but never LIST athletes unless signed in
 *     as a team member. Nothing public names the athletes.
 *   - The public athlete document holds a display name (first name + last initial by default), never the full
 *     name or email. Those live in wrestlerPrivate/{id}, organizers only.
 *   - A page stays hidden until the athlete (with a parent) accepts the athlete terms and publishes it.
 *     Organizers can unpublish, never publish.
 *   - Photos are optional and need a parent-approval confirmation.
 *   - Organizers must accept the organizer terms (8 attestations) before any organizer tool works.
 *
 * Money flow (the site never holds money)
 *   createOrder        holds the picked days, prices them server-side, records which payment option the sponsor chose
 *   mockPay            PAYMENT_MODE=mock only: stand-in for testing. Never deploy with mock.
 *   adminConfirmOrder  organizer confirms money that arrived by a payment link (Venmo, Cash App, PayPal.me, Zelle, check)
 *   adminRecordPayment cash / check / app payment handed over in person
 *   markOrderPaid      the ONE place an order becomes paid. Card providers' verified webhooks will call it too.
 */
const crypto = require("crypto");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineString } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const { TEAM, buildSeasonDays, zonedTimeToUtc } = require("./schedule");

initializeApp();
const db = getFirestore();

// manual = sponsors pay the team directly (payment links, cash, check) and organizers confirm it. Default for go-live.
// mock   = test payments that move no money. Testing only.
const PAYMENT_MODE = defineString("PAYMENT_MODE", { default: "manual" });
const ADMIN_EMAILS = defineString("ADMIN_EMAILS", { default: "" });
// The platform's percentage (0–20). Card providers will deduct it automatically; for link, cash and check payments
// it is only tallied for invoicing, and only when FEE_ON_LINK_PAYMENTS=yes. It is always disclosed to sponsors.
const PLATFORM_FEE_PERCENT = defineString("PLATFORM_FEE_PERCENT", { default: "0" });
const FEE_ON_LINK_PAYMENTS = defineString("FEE_ON_LINK_PAYMENTS", { default: "no" });

// Bump this whenever docs/terms.html or docs/privacy.html changes in substance: everyone re-accepts.
const TERMS_VERSION = "2026-11-15";
const ORG_ATTESTATIONS = ["authority", "approval", "roster", "consent", "marks", "funds", "moderation", "fee"];

const holdMinutes = () => (PAYMENT_MODE.value() === "mock" ? 15 : 72 * 60);
const MAX_DAYS_PER_ORDER = 40;
const MAX_MESSAGE = 280;
const MAX_ASK = 900;
const OPTS = { cors: true, maxInstances: 10 };

/* ---------------- helpers ---------------- */
const clean = (s, max) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
const cleanText = (s, max) => String(s ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
const emailKey = (e) => String(e || "").trim().toLowerCase();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ID_RE = /^[A-Za-z0-9]{1,40}$/;
const who = (req) => req.auth.token.email || req.auth.uid;
const claimRef = (wrestlerId, dayKey) => db.doc(`wrestlers/${wrestlerId}/claims/${dayKey}`);
const cleanId = (v) => { const id = clean(v, 40); if (!ID_RE.test(id)) throw new HttpsError("invalid-argument", "Unknown athlete."); return id; };

const TZ = TEAM.timezone || "America/Chicago";
const REVEAL_HOUR = Number.isInteger(TEAM.revealHour) ? TEAM.revealHour : 5;
// A note opens at REVEAL_HOUR on its day in the team's time zone (daylight saving handled).
const revealAtFor = (dayKey) => Timestamp.fromDate(zonedTimeToUtc(dayKey, REVEAL_HOUR, TZ));

// {first} fills in here; {practice} and {meet} fill in on the page so they track price changes.
const firstOf = (name) => clean(name, 40).split(/\s+/)[0] || "";
const defaultAsk = (first) => String(TEAM.copy.defaultAsk).replace(/\{first\}/g, first);
const cleanDetail = (v) => clean(v, 12);

/* What the public sees instead of the full name. "first-initial" (default): "Hailey L."; "full": "Hailey Lund". */
function displayFor(name) {
  const parts = clean(name, 40).split(/\s+/).filter(Boolean);
  if (!parts.length) return "Athlete";
  if ((TEAM.athletes && TEAM.athletes.nameDisplay) === "full" || parts.length === 1) return parts.join(" ");
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}
const slugify = (s) =>
  clean(s, 80).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "") || "athlete";

/* ---------------- fees ---------------- */
const feePercent = () => Math.min(20, Math.max(0, Number(PLATFORM_FEE_PERCENT.value()) || 0));
const feeOnLink = () => /^(yes|true|1)$/i.test(String(FEE_ON_LINK_PAYMENTS.value()).trim());
const feeFor = (cents) => Math.round((cents * feePercent()) / 100);
const recipient = () => TEAM.team.paymentRecipient || TEAM.team.name;
function feeDisclosure() {
  const p = feePercent();
  if (!p) return "";
  return `${p}% of each payment supports ${TEAM.brand.name}, the platform that runs this page. The rest goes to ${recipient()}.`;
}

/* ---------------- payment options (links to the team's own accounts) ---------------- */
const LINK_TYPES = {
  venmo: (v) => { const s = v.replace(/^@/, ""); return /^[A-Za-z0-9_-]{5,30}$/.test(s) ? s : null; },
  cashapp: (v) => { const s = v.replace(/^\$/, ""); return /^[A-Za-z][A-Za-z0-9_]{0,19}$/.test(s) ? "$" + s : null; },
  paypalme: (v) => { const s = v.replace(/^(https?:\/\/)?(www\.)?paypal\.me\//i, "").replace(/\/+$/, ""); return /^[A-Za-z0-9]{1,20}$/.test(s) ? s : null; },
  zelle: (v) => {
    if (EMAIL_RE.test(v)) return v.toLowerCase();
    const d = v.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
    return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : null;
  },
  check: (v) => clean(v, 120) || null,
};
const LINK_LABEL = { venmo: "Venmo", cashapp: "Cash App", paypalme: "PayPal", zelle: "Zelle", check: "Check or cash" };

async function paymentConfig() {
  const snap = await db.doc("config/payments").get();
  const d = snap.exists ? snap.data() : {};
  return { links: Array.isArray(d.links) ? d.links : [], card: d.card || null };
}

/* ---------------- roles ---------------- */
function requireAdmin(req) {
  if (!req.auth || req.auth.token.admin !== true) throw new HttpsError("permission-denied", "Organizer sign-in required.");
}
const orgTermsRef = (uid) => db.doc(`acceptances/org_${uid}_${TERMS_VERSION}`);
/* Every organizer tool: signed in as an organizer AND has accepted the current organizer terms. */
async function requireOrganizer(req) {
  requireAdmin(req);
  if (!(await orgTermsRef(req.auth.uid).get()).exists) throw new HttpsError("failed-precondition", "Accept the organizer terms first.");
}
function requireAthlete(req) {
  const id = req.auth && req.auth.token.wrestlerId;
  if (!id) throw new HttpsError("permission-denied", "Sign in with the school email your coach has on the roster.");
  return id;
}

/* Photos must come from this project's own Storage bucket (or the local emulator), and need parent approval. */
function photoPatch(d) {
  const url = clean(d.photoUrl, 600);
  if (!url) return { photoUrl: "", photoCutout: false, photoConsent: false };
  if (d.photoConsent !== true) throw new HttpsError("failed-precondition", "Confirm a parent or guardian approved posting this photo.");
  if (!(url.startsWith("https://firebasestorage.googleapis.com/") || url.startsWith("http://127.0.0.1:9199/"))) {
    throw new HttpsError("invalid-argument", "Upload the photo from this page.");
  }
  return { photoUrl: url, photoCutout: !!d.photoCutout, photoConsent: true };
}

/* Per-caller rate limit for public calls, keyed by a hash of the caller's IP (the raw IP is never stored).
   Google's front end appends the real client IP to X-Forwarded-For, so the last entry is the trustworthy one. */
async function rateLimit(req, bucket, max, windowMs) {
  const raw = req.rawRequest || {};
  const xff = String((raw.headers && raw.headers["x-forwarded-for"]) || "");
  const ip = (xff ? xff.split(",").pop() : raw.ip || "unknown").trim();
  const key = crypto.createHash("sha256").update(`${bucket}|${ip}`).digest("hex").slice(0, 40);
  const ref = db.doc(`rateLimits/${key}`);
  await db.runTransaction(async (tx) => {
    const d = (await tx.get(ref)).data();
    const now = Date.now();
    if (!d || now - d.start > windowMs) {
      tx.set(ref, { start: now, count: 1, expireAt: Timestamp.fromMillis(now + 2 * windowMs) });
      return;
    }
    if (d.count >= max) throw new HttpsError("resource-exhausted", "Too many tries in a short time. Wait a few minutes and try again.");
    tx.update(ref, { count: d.count + 1 });
  });
}

async function getSeason(tx) {
  const ref = db.doc("config/season");
  const snap = tx ? await tx.get(ref) : await ref.get();
  if (!snap.exists) throw new HttpsError("failed-precondition", "The season isn't set up yet.");
  return snap.data();
}
const priceFor = (day, season) => day.priceCents || (day.kind === "event" ? season.practicePriceCents * season.eventMultiplier : season.practicePriceCents);
const claimIsTaken = (c, now) => !!c && (c.status === "paid" || (c.status === "held" && c.holdExpires && c.holdExpires.toMillis() > now));

/* Validates an order and writes it with holds. Must run inside a transaction (all reads before writes).
   Public orders need the sponsor to accept the terms and the athlete's page to be published. */
async function placeOrder(tx, input, { method, publicOrder }) {
  if (publicOrder && input.acceptTerms !== true) throw new HttpsError("invalid-argument", "Agree to the terms to continue.");
  const season = await getSeason(tx);
  const wrestlerId = cleanId(input.wrestlerId);
  const wSnap = await tx.get(db.doc(`wrestlers/${wrestlerId}`));
  const w = wSnap.data();
  if (!wSnap.exists || w.active === false) throw new HttpsError("not-found", "That athlete isn't on the roster.");
  if (publicOrder && w.published !== true) throw new HttpsError("failed-precondition", "This page isn't published yet.");

  const dayKeys = [...new Set((Array.isArray(input.dayKeys) ? input.dayKeys : []).map((k) => clean(k, 10)))].sort();
  if (!dayKeys.length || dayKeys.length > MAX_DAYS_PER_ORDER) throw new HttpsError("invalid-argument", "Pick between 1 and 40 days.");
  const byKey = Object.fromEntries(season.days.map((d) => [d.key, d]));
  const off = new Set(season.offDays || []);
  for (const k of dayKeys) if (!byKey[k] || off.has(k)) throw new HttpsError("invalid-argument", `${k} isn't a day you can sponsor.`);

  const donorName = clean(input.donorName, 60);
  if (!donorName) throw new HttpsError("invalid-argument", "Enter your name.");
  const anon = !!input.anon;
  const contact = clean(input.contact, 120);
  const message = cleanText(input.message, MAX_MESSAGE);
  const revealDay = dayKeys.includes(clean(input.revealDay, 10)) ? clean(input.revealDay, 10) : dayKeys[0];

  const now = Date.now();
  const refs = dayKeys.map((k) => claimRef(wrestlerId, k));
  const snaps = await Promise.all(refs.map((r) => tx.get(r)));
  const taken = snaps.filter((s) => claimIsTaken(s.data(), now)).map((s) => s.data().dayKey);
  if (taken.length) throw new HttpsError("already-exists", "Someone just took one of those days.", { taken });

  const amountCents = dayKeys.reduce((sum, k) => sum + priceFor(byKey[k], season), 0);
  const units = dayKeys.reduce((sum, k) => sum + (byKey[k].kind === "event" ? season.eventMultiplier : 1), 0);
  const orderRef = db.collection("orders").doc();
  const holdExpires = Timestamp.fromMillis(now + holdMinutes() * 60 * 1000);

  tx.set(orderRef, {
    wrestlerId, dayKeys, amountCents, units, donorName, anon, contact, message, revealDay,
    status: "pending", method, termsVersion: publicOrder ? TERMS_VERSION : null, createdAt: FieldValue.serverTimestamp(),
  });
  refs.forEach((ref, i) => tx.set(ref, {
    wrestlerId, dayKey: dayKeys[i], status: "held", orderId: orderRef.id,
    displayName: anon ? "Anonymous" : donorName, hasNote: false, holdExpires,
  }));
  return { orderId: orderRef.id, amountCents, holdExpires: holdExpires.toMillis(), method };
}

/* The only place an order becomes paid. Idempotent: a repeated call for a paid order changes nothing. */
async function markOrderPaid(orderId, payment) {
  return db.runTransaction(async (tx) => {
    const orderRef = db.doc(`orders/${orderId}`);
    const o = (await tx.get(orderRef)).data();
    if (!o) throw new HttpsError("not-found", "Order not found.");
    if (o.status === "paid") return { status: "paid", alreadyPaid: true };
    if (o.status !== "pending") throw new HttpsError("failed-precondition", `This order is ${o.status}.`);

    const now = Date.now();
    const refs = o.dayKeys.map((k) => claimRef(o.wrestlerId, k));
    const snaps = await Promise.all(refs.map((r) => tx.get(r)));
    // The hold lapsed and someone else took a day: never double-book. Flag it so an organizer refunds or moves it.
    const lost = snaps.filter((s) => { const c = s.data(); return c && c.orderId !== orderId && claimIsTaken(c, now); });
    if (lost.length) {
      tx.update(orderRef, { status: "conflict", payment, conflictDays: lost.map((s) => s.data().dayKey) });
      return { status: "conflict" };
    }

    refs.forEach((ref, i) => tx.set(ref, {
      wrestlerId: o.wrestlerId, dayKey: o.dayKeys[i], status: "paid", orderId,
      displayName: o.anon ? "Anonymous" : o.donorName,
      hasNote: !!o.message && o.dayKeys[i] === o.revealDay, // envelope icon only; the note itself stays private
      paidAt: FieldValue.serverTimestamp(), holdExpires: null,
    }));
    tx.update(orderRef, { status: "paid", payment, paidAt: FieldValue.serverTimestamp() });
    tx.set(db.doc(`wrestlers/${o.wrestlerId}`), {
      raisedCents: FieldValue.increment(o.amountCents),
      daysPaid: FieldValue.increment(o.dayKeys.length),
      sponsorCount: FieldValue.increment(1),
    }, { merge: true });
    tx.set(db.doc("team/totals"), {
      raisedCents: FieldValue.increment(o.amountCents),
      daysPaid: FieldValue.increment(o.dayKeys.length),
      orders: FieldValue.increment(1),
    }, { merge: true });
    if (o.message) {
      tx.set(db.doc(`messages/${orderId}`), {
        wrestlerId: o.wrestlerId, orderId, text: o.message,
        fromName: o.anon ? "Someone in your corner" : o.donorName,
        revealDay: o.revealDay, revealAt: revealAtFor(o.revealDay),
        status: "pending", released: false, createdAt: FieldValue.serverTimestamp(),
      });
    }
    return { status: "paid" };
  });
}

/* ---------------- public ---------------- */
exports.createOrder = onCall(OPTS, async (req) => {
  await rateLimit(req, "order", 10, 10 * 60 * 1000);
  const input = req.data || {};
  let method = "online";
  if (PAYMENT_MODE.value() !== "mock") {
    const { links } = await paymentConfig();
    const want = clean(input.method, 20);
    if (!links.length) method = "manual";
    else if (links.some((l) => l.type === want)) method = want;
    else throw new HttpsError("invalid-argument", "Pick one of the payment options.");
  }
  return db.runTransaction((tx) => placeOrder(tx, input, { method, publicOrder: true }));
});

exports.mockPay = onCall(OPTS, async (req) => {
  if (PAYMENT_MODE.value() !== "mock") throw new HttpsError("failed-precondition", "Test payments are turned off.");
  await rateLimit(req, "mockpay", 20, 10 * 60 * 1000);
  return markOrderPaid(clean(req.data?.orderId, 40), { provider: "mock", ref: `mock_${Date.now()}`, at: Date.now() });
});

/* Everything the checkout needs to describe payment honestly, computed on the server. */
exports.paymentMode = onCall(OPTS, async () => {
  const { links } = await paymentConfig();
  return {
    mode: PAYMENT_MODE.value(), options: links, feePercent: feePercent(), feeOnLink: feeOnLink(),
    disclosure: feeDisclosure(), termsVersion: TERMS_VERSION,
  };
});

/* Recomputes roles from scratch on every sign-in, so removing someone from the organizer list
   or the roster takes their access away the next time they sign in (and within an hour otherwise). */
exports.claimRoles = onCall(OPTS, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  if (!req.auth.token.email_verified) throw new HttpsError("permission-denied", "Use the sign-in link sent to your email.");
  const email = emailKey(req.auth.token.email);
  const admins = ADMIN_EMAILS.value().split(",").map(emailKey).filter(Boolean);
  const claims = {};
  if (admins.includes(email)) claims.admin = true;
  const map = await db.doc(`rosterEmails/${email}`).get();
  if (map.exists) {
    const w = await db.doc(`wrestlers/${map.data().wrestlerId}`).get();
    if (w.exists && w.data().active !== false) claims.wrestlerId = map.data().wrestlerId;
  }
  const current = req.auth.token;
  const changed = (current.admin === true) !== !!claims.admin || (current.wrestlerId || null) !== (claims.wrestlerId || null);
  if (changed) await getAuth().setCustomUserClaims(req.auth.uid, claims);
  if (claims.wrestlerId) await db.doc(`wrestlerPrivate/${claims.wrestlerId}`).set({ lastSignIn: FieldValue.serverTimestamp() }, { merge: true });
  const orgTerms = claims.admin ? (await orgTermsRef(req.auth.uid).get()).exists : false;
  return { ...claims, changed, orgTerms, termsVersion: TERMS_VERSION };
});

/* ---------------- the athlete herself ---------------- */
exports.athleteUpdateProfile = onCall(OPTS, async (req) => {
  const id = requireAthlete(req);
  const d = req.data || {};
  const patch = {};
  if (d.askText != null) patch.askText = cleanText(d.askText, MAX_ASK);
  if (d.photoUrl != null) Object.assign(patch, photoPatch(d));
  if (!Object.keys(patch).length) return { ok: true };
  await db.doc(`wrestlers/${id}`).set(patch, { merge: true });
  return { ok: true };
});

/* Publishing needs the athlete's own sign-in and a parent's approval of the athlete terms. */
exports.athletePublish = onCall(OPTS, async (req) => {
  const id = requireAthlete(req);
  const d = req.data || {};
  if (d.version !== TERMS_VERSION) throw new HttpsError("failed-precondition", "The terms changed. Reload the page and read them again.");
  if (d.parentApproved !== true) throw new HttpsError("failed-precondition", "A parent or guardian needs to approve before you publish.");
  await db.doc(`acceptances/ath_${id}_${TERMS_VERSION}`).set({ wrestlerId: id, uid: req.auth.uid, email: req.auth.token.email || "", version: TERMS_VERSION, at: FieldValue.serverTimestamp() });
  await db.doc(`wrestlers/${id}`).set({ published: true, consentVersion: TERMS_VERSION }, { merge: true });
  return { ok: true };
});

exports.athleteUnpublish = onCall(OPTS, async (req) => {
  const id = requireAthlete(req);
  await db.doc(`wrestlers/${id}`).set({ published: false }, { merge: true });
  return { ok: true };
});

/* ---------------- organizers ---------------- */
exports.acceptOrganizerTerms = onCall(OPTS, async (req) => {
  requireAdmin(req);
  const d = req.data || {};
  if (d.version !== TERMS_VERSION) throw new HttpsError("failed-precondition", "The terms changed. Reload the page and read them again.");
  const attest = Array.isArray(d.attest) ? d.attest.map((x) => clean(x, 20)) : [];
  const missing = ORG_ATTESTATIONS.filter((a) => !attest.includes(a));
  if (missing.length) throw new HttpsError("invalid-argument", "Confirm every statement to continue.", { missing });
  await orgTermsRef(req.auth.uid).set({ uid: req.auth.uid, email: req.auth.token.email || "", version: TERMS_VERSION, attest: ORG_ATTESTATIONS, at: FieldValue.serverTimestamp() });
  return { ok: true };
});

/* The season's schedule: team.json's to start, then whatever organizers save with the schedule editor. */
const scheduleOf = (season) => (season && season.schedule) || TEAM.schedule;
const daysFor = (schedule) => buildSeasonDays({ ...TEAM, schedule });

exports.adminSetup = onCall(OPTS, async (req) => {
  await requireOrganizer(req);
  const ref = db.doc("config/season");
  const snap = await ref.get();
  const prev = snap.exists ? snap.data() : {};
  const schedule = scheduleOf(prev);
  await ref.set({
    season: TEAM.team.season,
    schedule,
    days: daysFor(schedule),
    breaks: schedule.breaks || {},
    offDays: prev.offDays || [],
    practicePriceCents: prev.practicePriceCents || TEAM.prices.practiceCents,
    eventMultiplier: TEAM.prices.eventMultiplier,
    rewardName: prev.rewardName || TEAM.reward.name,
    rewardText: prev.rewardText || TEAM.reward.text,
    payNote: prev.payNote || TEAM.payNote,
    match: prev.match || null,
  });
  await db.doc("team/totals").set({ raisedCents: FieldValue.increment(0), daysPaid: FieldValue.increment(0), orders: FieldValue.increment(0) }, { merge: true });
  // Older records kept the full name on the public document: move it to the private one.
  const all = await db.collection("wrestlers").get();
  for (const w of all.docs) {
    const x = w.data();
    if (x.name) {
      await db.doc(`wrestlerPrivate/${w.id}`).set({ name: x.name }, { merge: true });
      await w.ref.set({ name: FieldValue.delete(), displayName: x.displayName || displayFor(x.name), slug: slugify(x.displayName || displayFor(x.name)) }, { merge: true });
    } else if (!x.slug) {
      await w.ref.set({ slug: slugify(x.displayName) }, { merge: true });
    }
  }
  return { ok: true };
});

exports.adminSettings = onCall(OPTS, async (req) => {
  await requireOrganizer(req);
  const d = req.data || {};
  const cents = Math.round(Number(d.practicePriceCents));
  if (!(cents >= 100 && cents <= 10000)) throw new HttpsError("invalid-argument", "Practice price must be between $1 and $100.");
  await db.doc("config/season").update({
    practicePriceCents: cents,
    rewardName: clean(d.rewardName, 40) || TEAM.reward.name,
    rewardText: clean(d.rewardText, 400),
    payNote: clean(d.payNote, 400),
    // A real matching sponsor (Karlan & List 2007: a 1:1 match raises response and revenue). Blank = no match shown.
    match: clean(d.matchName, 60) && Number(d.matchCapCents) > 0
      ? { name: clean(d.matchName, 60), capCents: Math.min(Math.round(Number(d.matchCapCents)), 10000000) }
      : null,
  });
  return { ok: true };
});

/* The team's own payment links. One of each type at most; values are validated so a link can't point anywhere else. */
exports.adminSetPaymentOptions = onCall(OPTS, async (req) => {
  await requireOrganizer(req);
  const rows = Array.isArray(req.data?.links) ? req.data.links.slice(0, 10) : [];
  const links = [];
  for (const r of rows) {
    const type = clean(r && r.type, 20);
    if (!LINK_TYPES[type]) throw new HttpsError("invalid-argument", "Card checkout is connected separately. Links can be Venmo, Cash App, PayPal, Zelle, or check.");
    if (links.some((l) => l.type === type)) throw new HttpsError("invalid-argument", `Add ${LINK_LABEL[type]} only once.`);
    const value = LINK_TYPES[type](clean(r.value, 160));
    if (!value) throw new HttpsError("invalid-argument", `That ${LINK_LABEL[type]} handle doesn't look right.`);
    links.push({ type, value });
  }
  await db.doc("config/payments").set({ links, updatedAt: FieldValue.serverTimestamp(), updatedBy: who(req) }, { merge: true });
  return { ok: true, links };
});

/* CSV import: rows of {name, email, weight}. Matches existing athletes by email, so re-importing is safe.
   New athletes start unpublished; their page goes live when they (with a parent) publish it. */
exports.adminImportRoster = onCall(OPTS, async (req) => {
  await requireOrganizer(req);
  const rows = Array.isArray(req.data?.rows) ? req.data.rows.slice(0, 80) : [];
  const result = { added: 0, updated: 0, skipped: [] };
  for (const r of rows) {
    const name = clean(r.name, 40);
    const email = emailKey(r.email);
    const weight = cleanDetail(r.weight);
    if (!name || !EMAIL_RE.test(email)) { result.skipped.push(r.email || r.name || "(blank row)"); continue; }
    const mapRef = db.doc(`rosterEmails/${email}`);
    const map = await mapRef.get();
    if (map.exists) {
      const id = map.data().wrestlerId;
      const patch = { displayName: displayFor(name), active: true };
      if (weight) patch.weight = weight;
      await db.doc(`wrestlers/${id}`).set(patch, { merge: true });
      await db.doc(`wrestlerPrivate/${id}`).set({ name }, { merge: true });
      result.updated++;
    } else {
      const wRef = db.collection("wrestlers").doc();
      const display = displayFor(name);
      const batch = db.batch();
      batch.set(wRef, {
        displayName: display, slug: slugify(display), weight, photoUrl: "", photoCutout: false, photoConsent: false,
        askText: defaultAsk(firstOf(name)), active: true, published: false,
        raisedCents: 0, daysPaid: 0, sponsorCount: 0, createdAt: FieldValue.serverTimestamp(),
      });
      batch.set(mapRef, { wrestlerId: wRef.id });
      batch.set(db.doc(`wrestlerPrivate/${wRef.id}`), { email, name });
      await batch.commit();
      result.added++;
    }
  }
  return result;
});

exports.adminSaveWrestler = onCall(OPTS, async (req) => {
  await requireOrganizer(req);
  const d = req.data || {};
  if (!d.id) throw new HttpsError("invalid-argument", "Add athletes with the roster CSV so each one gets a login.");
  const id = cleanId(d.id);
  const snap = await db.doc(`wrestlers/${id}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "Athlete not found.");
  const patch = {};
  if (d.name != null) {
    const name = clean(d.name, 40) || "Athlete";
    await db.doc(`wrestlerPrivate/${id}`).set({ name }, { merge: true });
    patch.displayName = displayFor(name);
    patch.slug = slugify(patch.displayName);
  }
  if (d.weight != null) patch.weight = cleanDetail(d.weight);
  if (d.askText != null) patch.askText = cleanText(d.askText, MAX_ASK);
  if (d.photoUrl != null) Object.assign(patch, photoPatch(d));
  if (d.active != null) patch.active = !!d.active;
  await db.doc(`wrestlers/${id}`).set(patch, { merge: true });
  return { id };
});

/* Organizers can take a page down; only the athlete (with a parent) can put it up. */
exports.adminSetPublished = onCall(OPTS, async (req) => {
  await requireOrganizer(req);
  const id = cleanId(req.data?.id);
  if (req.data?.published !== false) throw new HttpsError("permission-denied", "Only the athlete can publish her page, with a parent's approval.");
  await db.doc(`wrestlers/${id}`).set({ published: false }, { merge: true });
  return { ok: true };
});

/* Schedule editor: organizers add, move, rename or remove meets and add extra practice days.
   A day someone already sponsored can be renamed, but never removed or changed to a different kind or price. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (k) => DATE_RE.test(k) && !Number.isNaN(Date.parse(k + "T00:00:00Z")) && new Date(k + "T00:00:00Z").toISOString().slice(0, 10) === k;
exports.adminSaveSchedule = onCall(OPTS, async (req) => {
  await requireOrganizer(req);
  const d = req.data || {};
  const base = TEAM.schedule;
  const lo = Date.parse(base.practiceStart + "T00:00:00Z") - 60 * 864e5, hi = Date.parse(base.lastDay + "T00:00:00Z") + 60 * 864e5;
  const inSeason = (k) => validDate(k) && Date.parse(k + "T00:00:00Z") >= lo && Date.parse(k + "T00:00:00Z") <= hi;
  const rows = Array.isArray(d.events) ? d.events.slice(0, 80) : [];
  const events = [];
  for (const r of rows) {
    const date = clean(r && r.date, 10);
    if (!inSeason(date)) throw new HttpsError("invalid-argument", `${date || "A date"} isn't a date in this season.`);
    if (events.some((e) => e.date === date)) throw new HttpsError("invalid-argument", `Two events are on ${date}. Keep one per day.`);
    const name = clean(r.name, 60);
    if (!name) throw new HttpsError("invalid-argument", `Give the ${date} event a name.`);
    const e = { date, name, where: clean(r.where, 60), label: clean(r.label, 20) || name.slice(0, 20) };
    const end = clean(r.end, 10);
    if (end) {
      if (!inSeason(end) || end <= date || Date.parse(end) - Date.parse(date) > 6 * 864e5) throw new HttpsError("invalid-argument", `The ${name} end date has to be within a week after it starts.`);
      e.end = end;
    }
    if (r.postseason) {
      e.postseason = true;
      const cents = Math.round(Number(r.priceCents));
      if (!(cents >= 100 && cents <= 100000)) throw new HttpsError("invalid-argument", `Set a price for ${name}.`);
      e.priceCents = cents;
    }
    events.push(e);
  }
  events.sort((a, b) => a.date.localeCompare(b.date));
  const extraPractices = [...new Set((Array.isArray(d.extraPractices) ? d.extraPractices : []).map((k) => clean(k, 10)))].filter(Boolean).sort().slice(0, 60);
  for (const k of extraPractices) if (!inSeason(k)) throw new HttpsError("invalid-argument", `${k} isn't a date in this season.`);
  return db.runTransaction(async (tx) => {
    const season = await getSeason(tx);
    const claims = await tx.get(db.collectionGroup("claims"));
    const schedule = { ...scheduleOf(season), events, extraPractices };
    const days = daysFor(schedule);
    const oldBy = Object.fromEntries(season.days.map((x) => [x.key, x]));
    const newBy = Object.fromEntries(days.map((x) => [x.key, x]));
    const now = Date.now();
    const blocked = new Set();
    for (const c of claims.docs.map((s) => s.data())) {
      if (!claimIsTaken(c, now)) continue;
      const was = oldBy[c.dayKey], is = newBy[c.dayKey];
      if (!is || !was || is.kind !== was.kind || priceFor(is, season) !== priceFor(was, season)) blocked.add(c.dayKey);
    }
    if (blocked.size) throw new HttpsError("failed-precondition", `Someone already sponsored ${[...blocked].sort().join(", ")}. Those days can be renamed but not removed or changed. Void those sponsorships first.`, { blocked: [...blocked] });
    tx.update(db.doc("config/season"), { schedule, days });
    return { ok: true, days: days.length };
  });
});

exports.adminSetOffDay = onCall(OPTS, async (req) => {
  await requireOrganizer(req);
  const dayKey = clean(req.data?.dayKey, 10);
  const off = !!req.data?.off;
  return db.runTransaction(async (tx) => {
    const season = await getSeason(tx);
    const day = season.days.find((x) => x.key === dayKey);
    if (!day || day.kind !== "practice") throw new HttpsError("invalid-argument", "Only practice days can be turned off.");
    if (off) {
      const q = await tx.get(db.collectionGroup("claims").where("dayKey", "==", dayKey));
      if (q.docs.some((s) => claimIsTaken(s.data(), Date.now()))) throw new HttpsError("failed-precondition", "Someone already sponsored this day. Void that sponsorship first.");
    }
    const set = new Set(season.offDays || []);
    off ? set.add(dayKey) : set.delete(dayKey);
    tx.update(db.doc("config/season"), { offDays: [...set].sort() });
    return { ok: true };
  });
});

exports.adminRecordPayment = onCall(OPTS, async (req) => {
  await requireOrganizer(req);
  const method = ["cash", "check", "venmo", "cashapp", "paypalme", "zelle", "other"].includes(req.data?.method) ? req.data.method : "cash";
  const { orderId } = await db.runTransaction((tx) => placeOrder(tx, req.data || {}, { method, publicOrder: false }));
  const r = await markOrderPaid(orderId, { provider: method, recordedBy: who(req), at: Date.now() });
  return { ...r, orderId };
});

exports.adminConfirmOrder = onCall(OPTS, async (req) => {
  await requireOrganizer(req);
  const orderId = clean(req.data?.orderId, 40);
  const o = (await db.doc(`orders/${orderId}`).get()).data();
  return markOrderPaid(orderId, { provider: (o && o.method) || "manual", recordedBy: who(req), at: Date.now() });
});

exports.adminVoidOrder = onCall(OPTS, async (req) => {
  await requireOrganizer(req);
  const orderId = clean(req.data?.orderId, 40);
  return db.runTransaction(async (tx) => {
    const ref = db.doc(`orders/${orderId}`);
    const o = (await tx.get(ref)).data();
    if (!o) throw new HttpsError("not-found", "Order not found.");
    if (o.status === "void") return { ok: true };
    const refs = o.dayKeys.map((k) => claimRef(o.wrestlerId, k));
    const snaps = await Promise.all(refs.map((r) => tx.get(r)));
    const msgRef = db.doc(`messages/${orderId}`);
    const msg = await tx.get(msgRef);
    snaps.forEach((s, i) => { if (s.exists && s.data().orderId === orderId) tx.delete(refs[i]); });
    if (o.status === "paid") {
      tx.set(db.doc(`wrestlers/${o.wrestlerId}`), { raisedCents: FieldValue.increment(-o.amountCents), daysPaid: FieldValue.increment(-o.dayKeys.length), sponsorCount: FieldValue.increment(-1) }, { merge: true });
      tx.set(db.doc("team/totals"), { raisedCents: FieldValue.increment(-o.amountCents), daysPaid: FieldValue.increment(-o.dayKeys.length), orders: FieldValue.increment(-1) }, { merge: true });
    }
    if (msg.exists) tx.update(msgRef, { status: "rejected", released: false });
    tx.update(ref, { status: "void", voidedBy: who(req), voidedAt: FieldValue.serverTimestamp() });
    return { ok: true };
  });
});

/* Coaches read every note before an athlete can open it. Approving a note whose day has passed opens it right away. */
exports.adminModerate = onCall(OPTS, async (req) => {
  await requireOrganizer(req);
  const ref = db.doc(`messages/${clean(req.data?.messageId, 40)}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Note not found.");
  const m = snap.data();
  const approve = !!req.data?.approve;
  const text = req.data?.text != null ? cleanText(req.data.text, MAX_MESSAGE) : m.text;
  const due = m.revealAt.toMillis() <= Date.now();
  await ref.update({ status: approve ? "approved" : "rejected", text, released: approve && due, moderatedBy: who(req) });
  const cRef = claimRef(m.wrestlerId, m.revealDay);
  const claim = await cRef.get();
  if (claim.exists && claim.data().orderId === m.orderId) await cRef.update({ hasNote: approve });
  return { ok: true, released: approve && due };
});

/* Every morning at REVEAL_HOUR (team time zone): open approved notes whose morning has come. Opened notes stay open. */
exports.releaseMessages = onSchedule({ schedule: `0 ${REVEAL_HOUR} * * *`, timeZone: TZ }, async () => {
  const q = await db.collection("messages").where("status", "==", "approved").where("released", "==", false)
    .where("revealAt", "<=", Timestamp.now()).get();
  for (let i = 0; i < q.docs.length; i += 400) {
    const batch = db.batch();
    q.docs.slice(i, i + 400).forEach((d) => batch.update(d.ref, { released: true }));
    await batch.commit();
  }
});

/* Retention (promised in docs/privacy.html): 90 days after the season's last day, delete athlete and sponsor data,
   unless an organizer has renewed the team (config/season.renewedFor set to a later season). Totals stay as numbers. */
const RETENTION_DAYS = 90;
async function purgeIfExpired(nowMs) {
  const snap = await db.doc("config/season").get();
  if (!snap.exists) return { purged: false };
  const lastDay = TEAM.schedule.lastDay;
  const due = Date.parse(lastDay + "T00:00:00Z") + RETENTION_DAYS * 864e5;
  if (nowMs < due || snap.data().renewedFor) return { purged: false };
  let n = 0;
  const wipe = async (q) => { const r = await q.get(); for (const d of r.docs) { await d.ref.delete(); n++; } };
  const ws = await db.collection("wrestlers").get();
  for (const w of ws.docs) { await wipe(db.collection(`wrestlers/${w.id}/claims`)); await w.ref.delete(); n++; }
  for (const c of ["wrestlerPrivate", "rosterEmails", "orders", "messages"]) await wipe(db.collection(c));
  await db.doc("config/season").set({ purgedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { purged: true, deleted: n };
}
exports.retention = onSchedule({ schedule: "30 3 * * *", timeZone: TZ }, async () => { await purgeIfExpired(Date.now()); });

