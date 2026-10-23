# Send Your Strength

**Pick a day. Send a message. Help build the athlete.**

A sponsor-a-day fundraiser any team can run. Each athlete gets their own page and their own link. Supporters sponsor a practice ($5 by default), a game or meet, or a postseason day, and leave a note. The athlete opens that note the morning of the sponsored day. Coaches approve every note, track every dollar, and manage the roster.

> Your words can carry them through the hard days. · Support the season. Strengthen the athlete. · One message. One moment. One stronger athlete. · Be part of the work behind the wins.

The example setup is the Merrill (Wis.) girls wrestling team, 2026–27. The live preview runs on sample data: `https://<owner>.github.io/send-your-strength/`. Each athlete's preview page is that link plus `#their-link`, for example `#addison-clark`.

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
7. **Share the links.** Each athlete's link is `https://<your-site>/<their-name>`, for example `/addison-clark`. Coaches copy links from the roster; athletes find theirs in their locker.

**Test before launch:**
- **Sign-in email.** Have one athlete sign in. School email systems often junk outside mail; if the link doesn't arrive, ask IT to allow `noreply@<project-id>.firebaseapp.com`.
- **One full sponsorship.** Sponsor a day, approve its note, and void it.

The sample data (`docs/demo.json` and its photos) is never deployed to Firebase; `firebase.json` excludes it.

## Payments

The default is **manual**. A sponsor picks days and writes a note, the page shows how to pay with a memo to copy, and the days are held for 3 days. A coach taps **Money received** when the payment arrives. Cash and checks can be recorded directly from the calendar.

To take payments on the page, connect a processor whose verified webhook calls `markOrderPaid()` in `functions/index.js`. That function is the only place an order becomes paid. PayPal Checkout can show a Venmo button. `PAYMENT_MODE=mock` is for testing only.

## Security

- **No browser writes.** Browsers can't write anything. Every change goes through a Cloud Function that checks who's calling, and prices are always recomputed on the server.
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
