import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { POST } from "../app/api/edits/route";
import { buildEditPrompt, sanitizeInstruction } from "../lib/ai/prompt";
import { projectEdit, readPhotograph } from "../lib/image/prepare";

test("prompt keeps the photograph as the source of truth", () => {
  const prompt = buildEditPrompt("Replace the sofa with a dark green velvet sofa", "select", "conservative");
  assert.match(prompt, /source of truth/);
  assert.match(prompt, /selected region/);
  assert.match(prompt, /Replace the sofa with a dark green velvet sofa/);
  assert.match(prompt, /smallest convincing change/);
  assert.throws(() => sanitizeInstruction("   "), /Describe what should change/);
});

test("composite output matches the original dimensions and preserves unselected pixels", async () => {
  const original = await sharp({
    create: { width: 4, height: 2, channels: 3, background: { r: 20, g: 40, b: 60 } },
  })
    .png()
    .toBuffer();
  const edited = await sharp({
    create: { width: 2, height: 2, channels: 3, background: { r: 200, g: 10, b: 10 } },
  })
    .png()
    .toBuffer();
  const selection = await sharp({
    create: {
      width: 4,
      height: 2,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: await sharp({
          create: { width: 2, height: 2, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
        })
          .png()
          .toBuffer(),
        left: 2,
        top: 0,
      },
    ])
    .png()
    .toBuffer();

  const result = await projectEdit({ original, edited, selectionPng: selection });
  const { data, info } = await sharp(result).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 4);
  assert.equal(info.height, 2);
  assert.deepEqual(Array.from(data.subarray(0, 3)), [20, 40, 60]);
  assert.ok(data[8] > 150);
});

test("upload validation rejects a non-image before any provider call", async () => {
  await assert.rejects(readPhotograph(Buffer.from("<svg></svg>")), /JPEG, PNG, or WebP/);
});

test("edit route reports a missing image service without inventing a result", async () => {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const image = await sharp({
      create: { width: 32, height: 24, channels: 3, background: { r: 30, g: 50, b: 70 } },
    })
      .jpeg()
      .toBuffer();
    const mask = await sharp({
      create: { width: 32, height: 24, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
    })
      .png()
      .toBuffer();
    const form = new FormData();
    form.set("image", new File([new Uint8Array(image)], "room.jpg", { type: "image/jpeg" }));
    form.set("mask", new File([new Uint8Array(mask)], "selection.png", { type: "image/png" }));
    form.set("instruction", "Replace the red square with a ceramic cup");
    form.set("mode", "select");
    form.set("variation", "balanced");
    const response = await POST(new Request("http://pixelshift.test/api/edits", { method: "POST", body: form }));
    const body = (await response.json()) as { error: string };
    assert.equal(response.status, 503);
    assert.match(body.error, /isn't configured/);
  } finally {
    if (previous) process.env.OPENAI_API_KEY = previous;
  }
});

test("edit route rejects a selection edit that has no mask", async () => {
  const image = await sharp({
    create: { width: 16, height: 16, channels: 3, background: "navy" },
  })
    .png()
    .toBuffer();
  const form = new FormData();
  form.set("image", new File([new Uint8Array(image)], "room.png", { type: "image/png" }));
  form.set("instruction", "Remove the chair");
  form.set("mode", "select");
  form.set("variation", "balanced");
  const response = await POST(new Request("http://pixelshift.test/api/edits", { method: "POST", body: form }));
  assert.equal(response.status, 400);
  const body = (await response.json()) as { error: string };
  assert.match(body.error, /Select the area/);
});
