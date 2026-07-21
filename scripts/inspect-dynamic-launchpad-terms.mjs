import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(
  "C:/Users/hendo420/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright"
);

const targets = [
  ["Bags", "https://bags.fm/terms"],
  ["BONKfun", "https://www.letsbonk.fun/terms-of-service"],
  ["DAOS.FUN", "https://www.daos.fun/terms-of-service"],
  [
    "Four.meme",
    "https://four.meme/en/token/0x7cf0b0120eb1a5eb304415c6c23f07e34cbc4444",
  ],
  ["Clanker", "https://clanker.world/"],
  ["SunPump", "https://sunpump.meme/"],
];

const browser = await chromium.launch({
  executablePath:
    "C:/Users/hendo420/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe",
  headless: true,
  args: ["--disable-gpu", "--disable-dev-shm-usage", "--no-sandbox"],
});

const results = [];
for (const [platform, url] of targets) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
  });
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(4_000);
    if (platform === "Clanker") {
      const menu = page.getByRole("button", { name: "Menu", exact: true });
      if ((await menu.count()) === 1) {
        await menu.click();
        await page.waitForTimeout(500);
      }
    }
    const state = await page.evaluate(() => {
      const legalPattern = /terms|privacy|legal|risk|disclaimer|policy|guideline/i;
      const legalElements = Array.from(document.querySelectorAll("a,button"))
        .map((element) => ({
          tag: element.tagName,
          text: element.textContent?.replace(/\s+/g, " ").trim() ?? "",
          href: element instanceof HTMLAnchorElement ? element.href : null,
        }))
        .filter(({ text, href }) => legalPattern.test(`${text} ${href ?? ""}`));
      return {
        title: document.title,
        finalUrl: location.href,
        legalElements,
        bodyText: document.body.innerText.slice(0, 80_000),
      };
    });
    results.push({ platform, requestedUrl: url, ...state, status: "inspected" });
  } catch (error) {
    results.push({ platform, requestedUrl: url, status: "failed", error: String(error) });
  } finally {
    await context.close();
  }
}

await browser.close();
const outputPath = path.resolve("research/dynamic-launchpad-terms.json");
await writeFile(outputPath, `${JSON.stringify(results, null, 2)}\n`, "utf8");
for (const result of results) {
  console.log(`\n## ${result.platform} ${result.status} ${result.finalUrl ?? ""}`);
  console.log(JSON.stringify(result.legalElements ?? [], null, 2));
  console.log((result.bodyText ?? "").slice(0, 1200).replace(/\s+/g, " "));
}
