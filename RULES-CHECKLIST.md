# Security rules checklist (run once after the first deploy)

These rules are tested automatically against the real Firestore emulator on every push (GitHub → Actions → Tests,
from `test-rules/rules.test.js`). Run them yourself with `cd test-rules && npm install && npm test` (needs Java 11+).
After a team's first deploy, spot-check the live project by hand in the Firebase console:
**Firestore → Rules → Rules Playground**. Use the simulation type and path shown; "signed out" means Authenticated is off.

| # | Simulate | Path | Expected |
|---|---|---|---|
| 1 | get, signed out | `wrestlers/<a published athlete's id>` | Allowed |
| 2 | get, signed out | `wrestlers/<an unpublished athlete's id>` | Denied |
| 3 | list, signed out | `wrestlers` | Denied |
| 4 | list, signed in with custom claim `{"wrestlerId":"<any id>"}` | `wrestlers` | Allowed |
| 5 | get, signed out | `wrestlers/<published id>/claims/2026-12-01` | Allowed |
| 6 | get, signed out | `wrestlers/<unpublished id>/claims/2026-12-01` | Denied |
| 7 | get, signed out | `orders/anything`, `wrestlerPrivate/anything`, `acceptances/anything`, `private/stripe` | Denied |
| 8 | get, signed in as athlete A | `messages/<a note for athlete B>` | Denied |
| 9 | create/update, signed in with `{"admin":true}` | `wrestlers/anything` | Denied (all writes go through functions) |
| 10 | get, signed out | `wrestlers/<published id>/updates/<an approved update>` | Allowed |
| 11 | get, signed out | `wrestlers/<published id>/updates/<a pending update>` | Denied |
| 12 | get, signed in with `{"wrestlerId":"<that athlete>"}` | `wrestlers/<her id>/updates/<a pending update>` | Allowed |
| 13 | get, signed in with `{"admin":true}` | `followers/anything` | Denied (sponsor emails stay with the functions) |
| 14 | create, signed in with `{"wrestlerId":"<her id>"}` | `wrestlers/<her id>/updates/x` | Denied (no posting around the coach) |

Also, in **Firestore → Time-to-live**, add a TTL policy on collection `rateLimits`, field `expireAt`, so the hashed rate-limit records delete themselves.
