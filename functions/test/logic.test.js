// Runs the real Cloud Functions code against an in-memory Firestore stand-in.
// Usage: node test/logic.test.js   (no emulator needed)
const Module = require("module");
const assert = require("assert");

/* ---------- in-memory Firestore ---------- */
const store = new Map();
let autoId = 0;
class Ts { constructor(ms) { this.ms = ms; } toMillis() { return this.ms; } }
const Timestamp = { fromDate: (d) => new Ts(d.getTime()), fromMillis: (m) => new Ts(m), now: () => new Ts(Date.now()) };
const INC = Symbol("inc"), SRV = Symbol("srv");
const FieldValue = { increment: (n) => ({ [INC]: n }), serverTimestamp: () => ({ [SRV]: true }) };
const cmp = (v) => (v instanceof Ts ? v.ms : v);
function applyFields(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v && v[INC] !== undefined) out[k] = (out[k] || 0) + v[INC];
    else if (v && v[SRV]) out[k] = new Ts(Date.now());
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
class Query {
  constructor(coll, filters = []) { this.coll = coll; this.filters = filters; }
  where(f, op, v) { return new Query(this.coll, [...this.filters, [f, op, v]]); }
  async get() {
    const docs = [];
    for (const [p, d] of store) {
      if (p.split("/").slice(0, -1).join("/") !== this.coll) continue;
      const ok = this.filters.every(([f, op, v]) => op === "==" ? cmp(d[f]) === cmp(v) : op === "<=" ? cmp(d[f]) <= cmp(v) : false);
      if (ok) docs.push(snap(new DocRef(p)));
    }
    return { docs, empty: !docs.length };
  }
}
class CollRef extends Query { doc(id) { return new DocRef(`${this.coll}/${id || "auto" + ++autoId}`); } }
const db = {
  doc: (p) => new DocRef(p),
  collection: (p) => new CollRef(p),
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
const fakes = {
  "firebase-admin/app": { initializeApp: () => {} },
  "firebase-admin/firestore": { getFirestore: () => db, FieldValue, Timestamp },
  "firebase-admin/auth": { getAuth: () => ({ setCustomUserClaims: async (uid, c) => { claimsSet[uid] = c; } }) },
  "firebase-functions/v2/https": { onCall: (o, h) => h, HttpsError },
  "firebase-functions/v2/scheduler": { onSchedule: (o, h) => h },
  "firebase-functions/params": { defineString: (n, o) => ({ value: () => (n === "ADMIN_EMAILS" ? "coach@example.org" : n === "PAYMENT_MODE" ? "mock" : o.default) }) },
};
const origLoad = Module._load;
Module._load = function (req, ...rest) { return fakes[req] || origLoad.call(this, req, ...rest); };
const fn = require("../index.js");

/* ---------- helpers ---------- */
const admin = { auth: { uid: "coach", token: { admin: true, email: "coach@example.org", email_verified: true } } };
const anon = { auth: null };
const get = (p) => store.get(p);
const expectErr = async (p, code) => { try { await p; assert.fail("expected " + code); } catch (e) { assert.strictEqual(e.code, code, e.message); } };
let passed = 0; const t = async (name, f) => { await f(); passed++; console.log("  ✓ " + name); };

(async () => {
  console.log("Bluejay Backers function tests");
  await t("non-admin can't set up", () => expectErr(fn.adminSetup({ auth: { uid: "x", token: {} }, data: {} }), "permission-denied"));
  await t("setup writes 60 season days at $5", async () => {
    await fn.adminSetup({ ...admin, data: {} });
    assert.strictEqual(get("config/season").days.length, 60);
    assert.strictEqual(get("config/season").practicePriceCents, 500);
  });
  let kenzie;
  await t("CSV import creates wrestlers + email map; re-import updates, no duplicates", async () => {
    const r1 = await fn.adminImportRoster({ ...admin, data: { rows: [{ name: "Kenzie R", email: "Kenzie.R@example.org", weight: "126" }, { name: "Bad", email: "nope" }] } });
    assert.deepStrictEqual([r1.added, r1.updated, r1.skipped.length], [1, 0, 1]);
    kenzie = get("rosterEmails/kenzie.r@example.org").wrestlerId;
    assert.ok(get(`wrestlers/${kenzie}`).askText.includes("{practice}"));
    const r2 = await fn.adminImportRoster({ ...admin, data: { rows: [{ name: "Kenzie Rae", email: "kenzie.r@example.org", weight: "132" }] } });
    assert.deepStrictEqual([r2.added, r2.updated], [0, 1]);
    assert.strictEqual(get(`wrestlers/${kenzie}`).weight, "132");
  });
  await t("claimRoles: roster email -> wrestlerId; organizer -> admin; stranger -> none; stale admin removed", async () => {
    const strip = ({ changed, ...c }) => c;
    assert.deepStrictEqual(strip(await fn.claimRoles({ auth: { uid: "k", token: { email: "kenzie.r@example.org", email_verified: true } } })), { wrestlerId: kenzie });
    assert.deepStrictEqual(strip(await fn.claimRoles({ auth: { uid: "c", token: { email: "coach@example.org", email_verified: true } } })), { admin: true });
    assert.deepStrictEqual(strip(await fn.claimRoles({ auth: { uid: "s", token: { email: "random@gmail.com", email_verified: true } } })), {});
    await expectErr(fn.claimRoles({ auth: { uid: "u", token: { email: "kenzie.r@example.org", email_verified: false } } }), "permission-denied");
    const r = await fn.claimRoles({ auth: { uid: "x", token: { email: "former.coach@example.org", email_verified: true, admin: true } } });
    assert.strictEqual(r.changed, true); assert.deepStrictEqual(claimsSet.x, {});
  });
  await t("each girl gets a readable link; same name gets -2; organizer can rename it; bad or taken links refused", async () => {
    assert.strictEqual(get(`wrestlers/${kenzie}`).slug, "kenzie-r");
    await fn.adminImportRoster({ ...admin, data: { rows: [{ name: "Kenzie R", email: "other.kenzie@example.org" }] } });
    const twin = get("rosterEmails/other.kenzie@example.org").wrestlerId;
    assert.strictEqual(get(`wrestlers/${twin}`).slug, "kenzie-r-2");
    await fn.adminSaveWrestler({ ...admin, data: { id: twin, slug: "kenz" } });
    assert.strictEqual(get(`wrestlers/${twin}`).slug, "kenz");
    await expectErr(fn.adminSaveWrestler({ ...admin, data: { id: twin, slug: "kenzie-r" } }), "already-exists");
    await expectErr(fn.adminSaveWrestler({ ...admin, data: { id: twin, slug: "Bad Link!" } }), "invalid-argument");
    await expectErr(fn.adminSaveWrestler({ ...admin, data: { id: twin, slug: "admin" } }), "invalid-argument");
  });
  await t("photos must come from the project's own storage, even for organizers", async () => {
    await expectErr(fn.adminSaveWrestler({ ...admin, data: { id: kenzie, photoUrl: "https://evil.example/x.png" } }), "invalid-argument");
  });
  await t("one caller can't spam holds: the 11th order in 10 minutes is refused", async () => {
    const spam = { auth: null, rawRequest: { headers: { "x-forwarded-for": "1.2.3.4, 203.0.113.9" } } };
    const keys = ["2027-01-04", "2027-01-05", "2027-01-06", "2027-01-07", "2027-01-11", "2027-01-13", "2027-01-15", "2027-01-18", "2027-01-20", "2027-01-22"];
    for (const k of keys) await fn.createOrder({ ...spam, data: { wrestlerId: kenzie, dayKeys: [k], donorName: "Bot" } });
    await expectErr(fn.createOrder({ ...spam, data: { wrestlerId: kenzie, dayKeys: ["2027-01-25"], donorName: "Bot" } }), "resource-exhausted");
    const other = { auth: null, rawRequest: { headers: { "x-forwarded-for": "1.2.3.4, 198.51.100.7" } } };
    await fn.createOrder({ ...other, data: { wrestlerId: kenzie, dayKeys: ["2027-01-25"], donorName: "Real person" } });
  });
  let order;
  await t("createOrder prices server-side ($5 + $25) and holds days", async () => {
    order = await fn.createOrder({ ...anon, data: { wrestlerId: kenzie, dayKeys: ["2026-12-07", "2026-12-08"], donorName: "Grandma", message: "Go get em!", revealDay: "2026-12-08", amountCents: 1 } });
    assert.strictEqual(order.amountCents, 3000);
    assert.strictEqual(get(`claims/${kenzie}__2026-12-07`).status, "held");
  });
  await t("postseason prices: Regional $40, Sectional $50, State $100", async () => {
    const r = await fn.createOrder({ ...anon, data: { wrestlerId: kenzie, dayKeys: ["2027-02-05", "2027-02-12", "2027-02-25"], donorName: "Coach" } });
    assert.strictEqual(r.amountCents, 4000 + 5000 + 10000);
  });
  await t("match: organizer sets a real match; blank clears it", async () => {
    await fn.adminSettings({ ...admin, data: { practicePriceCents: 500, rewardName: "Bluejay Backer", rewardText: "", payNote: "", matchName: "Main St Hardware", matchCapCents: 100000 } });
    assert.deepStrictEqual(get("config/season").match, { name: "Main St Hardware", capCents: 100000 });
    await fn.adminSettings({ ...admin, data: { practicePriceCents: 500, rewardName: "Bluejay Backer", rewardText: "", payNote: "", matchName: "", matchCapCents: 0 } });
    assert.strictEqual(get("config/season").match, null);
  });
  await t("a second sponsor can't grab a held day", () => expectErr(fn.createOrder({ ...anon, data: { wrestlerId: kenzie, dayKeys: ["2026-12-08"], donorName: "Other" } }), "already-exists"));
  await t("off days and fake days are rejected", () => expectErr(fn.createOrder({ ...anon, data: { wrestlerId: kenzie, dayKeys: ["2026-12-25"], donorName: "X" } }), "invalid-argument"));
  await t("mockPay marks paid, updates wrestler + team totals, files a pending private note", async () => {
    const r = await fn.mockPay({ ...anon, data: { orderId: order.orderId } });
    assert.strictEqual(r.status, "paid");
    assert.strictEqual(get(`claims/${kenzie}__2026-12-08`).status, "paid");
    assert.strictEqual(get(`claims/${kenzie}__2026-12-08`).hasNote, true);
    assert.strictEqual(get(`wrestlers/${kenzie}`).raisedCents, 3000);
    assert.strictEqual(get("team/totals").raisedCents, 3000);
    const m = get(`messages/${order.orderId}`);
    assert.deepStrictEqual([m.status, m.released], ["pending", false]);
  });
  await t("paying twice doesn't double count", async () => {
    await fn.mockPay({ ...anon, data: { orderId: order.orderId } });
    assert.strictEqual(get("team/totals").raisedCents, 3000);
  });
  await t("approved note stays sealed until 5:00 a.m. Central on its day, then stays open", async () => {
    await fn.adminModerate({ ...admin, data: { messageId: order.orderId, approve: true } });
    assert.deepStrictEqual([get(`messages/${order.orderId}`).status, get(`messages/${order.orderId}`).released], ["approved", false]);
    await fn.releaseMessages();
    assert.strictEqual(get(`messages/${order.orderId}`).released, false, "future note stays sealed");
    const realNow = Date.now;
    Date.now = () => new Date("2026-12-08T10:59:00Z").getTime();
    try { await fn.releaseMessages(); assert.strictEqual(get(`messages/${order.orderId}`).released, false, "not before 5am CST");
      Date.now = () => new Date("2026-12-08T11:00:30Z").getTime(); await fn.releaseMessages(); } finally { Date.now = realNow; }
    assert.strictEqual(get(`messages/${order.orderId}`).released, true);
    await fn.releaseMessages();
    assert.strictEqual(get(`messages/${order.orderId}`).released, true, "stays open");
  });
  await t("expired hold + someone else took the day -> conflict, no double booking", async () => {
    const realNow = Date.now;
    const o1 = await fn.createOrder({ ...anon, data: { wrestlerId: kenzie, dayKeys: ["2026-12-09"], donorName: "Slow" } });
    Date.now = () => realNow() + 16 * 60 * 1000;
    try {
      const o2 = await fn.createOrder({ ...anon, data: { wrestlerId: kenzie, dayKeys: ["2026-12-09"], donorName: "Fast" } });
      await fn.mockPay({ ...anon, data: { orderId: o2.orderId } });
      const r = await fn.mockPay({ ...anon, data: { orderId: o1.orderId } });
      assert.strictEqual(r.status, "conflict");
      assert.strictEqual(get(`claims/${kenzie}__2026-12-09`).displayName, "Fast");
    } finally { Date.now = realNow; }
  });
  await t("cash recorded by an organizer counts toward her total", async () => {
    const before = get(`wrestlers/${kenzie}`).raisedCents;
    await fn.adminRecordPayment({ ...admin, data: { wrestlerId: kenzie, dayKeys: ["2026-12-10"], donorName: "Neighbor", method: "cash" } });
    assert.strictEqual(get(`wrestlers/${kenzie}`).raisedCents, before + 500);
  });
  await t("voiding reverses totals and frees the days", async () => {
    const before = get("team/totals").raisedCents;
    await fn.adminVoidOrder({ ...admin, data: { orderId: order.orderId } });
    assert.strictEqual(get("team/totals").raisedCents, before - 3000);
    assert.strictEqual(get(`claims/${kenzie}__2026-12-08`), undefined);
    assert.strictEqual(get(`messages/${order.orderId}`).status, "rejected");
  });
  await t("can't turn off a sponsored practice day", () => expectErr(fn.adminSetOffDay({ ...admin, data: { dayKey: "2026-12-10", off: true } }), "failed-precondition"));
  await t("a wrestler edits only her own message; outsiders can't", async () => {
    await fn.athleteUpdateProfile({ auth: { uid: "k", token: { wrestlerId: kenzie } }, data: { askText: "My own words." } });
    assert.strictEqual(get(`wrestlers/${kenzie}`).askText, "My own words.");
    await expectErr(fn.athleteUpdateProfile({ auth: { uid: "s", token: {} }, data: { askText: "hack" } }), "permission-denied");
    await expectErr(fn.athleteUpdateProfile({ auth: { uid: "k", token: { wrestlerId: kenzie } }, data: { photoUrl: "https://evil.example/x.png" } }), "invalid-argument");
  });
  await t("template: the three team.json copies match (run scripts/sync-config.js after editing)", async () => {
    const fs = require("fs"), path = require("path"), root = path.join(__dirname, "..", "..");
    const src = fs.readFileSync(path.join(root, "team.json"), "utf8");
    for (const f of ["docs/team.json", "functions/team.json"]) assert.strictEqual(fs.readFileSync(path.join(root, f), "utf8"), src, f + " is out of date");
  });
  await t("template: schedule honors practice weekdays and breaks; note times follow the team's time zone", async () => {
    const { buildSeasonDays, zonedTimeToUtc, TEAM } = require("../schedule.js");
    const t2 = JSON.parse(JSON.stringify(TEAM));
    t2.schedule.practiceWeekdays = [1, 3]; // Mondays and Wednesdays only
    const days = buildSeasonDays(t2).filter((d) => d.kind === "practice");
    assert.ok(days.length > 0 && days.every((d) => [1, 3].includes(new Date(d.key + "T00:00:00Z").getUTCDay())));
    assert.ok(!days.some((d) => t2.schedule.breaks[d.key]));
    assert.strictEqual(zonedTimeToUtc("2026-12-08", 5, "America/Chicago").toISOString(), "2026-12-08T11:00:00.000Z");
    assert.strictEqual(zonedTimeToUtc("2027-03-20", 5, "America/Chicago").toISOString(), "2027-03-20T10:00:00.000Z");
    assert.strictEqual(zonedTimeToUtc("2026-12-08", 6, "America/New_York").toISOString(), "2026-12-08T11:00:00.000Z");
  });
  await t("template: new athletes get the team's default message", async () => {
    const { TEAM } = require("../schedule.js");
    await fn.adminImportRoster({ ...admin, data: { rows: [{ name: "Riley Fresh", email: "riley.f@example.org", weight: "PG" }] } });
    const riley = get(`wrestlers/${get("rosterEmails/riley.f@example.org").wrestlerId}`);
    assert.strictEqual(riley.askText, TEAM.copy.defaultAsk.replace(/\{first\}/g, "Riley"));
    assert.strictEqual(riley.weight, "PG", "the detail column accepts text (positions, numbers) for other sports");
  });
  console.log(`\n${passed} checks passed`);
})().catch((e) => { console.error("FAILED:", e); process.exit(1); });
