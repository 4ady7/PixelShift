import sharp from "sharp";
import { blendPreserving } from "./composite";
import { MAX_EDGE, MAX_PIXELS, MAX_UPLOAD_BYTES } from "./limits";
import { sniffImage, type ImageKind } from "./sniff";

export class EditInputError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "EditInputError";
    this.status = status;
  }
}

export type PhotographInfo = {
  width: number;
  height: number;
  kind: ImageKind;
};

export async function readPhotograph(buffer: Buffer): Promise<PhotographInfo> {
  if (buffer.length === 0) throw new EditInputError("The upload was empty.");
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new EditInputError("This photograph is too large. Use an image under 25 MB.");
  }
  const kind = sniffImage(buffer.subarray(0, 16));
  if (!kind) throw new EditInputError("Use a JPEG, PNG, or WebP photograph.");

  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(buffer, { failOn: "error" }).metadata();
  } catch {
    throw new EditInputError("This photograph couldn't be read. It may be damaged.");
  }
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width < 1 || height < 1) {
    throw new EditInputError("This photograph couldn't be read. It may be damaged.");
  }
  if (width > MAX_EDGE || height > MAX_EDGE || width * height > MAX_PIXELS) {
    throw new EditInputError("This photograph is too large to edit. Use an image up to 8000 pixels on the long side.");
  }
  return { width, height, kind };
}

export async function resizePng(buffer: Buffer, width: number, height: number): Promise<Buffer> {
  return sharp(buffer, { failOn: "error" })
    .rotate()
    .resize(width, height, { fit: "fill" })
    .png()
    .toBuffer();
}

export async function selectionToEditMask(selectionPng: Buffer, width: number, height: number): Promise<Buffer> {
  const { data, info } = await sharp(selectionPng, { failOn: "error" })
    .rotate()
    .resize(width, height, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let strongest = 0;
  const pixels = info.width * info.height;
  const raw = Buffer.alloc(pixels * 4);
  for (let i = 0; i < pixels; i += 1) {
    const selection = data[i * 4 + 3];
    if (selection > strongest) strongest = selection;
    const alpha = 255 - selection;
    raw[i * 4] = 0;
    raw[i * 4 + 1] = 0;
    raw[i * 4 + 2] = 0;
    raw[i * 4 + 3] = alpha;
  }
  if (strongest < 8) throw new EditInputError("Select the area that should change.");

  return sharp(raw, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

export async function projectEdit(options: {
  original: Buffer;
  edited: Buffer;
  selectionPng: Buffer | null;
}): Promise<Buffer> {
  const base = await sharp(options.original, { failOn: "error" }).rotate().ensureAlpha().raw().toBuffer({
    resolveWithObject: true,
  });
  const editedRaw = await sharp(options.edited, { failOn: "error" })
    .rotate()
    .resize(base.info.width, base.info.height, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer();

  let blended: Uint8Array = editedRaw;
  if (options.selectionPng) {
    const selection = await sharp(options.selectionPng, { failOn: "error" })
      .rotate()
      .resize(base.info.width, base.info.height, { fit: "fill" })
      .ensureAlpha()
      .raw()
      .toBuffer();
    const mask = new Uint8Array(base.info.width * base.info.height);
    for (let i = 0; i < mask.length; i += 1) mask[i] = selection[i * 4 + 3];
    blended = blendPreserving(base.data, editedRaw, mask);
  }

  return sharp(blended, {
    raw: { width: base.info.width, height: base.info.height, channels: 4 },
  })
    .png()
    .toBuffer();
}

export async function assertDecodedImage(buffer: Buffer): Promise<{ width: number; height: number }> {
  try {
    const metadata = await sharp(buffer, { failOn: "error" }).metadata();
    if (!metadata.width || !metadata.height) throw new Error("missing dimensions");
    return { width: metadata.width, height: metadata.height };
  } catch {
    throw new EditInputError("The image service returned an unreadable result.", 502);
  }
}
