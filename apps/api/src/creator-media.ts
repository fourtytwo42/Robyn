import sharp from "sharp";

export const maxUploadBytes = 2 * 1024 * 1024;
export const maxInputPixels = 4096 * 4096;

function exactPngLength(input: Buffer) {
  let offset = 8;
  while (offset + 12 <= input.length) {
    const length = input.readUInt32BE(offset);
    const type = input.subarray(offset + 4, offset + 8).toString("ascii");
    offset += 12 + length;
    if (offset > input.length) return false;
    if (type === "IEND") return offset === input.length;
  }
  return false;
}

function exactWebpLength(input: Buffer) {
  return input.length >= 12 && input.readUInt32LE(4) + 8 === input.length;
}

function detectedFormat(input: Buffer) {
  if (
    input.length >= 8 &&
    input.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return exactPngLength(input) ? "png" : null;
  if (
    input.length >= 12 &&
    input.subarray(0, 4).toString("ascii") === "RIFF" &&
    input.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return exactWebpLength(input) ? "webp" : null;
  if (input.length >= 4 && input[0] === 0xff && input[1] === 0xd8)
    return input.at(-2) === 0xff && input.at(-1) === 0xd9 ? "jpeg" : null;
  return null;
}

export function validateImageContainer(
  input: Buffer,
  contentType: string | undefined,
) {
  if (input.length === 0) throw new Error("empty_upload");
  if (input.length > maxUploadBytes) throw new Error("upload_too_large");
  const format = detectedFormat(input);
  if (!format) throw new Error("unsupported_or_malformed_image");
  const normalizedType = contentType?.split(";")[0]?.trim().toLowerCase();
  const expected = format === "jpeg" ? "image/jpeg" : `image/${format}`;
  if (normalizedType !== expected) throw new Error("content_type_mismatch");
  return format;
}

export async function sanitizeCreatorImage(
  input: Buffer,
  contentType: string | undefined,
) {
  const format = validateImageContainer(input, contentType);
  const image = sharp(input, {
    animated: true,
    failOn: "error",
    limitInputPixels: maxInputPixels,
    sequentialRead: true,
  });
  const metadata = await image.metadata();
  if (metadata.format !== format || !metadata.width || !metadata.height)
    throw new Error("image_decode_mismatch");
  if (
    metadata.width < 256 ||
    metadata.height < 256 ||
    metadata.width > 4096 ||
    metadata.height > 4096
  )
    throw new Error("image_dimensions_out_of_range");
  if ((metadata.pages ?? 1) !== 1) throw new Error("animated_image_rejected");
  const output = await sharp(input, {
    animated: false,
    failOn: "error",
    limitInputPixels: maxInputPixels,
    sequentialRead: true,
  })
    .rotate()
    .resize(1024, 1024, { fit: "cover", position: "centre" })
    .webp({ quality: 88, effort: 5 })
    .toBuffer();
  return {
    output,
    width: 1024,
    height: 1024,
    contentType: "image/webp" as const,
  };
}
