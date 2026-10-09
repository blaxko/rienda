import { useEffect, useRef, useState } from "react";
import type { Connector } from "wagmi";
import { useConnect, useConnection, useConnectors, useDisconnect, useSwitchChain } from "wagmi";
import { numberToHex } from "viem";
import { Link } from "../router";
import { NETWORK, RIENDA, addressUrl, chain } from "../config";
import { useWallet } from "../hooks";
import { shortAddr } from "../lib/format";
import { errorText } from "../lib/tx";

/** Wallets to offer: every EIP-6963 announcement; the generic injected connector only if nothing announced. */
function useWalletChoices(): { choices: Connector[]; fallbackOnly: boolean } {
  const connectors = useConnectors();
  const announced = connectors.filter((c) => c.id !== "injected");
  if (announced.length > 0) return { choices: announced, fallbackOnly: false };
  const hasLegacyProvider = typeof window !== "undefined" && !!(window as any).ethereum;
  const generic = connectors.filter((c) => c.id === "injected");
  return { choices: hasLegacyProvider ? generic : [], fallbackOnly: hasLegacyProvider };
}

function ConnectMenu({ onError }: { onError: (msg: string | null) => void }) {
  const connect = useConnect();
  const { choices, fallbackOnly } = useWalletChoices();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  function pick(c: Connector) {
    onError(null);
    connect.mutate(
      { connector: c },
      {
        onSuccess: () => setOpen(false),
        onError: (e) => onError(`Could not connect ${c.name}: ${errorText(e)}`),
      },
    );
  }

  return (
    <div className="picker-wrap" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} disabled={connect.isPending}>
        {connect.isPending ? "Connecting… check your wallet" : "Connect wallet"}
      </button>
      {open && (
        <div className="picker" role="menu">
          {choices.length === 0 ? (
            <p className="picker-empty">No wallet found — install MetaMask or Rabby, then reload this page.</p>
          ) : (
            <>
              <div className="picker-title">Choose a wallet</div>
              {choices.map((c) => (
                <button key={c.uid} role="menuitem" className="picker-item" onClick={() => pick(c)} disabled={connect.isPending}>
                  {c.icon ? <img src={c.icon} alt="" width={22} height={22} /> : <span className="picker-noicon" />}
                  <span>{fallbackOnly ? "Browser wallet" : c.name}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function Header() {
  const w = useWallet();
  const disconnect = useDisconnect();
  const { connector } = useConnection();
  const [connectError, setConnectError] = useState<string | null>(null);

  return (
    <>
      <header className="header">
        <Link to="/" className="brand">Rienda</Link>
        <nav>
          <Link to="/">My reins</Link>
          <Link to="/new">New rein</Link>
        </nav>
        <div className="spacer" />
        <span className={`pill ${NETWORK}`} title={RIENDA ?? "not deployed"}>{chain.name}</span>
        {w.isConnected ? (
          <>
            {connector?.name && <span className="muted">{connector.name}</span>}
            <a className="addr" href={addressUrl(w.address!)} target="_blank" rel="noreferrer" title={w.address}>
              {shortAddr(w.address!)}
            </a>
            <button className="ghost" onClick={() => disconnect.mutate()}>Disconnect</button>
          </>
        ) : (
          <ConnectMenu onError={setConnectError} />
        )}
      </header>
      {connectError && !w.isConnected && (
        <div className="banner banner-red" role="alert">
          {connectError} <button className="ghost small" onClick={() => setConnectError(null)}>Dismiss</button>
        </div>
      )}
    </>
  );
}

function isRejected(e: unknown): boolean {
  const code = (e as any)?.code ?? (e as any)?.cause?.code;
  return code === 4001 || /rejected|denied/i.test((e as Error)?.message ?? "");
}

/**
 * Shown on every page. After connecting on the wrong network it prompts once to switch (adding Monad
 * to the wallet if it doesn't know it), and keeps a button + the error on screen. Actions stay blocked
 * (useWallet().canAct) until the wallet is on Monad.
 */
export function NetworkGuard() {
  const w = useWallet();
  const { connector, chainId } = useConnection();
  const switchChain = useSwitchChain();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prompted = useRef<string>("");

  async function switchOrAdd() {
    setError(null);
    setPending(true);
    try {
      await switchChain.mutateAsync({ chainId: chain.id });
    } catch (e) {
      if (isRejected(e)) {
        setError("Network switch was rejected in your wallet.");
      } else {
        // wallet doesn't know this network yet (or wouldn't switch): add it explicitly
        try {
          const provider = (await connector?.getProvider()) as { request: (a: { method: string; params: unknown[] }) => Promise<unknown> } | undefined;
          if (!provider) throw new Error("No wallet provider available");
          await provider.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: numberToHex(chain.id),
                chainName: chain.name,
                nativeCurrency: chain.nativeCurrency,
                rpcUrls: chain.rpcUrls.default.http,
                blockExplorerUrls: chain.blockExplorers ? [chain.blockExplorers.default.url] : undefined,
              },
            ],
          });
        } catch (e2) {
          setError(isRejected(e2) ? "Adding the network was rejected in your wallet." : `Could not switch network: ${errorText(e2)}`);
        }
      }
    } finally {
      setPending(false);
    }
  }

  // prompt once per (account, chain) right after connecting on the wrong network
  const key = `${w.address ?? ""}:${chainId ?? ""}`;
  useEffect(() => {
    if (w.isConnected && !w.onRightChain && prompted.current !== key) {
      prompted.current = key;
      void switchOrAdd();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w.isConnected, w.onRightChain, key]);

  if (!RIENDA) return <div className="banner banner-red">Rienda is not deployed on {chain.name} yet.</div>;
  if (!w.isConnected || w.onRightChain) return null;
  return (
    <div className="banner banner-amber" role="alert">
      <strong>Switch to Monad.</strong> Your wallet is on another network (chain {chainId}), so actions are disabled.{" "}
      <button onClick={switchOrAdd} disabled={pending}>{pending ? "Check your wallet…" : `Switch to ${chain.name}`}</button>
      {error && <div className="tx tx-err">{error}</div>}
    </div>
  );
}
