import { createPublicClient, http } from "viem";
import { createConfig } from "wagmi";
import { coinbaseWallet, injected, walletConnect } from "wagmi/connectors";
import { LOGS_RPC, PUBLIC_LOGS_RANGE, addresses, chainFor, createRienda, explorerUrl, transportFor, type Network } from "@rienda/sdk";

const env = import.meta.env;

export const NETWORK: Network = env.VITE_NETWORK === "mainnet" ? "mainnet" : "testnet";
export const chain = chainFor(NETWORK);
export const deployment = addresses[NETWORK];
export const RIENDA = deployment.rienda;
export const USDC = deployment.usdc;

const transport = transportFor(NETWORK, {
  RPC_URL_TESTNET: env.VITE_RPC_URL_TESTNET,
  RPC_URL_MAINNET: env.VITE_RPC_URL_MAINNET,
});

/** WalletConnect needs a Reown project id. Without one the option is hidden, never a crash. */
export const WALLETCONNECT_PROJECT_ID: string | undefined = env.VITE_WALLETCONNECT_PROJECT_ID?.trim() || undefined;

const appUrl = typeof window !== "undefined" ? window.location.origin : "https://rienda.app";

export const wagmiConfig = createConfig({
  chains: [chain],
  // EIP-6963: every installed wallet (MetaMask, Rabby, …) announces itself and becomes its own connector.
  // The generic injected() connector stays only as a fallback for wallets that don't announce.
  multiInjectedProviderDiscovery: true,
  connectors: [
    injected(),
    coinbaseWallet({ appName: "Rienda" }),
    ...(WALLETCONNECT_PROJECT_ID
      ? [
          walletConnect({
            projectId: WALLETCONNECT_PROJECT_ID,
            showQrModal: false, // we draw our own QR in the connect modal
            metadata: { name: "Rienda", description: "Spending limits for AI agents on Monad", url: appUrl, icons: [] },
          }),
        ]
      : []),
  ],
  transports: { [chain.id]: transport },
});

/** Read-only client, independent of the wallet (works before connecting and on the wrong network). */
export const publicClient = createPublicClient({ chain, transport });

/** Where event history is read from, fastest first. `max` is how many blocks one getLogs call may span (shrinks if the node says no). */
/** Caps how many requests one source gets at once, however many windows are being fetched (public RPCs 429 above ~6-8 in flight). */
export class Gate {
  private n = 0;
  private q: (() => void)[] = [];
  private nextStart = 0;
  /** `gapMs`: minimum time between request starts (a rate cap: thirdweb's public RPC 429s above ~7 requests/s). */
  constructor(readonly cap: number, readonly gapMs = 0) {}
  async run<T>(f: () => Promise<T>): Promise<T> {
    if (this.n >= this.cap) await new Promise<void>((r) => this.q.push(r));
    this.n++;
    if (this.gapMs > 0) {
      const start = Math.max(Date.now(), this.nextStart);
      this.nextStart = start + this.gapMs;
      if (start > Date.now()) await new Promise((r) => setTimeout(r, start - Date.now()));
    }
    try {
      return await f();
    } finally {
      this.n--;
      this.q.shift()?.();
    }
  }
}
export type LogSource = { name: string; client: typeof publicClient; max: bigint; fails: number; coolUntil: number; gate: Gate };
export const logSources: LogSource[] = [
  // VITE_LOGS_RPC=none turns the extra history RPCs off (e.g. against a local chain); the public RPC is always the last source
  ...(env.VITE_LOGS_RPC === "none" ? [] : LOGS_RPC[NETWORK]).map((s) => ({ name: new URL(s.url).host, client: createPublicClient({ chain, transport: http(s.url, { retryCount: 0, timeout: 8_000 }) }), max: BigInt(s.maxRange), fails: 0, coolUntil: 0, gate: new Gate(4, 170) })),
  { name: "public", client: publicClient, max: BigInt(PUBLIC_LOGS_RANGE), fails: 0, coolUntil: 0, gate: new Gate(6, 90) },
];

export const rienda = RIENDA ? createRienda({ address: RIENDA, publicClient }) : null;

export const txUrl = (hash: string) => explorerUrl(NETWORK, "tx", hash);
export const addressUrl = (addr: string) => explorerUrl(NETWORK, "address", addr);
