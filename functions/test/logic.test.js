// Runs the real Cloud Functions code against an in-memory Firestore stand-in.
// Usage: node test/logic.test.js   (no emulator needed)
const Module = require("module");
const assert = require("assert");

/* ---------- in-memory Firestore ---------- */
const store = new Map();
let autoId = 0;
class Ts { constructor(ms) { this.ms = ms; } toMillis() { return this.ms; } }
const Timestamp = { fromDate: (d) => new Ts(d.getTime()), fromMillis: (m) => new Ts(m), now: () => new Ts(Date.now()) };
const INC = Symbol("inc"), SRV = Symbol("srv"), DEL = Symbol("del");
const FieldValue = { increment: (n) => ({ [INC]: n }), serverTimestamp: () => ({ [SRV]: true }), delete: () => ({ [DEL]: true }) };
const cmp = (v) => (v instanceof Ts ? v.ms : v);
function applyFields(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v && v[INC] !== undefined) out[k] = (out[k] || 0) + v[INC];
    else if (v && v[SRV]) out[k] = new Ts(Date.now());
    else if (v && v[DEL]) delete out[k];
    else out[k] = v;
  }
  return out;
}
class DocRef {
  constructor(path) { this.path = path; this.id = path.split("/").pop(); }
  async get() { return snap(this); }
  async set(d, o) { write(this, "set", d, o); }
  async update(d) { write(this, "update", d); }
  async delete() { write(this, "delete"); }
}
function snap(ref) { const d = store.get(ref.path); return { exists: !!d, id: ref.id, ref, data: () => (d ? { ...d } : undefined) }; }
function write(ref, op, d, o) {
  if (op === "delete") return store.delete(ref.path);
  if (op === "update" && !store.has(ref.path)) throw new Error("update on missing doc " + ref.path);
  const base = op === "set" && !(o && o.merge) ? {} : store.get(ref.path) || {};
  store.set(ref.path, applyFields(base, d));
}
const matches = (d, filters) => filters.every(([f, op, v]) => op === "==" ? cmp(d[f]) === cmp(v) : op === "<=" ? cmp(d[f]) <= cmp(v) : false);
class Query {
  constructor(coll, filters = [], group = false) { this.coll = coll; this.filters = filters; this.group = group; }
  where(f, op, v) { return new Query(this.coll, [...this.filters, [f, op, v]], this.group); }
  async get() {
    const docs = [];
    for (const [p, d] of store) {
      const segs = p.split("/");
      const inColl = this.group ? segs.length % 2 === 0 && segs[segs.length - 2] === this.coll : segs.slice(0, -1).join("/") === this.coll;
      if (inColl && matches(d, this.filters)) docs.push(snap(new DocRef(p)));
    }
    return { docs, empty: !docs.length };
  }
}
class CollRef extends Query { doc(id) { return new DocRef(`${this.coll}/${id || "auto" + ++autoId}`); } }
const db = {
  doc: (p) => new DocRef(p),
  collection: (p) => new CollRef(p),
  collectionGroup: (name) => new Query(name, [], true),
  batch() { const ops = []; return { set: (r, d, o) => ops.push(() => write(r, "set", d, o)), update: (r, d) => ops.push(() => write(r, "update", d)), commit: async () => ops.forEach((f) => f()) }; },
  async runTransaction(fn) {
    const ops = []; let wrote = false;
    const tx = {
      get: async (r) => { if (wrote) throw new Error("Transaction read after write"); return r instanceof Query ? r.get() : snap(r); },
      set: (r, d, o) => { wrote = true; ops.push(() => write(r, "set", d, o)); },
      update: (r, d) => { wrote = true; ops.push(() => write(r, "update", d)); },
      delete: (r) => { wrote = true; ops.push(() => write(r, "delete")); },
    };
    const res = await fn(tx); ops.forEach((f) => f()); return res;
  },
};
const claimsSet = {};
class HttpsError extends Error { constructor(code, msg, details) { super(msg); this.code = code; this.details = details; } }
const params = { ADMIN_EMAILS: "coach@example.org", PAYMENT_MODE: "mock", PLATFORM_FEE_PERCENT: "5", FEE_ON_LINK_PAYMENTS: "no" };
const fakes = {
  "firebase-admin/app": { initializeApp: () => {} },
  "firebase-admin/firestore": { getFirestore: () => db, FieldValue, Timestamp },
  "firebase-admin/auth": { getAuth: () => ({ setCustomUserClaims: async (uid, c) => { claimsSet[uid] = c; } }) },
  "firebase-functions/v2/https": { onCall: (o, h) => h, onRequest: (o, h) => h, HttpsError },
  "firebase-functions/v2/scheduler": { onSchedule: (o, h) => h },
  "firebase-functions/params": { defineString: (n, o) => ({ value: () => (n in params ? params[n] : o.default) }) },
};
const origLoad = Module._load;
Module._load = function (req, ...rest) { return fakes[req] || origLoad.call(this, req, ...rest); };
const fn = require("../index.js");

