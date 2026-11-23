# Send Your Strength

**Pick a day. Send a message. Help build the athlete.**

A sponsor-a-day fundraiser any team can run. Each athlete gets their own page and their own link. Supporters sponsor a practice ($5 by default), a game or meet, or a postseason day, and leave a note. The athlete opens that note the morning of the sponsored day, and supporters follow along through the updates she posts in her corner of the page (with an optional email when she posts). Coaches approve every note and every update, track every dollar, and manage the roster.

> Your words can carry them through the hard days. · Support the season. Strengthen the athlete. · One message. One moment. One stronger athlete. · Be part of the work behind the wins.

The example setup is the Merrill (Wis.) girls wrestling team, 2026–27. The live preview runs on sample data: `https://<owner>.github.io/send-your-strength/`. Each sample athlete's page is that link plus `#<name>-<id>`, for example `#addison-c-d3`.

---

## Make it yours in 4 steps

1. **Edit `team.json`.** Everything team-specific lives in this one file; you shouldn't need to touch code.
2. **Replace `docs/logo.png`** with your team logo. A transparent PNG works best.
3. **Run `node scripts/sync-config.js`.** It copies `team.json` to the app and the server. `firebase deploy` also runs it for you.
4. **Preview it.** Open `docs/index.html` through any local web server, or push to GitHub and turn on Pages from the `/docs` folder. Without Firebase, the page runs on the sample data in `docs/demo.json`.

### What's in `team.json`

| Key | What it controls | Example |
|---|---|---|
| `brand.name`, `brand.tagline` | Site name and headline | `Send Your Strength` |
| `brand.lines` | The four supporting lines (note hint, idea line, thank-you, standings). `{obj}` becomes him/her/them and `{athlete}` becomes your athlete word | `Your words can carry {obj} through the hard days.` |
| `team.name`, `school`, `season`, `sport` | Names shown everywhere. Setting `sport` to `wrestling` adds the mat backdrop and singlet progress icon; any other sport gets a clean spotlight and a progress ring | `Riverside Boys Basketball`, `basketball` |
| `team.logo`, `team.colors.primary`, `team.colors.accent` | Logo and the two team colors. Every other color is derived from these two | `#c8102e`, `#f2a900` |
| `athletes.singular` / `plural` | The word for the athletes | `player` / `players` |
| `athletes.pronouns` | `she`, `he`, or `they`. Sentences adjust ("she opens it" / "they open it") | `they` |
| `athletes.detail` | The extra roster column, such as weight class or jersey number: `label`, `short`, `prefix`, `suffix` | `{"label":"Number","short":"#","prefix":"#","suffix":""}` |
| `labels` | Words for practice, event, and postseason, plus their one-line descriptions | `"event":"Game"` |
| `prices` | Practice price in cents, and how many practices one event equals | `500`, `5` |
| `schedule` | First practice, last practice, last day of the season, practice weekdays (0 = Sunday), events (with optional postseason prices and multi-day `end` dates), and breaks | see the file |
| `reward` | The name and description of the reward tier for people who sponsor 5+ practices | `Raider Booster` |
| `payNote` | Where the money goes | `Every dollar goes to the Riverside booster club.` |
| `timezone`, `revealHour` | When notes open each morning, in your team's time zone. Daylight saving is handled | `America/New_York`, `5` |
| `copy.defaultAsk` | Each new athlete's starting message (they can rewrite it). `{first}` `{practice}` `{meet}` fill in | |
| `copy.shareText` | The text athletes copy and send to family | |

**Writing the ask.** The default message follows what fundraising research supports:
- One named person, in their own voice.
- Small gifts framed as meaningful ("Even one $5 practice makes a difference").
- A clear role for the supporter: write the note.
- No pressure.

Keep that shape when you rewrite it.

---

## Going live

The live site runs on Firebase. Hosting serves `docs/`, Firestore holds the data, Auth handles the logins, Storage keeps the photos, and Cloud Functions make every change. At team size it should cost $0, though the Blaze plan requires a card on file.

1. **Create the project.** In the Firebase console, create a project and switch it to **Blaze**. Set a $5 budget alert.
2. **Turn on sign-in.** Under **Authentication**, enable *Email/Password* with **Email link (passwordless)**. Google sign-in is optional, for coaches.
3. **Create the storage.** Create **Firestore** (production mode) and **Storage**. Optionally, add a TTL policy on `rateLimits.expireAt`.
4. **Configure.** Copy `functions/.env.example` to `functions/.env`. List the organizer emails in `ADMIN_EMAILS` and keep `PAYMENT_MODE=manual`.
5. **Deploy** (Node 20):
   ```
   npm install -g firebase-tools
   firebase login
   firebase use --add
   cd functions && npm install && cd ..
   node functions/test/logic.test.js
   firebase deploy
   ```
