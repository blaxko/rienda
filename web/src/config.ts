import { createPublicClient, http } from "viem";
import { createConfig } from "wagmi";
import { coinbaseWallet, injected } from "wagmi/connectors";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { createAppKit } from "@reown/appkit/react";
import { brandAppKit } from "./lib/appkitBrand";
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

/** Wallets listed first in the connect modal (WalletConnect Explorer ids, checked against the Explorer API). */
const FEATURED_WALLETS = [
  "c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96", // MetaMask
  "4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0", // Trust Wallet
  "fd20dc426fb37566d803205b19bbc1d4096b248ac04548e3cfb6b3a38bd033aa", // Coinbase Wallet
  "1ae92b26df02f0abca6304df07debccd18262fdf5fe82daa81593582dac9a369", // Rainbow
  "971e689d0a5be527bac79629b4ee9b925e82208e5168b733496a09c0faed0709", // OKX Wallet
  "a797aa35c0fadbfc1a53e7f675162ed5226968b44a19ee3d24385c64d1d3c393", // Phantom
  "18388be9ac2d02726dbac9777c96efaac06d744b2f6d580fccdd4127a6d01fd1", // Rabby
];

/** True when the Reown AppKit modal is in use (a WalletConnect project id is set). */
export const USE_APPKIT = !!WALLETCONNECT_PROJECT_ID;

function buildWagmiConfig() {
  if (WALLETCONNECT_PROJECT_ID) {
    // Reown AppKit on top of wagmi: every wallet the browser announces (EIP-6963), WalletConnect with its own
    // wallet list and logos, deep links on phones. Themed to Rienda; the modal gets our mark (see lib/appkitBrand).
    const adapter = new WagmiAdapter({ projectId: WALLETCONNECT_PROJECT_ID, networks: [chain as never], transports: { [chain.id]: transport } });
    const modal = createAppKit({
      adapters: [adapter],
      projectId: WALLETCONNECT_PROJECT_ID,
      networks: [chain as never],
      defaultNetwork: chain as never,
      metadata: { name: "Rienda", description: "Spending limits for AI agents on Monad", url: appUrl, icons: [`${appUrl}/apple-touch-icon.png`] },
      themeMode: "light",
      themeVariables: {
        "--w3m-font-family": '"Geist", system-ui, -apple-system, "Segoe UI", sans-serif',
        "--w3m-accent": "#8B5A2B",
        "--w3m-color-mix": "#FBF8F3",
        "--w3m-color-mix-strength": 28,
        "--w3m-border-radius-master": "3px",
        "--w3m-qr-color": "#14110F",
        "--w3m-z-index": 300,
      },
      featuredWalletIds: FEATURED_WALLETS,
      features: { analytics: false, email: false, socials: false, swaps: false, onramp: false, reownBranding: false } as never,
    });
    brandAppKit(modal);
    return adapter.wagmiConfig;
  }
  // No project id: injected wallets (EIP-6963) and Coinbase only. WalletConnect is hidden, never a crash.
  return createConfig({
    chains: [chain],
    multiInjectedProviderDiscovery: true,
    connectors: [injected(), coinbaseWallet({ appName: "Rienda" })],
    transports: { [chain.id]: transport },
  });
}

export const wagmiConfig = buildWagmiConfig();

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