/* ---------- helpers ---------- */
const admin = { auth: { uid: "coach", token: { admin: true, email: "coach@example.org", email_verified: true } } };
const get = (p) => store.get(p);
const claim = (w, k) => get(`wrestlers/${w}/claims/${k}`);
const expectErr = async (p, code) => { try { await p; assert.fail("expected " + code); } catch (e) { assert.strictEqual(e.code, code, e.message); } };
let passed = 0; const t = async (name, f) => { await f(); passed++; console.log("  ✓ " + name); };
const pub = (extra) => ({ auth: null, ...extra });
const order = (w, dayKeys, more = {}) => fn.createOrder(pub({ data: { wrestlerId: w, dayKeys, donorName: "Grandma", acceptTerms: true, ...more } }));

/* Dates and prices come from whatever team.json is loaded, so these tests run for any team. */
const { TEAM, buildSeasonDays, zonedTimeToUtc: z2u } = require("../schedule.js");
const DAYS = buildSeasonDays();
const P = DAYS.filter((d) => d.kind === "practice").map((d) => d.key);
const E = DAYS.filter((d) => d.kind === "event" && !d.post);
const POST = DAYS.filter((d) => d.post);
const PC = TEAM.prices.practiceCents, EC = PC * TEAM.prices.eventMultiplier;
const ORDER = [P[0], E[0].key], ORDER_AMT = PC + (E[0].priceCents || EC);
const BREAK = Object.keys(TEAM.schedule.breaks || {})[0] || "2026-12-25";
assert.ok(P.length >= 25 && E.length >= 1 && POST.length >= 1, "team.json needs at least 25 practices, 1 regular event and 1 postseason event for these tests");
const ATTEST = ["terms"];

