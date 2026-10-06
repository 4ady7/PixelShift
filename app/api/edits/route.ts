import { ProviderError } from "../../../lib/ai/errors";
import { generateEdit, imageModel } from "../../../lib/ai/openai";
import { buildEditPrompt } from "../../../lib/ai/prompt";
import type { EditMode, Variation } from "../../../lib/editor/types";
import { chooseModelCanvas } from "../../../lib/image/geometry";
import {
  assertDecodedImage,
  EditInputError,
  projectEdit,
  readPhotograph,
  resizePng,
  selectionToEditMask,
} from "../../../lib/image/prepare";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MODES = new Set<EditMode>(["select", "prompt", "render"]);
const VARIATIONS = new Set<Variation>(["conservative", "balanced", "creative"]);

export async function POST(request: Request): Promise<Response> {
  try {
    const form = await request.formData();
    const mode = readMode(form.get("mode"));
    const variation = readVariation(form.get("variation"));
    const instruction = String(form.get("instruction") ?? "");
    const image = await fileBuffer(form.get("image"), "Choose a photograph first.");
    const photo = await readPhotograph(image);
    const selection = form.get("mask");
    const selectionBuffer = mode === "select" ? await fileBuffer(selection, "Select the area that should change.") : null;
    if (selectionBuffer) {
      const maskInfo = await readPhotograph(selectionBuffer);
      if (maskInfo.kind !== "png" || maskInfo.width !== photo.width || maskInfo.height !== photo.height) {
        throw new EditInputError("The selection doesn't match the photograph. Try it again.");
      }
    }

    const prompt = buildEditPrompt(instruction, mode, variation);
    const model = imageModel();
    const canvas = chooseModelCanvas(model, photo.width, photo.height);
    const imagePng = await resizePng(image, canvas.width, canvas.height);
    const maskPng = selectionBuffer ? await selectionToEditMask(selectionBuffer, canvas.width, canvas.height) : null;
    const edited = await generateEdit({
      model,
      prompt,
      imagePng,
      maskPng: mode === "select" ? maskPng : null,
      size: `${canvas.width}x${canvas.height}`,
      signal: request.signal,
    });
    await assertDecodedImage(edited);
    const composited = await projectEdit({
      original: image,
      edited,
      selectionPng: mode === "select" ? selectionBuffer : null,
    });
    const verified = await assertDecodedImage(composited);
    if (verified.width !== photo.width || verified.height !== photo.height) {
      throw new EditInputError("The result didn't match the photograph's dimensions.", 502);
    }

    return new Response(new Uint8Array(composited), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
        "X-PixelShift-Variant": variation,
      },
    });
  } catch (error) {
    if (error instanceof EditInputError || error instanceof ProviderError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof Error && error.name === "AbortError") {
      return Response.json({ error: "Generation was cancelled." }, { status: 499 });
    }
    console.error("PixelShift edit failed");
    return Response.json(
      { error: "We couldn't generate this edit. The image service didn't respond." },
      { status: 500 },
    );
  }
}

function readMode(value: FormDataEntryValue | null): EditMode {
  if (typeof value === "string" && MODES.has(value as EditMode)) return value as EditMode;
  throw new EditInputError("Choose an editing mode and try again.");
}

function readVariation(value: FormDataEntryValue | null): Variation {
  if (typeof value === "string" && VARIATIONS.has(value as Variation)) return value as Variation;
  throw new EditInputError("Choose a variation and try again.");
}

async function fileBuffer(value: FormDataEntryValue | null, missing: string): Promise<Buffer> {
  if (!(value instanceof File)) throw new EditInputError(missing);
  const bytes = Buffer.from(await value.arrayBuffer());
  if (bytes.length === 0) throw new EditInputError(missing);
  return bytes;
}
