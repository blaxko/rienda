import { useEffect, useRef, useState } from "react";
import { useConnection, useDisconnect, useSwitchChain } from "wagmi";
import { AlertTriangle, ChevronDown } from "@untitledui/icons";
import { Link, usePath } from "../router";
import { NETWORK, RIENDA, addressUrl, chain } from "../config";
import { useWallet } from "../hooks";
import { shortAddr } from "../lib/format";
import { errorText } from "../lib/tx";
import { redact } from "../lib/errors";
import { chainAddParams } from "../lib/wallet";
import { RiendaMark } from "./Logo";
import { ConnectButton } from "./ConnectModal";

/** Phones: one compact chip (address) that opens a small menu with the network, the wallet and Disconnect. */
function AccountChip({ address, wallet, rightChain, onDisconnect }: { address: string; wallet?: string; rightChain: boolean; onDisconnect: () => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); box.current?.querySelector<HTMLElement>(".acct-chip")?.focus(); } };
    document.addEventListener("mousedown", onDown); document.addEventListener("touchstart", onDown); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("touchstart", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <div className="acct-mobile" ref={box}>
      <button className="acct-chip" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className={`acct-dot ${rightChain ? "" : "bad"}`} aria-hidden />
        <span className="mono">{shortAddr(address)}</span>
        <ChevronDown width={16} height={16} aria-hidden />
      </button>
      {open && (
        <div className="acct-menu glass" role="menu">
          <div className="acct-row2"><span className="muted">Network</span><span>{rightChain ? chain.name : <strong className="warn">Wrong network</strong>}</span></div>
          {wallet && <div className="acct-row2"><span className="muted">Wallet</span><span>{wallet}</span></div>}
          <a className="acct-link" role="menuitem" href={addressUrl(address)} target="_blank" rel="noreferrer">View address on the explorer</a>
          <button className="btn ghost" role="menuitem" onClick={() => { setOpen(false); onDisconnect(); }}>Disconnect</button>
        </div>
      )}
    </div>
  );
}

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
        <span className={`pill net acct-desktop ${NETWORK}`} title={RIENDA ?? "not deployed"}>{chain.name}</span>
        {w.isConnected ? (
          <>
            <span className="acct-desktop acct-row">
              {connector?.name && <span className="muted">{connector.name}</span>}
              <a className="addr" href={addressUrl(w.address!)} target="_blank" rel="noreferrer" title={w.address}>
                {shortAddr(w.address!)}
              </a>
              <button className="btn ghost small" onClick={() => disconnect.mutate()}>Disconnect</button>
            </span>
            <AccountChip address={w.address!} wallet={connector?.name} rightChain={w.onRightChain} onDisconnect={() => disconnect.mutate()} />
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
  const [error, setError] = useState<{ msg: string; detail?: string } | null>(null);
  const prompted = useRef<string>("");

  async function switchOrAdd() {
    setError(null);
    setPending(true);
    try {
      await switchChain.mutateAsync({ chainId: chain.id });
    } catch (e) {
      if (isRejected(e)) {
        setError({ msg: "You rejected the network switch in your wallet." });
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
          setError(isRejected(e2) ? { msg: "You rejected adding the network in your wallet." } : { msg: "Couldn't switch network. Try again, or add Monad Testnet in your wallet.", detail: redact(errorText(e2)) });
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
        <span><strong>Wrong network.</strong> Your wallet is on chain {chainId}. Switch to {chain.name} to make changes. Until then you can only look.{error && <><br />{error.msg}{error.detail && <details className="err-details"><summary>Details</summary><pre>{error.detail}</pre></details>}</>}</span>
        <button className="btn small" onClick={switchOrAdd} disabled={pending}>{pending ? "Check your wallet…" : `Switch to ${chain.name}`}</button>
      </div>
    </div>
  );
}
