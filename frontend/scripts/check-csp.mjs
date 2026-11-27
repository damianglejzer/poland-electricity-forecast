// Fails the build if the inline script in index.html no longer matches the hash allowed by the
// Content-Security-Policy (vercel.json and nginx). Without this, editing that script would
// silently block it in production.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const html = readFileSync("dist/index.html", "utf8");
const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
  (m) => `'sha256-${createHash("sha256").update(m[1]).digest("base64")}'`,
);
const policies = {
  "vercel.json": readFileSync("vercel.json", "utf8"),
  "security-headers.conf": readFileSync("security-headers.conf", "utf8"),
};
let ok = true;
for (const [file, text] of Object.entries(policies))
  for (const h of hashes)
    if (!text.includes(h)) {
      console.error(`CSP in ${file} does not allow inline script ${h}`);
      ok = false;
    }
if (!ok) process.exit(1);
console.log(`CSP ok: ${hashes.length} inline script(s) allowed in vercel.json and nginx`);
