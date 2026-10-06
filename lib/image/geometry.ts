import { MODEL_MAX_EDGE } from "./limits";

export type CanvasSize = { width: number; height: number };

export type Frame = { left: number; top: number; width: number; height: number };

const BUCKETS: CanvasSize[] = [
  { width: 1024, height: 1024 },
  { width: 1536, height: 1024 },
  { width: 1024, height: 1536 },
];

export function supportsCustomSize(model: string): boolean {
  return model.startsWith("gpt-image-2");
}

export function supportsInputFidelity(model: string): boolean {
  return model === "gpt-image-1" || model.startsWith("gpt-image-1.5");
}

export function chooseModelCanvas(model: string, width: number, height: number): CanvasSize {
  if (!supportsCustomSize(model)) return closestBucket(width, height);

  const scale = Math.min(1, MODEL_MAX_EDGE / Math.max(width, height));
  let nextWidth = round16(width * scale);
  let nextHeight = round16(height * scale);

  if (nextWidth / nextHeight > 3) nextHeight = round16(nextWidth / 3);
  if (nextHeight / nextWidth > 3) nextWidth = round16(nextHeight / 3);
  nextWidth = Math.min(2560, nextWidth);
  nextHeight = Math.min(2560, nextHeight);
  return { width: round16(nextWidth), height: round16(nextHeight) };
}

export function closestBucket(width: number, height: number): CanvasSize {
  const aspect = Math.log(width / height);
  return BUCKETS.reduce((best, candidate) => {
    const bestDistance = Math.abs(Math.log(best.width / best.height) - aspect);
    const candidateDistance = Math.abs(Math.log(candidate.width / candidate.height) - aspect);
    return candidateDistance < bestDistance ? candidate : best;
  });
}

export function letterboxFrame(sourceWidth: number, sourceHeight: number, canvasWidth: number, canvasHeight: number): Frame {
  const scale = Math.min(canvasWidth / sourceWidth, canvasHeight / sourceHeight);
  const width = Math.min(canvasWidth, Math.max(1, Math.round(sourceWidth * scale)));
  const height = Math.min(canvasHeight, Math.max(1, Math.round(sourceHeight * scale)));
  const left = Math.max(0, Math.floor((canvasWidth - width) / 2));
  const top = Math.max(0, Math.floor((canvasHeight - height) / 2));
  return {
    left,
    top,
    width: Math.min(width, canvasWidth - left),
    height: Math.min(height, canvasHeight - top),
  };
}

function round16(value: number): number {
  return Math.max(16, Math.round(value / 16) * 16);
}
