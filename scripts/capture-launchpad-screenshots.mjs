import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(
  "C:/Users/hendo420/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright"
);

const outputDir = path.resolve("research/screenshots/launchpads");
await mkdir(outputDir, { recursive: true });

const launchpads = [
  { name: "Pump.fun", chain: "Solana and multichain", slug: "pump-fun", url: "https://pump.fun/" },
  { name: "Bags", chain: "Solana", slug: "bags", url: "https://bags.fm/" },
  { name: "Believe", chain: "Solana", slug: "believe", url: "https://believe.app/" },
  { name: "BONKfun", chain: "Solana", slug: "letsbonk", url: "https://www.letsbonk.fun/" },
  { name: "DAOS.FUN", chain: "Solana", slug: "daos-fun", url: "https://www.daos.fun/" },
  { name: "Clanker", chain: "Base and EVM", slug: "clanker", url: "https://clanker.world/" },
  { name: "Zora", chain: "Base", slug: "zora", url: "https://zora.co/" },
  { name: "Four.meme", chain: "BNB Chain", slug: "four-meme", url: "https://four.meme/" },
  { name: "PinkSale", chain: "Multichain", slug: "pinksale", url: "https://www.pinksale.finance/" },
  { name: "SunPump", chain: "TRON", slug: "sunpump", url: "https://sunpump.meme/" },
  { name: "Virtuals", chain: "Base and Solana", slug: "virtuals", url: "https://app.virtuals.io/" },
  { name: "pons", chain: "Robinhood Chain", slug: "pons", url: "https://pons.money/" },
  { name: "hood.fun", chain: "Robinhood Chain", slug: "hood-fun", url: "https://hood.fun/" },
];

const executablePath =
  "C:/Users/hendo420/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe";
const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--disable-gpu", "--disable-dev-shm-usage", "--no-sandbox"],
});

const results = [];
for (const launchpad of launchpads) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: "en-US",
    colorScheme: "dark",
  });
  const page = await context.newPage();
  const screenshotPath = path.join(outputDir, `${launchpad.slug}.png`);

  try {
    const response = await page.goto(launchpad.url, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.waitForTimeout(4_000);

    const optionalDismissals = {
      "daos-fun": ["Got it"],
      zora: ["Reject"],
      virtuals: ["Opt-out"],
    };
    for (const label of optionalDismissals[launchpad.slug] ?? []) {
      const control = page.getByRole("button", { name: label, exact: true });
      if ((await control.count()) === 1) {
        await control.click();
        await page.waitForTimeout(500);
      }
    }

    const state = await page.evaluate(() => ({
      title: document.title,
      url: location.href,
      headings: Array.from(document.querySelectorAll("h1,h2"))
        .slice(0, 10)
        .map((element) => element.textContent?.trim())
        .filter(Boolean),
      actions: Array.from(document.querySelectorAll("button,a"))
        .filter((element) => {
          const box = element.getBoundingClientRect();
          return box.width > 0 && box.height > 0;
        })
        .slice(0, 16)
        .map((element) => element.textContent?.trim())
        .filter(Boolean),
    }));
    await page.screenshot({ path: screenshotPath, fullPage: false });
    results.push({
      ...launchpad,
      ...state,
      screenshotPath,
      statusCode: response?.status() ?? null,
      status: "captured",
    });
  } catch (error) {
    results.push({
      ...launchpad,
      screenshotPath,
      status: "failed",
      error: String(error),
    });
  } finally {
    await context.close();
  }
}

await browser.close();
await writeFile(
  path.join(outputDir, "capture-results.json"),
  `${JSON.stringify(results, null, 2)}\n`,
  "utf8"
);

for (const result of results) {
  console.log(`${result.status.padEnd(8)} ${result.name.padEnd(12)} ${result.url}`);
}
