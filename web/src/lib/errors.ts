export type ErrorKind = "network" | "rejected" | "funds" | "revert" | "other";
export type Explained = { kind: ErrorKind; hint: string; detail: string };

/** Hide anything key-like before technical detail goes on screen: RPC API keys and project ids. */
export function redact(text: string): string {
  return text
    .replace(/(\/v[0-9]\/)[A-Za-z0-9_-]{16,}/g, "$1…")
    .replace(/(projectId=|api[-_]?key=|apikey=)[A-Za-z0-9_-]+/gi, "$1…")
    .replace(/\b[0-9a-f]{32}\b/g, "…");
}

/** Turns whatever was thrown into a short sentence for people and the full text for the Details section. */
export function explain(e: unknown): Explained {
  const err = e as { code?: number; name?: string; message?: string; shortMessage?: string; details?: string; cause?: { code?: number } } | string | undefined;
  const obj = typeof err === "object" && err ? err : undefined;
  const msg = typeof err === "string" ? err : obj?.message ?? String(e);
  const detail = redact([msg, obj?.details && !msg.includes(obj.details) ? obj.details : ""].filter(Boolean).join("\n"));
  const code = obj?.code ?? obj?.cause?.code;
  const text = `${obj?.name ?? ""} ${msg}`;
  if (code === 4001 || /user rejected|rejected in your wallet|denied transaction|request rejected|declined/i.test(text)) return { kind: "rejected", hint: "You rejected the request in your wallet.", detail };
  if (/insufficient funds/i.test(text)) return { kind: "funds", hint: "This wallet doesn't have enough MON to pay for gas.", detail };
  if (/HTTP request failed|HttpRequestError|failed to fetch|fetch failed|networkerror|network request failed|timed? ?out|timeout|ECONN|ENOTFOUND|WebSocket|Load failed/i.test(text)) return { kind: "network", hint: "Check your connection and try again.", detail };
  if (/revert|ContractFunctionExecutionError|ContractFunctionRevertedError|Contract rejected/i.test(text)) return { kind: "revert", hint: "The contract refused it. See the details.", detail };
  return { kind: "other", hint: "Try again in a moment.", detail };
}
