import { readdirSync, readFileSync } from "node:fs";
import { formatUnits, getAddress, isAddress, parseUnits } from "viem";
import {
  MAX_MEMO_BYTES,
  RiendaRevertError,
  explorerUrl,
  type Network,
  type PayResult,
  type Rienda,
} from "@rienda/sdk";
import { AGENT_DIR } from "./env.js";
import { log } from "./log.js";

// ───────────────────────────── Types ─────────────────────────────

export type Merchant = { key: string; label: string; address: `0x${string}`; price: string; unit: string };

export type ToolContext = {
  rienda: Rienda;
  network: Network;
  reinId: bigint;
  decimals: number;
  merchants: Merchant[];
  attacker: `0x${string}`;
  /** Latest block timestamp reader, for the UTC-day rollover in check_budget. */
  now: () => Promise<bigint>;
};

export class ToolInputError extends Error {}

export type Tool<A = unknown> = {
  name: string;
  description: string;
  /** JSON Schema for LLM tool-calling (used in LLM mode). */
  parameters: Record<string, unknown>;
  /** Validates raw (untrusted) args. Throws ToolInputError. Nothing is sent to chain before this passes. */
  parse: (raw: unknown) => A;
  run: (args: A) => Promise<unknown>;
};

// ───────────────────────────── Validation ─────────────────────────────

function asObject(raw: unknown): Record<string, unknown> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new ToolInputError("arguments must be an object");
  return raw as Record<string, unknown>;
}

function noExtraKeys(o: Record<string, unknown>, allowed: string[]) {
  const extra = Object.keys(o).filter((k) => !allowed.includes(k));
  if (extra.length) throw new ToolInputError(`unexpected argument(s): ${extra.join(", ")}`);
}

export function parseAddress(v: unknown, field: string): `0x${string}` {
  if (typeof v !== "string" || !isAddress(v, { strict: false })) throw new ToolInputError(`${field} must be a valid 0x address`);
  return getAddress(v);
}

/** USDC amount in dollars as a plain decimal string/number, e.g. "2", "0.40". Returns base units. */
export function parseAmount(v: unknown, decimals: number): bigint {
  const s = typeof v === "number" && Number.isFinite(v) ? String(v) : v;
  if (typeof s !== "string" || !/^\d+(\.\d+)?$/.test(s)) throw new ToolInputError("amount must be a positive decimal number in USDC, e.g. 2 or 0.40");
  const frac = s.split(".")[1] ?? "";
  if (frac.length > decimals) throw new ToolInputError(`amount has more than ${decimals} decimal places`);
  const units = parseUnits(s, decimals);
  if (units <= 0n) throw new ToolInputError("amount must be greater than 0");
  if (units > parseUnits("1000000", decimals)) throw new ToolInputError("amount is unreasonably large (max 1,000,000 USDC)");
  return units;
}

export function parseMemo(v: unknown): string {
  if (typeof v !== "string") throw new ToolInputError("memo must be a string");
  if (new TextEncoder().encode(v).length > MAX_MEMO_BYTES) throw new ToolInputError(`memo must be at most ${MAX_MEMO_BYTES} bytes`);
  return v;
}

// ───────────────────────────── Fixtures ─────────────────────────────

const PAGES_DIR = `${AGENT_DIR}fixtures/pages/`;

export function listPages(): string[] {
  return readdirSync(PAGES_DIR)
    .filter((f) => f.endsWith(".html"))
    .map((f) => f.slice(0, -".html".length));
}

// ───────────────────────────── Tools ─────────────────────────────

const fmt = (units: bigint, decimals: number) => formatUnits(units, decimals);

