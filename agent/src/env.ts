import { isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const AGENT_DIR = fileURLToPath(new URL("../", import.meta.url));

export type AgentEnv = {
  agentKey: `0x${string}`;
  reinId: bigint;
  attacker: `0x${string}`;
  raw: NodeJS.ProcessEnv;
};

/** Loads the single repo-root .env (works from any cwd). Never logs values. */
export function loadAgentEnv(): AgentEnv {
  try {
    process.loadEnvFile(`${ROOT}.env`);
  } catch {
    // no file: rely on real environment variables
  }
  const e = process.env;
  const missing: string[] = [];
  const need = (k: string) => {
    if (!e[k]) missing.push(k);
    return e[k] ?? "";
  };
  const agentKey = need("AGENT_PRIVATE_KEY");
  const reinId = need("REIN_ID");
  const attacker = need("ATTACKER_ADDRESS");
  if (missing.length) throw new Error(`Missing in root .env: ${missing.join(", ")}`);

  if (!/^0x[0-9a-fA-F]{64}$/.test(agentKey)) throw new Error("AGENT_PRIVATE_KEY must be a 0x-prefixed 32-byte hex key");
  if (!/^\d+$/.test(reinId)) throw new Error("REIN_ID must be a non-negative integer");
  if (!isAddress(attacker)) throw new Error("ATTACKER_ADDRESS is not a valid address");

  const derived = privateKeyToAccount(agentKey as `0x${string}`).address;
  if (e.AGENT_ADDRESS && e.AGENT_ADDRESS.toLowerCase() !== derived.toLowerCase()) {
    throw new Error("AGENT_ADDRESS does not match AGENT_PRIVATE_KEY (check root .env)");
  }
  return { agentKey: agentKey as `0x${string}`, reinId: BigInt(reinId), attacker: attacker as `0x${string}`, raw: e };
}
