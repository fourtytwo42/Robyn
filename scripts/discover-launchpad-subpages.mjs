import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(
  "C:/Users/hendo420/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright"
);

const sites = [
  ["pump-fun", "https://pump.fun/"],
  ["bags", "https://bags.fm/"],
  ["four-meme", "https://four.meme/en"],
  ["clanker", "https://clanker.world/"],
  ["hood-fun", "https://hood.fun/"],
  ["pons", "https://pons.money/"],
  ["virtuals", "https://app.virtuals.io/"],
];

const browser = await chromium.launch({
  executablePath:
    "C:/Users/hendo420/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe",
  headless: true,
  args: ["--disable-gpu", "--disable-dev-shm-usage", "--no-sandbox"],
});

for (const [slug, url] of sites) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
    colorScheme: "dark",
  });
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
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
        .filter(({ href }) => href.startsWith(location.origin))
        .filter(
          ({ text, href }) =>
            /create|launch|deploy|token|coin|profile|portfolio|reward|claim|explore|trade/i.test(
              `${text} ${href}`
            )
        )
        .filter(
          (item, index, items) =>
            items.findIndex((candidate) => candidate.href === item.href) === index
        )
        .slice(0, 40)
    );
    console.log(`\n## ${slug} ${page.url()}`);
    console.log(JSON.stringify(links, null, 2));
  } catch (error) {
    console.log(`\n## ${slug} FAILED\n${String(error)}`);
  } finally {
    await context.close();
  }
}

await browser.close();
