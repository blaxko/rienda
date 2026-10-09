import { defineChain, fallback, http } from "viem";
import type { Chain, Transport } from "viem";

export type Network = "testnet" | "mainnet";

export const PUBLIC_RPC = {
  mainnet: "https://rpc.monad.xyz",
  testnet: "https://testnet-rpc.monad.xyz",
} as const;

export const monadMainnet = defineChain({
  id: 143,
  name: "Monad",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [PUBLIC_RPC.mainnet] } },
  blockExplorers: { default: { name: "MonadVision", url: "https://monadvision.com" } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
});

export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [PUBLIC_RPC.testnet] } },
  blockExplorers: { default: { name: "MonadVision", url: "https://testnet.monadvision.com" } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
  testnet: true,
});

export function chainFor(network: Network): Chain {
  return network === "mainnet" ? monadMainnet : monadTestnet;
}

/** Explorer link for a transaction or address on the right network. */
export function explorerUrl(network: Network, kind: "tx" | "address", value: string): string {
  return `${chainFor(network).blockExplorers!.default.url}/${kind}/${value}`;
}

type Env = Record<string, string | undefined>;

/**
 * Primary RPC from env (e.g. Alchemy) with the public Monad RPC as fallback.
 * Env keys: RPC_URL (applies to the selected network), or RPC_URL_MAINNET / RPC_URL_TESTNET.
 * Pass `process.env` (node) or `import.meta.env` (vite); the SDK never reads globals itself.
 */
export function transportFor(network: Network, env: Env = {}): Transport {
  const specific = network === "mainnet" ? env.RPC_URL_MAINNET : env.RPC_URL_TESTNET;
  const primary = specific || env.RPC_URL;
  const publicUrl = PUBLIC_RPC[network];
  const urls = primary && primary !== publicUrl ? [primary, publicUrl] : [publicUrl];
  const transports = urls.map((u) => http(u, { retryCount: 1, timeout: 10_000 }));
  return transports.length === 1 ? transports[0]! : fallback(transports, { rank: false });
}
