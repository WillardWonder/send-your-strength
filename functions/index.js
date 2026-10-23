/**
 * Send Your Strength – Cloud Functions
 *
 * Team-specific settings (names, schedule, prices, time zone, default text) come from team.json,
 * which scripts/sync-config.js copies here from the repo root.
 *
 * Browsers only read public data (see firestore.rules). Every write happens here,
 * so nobody can mark a day paid, change a total, or read an athlete's notes from devtools.
 *
 * Roles live in Firebase Auth custom claims and are re-checked by claimRoles on every sign-in:
 *   admin: true          – email is in the ADMIN_EMAILS parameter
 *   wrestlerId: "<id>"   – email was on the roster CSV an organizer imported (and she's still active)
 *
 * Each athlete has a readable link: https://<site>/<slug>, e.g. /addison-clark.
 * (Internal collection names say "wrestlers" because the project started as a wrestling fundraiser;
 *  they work the same for any sport.)
 *
 * Money flow:
 *   createOrder        holds the picked days and prices them server-side (never trusts the browser's price)
 *   mockPay            PAYMENT_MODE=mock only: stands in for a payment processor. Never use mock in production.
 *   adminConfirmOrder  organizer confirms money that arrived outside the page (manual mode)
 *   adminRecordPayment cash / check / Venmo handed over in person
 *   markOrderPaid      the ONE place an order becomes paid. A real processor's verified webhook calls this too.
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

// manual = sponsors pay the booster club directly and organizers confirm it (safe default for go-live)
// mock   = test payments that move no money (anyone holding an order id could mark it paid: testing only)
const PAYMENT_MODE = defineString("PAYMENT_MODE", { default: "manual" });
const ADMIN_EMAILS = defineString("ADMIN_EMAILS", { default: "" });

const holdMinutes = () => (PAYMENT_MODE.value() === "manual" ? 72 * 60 : 15);
const MAX_DAYS_PER_ORDER = 40;
const MAX_MESSAGE = 280;
const MAX_ASK = 900;
const OPTS = { cors: true, maxInstances: 10 };
const RESERVED_SLUGS = new Set(["index", "app", "admin", "organizer", "signin", "login", "api", "assets", "team", "demo", "logo", "docs", "standings", "calendar"]);

/* ---------------- helpers ---------------- */
const claimId = (wrestlerId, dayKey) => `${wrestlerId}__${dayKey}`;
const clean = (s, max) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
const cleanText = (s, max) => String(s ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
const emailKey = (e) => String(e || "").trim().toLowerCase();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const who = (req) => req.auth.token.email || req.auth.uid;

const TZ = TEAM.timezone || "America/Chicago";
const REVEAL_HOUR = Number.isInteger(TEAM.revealHour) ? TEAM.revealHour : 5;
// A note opens at REVEAL_HOUR on its day in the team's time zone (daylight saving handled).
const revealAtFor = (dayKey) => Timestamp.fromDate(zonedTimeToUtc(dayKey, REVEAL_HOUR, TZ));

// {first} fills in here; {practice} and {meet} fill in on the page so they track price changes.
const defaultAsk = (first) => String(TEAM.copy.defaultAsk).replace(/\{first\}/g, first);
const cleanDetail = (v) => clean(v, 12);

function requireAdmin(req) {
  if (!req.auth || req.auth.token.admin !== true) throw new HttpsError("permission-denied", "Organizer sign-in required.");
}
function requireAthlete(req) {
  const id = req.auth && req.auth.token.wrestlerId;
  if (!id) throw new HttpsError("permission-denied", "Sign in with the school email your coach has on the roster.");
  return id;
}

/* Photos must come from this project's own Storage bucket (or the local emulator). */
function checkPhotoUrl(url) {
  if (!url) return "";
  if (url.startsWith("https://firebasestorage.googleapis.com/") || url.startsWith("http://127.0.0.1:9199/")) return url;
  throw new HttpsError("invalid-argument", "Upload the photo from this page.");
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

const slugify = (name) =>
  clean(name, 80).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "") || "wrestler";

async function uniqueSlug(base, selfId) {
  for (let i = 1; i < 100; i++) {
    const cand = i === 1 ? base : `${base}-${i}`;
    if (RESERVED_SLUGS.has(cand)) continue;
    const q = await db.collection("wrestlers").where("slug", "==", cand).get();
    if (q.docs.every((d) => d.id === selfId)) return cand;
  }
  throw new HttpsError("already-exists", "Couldn't find a free link for that name.");
}

async function getSeason(tx) {
  const ref = db.doc("config/season");
  const snap = tx ? await tx.get(ref) : await ref.get();
  if (!snap.exists) throw new HttpsError("failed-precondition", "The season isn't set up yet.");
  return snap.data();
}
const priceFor = (day, season) => day.priceCents || (day.kind === "event" ? season.practicePriceCents * season.eventMultiplier : season.practicePriceCents);
const claimIsTaken = (c, now) => !!c && (c.status === "paid" || (c.status === "held" && c.holdExpires && c.holdExpires.toMillis() > now));

/* Validates an order and writes it with holds. Must run inside a transaction (all reads before writes). */
async function placeOrder(tx, input, { method }) {
  const season = await getSeason(tx);
  const wrestlerId = clean(input.wrestlerId, 40);
  const wSnap = await tx.get(db.doc(`wrestlers/${wrestlerId}`));
  if (!wSnap.exists || wSnap.data().active === false) throw new HttpsError("not-found", "That athlete isn't on the roster.");

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
  const claimRefs = dayKeys.map((k) => db.doc(`claims/${claimId(wrestlerId, k)}`));
  const claimSnaps = await Promise.all(claimRefs.map((r) => tx.get(r)));
  const taken = claimSnaps.filter((s) => claimIsTaken(s.data(), now)).map((s) => s.data().dayKey);
  if (taken.length) throw new HttpsError("already-exists", "Someone just took one of those days.", { taken });

  const amountCents = dayKeys.reduce((sum, k) => sum + priceFor(byKey[k], season), 0);
  const units = dayKeys.reduce((sum, k) => sum + (byKey[k].kind === "event" ? season.eventMultiplier : 1), 0);
  const orderRef = db.collection("orders").doc();
  const holdExpires = Timestamp.fromMillis(now + holdMinutes() * 60 * 1000);

  tx.set(orderRef, {
    wrestlerId, dayKeys, amountCents, units, donorName, anon, contact, message, revealDay,
    status: "pending", method, createdAt: FieldValue.serverTimestamp(),
  });
  claimRefs.forEach((ref, i) => tx.set(ref, {
    wrestlerId, dayKey: dayKeys[i], status: "held", orderId: orderRef.id,
    displayName: anon ? "Anonymous" : donorName, hasNote: false, holdExpires,
  }));
  return { orderId: orderRef.id, amountCents, holdExpires: holdExpires.toMillis() };
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
    const refs = o.dayKeys.map((k) => db.doc(`claims/${claimId(o.wrestlerId, k)}`));
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
  return db.runTransaction((tx) => placeOrder(tx, req.data || {}, { method: "online" }));
});

