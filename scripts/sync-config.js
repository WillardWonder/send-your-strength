// Copies the one team config (team.json at the repo root) to the two places that read it:
// the web app (docs/team.json) and the Cloud Functions (functions/team.json).
// `firebase deploy` runs this automatically (see firebase.json predeploy).
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const src = path.join(root, "team.json");
const text = fs.readFileSync(src, "utf8");
JSON.parse(text); // fail loudly on a typo before anything is copied
for (const dest of ["docs/team.json", "functions/team.json"]) {
  fs.writeFileSync(path.join(root, dest), text);
  console.log("team.json -> " + dest);
}
