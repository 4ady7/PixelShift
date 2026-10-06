import sharp from "sharp";
import { blendPreserving } from "./composite";
import { letterboxFrame, type CanvasSize, type Frame } from "./geometry";
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
  oriented: Buffer;
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

  let oriented = buffer;
  let width = metadata.width ?? 0;
  let height = metadata.height ?? 0;
  if ((metadata.orientation ?? 1) > 1) {
    try {
      oriented = await sharp(buffer, { failOn: "error" }).rotate().toBuffer();
      const rotated = await sharp(oriented).metadata();
      width = rotated.width ?? 0;
      height = rotated.height ?? 0;
    } catch {
      throw new EditInputError("This photograph couldn't be read. It may be damaged.");
    }
  }

  if (width < 1 || height < 1) {
    throw new EditInputError("This photograph couldn't be read. It may be damaged.");
  }
  if (width > MAX_EDGE || height > MAX_EDGE || width * height > MAX_PIXELS) {
    throw new EditInputError("This photograph is too large to edit. Use an image up to 8000 pixels on the long side.");
  }
  return { width, height, kind, oriented };
}

export async function placeOnCanvas(buffer: Buffer, canvas: CanvasSize, frame: Frame): Promise<Buffer> {
  const resized = await sharp(buffer, { failOn: "error" }).resize(frame.width, frame.height, { fit: "fill" }).png().toBuffer();
  return sharp({
    create: { width: canvas.width, height: canvas.height, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .composite([{ input: resized, left: frame.left, top: frame.top }])
    .png()
    .toBuffer();
}

export async function buildEditMask(selectionPng: Buffer, canvas: CanvasSize, frame: Frame): Promise<Buffer> {
  const resized = await sharp(selectionPng, { failOn: "error" })
    .resize(frame.width, frame.height, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer();
  const raw = Buffer.alloc(canvas.width * canvas.height * 4);
  for (let i = 0; i < canvas.width * canvas.height; i += 1) raw[i * 4 + 3] = 255;

  let strongest = 0;
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      const selection = resized[(y * frame.width + x) * 4 + 3];
      if (selection > strongest) strongest = selection;
      const offset = ((y + frame.top) * canvas.width + (x + frame.left)) * 4;
      raw[offset + 3] = 255 - selection;
    }
  }
  if (strongest < 8) throw new EditInputError("Select the area that should change.");

  return sharp(raw, { raw: { width: canvas.width, height: canvas.height, channels: 4 } }).png().toBuffer();
}

export async function extractFrame(modelPng: Buffer, canvas: CanvasSize, frame: Frame, outWidth: number, outHeight: number): Promise<Buffer> {
  const fitted = await sharp(modelPng, { failOn: "error" }).rotate().resize(canvas.width, canvas.height, { fit: "fill" }).png().toBuffer();
  const cropped = await sharp(fitted)
    .extract({ left: frame.left, top: frame.top, width: frame.width, height: frame.height })
    .png()
    .toBuffer();
  return sharp(cropped).resize(outWidth, outHeight, { fit: "fill" }).png().toBuffer();
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
