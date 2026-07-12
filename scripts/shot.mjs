// Headless render check: load the built app, capture console + a screenshot.
import puppeteer from "puppeteer";

const URL = process.env.URL ?? "http://localhost:4173";
const OUT = process.env.OUT ?? "/tmp/shot.png";

const browser = await puppeteer.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--enable-unsafe-webgpu",
    "--ignore-gpu-blocklist",
    "--use-gl=angle",
    "--enable-features=Vulkan",
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });

const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(URL, { waitUntil: "networkidle2", timeout: 60000 }).catch((e) => logs.push(`[goto] ${e.message}`));
await new Promise((r) => setTimeout(r, 7000)); // let the scene render

// optionally run a real semantic search
if (process.env.QUERY) {
  await page.type("#q", process.env.QUERY);
  await page.click("#go");
  await new Promise((r) => setTimeout(r, 9000)); // CLIP encode + camera fly
  const status = await page.$eval("#model-status", (el) => el.textContent).catch(() => "?");
  console.log("query:", process.env.QUERY, "| status:", status);
}

// optionally click a work in the cloud to trigger "more like this"
if (process.env.CLICK) {
  await page.mouse.click(660, 430);
  await new Promise((r) => setTimeout(r, 4000));
  const status = await page.$eval("#model-status", (el) => el.textContent).catch(() => "?");
  console.log("click status:", status);
}

// optionally hover over the cloud to surface the selection ring
if (process.env.HOVER) {
  for (let i = 0; i < 6; i++) {
    await page.mouse.move(620 + i * 12, 400 + i * 10);
    await new Promise((r) => setTimeout(r, 120));
  }
  await new Promise((r) => setTimeout(r, 600));
}

const backend = await page.$eval("#backend", (el) => el.textContent).catch(() => "?");
const count = await page.$eval("#count", (el) => el.textContent).catch(() => "?");
await page.screenshot({ path: OUT });

console.log("backend:", backend, "| count:", count);
console.log("--- console ---");
console.log(logs.join("\n") || "(no logs)");

await browser.close();