exports.mockPay = onCall(OPTS, async (req) => {
  if (PAYMENT_MODE.value() !== "mock") throw new HttpsError("failed-precondition", "Test payments are turned off.");
  await rateLimit(req, "mockpay", 20, 10 * 60 * 1000);
  return markOrderPaid(clean(req.data?.orderId, 40), { provider: "mock", ref: `mock_${Date.now()}`, at: Date.now() });
});

exports.paymentMode = onCall(OPTS, async () => ({ mode: PAYMENT_MODE.value() }));

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
  return { ...claims, changed };
});

/* ---------------- the wrestler herself ---------------- */
exports.athleteUpdateProfile = onCall(OPTS, async (req) => {
  const id = requireAthlete(req);
  const d = req.data || {};
  const patch = {};
  if (d.askText != null) patch.askText = cleanText(d.askText, MAX_ASK);
  if (d.photoUrl != null) { patch.photoUrl = checkPhotoUrl(clean(d.photoUrl, 600)); patch.photoCutout = !!d.photoCutout; }
  if (!Object.keys(patch).length) return { ok: true };
  await db.doc(`wrestlers/${id}`).set(patch, { merge: true });
  return { ok: true };
});

/* ---------------- organizers ---------------- */
exports.adminSetup = onCall(OPTS, async (req) => {
  requireAdmin(req);
  const ref = db.doc("config/season");
  const snap = await ref.get();
  const prev = snap.exists ? snap.data() : {};
  await ref.set({
    season: TEAM.team.season,
    days: buildSeasonDays(),
    breaks: TEAM.schedule.breaks || {},
    offDays: prev.offDays || [],
    practicePriceCents: prev.practicePriceCents || TEAM.prices.practiceCents,
    eventMultiplier: TEAM.prices.eventMultiplier,
    rewardName: prev.rewardName || TEAM.reward.name,
    rewardText: prev.rewardText || TEAM.reward.text,
    payNote: prev.payNote || TEAM.payNote,
    match: prev.match || null,
  });
  await db.doc("team/totals").set({ raisedCents: FieldValue.increment(0), daysPaid: FieldValue.increment(0), orders: FieldValue.increment(0) }, { merge: true });
  // Give every athlete a readable link if they don't have one yet.
  const all = await db.collection("wrestlers").get();
  for (const w of all.docs) {
    if (!w.data().slug) await w.ref.update({ slug: await uniqueSlug(slugify(w.data().name), w.id) });
  }
  return { ok: true };
});

