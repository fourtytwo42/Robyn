import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  creatorImageRuntimePolicy,
  sanitizeCreatorImage,
  validateImageContainer,
} from "../src/creator-media.js";

describe("creator media sanitization", () => {
  it("disables the no-hit native cache and bounds image worker concurrency", () => {
    expect(creatorImageRuntimePolicy.concurrency).toBe(1);
    expect(creatorImageRuntimePolicy.cache.memory.max).toBe(0);
    expect(creatorImageRuntimePolicy.cache.files.max).toBe(0);
    expect(creatorImageRuntimePolicy.cache.items.max).toBe(0);
  });

  it("decodes, strips and re-encodes an accepted image to square WebP", async () => {
    const source = await sharp({
      create: { width: 640, height: 480, channels: 3, background: "#35d0ba" },
    })
      .png()
      .toBuffer();
    const result = await sanitizeCreatorImage(source, "image/png");
    const webpMetadata = await sharp(result.webp).metadata();
    const pngMetadata = await sharp(result.png).metadata();
    expect(webpMetadata).toMatchObject({
      format: "webp",
      width: 1024,
      height: 1024,
    });
    expect(pngMetadata).toMatchObject({
      format: "png",
      width: 1024,
      height: 1024,
    });
  });

  it("rejects MIME confusion, trailing polyglot bytes and unsupported formats", async () => {
    const png = await sharp({
      create: { width: 256, height: 256, channels: 3, background: "#000" },
    })
      .png()
      .toBuffer();
    expect(() => validateImageContainer(png, "image/jpeg")).toThrow(
      "content_type_mismatch",
    );
    expect(() =>
      validateImageContainer(
        Buffer.concat([png, Buffer.from("<script>")]),
        "image/png",
      ),
    ).toThrow("unsupported_or_malformed_image");
    expect(() =>
      validateImageContainer(Buffer.from("GIF89a"), "image/gif"),
    ).toThrow("unsupported_or_malformed_image");
  });

  it("rejects source dimensions outside the bounded decoder policy", async () => {
    const tiny = await sharp({
      create: { width: 64, height: 64, channels: 3, background: "#fff" },
    })
      .webp()
      .toBuffer();
    await expect(sanitizeCreatorImage(tiny, "image/webp")).rejects.toThrow(
      "image_dimensions_out_of_range",
    );
  });
});
