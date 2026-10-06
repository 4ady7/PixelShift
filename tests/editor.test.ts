import assert from "node:assert/strict";
import test from "node:test";
import { EditHistory } from "../lib/editor/history";
import { chooseModelCanvas, closestBucket, letterboxFrame } from "../lib/image/geometry";
import { blendPreserving } from "../lib/image/composite";
import { sniffHeic, sniffImage } from "../lib/image/sniff";
import { createMask, dilate, erode, feather, fillPolygon, fillRect, invertMask, stamp } from "../lib/mask/mask";

test("sniffs photographs and rejects other files", () => {
  assert.equal(sniffImage(Uint8Array.of(0xff, 0xd8, 0xff, 0xe0)), "jpeg");
  assert.equal(sniffImage(Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)), "png");
  const webp = new Uint8Array(12);
  webp.set([0x52, 0x49, 0x46, 0x46], 0);
  webp.set([0x57, 0x45, 0x42, 0x50], 8);
  assert.equal(sniffImage(webp), "webp");
  assert.equal(sniffImage(Uint8Array.of(0x3c, 0x73, 0x76, 0x67)), null);
  const heic = new Uint8Array(12);
  heic.set([0x66, 0x74, 0x79, 0x70], 4);
  heic.set([0x68, 0x65, 0x69, 0x63], 8);
  assert.equal(sniffHeic(heic), true);
});

test("picks a model canvas that preserves a wide photograph", () => {
  assert.deepEqual(closestBucket(3000, 2000), { width: 1536, height: 1024 });
  assert.deepEqual(closestBucket(2000, 3000), { width: 1024, height: 1536 });
  const sized = chooseModelCanvas("gpt-image-2.5-sunburst", 4000, 3000);
  assert.equal(sized.width % 16, 0);
  assert.equal(sized.height % 16, 0);
  assert.ok(Math.max(sized.width, sized.height) <= 2048);
  assert.ok(Math.abs(sized.width / sized.height - 4 / 3) < 0.05);
});

test("blend keeps unselected pixels and replaces selected ones", () => {
  const original = Uint8Array.of(10, 20, 30, 255, 1, 2, 3, 255);
  const edited = Uint8Array.of(110, 120, 130, 255, 9, 8, 7, 255);
  const mask = Uint8Array.of(0, 255);
  const blended = blendPreserving(original, edited, mask);
  assert.deepEqual(Array.from(blended.subarray(0, 4)), [10, 20, 30, 255]);
  assert.deepEqual(Array.from(blended.subarray(4, 8)), [9, 8, 7, 255]);
});

test("mask tools paint, invert, expand, contract, and feather", () => {
  const mask = createMask(5, 5);
  stamp(mask, 2.5, 2.5, 0.6, 0, false);
  assert.equal(mask.data[2 * 5 + 2], 255);
  invertMask(mask);
  assert.equal(mask.data[2 * 5 + 2], 0);
  assert.equal(mask.data[0], 255);

  const block = createMask(5, 5);
  fillRect(block, 2, 2, 2, 2);
  const expanded = dilate({ ...block, data: block.data.slice() }, 1);
  assert.equal(expanded[2 * 5 + 2], 255);
  assert.equal(expanded[1 * 5 + 2], 255);
  const contracted = erode({ ...block, data: block.data.slice() }, 1);
  assert.equal(contracted[2 * 5 + 2], 0);

  const soft = createMask(7, 1);
  soft.data[3] = 255;
  const blurred = feather(soft, 1);
  assert.ok(blurred[2] > 0 && blurred[2] < 255);
});

test("lasso fills the interior of a rectangle", () => {
  const mask = createMask(6, 6);
  fillPolygon(mask, [
    { x: 1, y: 1 },
    { x: 4, y: 1 },
    { x: 4, y: 4 },
    { x: 1, y: 4 },
  ]);
  assert.equal(mask.data[2 * 6 + 2], 255);
  assert.equal(mask.data[0], 0);
});

test("history restores the previous snapshot and can redo it", () => {
  const history = new EditHistory<string>();
  history.push("original");
  const undone = history.undo("edited");
  assert.equal(undone, "original");
  assert.equal(history.canRedo, true);
  assert.equal(history.redo("original"), "edited");
  history.push("branch");
  assert.equal(history.canRedo, false);
});

test("history limit drops the oldest snapshots", () => {
  const history = new EditHistory<number>(3);
  history.push(1);
  history.push(2);
  history.push(3);
  history.push(4);
  assert.equal(history.undo(5), 4);
  history.setLimit(1);
  assert.equal(history.undo(4), 3);
  assert.equal(history.canUndo, false);
});

test("letterbox keeps a very wide photograph from being stretched", () => {
  const frame = letterboxFrame(800, 100, 768, 256);
  assert.ok(frame.width / frame.height > 7);
  assert.ok(frame.left >= 0 && frame.top >= 0);
  assert.ok(frame.left + frame.width <= 768);
  assert.ok(frame.top + frame.height <= 256);
});
