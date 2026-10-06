export function blendPreserving(
  original: Uint8Array,
  edited: Uint8Array,
  mask: Uint8Array,
): Uint8Array {
  if (original.length !== edited.length || mask.length * 4 !== original.length) {
    throw new Error("Image buffers do not match.");
  }
  const out = new Uint8Array(original.length);
  for (let i = 0; i < mask.length; i += 1) {
    const weight = mask[i] / 255;
    const keep = 1 - weight;
    const offset = i * 4;
    out[offset] = Math.round(original[offset] * keep + edited[offset] * weight);
    out[offset + 1] = Math.round(original[offset + 1] * keep + edited[offset + 1] * weight);
    out[offset + 2] = Math.round(original[offset + 2] * keep + edited[offset + 2] * weight);
    out[offset + 3] = 255;
  }
  return out;
}
