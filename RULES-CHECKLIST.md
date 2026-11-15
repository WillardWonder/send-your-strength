# Security rules checklist (run once after the first deploy)

The automated tests run the server code, not the database rules. Check these by hand in the Firebase console:
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

Also, in **Firestore → Time-to-live**, add a TTL policy on collection `rateLimits`, field `expireAt`, so the hashed rate-limit records delete themselves.