6. **Set up the season.** Sign in as an organizer and choose **Set up season**. Then go to **Roster & logins** and upload a CSV with columns `name,email,detail` (see `roster-template.csv`).
7. **Publish and share.** Each athlete signs in, publishes her page with a parent's OK, and copies her link (`https://<your-site>/p/<name>-<id>`) from her locker. Organizers can copy published links from the roster.
8. **Check the rules** with `RULES-CHECKLIST.md`.

**Test before launch:**
- **Sign-in email.** Have one athlete sign in. School email systems often junk outside mail; if the link doesn't arrive, ask IT to allow `noreply@<project-id>.firebaseapp.com`.
- **One full sponsorship.** Sponsor a day, approve its note, and void it.

The sample data (`docs/demo.json` and its photos) is never deployed to Firebase; `firebase.json` excludes it.

## Payments

The site never holds or moves money. Sponsors pay the team directly.

- **Payment options.** In **Organizer → Settings → How sponsors pay**, the team enters the accounts it already uses: Venmo (a business or charity profile), Cash App, PayPal.me, Zelle, and/or check or cash. Sponsors pick one at checkout, get the amount and a memo to copy, and are sent to that app. Days are held for 3 days; an organizer taps **Money received** when the payment shows up. Cash handed over in person is recorded straight from the calendar.
- **Platform fee.** `PLATFORM_FEE_PERCENT` (0–20) in `functions/.env`. Whenever it's above 0, sponsors see the percentage on the checkout page and in How it works, and the terms say so. Payment apps can't split a payment, so for link, cash and check payments the fee is only tallied on the Money tab (when `FEE_ON_LINK_PAYMENTS=yes`) and invoiced to the team. Card checkout (Stripe or Square, coming next) will take it automatically.
- `PAYMENT_MODE=mock` is for testing only and must never be deployed.

## Privacy and consent

- **Link-only pages.** Each athlete's page lives at `/p/<name>-<id>`, where the id is random. The database lets a browser read one page by its id but never list athletes unless signed in as a team member, so nothing public names the roster. Search engines are told not to index the site.
- **Display names.** Public pages show first name and last initial (set `athletes.nameDisplay` to `"full"` in `team.json` for full names). Full names and emails are organizer-only.
- **Publishing.** Every page starts hidden. The athlete publishes it from her locker after a parent or guardian approves the terms. Organizers can take a page down but can't publish one.
- **Photos** are optional and need a parent's approval. Without one, the page shows the athlete's initial.
- **Updates (one-way).** From her locker, an athlete can post a short text update (500 characters) that shows in the "<Name>'s corner" section near the top of her page. It's one-way on purpose:
  - A coach approves every update before anyone else sees it (Organizer → Updates), can fix a typo first, and can take a posted one down from the page.
  - There is no reply, comment, reaction, or message path anywhere, and browsers can't write to the database at all.
  - Emails, phone numbers, links and @handles are refused by the server, so an update can't open a side channel.
  - Text only, so no photo location data. Updates show only while the page is published, are capped at 3 a day, and are deleted at retention.
  - The corner features the latest update with earlier ones below. Before her first update it shows a short "check back here" note.
