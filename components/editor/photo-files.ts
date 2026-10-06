import { MAX_EDGE, MAX_PIXELS, MAX_UPLOAD_BYTES } from "@/lib/image/limits";
import { sniffHeic, sniffImage } from "@/lib/image/sniff";

export type LoadedPhoto = {
  file: File;
  url: string;
  width: number;
  height: number;
  name: string;
};

export async function readPhotographFile(file: File): Promise<LoadedPhoto> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("This photograph is too large. Use an image under 25 MB.");
  }
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const kind = sniffImage(header);
  const heic = !kind && sniffHeic(header);
  if (!kind && !heic) {
    throw new Error("Use a JPEG, PNG, or WebP photograph.");
  }

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (width < 1 || height < 1) throw new Error("damaged");
    if (width > MAX_EDGE || height > MAX_EDGE || width * height > MAX_PIXELS) {
      throw new Error("This photograph is too large to edit. Use an image up to 8000 pixels on the long side.");
    }
    return { file, url, width, height, name: displayName(file.name) };
  } catch (error) {
    URL.revokeObjectURL(url);
    if (error instanceof Error && error.message.startsWith("This photograph")) throw error;
    if (heic) {
      throw new Error("HEIC photographs need to be exported as JPEG or PNG before they can be edited here.");
    }
    throw new Error("This photograph couldn't be read. It may be damaged.");
  }
}

function displayName(name: string): string {
  const base = name.split(/[/\\]/).pop() || "Photograph";
  return base.slice(0, 80);
}

export async function imageUrlToBlob(url: string): Promise<Blob> {
  const image = new Image();
  image.src = url;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not prepare the photograph.");
  context.drawImage(image, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  if (!blob) throw new Error("Could not prepare the photograph.");
  return blob;
}

export async function downloadPhotograph(
  url: string,
  filename: string,
  type: "image/png" | "image/jpeg" | "image/webp",
): Promise<void> {
  const image = new Image();
  image.src = url;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not export the photograph.");
  if (type === "image/jpeg") {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(image, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.92));
  if (!blob) throw new Error("Could not export the photograph.");
  downloadBlob(blob, filename);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function exportFilename(label: string, extension: string): string {
  const safe = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `pixelshift-${safe || "photograph"}.${extension}`;
}