export function createTools(ctx: ToolContext): Tool<any>[] {
  const listMerchants: Tool<Record<string, never>> = {
    name: "list_merchants",
    description: "List the merchants you can buy from, with their payment addresses and prices (USDC).",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    parse: (raw) => {
      noExtraKeys(asObject(raw ?? {}), []);
      return {};
    },
    run: async () => ({
      ok: true,
      merchants: ctx.merchants.map((m) => ({ label: m.label, address: m.address, price: `${m.price} USDC per ${m.unit}` })),
    }),
  };

  const checkBudget: Tool<Record<string, never>> = {
    name: "check_budget",
    description: "Check your remaining budget: balance, today's spend, limits, strikes and status.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    parse: (raw) => {
      noExtraKeys(asObject(raw ?? {}), []);
      return {};
    },
    run: async () => {
      const r = await ctx.rienda.getRein(ctx.reinId);
      const today = (await ctx.now()) / 86_400n;
      const spentToday = r.day === today ? r.spentToday : 0n; // contract resets lazily on the next pay
      const d = ctx.decimals;
      return {
        ok: true,
        status: r.status,
        balance: fmt(r.balance, d),
        spentToday: fmt(spentToday, d),
        dailyCap: fmt(r.dailyCap, d),
        remainingToday: fmt(r.dailyCap > spentToday ? r.dailyCap - spentToday : 0n, d),
        perPaymentCap: fmt(r.perPayCap, d),
        holdCeiling: fmt(r.holdCeiling, d),
        strikes: `${r.strikes}/${r.maxStrikes}`,
        openHeldRequests: r.openHeld,
      };
    },
  };

  const readPage: Tool<{ name: string }> = {
    name: "read_page",
    description: `Read a web page by name. Available pages: ${listPages().join(", ")}.`,
    parameters: {
      type: "object",
      properties: { name: { type: "string", description: "page name, e.g. news-today" } },
      required: ["name"],
      additionalProperties: false,
    },
    parse: (raw) => {
      const o = asObject(raw);
      noExtraKeys(o, ["name"]);
      const name = o.name;
      if (typeof name !== "string" || !listPages().includes(name)) {
        throw new ToolInputError(`name must be one of: ${listPages().join(", ")}`);
      }
      return { name };
    },
    run: async ({ name }) => {
      const html = readFileSync(`${PAGES_DIR}${name}.html`, "utf8").replaceAll("{{ATTACKER_ADDRESS}}", ctx.attacker);
      return { ok: true, name, content: html };
    },
  };

  const pay: Tool<{ to: `0x${string}`; amount: bigint; memo: string }> = {
    name: "pay",
    description:
      "Pay USDC to an address through your rein. `amount` is in USDC dollars (e.g. 2 or 0.40). `memo` is a short note (max 140 bytes).",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string", description: "recipient 0x address" },
        amount: { type: "string", description: "USDC amount, e.g. \"2\" or \"0.40\"" },
        memo: { type: "string", description: "short note about the purchase" },
      },
      required: ["to", "amount", "memo"],
      additionalProperties: false,
    },
    parse: (raw) => {
      const o = asObject(raw);
      noExtraKeys(o, ["to", "amount", "memo"]);
      return { to: parseAddress(o.to, "to"), amount: parseAmount(o.amount, ctx.decimals), memo: parseMemo(o.memo) };
    },
    run: async ({ to, amount, memo }) => {
      try {
        const r: PayResult = await ctx.rienda.pay({ reinId: ctx.reinId, to, amount, memo });
        return {
          ok: true,
          outcome: r.outcome,
          reason: r.reason,
          requestId: r.requestId?.toString(),
          strikes: r.strikes,
          frozen: r.frozen,
          tx: r.txHash,
          explorer: explorerUrl(ctx.network, "tx", r.txHash),
          gasUsed: r.gasUsed.toString(),
        };
      } catch (err) {
        if (err instanceof RiendaRevertError) return { ok: false, reverted: true, error: err.errorName };
        throw err;
      }
    },
  };

  return [listMerchants, checkBudget, readPage, pay];
}

// ───────────────────────────── Execution ─────────────────────────────

export function summarize(result: any): string {
  if (result?.outcome) {
    const bits = [result.outcome, result.reason, result.requestId !== undefined ? `request #${result.requestId}` : undefined];
    if (result.strikes !== undefined) bits.push(`strike ${result.strikes}`);
    if (result.frozen) bits.push("FROZEN");
    return `${bits.filter(Boolean).join(" · ")}${result.explorer ? `\n   ${result.explorer}` : ""}`;
  }
  if (result?.reverted) return `REVERTED: ${result.error}`;
  if (result?.ok === false) return `error: ${result.error}`;
  if (result?.content) return `page "${result.name}":\n${result.content}`;
  return JSON.stringify(result, null, 2);
}

/** Validates raw args, runs the tool, prints the call and result. Invalid calls never reach the chain. */
export async function executeTool(tools: Tool<any>[], name: string, rawArgs: unknown): Promise<any> {
  log.call(name, rawArgs);
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    log.reject(`unknown tool "${name}"`);
    return { ok: false, error: `unknown tool "${name}"` };
  }
  let args;
  try {
    args = tool.parse(rawArgs);
  } catch (err) {
    if (err instanceof ToolInputError) {
      log.reject(err.message);
      return { ok: false, error: `invalid arguments: ${err.message}` };
    }
    throw err;
  }
  const result = await tool.run(args);
  log.result(summarize(result));
  return result;
}
