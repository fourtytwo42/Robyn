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

const [, , sourceArgument, nameArgument, symbolArgument, descriptionArgument] =
  process.argv;
const source = sourceArgument
  ? await readFile(sourceArgument)
  : await readFile(
      new URL(
        "../apps/web/public/assets/launchpad/token-fallback.webp",
        import.meta.url,
      ),
    );
const name = nameArgument ?? "Robyn Launch";
const symbol = symbolArgument ?? "ROBYN";
const description = descriptionArgument ?? "A Robyn reward-basket token.";
const decoded = sharp(source, {
  animated: false,
  failOn: "error",
  limitInputPixels: 4096 * 4096,
  sequentialRead: true,
})
  .rotate()
  .resize(1024, 1024, { fit: "cover", position: "centre" });
const png = await decoded
  .clone()
  .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
  .toBuffer();
const webp = await decoded
  .clone()
  .webp({ quality: 88, effort: 5 })
  .toBuffer();
const pngCid = await add(png, `${symbol.toLowerCase()}-token.png`);
const webpCid = await add(webp, `${symbol.toLowerCase()}-token.webp`);
const metadata = Buffer.from(
  JSON.stringify({
    interop: { erc1046: true },
    name,
    symbol,
    decimals: 18,
    ...(description ? { description } : {}),
    image: `ipfs://${pngCid}`,
    images: [`ipfs://${webpCid}`],
  }),
);
const metadataCid = await add(metadata, `${symbol.toLowerCase()}-token.json`);
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
