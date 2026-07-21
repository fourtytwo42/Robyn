import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(
  "C:/Users/hendo420/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright"
);

const outputDir = path.resolve("research/screenshots/launchpad-subpages");
await mkdir(outputDir, { recursive: true });

const targets = [
  {
    platform: "Pump.fun",
    slug: "pump-create",
    pageType: "Creation flow",
    url: "https://pump.fun/create",
  },
  {
    platform: "Pump.fun",
    slug: "pump-token-detail",
    pageType: "Token detail and trading",
    url: "https://pump.fun/coin/Ge87EtsjwRQbHaqQmKRno69RFTwh9bfSsm99XNxTpump",
  },
  {
    platform: "Pump.fun",
    slug: "pump-profile",
    pageType: "Creator profile",
    url: "https://pump.fun/profile/owprojexx",
  },
  {
    platform: "Bags",
    slug: "bags-launch",
    pageType: "Launch flow",
    url: "https://bags.fm/launch",
  },
  {
    platform: "Bags",
    slug: "bags-trade",
    pageType: "Trading and discovery",
    url: "https://bags.fm/trade",
  },
  {
    platform: "Bags",
    slug: "bags-token-detail",
    pageType: "Token detail",
    url: "https://bags.fm/",
    action: { kind: "text", value: "LUCKY" },
  },
  {
    platform: "Four.meme",
    slug: "four-create",
    pageType: "Creation wizard",
    url: "https://four.meme/en/create-token",
  },
  {
    platform: "Four.meme",
    slug: "four-token-detail",
    pageType: "Token detail and curve",
    url: "https://four.meme/en/token/0x7cf0b0120eb1a5eb304415c6c23f07e34cbc4444",
  },
  {
    platform: "Clanker",
    slug: "clanker-deploy",
    pageType: "Creation wizard",
    url: "https://clanker.world/deploy",
  },
  {
    platform: "Clanker",
    slug: "clanker-explore",
    pageType: "Token discovery",
    url: "https://clanker.world/clankers?filter=trending",
  },
  {
    platform: "Clanker",
    slug: "clanker-profile",
    pageType: "Account and rewards",
    url: "https://clanker.world/profile",
  },
  {
    platform: "Clanker",
    slug: "clanker-token-detail",
    pageType: "Token detail and trading",
    url: "https://clanker.world/clanker/0x9Cb41FD9dC6891BAe8187029461bfAADF6CC0C69",
  },
  {
    platform: "hood.fun",
    slug: "hood-create",
    pageType: "Creation flow",
    url: "https://hood.fun/create",
  },
  {
    platform: "hood.fun",
    slug: "hood-community-token",
    pageType: "Community-mode token detail",
    url: "https://hood.fun/coin/0x444c11538E4775F33682d533c66B32AF28eF600d",
  },
  {
    platform: "hood.fun",
    slug: "hood-portfolio",
    pageType: "Portfolio and rewards",
    url: "https://hood.fun/portfolio",
  },
  {
    platform: "pons",
    slug: "pons-create",
    pageType: "Creation flow",
    url: "https://pons.money/",
    action: { kind: "button", value: "Create" },
  },
  {
    platform: "pons",
    slug: "pons-token-detail",
    pageType: "Graduated token detail",
    url: "https://pons.money/",
    action: { kind: "text", value: "Pons" },
  },
  {
    platform: "pons",
    slug: "pons-profile",
    pageType: "Creator profile",
    url: "https://pons.money/profile/",
  },
  {
    platform: "Virtuals",
    slug: "virtuals-launch-token",
    pageType: "Token launch flow",
    url: "https://app.virtuals.io/",
    action: { kind: "text", value: "Launch Token" },
  },
  {
    platform: "Virtuals",
    slug: "virtuals-create-agent",
    pageType: "Agent creation flow",
    url: "https://app.virtuals.io/",
    action: { kind: "button", value: "Create Agent" },
  },
  {
    platform: "Virtuals",
    slug: "virtuals-agent-detail",
    pageType: "Agent token detail",
    url: "https://app.virtuals.io/virtuals/106754",
  },
  {
    platform: "BONKfun",
    slug: "bonk-rewards",
    pageType: "Bond rewards",
    url: "https://rewards.bonk.fun/",
  },
];

const browser = await chromium.launch({
  executablePath:
    "C:/Users/hendo420/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe",
  headless: true,
  args: ["--disable-gpu", "--disable-dev-shm-usage", "--no-sandbox"],
});

const requestedSlugs = new Set(process.argv.slice(2));
const selectedTargets = requestedSlugs.size
  ? targets.filter((target) => requestedSlugs.has(target.slug))
  : targets;
const results = [];
for (const target of selectedTargets) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: "en-US",
    colorScheme: "dark",
  });
  const page = await context.newPage();
  const screenshotPath = path.join(outputDir, `${target.slug}.png`);
  let actionResult = "not requested";
  try {
    const response = await page.goto(target.url, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.waitForTimeout(4_000);

    for (const label of ["Reject", "Opt-out", "Got it"]) {
      const button = page.getByRole("button", { name: label, exact: true });
      if ((await button.count()) === 1) {
        await button.click();
        await page.waitForTimeout(500);
      }
    }

    if (target.action) {
      const locator =
        target.action.kind === "button"
          ? page.getByRole("button", { name: target.action.value, exact: true })
          : page.getByText(target.action.value, { exact: true });
      const count = await locator.count();
      if (count === 1) {
        await locator.click();
        await page.waitForTimeout(3_000);
        actionResult = `clicked ${target.action.kind} ${target.action.value}`;
      } else {
        actionResult = `not clicked: ${count} matches for ${target.action.value}`;
      }
    }

    const state = await page.evaluate(() => ({
      title: document.title,
      finalUrl: location.href,
      headings: Array.from(document.querySelectorAll("h1,h2,h3"))
        .slice(0, 12)
        .map((element) => element.textContent?.replace(/\s+/g, " ").trim())
        .filter(Boolean),
      actions: Array.from(document.querySelectorAll("button,a"))
        .filter((element) => {
          const box = element.getBoundingClientRect();
          return box.width > 0 && box.height > 0;
        })
        .slice(0, 20)
        .map((element) => element.textContent?.replace(/\s+/g, " ").trim())
        .filter(Boolean),
    }));
    await page.screenshot({ path: screenshotPath, fullPage: false });
    results.push({
      ...target,
      ...state,
      actionResult,
      screenshotPath,
      statusCode: response?.status() ?? null,
      status: "captured",
    });
  } catch (error) {
    results.push({
      ...target,
      actionResult,
      screenshotPath,
      status: "failed",
      error: String(error),
    });
  } finally {
    await context.close();
  }
}

await browser.close();
let outputResults = results;
if (requestedSlugs.size) {
  try {
    const existing = JSON.parse(
      await readFile(path.join(outputDir, "capture-results.json"), "utf8")
    );
    outputResults = [
      ...existing.filter((result) => !requestedSlugs.has(result.slug)),
      ...results,
    ];
  } catch {
    outputResults = results;
  }
}
await writeFile(
  path.join(outputDir, "capture-results.json"),
  `${JSON.stringify(outputResults, null, 2)}\n`,
  "utf8"
);

for (const result of results) {
  console.log(
    `${result.status.padEnd(8)} ${result.slug.padEnd(24)} ${result.finalUrl ?? result.url} | ${result.actionResult}`
  );
}
