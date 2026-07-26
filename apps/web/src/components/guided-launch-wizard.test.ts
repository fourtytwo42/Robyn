import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const wizardSource = readFileSync(
  new URL("./guided-launch-wizard.tsx", import.meta.url),
  "utf8",
);
const testnetSource = readFileSync(
  new URL("./network-launchpad.testnet.tsx", import.meta.url),
  "utf8",
);

describe("Guided launch artwork and basket defaults", () => {
  it("uses the artwork tile as the chooser and prepares it during launch", () => {
    expect(wizardSource).toContain(
      'className="artwork-crop-frame artwork-upload-tile"',
    );
    expect(wizardSource).toContain('aria-label="Choose token artwork"');
    expect(wizardSource).toContain(
      "await artworkSetupRef.current?.prepareArtwork()",
    );
    expect(wizardSource).not.toContain("Use artwork");
  });

  it("starts each testnet launch with an empty reward basket", () => {
    expect(testnetSource).toContain(
      "const [weights, setWeights] = useState<number[]>([]);",
    );
    expect(testnetSource).toContain("setBasketAssets([]);");
    expect(testnetSource).not.toContain(
      'const defaults = ["TSLA", "AMD", "AMZN"]',
    );
  });
});
