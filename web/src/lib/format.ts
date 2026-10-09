import { formatUnits, parseUnits } from "viem";

/** USDC base units -> "30.00" (at least 2 decimals, trailing zeros trimmed beyond that). */
export function fmtUsdc(units: bigint, decimals = 6): string {
  const s = formatUnits(units, decimals);
  const [i, f = ""] = s.split(".");
  const frac = f.replace(/0+$/, "").padEnd(2, "0");
  return `${Number(i).toLocaleString("en-US")}.${frac}`;
}

/** "5" / "0.40" -> base units, or null if not a positive amount with <= decimals places. */
export function parseUsdc(input: string, decimals = 6): bigint | null {
  const s = input.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  if ((s.split(".")[1] ?? "").length > decimals) return null;
  const v = parseUnits(s, decimals);
  return v > 0n ? v : null;
}

export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function fmtTime(ts: number | undefined): string {
  if (!ts) return "…";
  return new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function fmtDateTime(ts: bigint | number): string {
  return new Date(Number(ts) * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}
