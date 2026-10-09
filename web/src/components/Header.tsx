import { useConnect, useConnectors, useDisconnect } from "wagmi";
import { Link } from "../router";
import { NETWORK, RIENDA, chain, addressUrl } from "../config";
import { useWallet } from "../hooks";
import { shortAddr } from "../lib/format";

export function Header() {
  const w = useWallet();
  const connect = useConnect();
  const connectors = useConnectors();
  const disconnect = useDisconnect();
  const injected = connectors[0];

  return (
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
          <a className="addr" href={addressUrl(w.address!)} target="_blank" rel="noreferrer" title={w.address}>
            {shortAddr(w.address!)}
          </a>
          <button className="ghost" onClick={() => disconnect.mutate()}>Disconnect</button>
        </>
      ) : (
        <button onClick={() => injected && connect.mutate({ connector: injected })} disabled={!injected || connect.isPending}>
          {connect.isPending ? "Connecting…" : "Connect wallet"}
        </button>
      )}
    </header>
  );
}

/** Shown on every page. Blocks actions (via useWallet().canAct) until the wallet is on Monad. */
export function NetworkGuard() {
  const w = useWallet();
  if (!RIENDA) return <div className="banner banner-red">Rienda is not deployed on {chain.name} yet.</div>;
  if (!w.isConnected || w.onRightChain) return null;
  return (
    <div className="banner banner-amber">
      <strong>Switch to Monad.</strong> Your wallet is on another network, so actions are disabled.{" "}
      <button onClick={w.switchToMonad} disabled={w.switching}>
        {w.switching ? "Switching…" : `Switch to ${chain.name}`}
      </button>
    </div>
  );
}
