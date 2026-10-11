import type { Chain } from "viem";
import { numberToHex } from "viem";
import type { Connector } from "wagmi";

/** Parameters for wallet_addEthereumChain: the chain id, our RPC, MON, and the MonadVision explorer. */
export function chainAddParams(chain: Chain) {
  return {
    chainId: numberToHex(chain.id),
    chainName: chain.name,
    nativeCurrency: chain.nativeCurrency,
    rpcUrls: chain.rpcUrls.default.http,
    blockExplorerUrls: chain.blockExplorers ? [chain.blockExplorers.default.url] : undefined,
  };
}

export type ConnectFailure = { kind: "rejected" | "not-installed" | "timeout" | "other"; message: string };

/** Turns whatever a wallet or connector throws into one of the cases the modal has copy for. */
export function classifyConnectError(e: unknown, walletName?: string): ConnectFailure {
  const err = e as { code?: number; name?: string; message?: string; cause?: { code?: number } } | undefined;
  const code = err?.code ?? err?.cause?.code;
  const text = `${err?.name ?? ""} ${err?.message ?? ""}`;
  if (err?.name === "ConnectTimeoutError") return { kind: "timeout", message: "The wallet didn't answer in time." };
  if (code === 4001 || /UserRejected|rejected|denied|declined|closed modal|user closed/i.test(text)) {
    return { kind: "rejected", message: `You rejected the request${walletName ? ` in ${walletName}` : ""}.` };
  }
  if (/ProviderNotFound|not found|not installed|No provider|undefined provider/i.test(text)) {
    return { kind: "not-installed", message: `${walletName ?? "That wallet"} isn't installed in this browser.` };
  }
  return { kind: "other", message: (err?.message ?? String(e)).split("\n")[0]!.slice(0, 200) };
}

export class ConnectTimeoutError extends Error {
  name = "ConnectTimeoutError";
}

/** Rejects after `ms` so a wallet that never answers can't leave the modal spinning forever. */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new ConnectTimeoutError("Timed out waiting for the wallet")), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

export type WalletOption = { connector: Connector; kind: "injected" | "walletconnect" | "coinbase" | "fallback"; name: string; icon?: string };

const COINBASE_RDNS = "com.coinbase.wallet";

/**
 * What the modal lists. Every EIP-6963 announcement is its own entry (real name and icon). The generic
 * injected connector appears only when nothing announced but window.ethereum exists. Coinbase's SDK
 * connector is dropped when the Coinbase extension already announced itself. WalletConnect appears only
 * when a project id was configured.
 */
export function walletOptions(connectors: readonly Connector[], opts: { hasLegacyProvider: boolean }): WalletOption[] {
  const announced = connectors.filter((c) => c.type === "injected" && c.id !== "injected");
  const out: WalletOption[] = announced.map((c) => ({ connector: c, kind: "injected", name: c.name, icon: c.icon }));
  if (announced.length === 0 && opts.hasLegacyProvider) {
    const g = connectors.find((c) => c.id === "injected");
    if (g) out.push({ connector: g, kind: "fallback", name: "Browser wallet" });
  }
  const cb = connectors.find((c) => c.id === "coinbaseWalletSDK" || c.type === "coinbaseWallet");
  if (cb && !announced.some((c) => c.id === COINBASE_RDNS)) out.push({ connector: cb, kind: "coinbase", name: "Coinbase Wallet", icon: cb.icon });
  const wc = connectors.find((c) => c.id === "walletConnect");
  if (wc) out.push({ connector: wc, kind: "walletconnect", name: "WalletConnect", icon: wc.icon });
  return out;
}

export const isMobileBrowser = () => typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

/** MetaMask's universal link opens this page inside its in-app browser. */
export const metamaskDeepLink = (loc: { host: string; pathname: string; search: string }) =>
  `https://metamask.app.link/dapp/${loc.host}${loc.pathname}${loc.search}`;

export function recentConnectorId(): string | null {
  try {
    const v = localStorage.getItem("wagmi.recentConnectorId");
    return v ? (JSON.parse(v) as string) : null;
  } catch {
    return null;
  }
}
