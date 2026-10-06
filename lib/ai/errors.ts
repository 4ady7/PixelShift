const SECRET = /sk-[A-Za-z0-9_-]{8,}|bearer\s+[A-Za-z0-9._-]+/i;

export class ProviderError extends Error {
  readonly status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
  }
}

export function publicProviderError(status: number, providerMessage?: string): string {
  if (status === 401 || status === 403) return "The image service rejected the server credentials.";
  if (status === 429) return "The image service is busy right now. Wait a moment, then try again.";
  if (status === 408 || status === 504) return "The image service didn't respond in time.";
  if (providerMessage && isSafeMessage(providerMessage)) {
    return `We couldn't generate this edit. ${providerMessage}`;
  }
  return "We couldn't generate this edit. The image service didn't respond.";
}

function isSafeMessage(message: string): boolean {
  const compact = message.replace(/\s+/g, " ").trim();
  return compact.length > 0 && compact.length <= 220 && !SECRET.test(compact) && !compact.includes("<");
}
