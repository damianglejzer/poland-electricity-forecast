// Browser smoke test: open every page, fail on console/HTTP errors, check key interactions and
// save screenshots. Run with `make e2e` while the stack is up (official Playwright Docker image).
// BASE_URL can point at any deployment, e.g. a production-like build served on another port.
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUT = process.env.SCREENSHOT_DIR || "/screenshots";

const PAGES = [
  { path: "/", name: "overview", ready: "text=How it works, in four steps" },
  { path: "/forecast", name: "forecast", ready: "text=Predicted vs actual electricity demand" },
  { path: "/accuracy", name: "accuracy", ready: "text=Daily error over time" },
  { path: "/what-if", name: "what-if", ready: "text=Why the model predicts this" },
  { path: "/how-it-works", name: "how-it-works", ready: "text=Model lifecycle" },
  { path: "/model", name: "model", ready: "text=Version history" },
];

const problems = [];
const browser = await chromium.launch();

async function newPage(theme, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    timezoneId: "Europe/Warsaw",
    colorScheme: theme,
  });
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && problems.push(`[console] ${page.url()}: ${m.text()}`));
  page.on("pageerror", (e) => problems.push(`[pageerror] ${page.url()}: ${e.message}`));
  page.on("response", (r) => r.status() >= 400 && problems.push(`[http ${r.status()}] ${r.url()}`));
  return page;
}

async function visit(page, p, file) {
  await page.goto(BASE + p.path, { waitUntil: "networkidle" });
  await page.waitForSelector(p.ready, { timeout: 60000 });
  await page.waitForSelector("[role=img] svg", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1000); // let chart animations settle
  await page.screenshot({ path: `${OUT}/${file}.png`, fullPage: true });
  console.log(`ok  ${p.path.padEnd(14)} -> ${file}.png`);
}

// Dark mode comes from the OS preference (no saved choice).
const dark = await newPage("dark");
for (const p of PAGES) await visit(dark, p, p.name);

// The public site is read-only: no refresh / retrain controls anywhere.
for (const p of PAGES) {
  await dark.goto(BASE + p.path, { waitUntil: "networkidle" });
  const n = await dark.locator("text=/Retrain model|Refresh data/").count();
  if (n) problems.push(`[read-only] ${p.path} shows a refresh/retrain control`);
}
console.log("ok  no refresh/retrain controls");

// What-if: a preset changes the scenario.
await dark.goto(`${BASE}/what-if`, { waitUntil: "networkidle" });
await dark.waitForSelector("text=Why the model predicts this");
await dark.click("button:has-text('Cold snap')");
await dark.waitForSelector("text=-10 °C", { timeout: 10000 }).catch(() => problems.push("[interaction] preset did not apply"));
await dark.waitForTimeout(2500);
await dark.screenshot({ path: `${OUT}/what-if-scenario.png`, fullPage: true });
console.log("ok  what-if preset");

// Theme toggle.
await dark.goto(`${BASE}/`, { waitUntil: "networkidle" });
await dark.click('button[aria-label="Switch to light mode"]:visible').catch(() => {
  problems.push("[interaction] theme toggle not found");
});
const isLight = await dark.evaluate(() => !document.documentElement.classList.contains("dark"));
if (!isLight) problems.push("[interaction] theme toggle did not switch to light mode");
console.log("ok  theme toggle");

// README hero: exactly what a visitor sees first, without scrolling.
const hero = await newPage("dark", { width: 1440, height: 900 });
await hero.goto(`${BASE}/`, { waitUntil: "networkidle" });
await hero.waitForSelector("[role=img] svg", { timeout: 30000 });
await hero.waitForTimeout(1200);
await hero.screenshot({ path: `${OUT}/hero.png` });
console.log("ok  hero (above the fold) -> hero.png");

const light = await newPage("light");
await visit(light, PAGES[0], "overview-light");
await visit(light, PAGES[4], "how-it-works-light");

const mobile = await newPage("dark", { width: 390, height: 844 });
await visit(mobile, PAGES[0], "overview-mobile");

await browser.close();
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n` + problems.join("\n"));
  process.exit(1);
}
console.log("\nAll pages rendered without console errors.");
