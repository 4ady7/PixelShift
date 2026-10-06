import { ProviderError, publicProviderError } from "./errors";
import { supportsInputFidelity } from "../image/geometry";

const ENDPOINT = "https://api.openai.com/v1/images/edits";

export type ProviderEditInput = {
  model: string;
  prompt: string;
  imagePng: Buffer;
  maskPng: Buffer | null;
  size: string;
  signal?: AbortSignal;
};

export async function generateEdit(input: ProviderEditInput): Promise<Buffer> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new ProviderError("The image service isn't configured yet.", 503);

  const form = new FormData();
  form.append("model", input.model);
  form.append("prompt", input.prompt);
  form.append("image[]", new Blob([new Uint8Array(input.imagePng)], { type: "image/png" }), "source.png");
  if (input.maskPng) {
    form.append("mask", new Blob([new Uint8Array(input.maskPng)], { type: "image/png" }), "mask.png");
  }
  form.append("size", input.size);
  form.append("quality", "high");
  form.append("output_format", "png");
  form.append("n", "1");
  if (supportsInputFidelity(input.model)) form.append("input_fidelity", "high");

  const timeout = AbortSignal.timeout(110_000);
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal,
    });
  } catch (error) {
    if (input.signal?.aborted) throw new ProviderError("Generation was cancelled.", 499);
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new ProviderError("The image service didn't respond in time.", 504);
    }
    throw new ProviderError("We couldn't generate this edit. The image service didn't respond.", 502);
  }

  const body = await response.text();
  let payload: { data?: { b64_json?: string }[]; error?: { message?: string } } | null = null;
  try {
    payload = JSON.parse(body) as { data?: { b64_json?: string }[]; error?: { message?: string } };
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new ProviderError(publicProviderError(response.status, payload?.error?.message), response.status);
  }

  const encoded = payload?.data?.[0]?.b64_json;
  if (!encoded) throw new ProviderError("The image service returned an unreadable result.", 502);
  const decoded = Buffer.from(encoded, "base64");
  if (decoded.length < 32) throw new ProviderError("The image service returned an unreadable result.", 502);
  return decoded;
}

export function imageModel(): string {
  return process.env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-2.5-sunburst";
}
