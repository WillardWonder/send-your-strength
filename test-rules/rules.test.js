/**
 * Firestore security rules, checked against the real emulator (the unit tests in functions/ can't see rules).
 * Run:  cd test-rules && npm install && npm test      (needs Java 11+; first run downloads the emulator)
 * Covers RULES-CHECKLIST.md, plus updates and update-email followers.
 */
const fs = require("fs");
const path = require("path");
const { initializeTestEnvironment, assertSucceeds, assertFails } = require("@firebase/rules-unit-testing");
const { doc, getDoc, getDocs, setDoc, collection, collectionGroup, query, where } = require("firebase/firestore");

const PUB = "pubAthlete", UNPUB = "unpubAthlete", OTHER = "otherAthlete";
let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log("  ✓ " + name); }
  catch (e) { fail++; console.log("  ✗ " + name + "\n      " + (e && e.message ? e.message.split("\n")[0] : e)); }
}

(async () => {
  const env = await initializeTestEnvironment({
    projectId: "demo-send-your-strength",
    firestore: { rules: fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8") },
  });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const put = (p, d) => setDoc(doc(db, p), d);
    await put(`wrestlers/${PUB}`, { published: true, displayName: "Addison C." });
    await put(`wrestlers/${UNPUB}`, { published: false, displayName: "Ava N." });
    await put(`wrestlers/${OTHER}`, { published: true, displayName: "Jada R." });
    await put(`wrestlers/${PUB}/claims/2026-12-01`, { status: "paid", displayName: "Aunt Jo" });
    await put(`wrestlers/${UNPUB}/claims/2026-12-01`, { status: "paid", displayName: "Aunt Jo" });
    await put(`wrestlers/${PUB}/updates/live1`, { wrestlerId: PUB, status: "live", text: "Won!" });
    await put(`wrestlers/${PUB}/updates/pend1`, { wrestlerId: PUB, status: "pending", text: "Waiting" });
    await put(`wrestlers/${PUB}/updates/hid1`, { wrestlerId: PUB, status: "hidden", text: "Declined" });
    await put(`wrestlers/${UNPUB}/updates/live2`, { wrestlerId: UNPUB, status: "live", text: "Unpublished page" });
    await put(`messages/noteForOther`, { wrestlerId: OTHER, status: "approved", released: true, text: "private" });
    await put(`messages/noteForPubUnreleased`, { wrestlerId: PUB, status: "approved", released: false, text: "not yet" });
    for (const p of ["orders/o1", "wrestlerPrivate/w1", "acceptances/a1", "private/stripe", "followers/f1", "rateLimits/r1"]) await put(p, { x: 1 });
    await put("config/season", { name: "2026-27" });
  });

  const anon = env.unauthenticatedContext().firestore();
  const athlete = (id) => env.authenticatedContext("uid-" + id, { wrestlerId: id }).firestore();
  const admin = env.authenticatedContext("uid-coach", { admin: true }).firestore();
  const live = (db, id) => query(collection(db, "wrestlers", id, "updates"), where("status", "==", "live"));

  console.log("Pages and claims (checklist 1-6)");
  await t("1 signed out can get a published page", () => assertSucceeds(getDoc(doc(anon, `wrestlers/${PUB}`))));
  await t("2 signed out can't get an unpublished page", () => assertFails(getDoc(doc(anon, `wrestlers/${UNPUB}`))));
  await t("3 signed out can't list athletes", () => assertFails(getDocs(collection(anon, "wrestlers"))));
  await t("4 a team athlete can list athletes", () => assertSucceeds(getDocs(collection(athlete(OTHER), "wrestlers"))));
  await t("5 signed out can read a published page's claims", () => assertSucceeds(getDoc(doc(anon, `wrestlers/${PUB}/claims/2026-12-01`))));
  await t("6 signed out can't read an unpublished page's claims", () => assertFails(getDoc(doc(anon, `wrestlers/${UNPUB}/claims/2026-12-01`))));

  console.log("Private data (checklist 7-9)");
  for (const p of ["orders/o1", "wrestlerPrivate/w1", "acceptances/a1", "private/stripe", "followers/f1", "rateLimits/r1"]) {
    await t(`7 signed out can't read ${p}`, () => assertFails(getDoc(doc(anon, p))));
  }
  await t("7 an athlete can't read followers (sponsor emails)", () => assertFails(getDoc(doc(athlete(PUB), "followers/f1"))));
  await t("7 even an organizer can't read followers or acceptances from a browser", async () => { await assertFails(getDoc(doc(admin, "followers/f1"))); await assertFails(getDoc(doc(admin, "acceptances/a1"))); });
  await t("8 an athlete can't read another athlete's note", () => assertFails(getDoc(doc(athlete(PUB), "messages/noteForOther"))));
  await t("8 an athlete can't read her own note before it's released", () => assertFails(getDoc(doc(athlete(PUB), "messages/noteForPubUnreleased"))));
  await t("8 an athlete can read her own released note", () => assertSucceeds(getDoc(doc(athlete(OTHER), "messages/noteForOther"))));
  await t("9 an organizer can't write athlete pages from a browser", () => assertFails(setDoc(doc(admin, `wrestlers/${PUB}`), { published: false })));

  console.log("Updates");
  await t("public can list a published page's approved updates", () => assertSucceeds(getDocs(live(anon, PUB))));
  await t("public can get an approved update", () => assertSucceeds(getDoc(doc(anon, `wrestlers/${PUB}/updates/live1`))));
  await t("public can't get a pending update", () => assertFails(getDoc(doc(anon, `wrestlers/${PUB}/updates/pend1`))));
  await t("public can't get a declined update", () => assertFails(getDoc(doc(anon, `wrestlers/${PUB}/updates/hid1`))));
  await t("public can't list all of a page's updates (only live ones)", () => assertFails(getDocs(collection(anon, "wrestlers", PUB, "updates"))));
  await t("public can't read approved updates on an unpublished page", () => assertFails(getDocs(live(anon, UNPUB))));
  await t("another athlete sees only approved updates, like the public", async () => { await assertSucceeds(getDocs(live(athlete(OTHER), PUB))); await assertFails(getDoc(doc(athlete(OTHER), `wrestlers/${PUB}/updates/pend1`))); });
  await t("the athlete sees all of her own updates", () => assertSucceeds(getDocs(collection(athlete(PUB), "wrestlers", PUB, "updates"))));
  await t("organizers can query every pending update across the team", () => assertSucceeds(getDocs(query(collectionGroup(admin, "updates"), where("status", "==", "pending")))));
  await t("nobody else can query updates across the team", async () => { await assertFails(getDocs(query(collectionGroup(anon, "updates"), where("status", "==", "live")))); await assertFails(getDocs(query(collectionGroup(athlete(PUB), "updates"), where("status", "==", "pending")))); });
  await t("nobody can write an update, reply, or comment from a browser", async () => {
    await assertFails(setDoc(doc(athlete(PUB), `wrestlers/${PUB}/updates/new`), { wrestlerId: PUB, status: "live", text: "skip the coach" }));
    await assertFails(setDoc(doc(anon, `wrestlers/${PUB}/updates/live1/replies/r1`), { text: "hi" }));
    await assertFails(setDoc(doc(admin, `wrestlers/${PUB}/updates/pend1`), { status: "live" }));
  });

  console.log("Everything else");
  await t("public config is readable", () => assertSucceeds(getDoc(doc(anon, "config/season"))));
  await t("unknown collections are closed", () => assertFails(getDoc(doc(anon, "whatever/x"))));

  await env.cleanup();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
