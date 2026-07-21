import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(
  "C:/Users/hendo420/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright"
);

const sites = [
  ["Pump.fun", "https://pump.fun/"],
  ["Bags", "https://bags.fm/"],
  ["Believe", "https://believe.app/"],
  ["BONKfun", "https://www.letsbonk.fun/"],
  ["DAOS.FUN", "https://www.daos.fun/"],
  ["Clanker", "https://clanker.world/"],
  ["Zora", "https://zora.co/"],
  ["Four.meme", "https://four.meme/en"],
  ["PinkSale", "https://www.pinksale.finance/"],
  ["SunPump", "https://sunpump.meme/"],
  ["Virtuals", "https://app.virtuals.io/"],
  ["pons", "https://pons.money/"],
  ["hood.fun", "https://hood.fun/"],
];

const browser = await chromium.launch({
  executablePath:
    "C:/Users/hendo420/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe",
  headless: true,
  args: ["--disable-gpu", "--disable-dev-shm-usage", "--no-sandbox"],
});

const results = [];
for (const [platform, url] of sites) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
  });
  const page = await context.newPage();
  try {
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.waitForTimeout(4_000);
    for (const label of ["Reject", "Opt-out", "Got it"]) {
      const button = page.getByRole("button", { name: label, exact: true });
      if ((await button.count()) === 1) await button.click();
    }
    const links = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a[href]"))
        .map((anchor) => ({
          text: anchor.textContent?.replace(/\s+/g, " ").trim() ?? "",
          href: anchor.href,
        }))
        .filter(({ text, href }) =>
          /terms|privacy|legal|risk|disclaimer|guideline|policy/i.test(`${text} ${href}`)
        )
        .filter(
          (item, index, items) =>
            items.findIndex((candidate) => candidate.href === item.href) === index
        )
    );
    results.push({
      platform,
      requestedUrl: url,
      finalUrl: page.url(),
      statusCode: response?.status() ?? null,
      title: await page.title(),
      links,
      status: "inspected",
    });
  } catch (error) {
    results.push({ platform, requestedUrl: url, status: "failed", error: String(error) });
  } finally {
    await context.close();
  }
}

await browser.close();
const outputPath = path.resolve("research/launchpad-legal-links.json");
await writeFile(outputPath, `${JSON.stringify(results, null, 2)}\n`, "utf8");
for (const result of results) {
  console.log(`\n${result.platform}: ${result.status}`);
  for (const link of result.links ?? []) console.log(`  ${link.text || "(no label)"}: ${link.href}`);
}
