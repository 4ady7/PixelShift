export type Mask = {
  width: number;
  height: number;
  data: Uint8Array;
};

export type Point = { x: number; y: number };

export function createMask(width: number, height: number): Mask {
  return { width, height, data: new Uint8Array(width * height) };
}

export function masksEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function maskHasSelection(mask: Mask, threshold = 8): boolean {
  for (let i = 0; i < mask.data.length; i += 1) {
    if (mask.data[i] >= threshold) return true;
  }
  return false;
}

export function stamp(
  mask: Mask,
  cx: number,
  cy: number,
  radius: number,
  softness: number,
  erase: boolean,
): void {
  if (radius <= 0) return;
  const soft = Math.min(1, Math.max(0, softness));
  const hard = radius * (1 - soft);
  const minX = Math.max(0, Math.floor(cx - radius));
  const maxX = Math.min(mask.width - 1, Math.ceil(cx + radius));
  const minY = Math.max(0, Math.floor(cy - radius));
  const maxY = Math.min(mask.height - 1, Math.ceil(cy + radius));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const distance = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (distance > radius) continue;
      let coverage = 1;
      if (distance > hard) {
        const t = 1 - (distance - hard) / Math.max(0.0001, radius - hard);
        coverage = t * t * (3 - 2 * t);
      }
      const index = y * mask.width + x;
      if (erase) {
        mask.data[index] = Math.round(mask.data[index] * (1 - coverage));
      } else {
        mask.data[index] = Math.round(mask.data[index] + (255 - mask.data[index]) * coverage);
      }
    }
  }
}

export function fillRect(
  mask: Mask,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  value = 255,
): void {
  const left = Math.max(0, Math.min(mask.width - 1, Math.floor(Math.min(x0, x1))));
  const right = Math.max(0, Math.min(mask.width - 1, Math.ceil(Math.max(x0, x1))));
  const top = Math.max(0, Math.min(mask.height - 1, Math.floor(Math.min(y0, y1))));
  const bottom = Math.max(0, Math.min(mask.height - 1, Math.ceil(Math.max(y0, y1))));
  for (let y = top; y <= bottom; y += 1) {
    const row = y * mask.width;
    mask.data.fill(value, row + left, row + right + 1);
  }
}

export function fillPolygon(mask: Mask, points: Point[], value = 255): void {
  if (points.length < 3) return;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  const startY = Math.max(0, Math.floor(minY));
  const endY = Math.min(mask.height - 1, Math.ceil(maxY));

  for (let y = startY; y <= endY; y += 1) {
    const crossings: number[] = [];
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const crosses = (a.y <= y && b.y > y) || (b.y <= y && a.y > y);
      if (!crosses || a.y === b.y) continue;
      const t = (y + 0.5 - a.y) / (b.y - a.y);
      crossings.push(a.x + t * (b.x - a.x));
    }
    crossings.sort((left, right) => left - right);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const xStart = Math.max(0, Math.ceil(crossings[i]));
      const xEnd = Math.min(mask.width - 1, Math.floor(crossings[i + 1]));
      const row = y * mask.width;
      for (let x = xStart; x <= xEnd; x += 1) mask.data[row + x] = value;
    }
  }
}

export function invertMask(mask: Mask): void {
  for (let i = 0; i < mask.data.length; i += 1) mask.data[i] = 255 - mask.data[i];
}

export function dilate(mask: Mask, radius: number): Uint8Array {
  return morphology(mask, radius, true);
}

export function erode(mask: Mask, radius: number): Uint8Array {
  return morphology(mask, radius, false);
}

export function feather(mask: Mask, radius: number): Uint8Array {
  const amount = Math.max(0, Math.round(radius));
  if (amount < 1) return mask.data.slice();
  let current = mask.data;
  for (let pass = 0; pass < 2; pass += 1) {
    current = boxBlurHorizontal(current, mask.width, mask.height, amount);
    current = boxBlurVertical(current, mask.width, mask.height, amount);
  }
  return current;
}

function morphology(mask: Mask, radius: number, expand: boolean): Uint8Array {
  const amount = Math.max(0, Math.round(radius));
  if (amount < 1) return mask.data.slice();
  const horizontal = filterPass(mask.data, mask.width, mask.height, amount, true, expand);
  return filterPass(horizontal, mask.width, mask.height, amount, false, expand);
}

function filterPass(
  src: Uint8Array,
  width: number,
  height: number,
  radius: number,
  horizontal: boolean,
  dilate: boolean,
): Uint8Array {
  const out = new Uint8Array(src.length);
  const lines = horizontal ? height : width;
  const length = horizontal ? width : height;

  for (let line = 0; line < lines; line += 1) {
    const deque = new Int32Array(length);
    let head = 0;
    let tail = 0;
    const at = (index: number) => (horizontal ? src[line * width + index] : src[index * width + line]);
    const set = (index: number, value: number) => {
      if (horizontal) out[line * width + index] = value;
      else out[index * width + line] = value;
    };

    for (let i = 0; i < length + radius; i += 1) {
      if (i < length) {
        while (
          tail > head &&
          (dilate ? at(deque[tail - 1]) <= at(i) : at(deque[tail - 1]) >= at(i))
        ) {
          tail -= 1;
        }
        deque[tail] = i;
        tail += 1;
      }
      const current = i - radius;
      if (current >= 0) {
        const windowStart = current - radius;
        while (head < tail && deque[head] < windowStart) head += 1;
        set(current, at(deque[head]));
      }
    }
  }
  return out;
}

function boxBlurHorizontal(src: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const out = new Uint8Array(src.length);
  const prefix = new Uint32Array(width + 1);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    prefix[0] = 0;
    for (let x = 0; x < width; x += 1) prefix[x + 1] = prefix[x] + src[row + x];
    for (let x = 0; x < width; x += 1) {
      const start = Math.max(0, x - radius);
      const end = Math.min(width - 1, x + radius);
      out[row + x] = Math.round((prefix[end + 1] - prefix[start]) / (end - start + 1));
    }
  }
  return out;
}

function boxBlurVertical(src: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const out = new Uint8Array(src.length);
  const prefix = new Uint32Array(height + 1);
  for (let x = 0; x < width; x += 1) {
    prefix[0] = 0;
    for (let y = 0; y < height; y += 1) prefix[y + 1] = prefix[y] + src[y * width + x];
    for (let y = 0; y < height; y += 1) {
      const start = Math.max(0, y - radius);
      const end = Math.min(height - 1, y + radius);
      out[y * width + x] = Math.round((prefix[end + 1] - prefix[start]) / (end - start + 1));
    }
  }
  return out;
}

export async function maskToPngBlob(mask: Mask): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = mask.width;
  canvas.height = mask.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not prepare the selection.");
  const image = context.createImageData(mask.width, mask.height);
  for (let i = 0; i < mask.data.length; i += 1) {
    const value = mask.data[i];
    const offset = i * 4;
    image.data[offset] = value;
    image.data[offset + 1] = value;
    image.data[offset + 2] = value;
    image.data[offset + 3] = value;
  }
  context.putImageData(image, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Could not prepare the selection.");
  return blob;
}
