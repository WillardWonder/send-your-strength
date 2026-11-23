#!/usr/bin/env node
/**
 * Bring a team's copy up to date with the Send Your Strength template.
 *
 * Every team runs the same code; teams differ only in their own files (below). This copies everything else from
 * the template, so a fix or feature made once reaches every team with one command. Works on Windows, Mac, Linux.
 *
 *   node scripts/sync-from-template.js                 pull from GitHub (needs git)
 *   node scripts/sync-from-template.js ../send-your-strength   or from a local copy of the template
 *   add --dry-run to see what would change without changing anything
 *
 * Never touched (the team's own): team.json and its two copies, README.md, docs/demo.json, every image in docs/
 * (logo, photos), .firebaserc, functions/.env*, node_modules, .git. Files the template no longer has are listed,
 * not deleted. Afterwards it copies team.json into place and runs the tests. Commit and deploy when you're happy.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const TEMPLATE_GIT = "https://github.com/WillardWonder/send-your-strength.git";
const root = path.join(__dirname, "..");
const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
let from = args.find((a) => !a.startsWith("--"));

const SKIP_DIRS = new Set([".git", "node_modules", ".firebase"]);
const TEAM_FILES = new Set(["team.json", "docs/team.json", "functions/team.json", "README.md", "docs/demo.json", ".firebaserc"]);
const isImage = (rel) => rel.startsWith("docs/") && /\.(png|jpe?g|webp|gif|svg|ico)$/i.test(rel);
const isTeamOwned = (rel) => TEAM_FILES.has(rel) || isImage(rel) || /^functions\/\.env/.test(rel) && rel !== "functions/.env.example";

function walk(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, base, out);
    else out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out;
}

let tmp = null;
if (!from) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sys-template-"));
  console.log("Getting the latest template from GitHub...");
  execFileSync("git", ["clone", "--quiet", "--depth", "1", TEMPLATE_GIT, tmp], { stdio: "inherit" });
  from = tmp;
}
from = path.resolve(from);
if (!fs.existsSync(path.join(from, "functions", "index.js"))) { console.error(`${from} doesn't look like the template.`); process.exit(1); }
if (path.resolve(from) === path.resolve(root)) { console.error("That's this repo. Run this from a team's copy."); process.exit(1); }

const tpl = walk(from).filter((r) => !isTeamOwned(r));
const mine = new Set(walk(root));
const added = [], changed = [];
for (const rel of tpl) {
  const src = path.join(from, rel), dst = path.join(root, rel);
  const next = fs.readFileSync(src);
  if (fs.existsSync(dst) && fs.readFileSync(dst).equals(next)) continue;
  (mine.has(rel) ? changed : added).push(rel);
  if (!dry) { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.writeFileSync(dst, next); }
}
const tplSet = new Set(tpl);
const gone = [...mine].filter((r) => !isTeamOwned(r) && !tplSet.has(r) && !r.startsWith("functions/.env"));
if (tmp) fs.rmSync(tmp, { recursive: true, force: true });

const list = (title, a) => a.length && console.log(`\n${title} (${a.length}):\n` + a.map((x) => "  " + x).join("\n"));
list(dry ? "Would update" : "Updated", changed);
list(dry ? "Would add" : "Added", added);
list("Only in this team's copy (left alone; delete if the template dropped them)", gone);
if (!changed.length && !added.length) { console.log("Already up to date."); process.exit(0); }
if (dry) { console.log("\nDry run: nothing changed."); process.exit(0); }

console.log("\nCopying team.json into place and running the tests...");
execFileSync(process.execPath, [path.join(root, "scripts", "sync-config.js")], { stdio: "inherit" });
try {
  execFileSync(process.execPath, [path.join(root, "functions", "test", "logic.test.js")], { stdio: "inherit" });
  console.log("\nDone. Review with `git diff`, then commit and `firebase deploy`.");
} catch (e) {
  console.error("\nTests failed. Nothing is committed or deployed; check the output above (often a team.json setting).");
  process.exit(1);
}