(async () => {
  console.log("Send Your Strength function tests (" + TEAM.team.name + ")");
  const { termsVersion: V } = await fn.paymentMode({});

  /* ---- organizer terms ---- */
  await t("non-admin can't set up", () => expectErr(fn.adminSetup({ auth: { uid: "x", token: {} }, data: {} }), "permission-denied"));
  await t("organizer tools are locked until the organizer terms are accepted with every statement", async () => {
    await expectErr(fn.adminSetup({ ...admin, data: {} }), "failed-precondition");
    await expectErr(fn.acceptOrganizerTerms({ ...admin, data: { version: V, attest: [] } }), "invalid-argument");
    await expectErr(fn.acceptOrganizerTerms({ ...admin, data: { version: "old", attest: ATTEST } }), "failed-precondition");
    await expectErr(fn.acceptOrganizerTerms({ auth: { uid: "x", token: {} }, data: { version: V, attest: ATTEST } }), "permission-denied");
    await fn.acceptOrganizerTerms({ ...admin, data: { version: V, attest: ATTEST } });
    assert.strictEqual(get(`acceptances/org_coach_${V}`).attest.length, 1);
  });
  await t("setup writes the season from team.json", async () => {
    await fn.adminSetup({ ...admin, data: {} });
    assert.strictEqual(get("config/season").days.length, DAYS.length);
    assert.strictEqual(get("config/season").practicePriceCents, PC);
  });

  /* ---- roster, privacy, links ---- */
  let kenzie;
  await t("CSV import: public record has only a display name; full name and email stay private; re-import updates", async () => {
    const r1 = await fn.adminImportRoster({ ...admin, data: { rows: [{ name: "Kenzie Rae", email: "Kenzie.R@example.org", weight: "126" }, { name: "Bad", email: "nope" }] } });
    assert.deepStrictEqual([r1.added, r1.updated, r1.skipped.length], [1, 0, 1]);
    kenzie = get("rosterEmails/kenzie.r@example.org").wrestlerId;
    const w = get(`wrestlers/${kenzie}`);
    assert.strictEqual(w.displayName, TEAM.athletes.nameDisplay === "full" ? "Kenzie Rae" : "Kenzie R.");
    assert.strictEqual(w.name, undefined, "no full name on the public record");
    assert.strictEqual(w.published, false, "starts unpublished");
    assert.ok(!JSON.stringify(w).includes("@"), "no email on the public record");
    assert.deepStrictEqual(get(`wrestlerPrivate/${kenzie}`), { email: "kenzie.r@example.org", name: "Kenzie Rae" });
    assert.ok(w.askText.includes("{practice}"));
    const r2 = await fn.adminImportRoster({ ...admin, data: { rows: [{ name: "Kenzie Rae", email: "kenzie.r@example.org", weight: "132" }] } });
    assert.deepStrictEqual([r2.added, r2.updated], [0, 1]);
    assert.strictEqual(get(`wrestlers/${kenzie}`).weight, "132");
  });
  await t("claimRoles: roster email -> wrestlerId; organizer -> admin with terms status; stranger -> none; stale admin removed", async () => {
    const strip = ({ changed, termsVersion, orgTerms, ...c }) => c;
    assert.deepStrictEqual(strip(await fn.claimRoles({ auth: { uid: "k", token: { email: "kenzie.r@example.org", email_verified: true } } })), { wrestlerId: kenzie });
    const c = await fn.claimRoles({ auth: { uid: "coach", token: { email: "coach@example.org", email_verified: true } } });
    assert.deepStrictEqual([c.admin, c.orgTerms], [true, true]);
    assert.strictEqual((await fn.claimRoles({ auth: { uid: "coach2", token: { email: "coach@example.org", email_verified: true } } })).orgTerms, false, "each organizer accepts for themselves");
    assert.deepStrictEqual(strip(await fn.claimRoles({ auth: { uid: "s", token: { email: "random@gmail.com", email_verified: true } } })), {});
    await expectErr(fn.claimRoles({ auth: { uid: "u", token: { email: "kenzie.r@example.org", email_verified: false } } }), "permission-denied");
    const r = await fn.claimRoles({ auth: { uid: "x", token: { email: "former.coach@example.org", email_verified: true, admin: true } } });
    assert.strictEqual(r.changed, true); assert.deepStrictEqual(claimsSet.x, {});
  });
  const me = (id) => ({ auth: { uid: "k-" + id, token: { wrestlerId: id, email: "kenzie.r@example.org" } } });
  await t("an unpublished page can't take sponsorships", () => expectErr(order(kenzie, [P[0]]), "failed-precondition"));
  await t("only the athlete publishes, only with a parent's approval of the current terms", async () => {
    await expectErr(fn.athletePublish({ ...me(kenzie), data: { version: V } }), "failed-precondition");
    await expectErr(fn.athletePublish({ ...me(kenzie), data: { version: "old", parentApproved: true } }), "failed-precondition");
    await expectErr(fn.athletePublish({ auth: { uid: "s", token: {} }, data: { version: V, parentApproved: true } }), "permission-denied");
    await fn.athletePublish({ ...me(kenzie), data: { version: V, parentApproved: true } });
    assert.strictEqual(get(`wrestlers/${kenzie}`).published, true);
    assert.ok(get(`acceptances/ath_${kenzie}_${V}`));
  });
  await t("organizers can unpublish but never publish", async () => {
    await expectErr(fn.adminSetPublished({ ...admin, data: { id: kenzie, published: true } }), "permission-denied");
    await fn.adminSetPublished({ ...admin, data: { id: kenzie, published: false } });
    assert.strictEqual(get(`wrestlers/${kenzie}`).published, false);
    await fn.athletePublish({ ...me(kenzie), data: { version: V, parentApproved: true } });
  });
  await t("photos need parent approval and must come from the project's own storage; removing always works", async () => {
    const url = "https://firebasestorage.googleapis.com/v0/b/x/o/p.jpg";
    await expectErr(fn.athleteUpdateProfile({ ...me(kenzie), data: { photoUrl: url } }), "failed-precondition");
    await expectErr(fn.athleteUpdateProfile({ ...me(kenzie), data: { photoUrl: "https://evil.example/x.png", photoConsent: true } }), "invalid-argument");
    await expectErr(fn.adminSaveWrestler({ ...admin, data: { id: kenzie, photoUrl: url } }), "failed-precondition");
    await fn.athleteUpdateProfile({ ...me(kenzie), data: { photoUrl: url, photoConsent: true } });
    assert.deepStrictEqual([get(`wrestlers/${kenzie}`).photoUrl, get(`wrestlers/${kenzie}`).photoConsent], [url, true]);
    await fn.athleteUpdateProfile({ ...me(kenzie), data: { photoUrl: "" } });
    assert.deepStrictEqual([get(`wrestlers/${kenzie}`).photoUrl, get(`wrestlers/${kenzie}`).photoConsent], ["", false]);
  });
  await t("renaming updates the private name and the public display name", async () => {
    await fn.adminSaveWrestler({ ...admin, data: { id: kenzie, name: "Kenzie Rae Olson" } });
    assert.strictEqual(get(`wrestlerPrivate/${kenzie}`).name, "Kenzie Rae Olson");
    assert.ok(/^Kenzie/.test(get(`wrestlers/${kenzie}`).displayName));
    assert.strictEqual(get(`wrestlers/${kenzie}`).name, undefined);
  });
  await t("setup moves a full name left on an old public record to the private record", async () => {
    store.set("wrestlers/legacy1", { name: "Old Record", slug: "old-record", active: true, published: true });
    await fn.adminSetup({ ...admin, data: {} });
    assert.strictEqual(get("wrestlers/legacy1").name, undefined);
    assert.strictEqual(get("wrestlerPrivate/legacy1").name, "Old Record");
    assert.ok(get("wrestlers/legacy1").displayName);
    store.delete("wrestlers/legacy1"); store.delete("wrestlerPrivate/legacy1");
  });

  /* ---- sponsoring ---- */
  await t("sponsors must agree to the terms", () => expectErr(fn.createOrder(pub({ data: { wrestlerId: kenzie, dayKeys: [P[0]], donorName: "X" } })), "invalid-argument"));
  await t("one caller can't spam holds: the 11th order in 10 minutes is refused", async () => {
    const spam = { rawRequest: { headers: { "x-forwarded-for": "1.2.3.4, 203.0.113.9" } } };
    for (const k of P.slice(10, 20)) await fn.createOrder(pub({ ...spam, data: { wrestlerId: kenzie, dayKeys: [k], donorName: "Bot", acceptTerms: true } }));
    await expectErr(fn.createOrder(pub({ ...spam, data: { wrestlerId: kenzie, dayKeys: [P[20]], donorName: "Bot", acceptTerms: true } })), "resource-exhausted");
    await fn.createOrder(pub({ rawRequest: { headers: { "x-forwarded-for": "1.2.3.4, 198.51.100.7" } }, data: { wrestlerId: kenzie, dayKeys: [P[20]], donorName: "Real person", acceptTerms: true } }));
  });
  let o1;
  await t("createOrder prices server-side (practice + event), holds days under the athlete, records the terms version", async () => {
    o1 = await order(kenzie, ORDER, { message: "Go get em!", revealDay: E[0].key, amountCents: 1 });
    assert.strictEqual(o1.amountCents, ORDER_AMT);
    assert.strictEqual(claim(kenzie, P[0]).status, "held");
    assert.strictEqual(get(`orders/${o1.orderId}`).termsVersion, V);
  });
  await t("postseason days use their own prices from team.json", async () => {
    const r = await order(kenzie, POST.map((d) => d.key), { donorName: "Coach" });
    assert.strictEqual(r.amountCents, POST.reduce((a, d) => a + (d.priceCents || EC), 0));
  });
  await t("match: organizer sets a real match; blank clears it", async () => {
    await fn.adminSettings({ ...admin, data: { practicePriceCents: 500, rewardName: "Backer", rewardText: "", payNote: "", matchName: "Main St Hardware", matchCapCents: 100000 } });
    assert.deepStrictEqual(get("config/season").match, { name: "Main St Hardware", capCents: 100000 });
    await fn.adminSettings({ ...admin, data: { practicePriceCents: 500, rewardName: "Backer", rewardText: "", payNote: "", matchName: "", matchCapCents: 0 } });
    assert.strictEqual(get("config/season").match, null);
  });
  await t("a second sponsor can't grab a held day", () => expectErr(order(kenzie, [E[0].key], { donorName: "Other" }), "already-exists"));
  await t("off days and fake days are rejected", () => expectErr(order(kenzie, [BREAK]), "invalid-argument"));
  await t("mockPay marks paid, updates totals, files a pending private note", async () => {
    const r = await fn.mockPay(pub({ data: { orderId: o1.orderId } }));
    assert.strictEqual(r.status, "paid");
    assert.strictEqual(claim(kenzie, E[0].key).status, "paid");
    assert.strictEqual(claim(kenzie, E[0].key).hasNote, true);
    assert.strictEqual(get(`wrestlers/${kenzie}`).raisedCents, ORDER_AMT);
    assert.strictEqual(get("team/totals").raisedCents, ORDER_AMT);
    assert.deepStrictEqual([get(`messages/${o1.orderId}`).status, get(`messages/${o1.orderId}`).released], ["pending", false]);
  });
  await t("paying twice doesn't double count", async () => {
    await fn.mockPay(pub({ data: { orderId: o1.orderId } }));
    assert.strictEqual(get("team/totals").raisedCents, ORDER_AMT);
  });
  await t("approved note stays sealed until the team's reveal hour on its day, then stays open", async () => {
    await fn.adminModerate({ ...admin, data: { messageId: o1.orderId, approve: true } });
    assert.deepStrictEqual([get(`messages/${o1.orderId}`).status, get(`messages/${o1.orderId}`).released], ["approved", false]);
    await fn.releaseMessages();
    assert.strictEqual(get(`messages/${o1.orderId}`).released, false, "future note stays sealed");
    const realNow = Date.now;
    const opens = z2u(E[0].key, TEAM.revealHour, TEAM.timezone).getTime();
    Date.now = () => opens - 60 * 1000;
    try { await fn.releaseMessages(); assert.strictEqual(get(`messages/${o1.orderId}`).released, false, "not before the reveal hour");
      Date.now = () => opens + 30 * 1000; await fn.releaseMessages(); } finally { Date.now = realNow; }
    assert.strictEqual(get(`messages/${o1.orderId}`).released, true);
    await fn.releaseMessages();
    assert.strictEqual(get(`messages/${o1.orderId}`).released, true, "stays open");
  });
  await t("expired hold + someone else took the day -> conflict, no double booking", async () => {
    const realNow = Date.now;
    const a = await order(kenzie, [P[1]], { donorName: "Slow" });
    Date.now = () => realNow() + 16 * 60 * 1000;
    try {
      const b = await order(kenzie, [P[1]], { donorName: "Fast" });
      await fn.mockPay(pub({ data: { orderId: b.orderId } }));
      assert.strictEqual((await fn.mockPay(pub({ data: { orderId: a.orderId } }))).status, "conflict");
      assert.strictEqual(claim(kenzie, P[1]).displayName, "Fast");
    } finally { Date.now = realNow; }
  });
  await t("cash recorded by an organizer counts toward her total", async () => {
    const before = get(`wrestlers/${kenzie}`).raisedCents;
    await fn.adminRecordPayment({ ...admin, data: { wrestlerId: kenzie, dayKeys: [P[2]], donorName: "Neighbor", method: "cash" } });
    assert.strictEqual(get(`wrestlers/${kenzie}`).raisedCents, before + PC);
  });
  await t("voiding reverses totals and frees the days", async () => {
    const before = get("team/totals").raisedCents;
    await fn.adminVoidOrder({ ...admin, data: { orderId: o1.orderId } });
    assert.strictEqual(get("team/totals").raisedCents, before - ORDER_AMT);
    assert.strictEqual(claim(kenzie, E[0].key), undefined);
    assert.strictEqual(get(`messages/${o1.orderId}`).status, "rejected");
  });
  await t("can't turn off a sponsored practice day (checks every athlete's claims)", () => expectErr(fn.adminSetOffDay({ ...admin, data: { dayKey: P[2], off: true } }), "failed-precondition"));
  await t("an open practice day can be turned off and back on", async () => {
    await fn.adminSetOffDay({ ...admin, data: { dayKey: P[24], off: true } });
    assert.ok(get("config/season").offDays.includes(P[24]));
    await fn.adminSetOffDay({ ...admin, data: { dayKey: P[24], off: false } });
  });
  await t("a wrestler edits only her own message; outsiders can't", async () => {
    await fn.athleteUpdateProfile({ ...me(kenzie), data: { askText: "My own words." } });
    assert.strictEqual(get(`wrestlers/${kenzie}`).askText, "My own words.");
    await expectErr(fn.athleteUpdateProfile({ auth: { uid: "s", token: {} }, data: { askText: "hack" } }), "permission-denied");
  });

  /* ---- payment options and fees ---- */
  await t("fee disclosure: shown with the percentage when the fee is above 0, empty at 0, capped at 20%", async () => {
    params.PLATFORM_FEE_PERCENT = "5"; assert.ok((await fn.paymentMode({})).disclosure.includes("5%"));
    params.PLATFORM_FEE_PERCENT = "0"; assert.strictEqual((await fn.paymentMode({})).disclosure, "");
    params.PLATFORM_FEE_PERCENT = "99"; assert.strictEqual((await fn.paymentMode({})).feePercent, 20);
    params.PLATFORM_FEE_PERCENT = "5";
  });
  await t("payment links: validated, one per type, no card types, organizers only", async () => {
    await expectErr(fn.adminSetPaymentOptions({ auth: { uid: "s", token: {} }, data: { links: [] } }), "permission-denied");
    await expectErr(fn.adminSetPaymentOptions({ ...admin, data: { links: [{ type: "venmo", value: "x" }] } }), "invalid-argument");
    await expectErr(fn.adminSetPaymentOptions({ ...admin, data: { links: [{ type: "stripe", value: "acct" }] } }), "invalid-argument");
    await expectErr(fn.adminSetPaymentOptions({ ...admin, data: { links: [{ type: "venmo", value: "Hodag-Wrestling" }, { type: "venmo", value: "Other-One" }] } }), "invalid-argument");
    const r = await fn.adminSetPaymentOptions({ ...admin, data: { links: [
      { type: "venmo", value: "@Hodag-Wrestling" }, { type: "cashapp", value: "HodagWrestling" }, { type: "paypalme", value: "https://paypal.me/hodags/" },
      { type: "zelle", value: "715-555-0100" }, { type: "check", value: "Payable to Rhinelander Wrestling Boosters" }] } });
    assert.deepStrictEqual(r.links.map((l) => l.value), ["Hodag-Wrestling", "$HodagWrestling", "hodags", "(715) 555-0100", "Payable to Rhinelander Wrestling Boosters"]);
    assert.strictEqual((await fn.paymentMode({})).options.length, 5);
  });
  await t("manual mode: sponsors must pick an enabled option; the order records it and holds for 72 hours", async () => {
    params.PAYMENT_MODE = "manual";
    try {
      await expectErr(order(kenzie, [P[3]], { method: "bitcoin" }), "invalid-argument");
      const r = await order(kenzie, [P[3]], { method: "venmo" });
      assert.strictEqual(get(`orders/${r.orderId}`).method, "venmo");
      assert.ok(r.holdExpires - Date.now() > 71 * 3600 * 1000);
      await expectErr(fn.mockPay(pub({ data: { orderId: r.orderId } })), "failed-precondition");
      await fn.adminConfirmOrder({ ...admin, data: { orderId: r.orderId } });
      assert.strictEqual(get(`orders/${r.orderId}`).payment.provider, "venmo");
    } finally { params.PAYMENT_MODE = "mock"; }
  });

  /* ---- schedule editor ---- */
  await t("schedule editor: coaches add a meet and a Saturday practice; reloading keeps their edits", async () => {
    const base = get("config/season").schedule.events;
    const sat = DAYS.map((d) => d.key).concat(P).find((k) => new Date(k + "T00:00:00Z").getUTCDay() === 1);
    const saturday = new Date(Date.parse(sat + "T00:00:00Z") + 5 * 864e5).toISOString().slice(0, 10);
    await fn.adminSaveSchedule({ ...admin, data: { events: [...base, { date: P[5], name: "Test Invite", where: "Here" }], extraPractices: [saturday] } });
    const days = get("config/season").days;
    assert.strictEqual(days.find((x) => x.key === P[5]).kind, "event");
    assert.strictEqual(days.find((x) => x.key === saturday).kind, "practice");
    await fn.adminSetup({ ...admin, data: {} });
    assert.strictEqual(get("config/season").days.find((x) => x.key === P[5]).name, "Test Invite", "reload keeps the coach's schedule");
    await expectErr(fn.adminSaveSchedule({ auth: { uid: "s", token: {} }, data: { events: base } }), "permission-denied");
  });
  await t("schedule editor: sponsored days can be renamed but not removed, re-typed or re-priced; bad input refused", async () => {
    const base = get("config/season").schedule.events;
    const held = POST[0].key; // held by an earlier sponsor
    await fn.adminSaveSchedule({ ...admin, data: { events: base.map((e) => e.date === held ? { ...e, where: "Rhinelander HS" } : e) } });
    assert.strictEqual(get("config/season").days.find((x) => x.key === held).where, "Rhinelander HS");
    await expectErr(fn.adminSaveSchedule({ ...admin, data: { events: base.map((e) => e.date === held ? { ...e, priceCents: e.priceCents + 500 } : e) } }), "failed-precondition");
    await expectErr(fn.adminSaveSchedule({ ...admin, data: { events: base.filter((e) => e.date !== held) } }), "failed-precondition");
    await expectErr(fn.adminSaveSchedule({ ...admin, data: { events: [...base, { date: P[2], name: "Over a paid practice" }] } }), "failed-precondition");
    await expectErr(fn.adminSaveSchedule({ ...admin, data: { events: [...base, { date: base[0].date, name: "Twin" }] } }), "invalid-argument");
    await expectErr(fn.adminSaveSchedule({ ...admin, data: { events: [...base, { date: "2026-02-31", name: "Bad" }] } }), "invalid-argument");
    await expectErr(fn.adminSaveSchedule({ ...admin, data: { events: [...base, { date: P[6], name: "Free?", postseason: true }] } }), "invalid-argument");
    await fn.adminSaveSchedule({ ...admin, data: { events: TEAM.schedule.events } });
    assert.strictEqual(get("config/season").days.length, DAYS.length, "back to the original schedule");
  });

  /* ---- retention ---- */
  await t("retention: nothing is deleted before 90 days after the last day; after that, athlete and sponsor data is gone", async () => {
    const realNow = Date.now, last = Date.parse(TEAM.schedule.lastDay + "T00:00:00Z");
    await fn.retention();
    assert.ok(get(`wrestlers/${kenzie}`), "kept during the season");
    Date.now = () => last + 89 * 864e5;
    try { await fn.retention(); assert.ok(get(`wrestlers/${kenzie}`), "kept at 89 days"); } finally { Date.now = realNow; }
    const snapshot = new Map(store);
    Date.now = () => last + 91 * 864e5;
    try { await fn.retention(); } finally { Date.now = realNow; }
    const left = [...store.keys()].filter((k) => /^(wrestlers|wrestlerPrivate|rosterEmails|orders|messages)\//.test(k));
    assert.deepStrictEqual(left, []);
    assert.ok(get("team/totals").raisedCents > 0, "team totals stay as numbers");
    store.clear(); for (const [k, v] of snapshot) store.set(k, v); // restore for the remaining tests
  });

  /* ---- template ---- */
  await t("template: the three team.json copies match (run scripts/sync-config.js after editing)", async () => {
    const fs = require("fs"), path = require("path"), root = path.join(__dirname, "..", "..");
    const src = fs.readFileSync(path.join(root, "team.json"), "utf8");
    for (const f of ["docs/team.json", "functions/team.json"]) assert.strictEqual(fs.readFileSync(path.join(root, f), "utf8"), src, f + " is out of date");
  });
  await t("template: schedule honors practice weekdays and breaks; note times follow the team's time zone", async () => {
    const t2 = JSON.parse(JSON.stringify(TEAM));
    t2.schedule.practiceWeekdays = [1, 3];
    const days = buildSeasonDays(t2).filter((d) => d.kind === "practice");
    assert.ok(days.length > 0 && days.every((d) => [1, 3].includes(new Date(d.key + "T00:00:00Z").getUTCDay())));
    assert.ok(!days.some((d) => t2.schedule.breaks[d.key]));
    assert.strictEqual(z2u("2026-12-08", 5, "America/Chicago").toISOString(), "2026-12-08T11:00:00.000Z");
    assert.strictEqual(z2u("2027-03-20", 5, "America/Chicago").toISOString(), "2027-03-20T10:00:00.000Z");
    assert.strictEqual(z2u("2026-12-08", 6, "America/New_York").toISOString(), "2026-12-08T11:00:00.000Z");
  });
  await t("template: new athletes get the team's default message", async () => {
    await fn.adminImportRoster({ ...admin, data: { rows: [{ name: "Riley Fresh", email: "riley.f@example.org", weight: "PG" }] } });
    const riley = get(`wrestlers/${get("rosterEmails/riley.f@example.org").wrestlerId}`);
    assert.strictEqual(riley.askText, TEAM.copy.defaultAsk.replace(/\{first\}/g, "Riley"));
    assert.strictEqual(riley.weight, "PG", "the detail column accepts text (positions, numbers) for other sports");
  });
  console.log(`\n${passed} checks passed`);
})().catch((e) => { console.error("FAILED:", e); process.exit(1); });
