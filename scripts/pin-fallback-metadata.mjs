import { readFile } from "node:fs/promises";
import sharp from "../apps/api/node_modules/sharp/dist/index.cjs";

const apiUrl = process.env.ROBYN_IPFS_API_URL ?? "http://127.0.0.1:5001";

async function add(bytes, filename) {
  const form = new FormData();
  form.append("file", new Blob([Uint8Array.from(bytes)]), filename);
  const url = new URL("/api/v0/add", apiUrl);
  url.searchParams.set("cid-version", "1");
  url.searchParams.set("hash", "sha2-256");
  url.searchParams.set("pin", "true");
  url.searchParams.set("raw-leaves", "true");
  url.searchParams.set("wrap-with-directory", "false");
  const response = await fetch(url, { method: "POST", body: form });
  if (!response.ok) throw new Error(`Kubo add failed: ${response.status}`);
  const line = (await response.text()).trim().split("\n").at(-1);
  const parsed = JSON.parse(line);
  if (typeof parsed.Hash !== "string") throw new Error("Kubo CID missing");
  return parsed.Hash;
}

const webp = await readFile(
  new URL("../apps/web/public/assets/launchpad/token-fallback.webp", import.meta.url),
);
const png = await sharp(webp)
  .resize(1024, 1024, { fit: "cover", position: "centre" })
  .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
  .toBuffer();
const pngCid = await add(png, "robyn-fallback.png");
const webpCid = await add(webp, "robyn-fallback.webp");
const metadata = Buffer.from(
  JSON.stringify({
    interop: { erc1046: true },
    name: "Robyn Launch",
    symbol: "ROBYN",
    decimals: 18,
    description: "A Robyn reward-basket token.",
    image: `ipfs://${pngCid}`,
    images: [`ipfs://${webpCid}`],
  }),
);
const metadataCid = await add(metadata, "robyn-fallback-token.json");
process.stdout.write(
  JSON.stringify(
    {
      pngCid,
      webpCid,
      metadataCid,
      metadataUri: `ipfs://${metadataCid}`,
    },
    null,
    2,
  ) + "\n",
);
