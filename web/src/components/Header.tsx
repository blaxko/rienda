import { useEffect, useRef, useState } from "react";
import { useConnection, useDisconnect, useSwitchChain } from "wagmi";
import { AlertTriangle } from "@untitledui/icons";
import { Link, usePath } from "../router";
import { NETWORK, RIENDA, addressUrl, chain } from "../config";
import { useWallet } from "../hooks";
import { shortAddr } from "../lib/format";
import { errorText } from "../lib/tx";
import { chainAddParams } from "../lib/wallet";
import { RiendaMark } from "./Logo";
import { ConnectButton } from "./ConnectModal";

export function Header() {
  const w = useWallet();
  const disconnect = useDisconnect();
  const { connector } = useConnection();
  const path = usePath();

  return (
    <>
      <header className="app-header">
       <div className="inner">
        <Link to="/" className="wordmark"><RiendaMark />Rienda</Link>
        <nav aria-label="App">
          <Link to="/app" aria-current={path === "/app" ? "page" : undefined}>My reins</Link>
          <Link to="/new" aria-current={path === "/new" ? "page" : undefined}>New rein</Link>
        </nav>
        <div className="header-end">
        <span className={`pill net ${NETWORK}`} title={RIENDA ?? "not deployed"}>{chain.name}</span>
        {w.isConnected ? (
          <>
            {connector?.name && <span className="muted hide-sm">{connector.name}</span>}
            <a className="addr" href={addressUrl(w.address!)} target="_blank" rel="noreferrer" title={w.address}>
              {shortAddr(w.address!)}
            </a>
            <button className="btn ghost small" onClick={() => disconnect.mutate()}>Disconnect</button>
          </>
        ) : (
          <ConnectButton />
        )}
        </div>
       </div>
      </header>
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
            params: [chainAddParams(chain)],
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

  if (!RIENDA) return <div className="global-banner"><div className="banner banner-red" role="alert"><AlertTriangle width={18} height={18} aria-hidden /> Rienda is not deployed on {chain.name} yet.</div></div>;
  if (!w.isConnected || w.onRightChain) return null;
  return (
    <div className="global-banner">
      <div className="banner banner-amber" role="alert">
        <AlertTriangle width={18} height={18} aria-hidden />
        <span><strong>Wrong network.</strong> Your wallet is on chain {chainId}. Switch to {chain.name} to make changes. Until then you can only look.{error && <><br />{error}</>}</span>
        <button className="btn small" onClick={switchOrAdd} disabled={pending}>{pending ? "Check your wallet…" : `Switch to ${chain.name}`}</button>
      </div>
    </div>
  );
}