- **What supporters are told.** How it works has a fourth step, Follow along, and every page ends with a Questions section: what happens after you sponsor, how to see updates (bookmark the page, or the email), how to stop emails, why there's no way to message the athlete, where the money goes, and who sees your info. The answers adjust to the team's settings (pronouns, fee, whether update emails are on).
- **Organizers' evening summary.** At 6:30 p.m. team time, every address in `ADMIN_EMAILS` gets one email if anything's waiting: notes that open tomorrow morning (first, so they're read before the 5 a.m. release), updates to approve, other notes, payments to confirm, and double bookings. Names and counts only, no note text. Nothing waiting means no email. Its button opens the site at `?see=organizer`, which jumps to the panel. Uses the same email setup as update emails.
- **Parent approval covers updates.** The publish checkbox says the parent approves the page "including the short updates I post." A page published before updates existed asks once for a parent's OK on the athlete's first update; it's recorded with the other acceptances.
- **Update emails (optional).** At checkout a sponsor who enters an email can tick "Email me when <name> posts an update" (shown only when this is turned on). Once their payment is confirmed, the first approval of each new update sends them a short themed email with a button to her corner (`/p/<name>-<id>?see=updates` jumps straight there).
  - The email never includes the update text or any way to reach the athlete. Replies don't go to her.
  - At most one email per athlete per day. Re-approving a taken-down update sends nothing. A failed send never blocks the approval.
  - Only paid sponsors can follow, so nobody can sign up someone else's inbox with an unpaid order. Voiding the order stops it.
  - Every email has a one-click stop link for that athlete (`/unsubscribe`), including mail apps' built-in unsubscribe button.
  - **To turn it on:** make a free [Resend](https://resend.com) account, verify your sending domain (add the DNS records it gives you in Cloudflare), then set `RESEND_API_KEY`, `SITE_URL` and `MAIL_FROM` in `functions/.env` and deploy. Leave the key blank and the feature stays off. The free tier covers 3,000 emails a month.
- **Terms.** Organizers check one box agreeing to the Terms (they confirm the fundraiser follows every applicable law and school, district, athletic-association and booster policy, take responsibility for it and its money, and release and indemnify us) before any organizer tool works. Sponsors agree at checkout. Every acceptance is recorded. `docs/terms.html` and `docs/privacy.html` are drafts for legal review; bump `TERMS_VERSION` in `functions/index.js` when they change.
- **Retention.** A daily job deletes athlete and sponsor data 90 days after the season's last day unless the team renews (`config/season.renewedFor`).

## Security

- **No browser writes.** Browsers can't write anything. Every change goes through a Cloud Function that checks who's calling, and prices are always recomputed on the server.
- **Updates.** Public visitors can read only coach-approved updates, only on a published page. The athlete and organizers see every status.
- **Private notes.** Notes are readable only by the athlete they're for (and organizers), only after a coach approves them and their morning arrives.
- **Private contact info.** Donor contact info and school emails are readable by organizers only.
- **Roles re-checked.** Roles are re-checked on every sign-in, so removing someone from `ADMIN_EMAILS` or the roster takes effect at their next sign-in.
- **Rate limits.** Public calls are rate-limited per caller (10 orders per 10 minutes). Only a hash of the caller's IP is stored.
- **Photos.** Photos are JPG, PNG, or WebP only, under 6 MB, uploaded by the athlete or an organizer.
- **Page lockdown.** Strict Content-Security-Policy, HSTS, no framing, and no inline scripts.

Internal names in the database say `wrestlers` because the project started as a wrestling fundraiser. They work the same for any sport.

## Tests

```
node functions/test/logic.test.js
```
These run the real server code against an in-memory database. They cover:
- pricing, including postseason prices
- holds, double-booking, and paying twice
- note release times in different time zones
- voids, cash, and roster re-import
- roles, links, photos, and rate limits
- one-way updates: approval, contact-info blocking, daily cap, delete, take-down
- update emails: opt-in only after payment, no update text, once a day, stop link, void, failures
- organizer summary: urgency order, recipients, no private text, quiet when nothing's waiting
- parent approval for updates on pages published before they existed

`test-rules/rules.test.js` checks the database rules against the real Firestore emulator (who can read pages, claims, notes, updates and sponsor data, and that browsers can't write anything). GitHub runs both suites on every push: see the **Actions** tab.

## Updating a team's copy from the template

Every team runs the same code and differs only in its own files: `team.json`, `README.md`, `docs/demo.json`, images in `docs/` (logo, photos), `.firebaserc` and `functions/.env`. To bring a team up to date after the template changes, from the team's repo:

```
node scripts/sync-from-template.js --dry-run   # see what would change
node scripts/sync-from-template.js             # copy it in, then run the tests
```

It never touches the team's own files. Review with `git diff`, commit, and `firebase deploy`. Make fixes in the template, not in a team's copy, or the next sync will overwrite them.
- template checks: config copies in sync, custom practice weekdays, default messages

The Firestore and Storage rules aren't covered by these tests. Run them once in the Firebase console's Rules Playground before launch.

## Files

```
team.json                 ← edit this
scripts/sync-config.js    copies team.json to docs/ and functions/
docs/                     the web app (GitHub Pages and Firebase Hosting both serve this folder)
  index.html, app.js      page and app
  team.json               synced copy (don't edit)
  demo.json, demo-*.webp  sample data for previews (never deployed to Firebase)
  logo.png                your logo
functions/                Cloud Functions, schedule builder, tests
firestore.rules, storage.rules, firebase.json
roster-template.csv
```