exports.adminSettings = onCall(OPTS, async (req) => {
  requireAdmin(req);
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

/* CSV import: rows of {name, email, weight}. Matches existing athletes by email, so re-importing is safe.
   An athlete's link (slug) is set once from their name and never changes on re-import, so links already sent keep working. */
exports.adminImportRoster = onCall(OPTS, async (req) => {
  requireAdmin(req);
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
      const patch = { name, active: true };
      if (weight) patch.weight = weight;
      await db.doc(`wrestlers/${map.data().wrestlerId}`).set(patch, { merge: true });
      result.updated++;
    } else {
      const wRef = db.collection("wrestlers").doc();
      const slug = await uniqueSlug(slugify(name), wRef.id);
      const batch = db.batch();
      batch.set(wRef, {
        name, slug, weight, photoUrl: "", photoCutout: false, askText: defaultAsk(name.split(/\s+/)[0]),
        active: true, raisedCents: 0, daysPaid: 0, sponsorCount: 0, createdAt: FieldValue.serverTimestamp(),
      });
      batch.set(mapRef, { wrestlerId: wRef.id });
      batch.set(db.doc(`wrestlerPrivate/${wRef.id}`), { email });
      await batch.commit();
      result.added++;
    }
  }
  return result;
});

exports.adminSaveWrestler = onCall(OPTS, async (req) => {
  requireAdmin(req);
  const d = req.data || {};
  const id = clean(d.id, 40);
  if (!id) throw new HttpsError("invalid-argument", "Add athletes with the roster CSV so each one gets a login.");
  const snap = await db.doc(`wrestlers/${id}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "Athlete not found.");
  const patch = {};
  if (d.name != null) patch.name = clean(d.name, 40) || "Wrestler";
  if (d.weight != null) patch.weight = cleanDetail(d.weight);
  if (d.askText != null) patch.askText = cleanText(d.askText, MAX_ASK);
  if (d.photoUrl != null) { patch.photoUrl = checkPhotoUrl(clean(d.photoUrl, 600)); patch.photoCutout = !!d.photoCutout; }
  if (d.active != null) patch.active = !!d.active;
  if (d.slug != null && d.slug !== snap.data().slug) {
    const slug = clean(d.slug, 40).toLowerCase();
    if (slug.length < 2 || !SLUG_RE.test(slug) || RESERVED_SLUGS.has(slug)) throw new HttpsError("invalid-argument", "Links can use lowercase letters, numbers, and dashes, like addison-clark.");
    if ((await uniqueSlug(slug, id)) !== slug) throw new HttpsError("already-exists", "Another athlete already has that link.");
    patch.slug = slug;
  }
  await db.doc(`wrestlers/${id}`).set(patch, { merge: true });
  return { id, slug: patch.slug || snap.data().slug };
});

exports.adminSetOffDay = onCall(OPTS, async (req) => {
  requireAdmin(req);
  const dayKey = clean(req.data?.dayKey, 10);
  const off = !!req.data?.off;
  return db.runTransaction(async (tx) => {
    const season = await getSeason(tx);
    const day = season.days.find((x) => x.key === dayKey);
    if (!day || day.kind !== "practice") throw new HttpsError("invalid-argument", "Only practice days can be turned off.");
    if (off) {
      const q = await tx.get(db.collection("claims").where("dayKey", "==", dayKey));
      if (q.docs.some((s) => claimIsTaken(s.data(), Date.now()))) throw new HttpsError("failed-precondition", "Someone already sponsored this day. Void that sponsorship first.");
    }
    const set = new Set(season.offDays || []);
    off ? set.add(dayKey) : set.delete(dayKey);
    tx.update(db.doc("config/season"), { offDays: [...set].sort() });
    return { ok: true };
  });
});

exports.adminRecordPayment = onCall(OPTS, async (req) => {
  requireAdmin(req);
  const method = ["cash", "check", "venmo", "other"].includes(req.data?.method) ? req.data.method : "cash";
  const { orderId } = await db.runTransaction((tx) => placeOrder(tx, req.data || {}, { method }));
  const r = await markOrderPaid(orderId, { provider: method, recordedBy: who(req), at: Date.now() });
  return { ...r, orderId };
});

exports.adminConfirmOrder = onCall(OPTS, async (req) => {
  requireAdmin(req);
  return markOrderPaid(clean(req.data?.orderId, 40), { provider: "manual", recordedBy: who(req), at: Date.now() });
});

exports.adminVoidOrder = onCall(OPTS, async (req) => {
  requireAdmin(req);
  const orderId = clean(req.data?.orderId, 40);
  return db.runTransaction(async (tx) => {
    const ref = db.doc(`orders/${orderId}`);
    const o = (await tx.get(ref)).data();
    if (!o) throw new HttpsError("not-found", "Order not found.");
    if (o.status === "void") return { ok: true };
    const refs = o.dayKeys.map((k) => db.doc(`claims/${claimId(o.wrestlerId, k)}`));
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
  requireAdmin(req);
  const ref = db.doc(`messages/${clean(req.data?.messageId, 40)}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Note not found.");
  const m = snap.data();
  const approve = !!req.data?.approve;
  const text = req.data?.text != null ? cleanText(req.data.text, MAX_MESSAGE) : m.text;
  const due = m.revealAt.toMillis() <= Date.now();
  await ref.update({ status: approve ? "approved" : "rejected", text, released: approve && due, moderatedBy: who(req) });
  const claimRef = db.doc(`claims/${claimId(m.wrestlerId, m.revealDay)}`);
  const claim = await claimRef.get();
  if (claim.exists && claim.data().orderId === m.orderId) await claimRef.update({ hasNote: approve });
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
