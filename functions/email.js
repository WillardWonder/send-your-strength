/**
 * Send Your Strength – the "she just posted an update" email.
 *
 * On purpose the email carries no update text, no photo and no way to reach the athlete: it's a themed nudge with a
 * link to her page, where the coach-approved update lives. Replies go nowhere near her.
 * Plain HTML tables with inline styles, so it looks right in Gmail, Outlook and phone mail apps.
 */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const PRON = { she: { sub: "she", obj: "her", pos: "her" }, he: { sub: "he", obj: "him", pos: "his" }, they: { sub: "they", obj: "them", pos: "their" } };
const hex = (v, d) => (/^#[0-9a-f]{6}$/i.test(v || "") ? v : d);

/**
 * team:    the team.json object
 * first:   athlete's first name (from the public display name)
 * display: the public display name, e.g. "Addison C."
 * pageUrl: link to her page, already pointing at the updates section
 * unsubscribeUrl: one-click stop link for this sponsor and this athlete only
 * siteUrl: the site root, for the logo
 */
function updateEmail({ team, first, display, pageUrl, unsubscribeUrl, siteUrl }) {
  const p = PRON[(team.athletes && team.athletes.pronouns) || "they"] || PRON.they;
  const brand = (team.brand && team.brand.name) || "Send Your Strength";
  const teamName = team.team.name;
  const primary = hex(team.team.colors && team.team.colors.primary, "#2d68db");
  const accent = hex(team.team.colors && team.team.colors.accent, "#e3263c");
  const logo = siteUrl && team.team.logo ? `${siteUrl.replace(/\/+$/, "")}/${String(team.team.logo).replace(/^\/+/, "")}` : "";

  const subject = `${first} just posted an update for ${p.pos} corner`;
  const preheader = `You sent ${first} strength this season. Here's how it's going.`;

  const text = [
    `${teamName} · ${brand}`,
    "",
    `${first} just posted an update.`,
    "",
    `You sent ${first} strength this season, so you're in ${p.pos} corner. ${cap(p.sub)} just shared how it's going.`,
    "",
    `See ${first}'s update: ${pageUrl}`,
    "",
    `A coach reads every update before it goes up.`,
    "",
    "—",
    `You're getting this because you sponsored a day for ${display} with ${teamName}. You'll get at most one of these a day, and only when ${p.sub} ${p.sub === "they" ? "post" : "posts"}. Replies to this email don't reach ${first}.`,
    `Stop update emails for ${first}: ${unsubscribeUrl}`,
    `${brand} · Artificial Intelligence Consulting LLC · Wisconsin`,
  ].join("\n");

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#0b0f1a;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0b0f1a;">
<tr><td align="center" style="padding:28px 14px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
    <tr><td style="padding:0 4px 14px;font:700 12px/1.4 Arial,Helvetica,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#a7aec2;">
      ${logo ? `<img src="${esc(logo)}" width="28" height="28" alt="" style="vertical-align:middle;border:0;margin-right:8px;">` : ""}${esc(teamName)} · ${esc(brand)}
    </td></tr>
    <tr><td style="background:#121a2e;border-radius:16px;border-top:6px solid ${accent};padding:30px 28px 28px;">
      <div style="font:800 12px/1.4 Arial,Helvetica,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:${accent};margin:0 0 10px;">From ${esc(first)}'s corner</div>
      <h1 style="margin:0 0 14px;font:900 34px/1.08 Impact,'Arial Black',Arial,sans-serif;text-transform:uppercase;color:#ffffff;">${esc(first)} just posted an update.</h1>
      <p style="margin:0 0 22px;font:16px/1.6 Arial,Helvetica,sans-serif;color:#dfe4f1;">You sent ${esc(first)} strength this season, so you're in ${esc(p.pos)} corner. ${esc(cap(p.sub))} just shared how it's going.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-radius:10px;background:${primary};">
        <a href="${esc(pageUrl)}" style="display:inline-block;padding:15px 26px;font:800 16px/1 Arial,Helvetica,sans-serif;letter-spacing:.04em;text-transform:uppercase;color:#ffffff;text-decoration:none;border-radius:10px;">See ${esc(first)}'s update</a>
      </td></tr></table>
      <p style="margin:22px 0 0;font:13px/1.5 Arial,Helvetica,sans-serif;color:#a7aec2;">A coach reads every update before it goes up.</p>
    </td></tr>
    <tr><td style="padding:18px 6px 0;font:12px/1.6 Arial,Helvetica,sans-serif;color:#8089a0;">
      You're getting this because you sponsored a day for ${esc(display)} with ${esc(teamName)}. You'll get at most one of these a day, and only when ${esc(p.sub)} ${p.sub === "they" ? "post" : "posts"}. Replies to this email don't reach ${esc(first)}.<br>
      <a href="${esc(unsubscribeUrl)}" style="color:#a7aec2;">Stop update emails for ${esc(first)}</a><br>
      ${esc(brand)} · Artificial Intelligence Consulting LLC · Wisconsin
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
  return { subject, text, html };
}
const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);

module.exports = { updateEmail };
