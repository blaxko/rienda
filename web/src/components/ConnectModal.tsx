import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { useConnect, useConnectors } from "wagmi";
import { AlertTriangle, Copy01, Loading02, XClose } from "@untitledui/icons";
import { chain } from "../config";
import {
  classifyConnectError,
  isMobileBrowser,
  metamaskDeepLink,
  recentConnectorId,
  walletOptions,
  withTimeout,
  type ConnectFailure,
  type WalletOption,
} from "../lib/wallet";

type View =
  | { name: "list" }
  | { name: "connecting"; option: WalletOption; uri?: string }
  | { name: "error"; option: WalletOption; failure: ConnectFailure };

function WalletIcon({ o }: { o: WalletOption }) {
  if (o.icon) return <img src={o.icon} alt="" width={32} height={32} />;
  return <span className="wallet-noicon" aria-hidden>{o.name.slice(0, 1)}</span>;
}

function Qr({ uri }: { uri: string }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(uri, { margin: 1, width: 224, color: { dark: "#0b0c0e", light: "#ffffff" } }).then((d) => live && setSrc(d));
    return () => { live = false; };
  }, [uri]);
  return src ? <img className="qr" src={src} width={224} height={224} alt="QR code. Scan it with your wallet app to connect." /> : <div className="qr skeleton" style={{ width: 224, height: 224 }} />;
}

/** Glass connect dialog: every wallet the browser announces (EIP-6963), WalletConnect, Coinbase. */
export function ConnectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const connect = useConnect();
  const connectors = useConnectors();
  const [view, setView] = useState<View>({ name: "list" });
  const [copied, setCopied] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const attempt = useRef(0);

  const hasLegacy = typeof window !== "undefined" && !!(window as { ethereum?: unknown }).ethereum;
  const mobile = isMobileBrowser();
  let options = walletOptions(connectors, { hasLegacyProvider: hasLegacy });
  const hasInjected = options.some((o) => o.kind === "injected" || o.kind === "fallback");
  // On a phone with no wallet in the browser, WalletConnect goes first.
  if (mobile && !hasInjected) options = [...options].sort((a, b) => Number(b.kind === "walletconnect") - Number(a.kind === "walletconnect"));
  const recent = recentConnectorId();

  const reset = useCallback(() => {
    attempt.current++;
    connect.reset();
    setView({ name: "list" });
  }, [connect]);

  const close = useCallback(() => { reset(); onClose(); }, [reset, onClose]);

  // focus, Esc, Tab trap, scroll lock
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const root = dialogRef.current!;
    const focusables = () => [...root.querySelectorAll<HTMLElement>("button, a[href]")].filter((e) => !e.hasAttribute("disabled"));
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "Tab") {
        const f = focusables();
        if (f.length === 0) return;
        const first = f[0]!, last = f[f.length - 1]!;
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [open, close]);

  async function pick(option: WalletOption) {
    const mine = ++attempt.current;
    setView({ name: "connecting", option });
    let detach: (() => void) | undefined;
    try {
      if (option.kind === "walletconnect") {
        const provider = (await option.connector.getProvider()) as { on: (e: string, f: (u: string) => void) => void; removeListener: (e: string, f: (u: string) => void) => void };
        const onUri = (uri: string) => attempt.current === mine && setView({ name: "connecting", option, uri });
        provider.on("display_uri", onUri);
        detach = () => provider.removeListener("display_uri", onUri);
      }
      await withTimeout(connect.mutateAsync({ connector: option.connector, chainId: chain.id }), option.kind === "walletconnect" ? 120_000 : 60_000);
      if (attempt.current === mine) { reset(); onClose(); }
    } catch (e) {
      if (attempt.current === mine) setView({ name: "error", option, failure: classifyConnectError(e, option.name) });
    } finally {
      detach?.();
    }
  }

  if (!open) return null;

  const uri = view.name === "connecting" ? view.uri : undefined;
  const title = view.name === "list" ? "Connect a wallet" : view.option.name;

  return createPortal(
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal glass" role="dialog" aria-modal="true" aria-labelledby="connect-title" ref={dialogRef}>
        <div className="modal-head">
          <h2 id="connect-title">{title}</h2>
          <button className="icon-btn" onClick={close} aria-label="Close"><XClose width={20} height={20} aria-hidden /></button>
        </div>

        {view.name === "list" && (
          <>
            <p className="modal-sub">Choose the wallet you used to create your reins, or a new one. Rienda never holds your keys.</p>
            {mobile && !hasInjected && (
              <a className="wallet-row" href={metamaskDeepLink(window.location)}>
                <span className="wallet-noicon" aria-hidden>M</span>
                <span className="wallet-name">Open in MetaMask app<small>Reopens this page inside the wallet</small></span>
              </a>
            )}
            <ul className="wallet-list">
              {options.map((o) => (
                <li key={o.connector.uid}>
                  <button className="wallet-row" onClick={() => pick(o)}>
                    <WalletIcon o={o} />
                    <span className="wallet-name">
                      {o.name}
                      {o.kind === "walletconnect" && <small>{mobile ? "Opens your wallet app" : "Scan a QR code with your phone"}</small>}
                    </span>
                    {recent === o.connector.id && <span className="pill grey">Last used</span>}
                  </button>
                </li>
              ))}
            </ul>
            {options.length === 0 && (
              <p className="modal-empty">
                No wallet found in this browser. Install <a href="https://metamask.io/download" target="_blank" rel="noreferrer">MetaMask</a> or <a href="https://rabby.io" target="_blank" rel="noreferrer">Rabby</a>, then reload this page.
              </p>
            )}
          </>
        )}

        {view.name === "connecting" && (
          <div className="modal-body" aria-live="polite">
            {view.option.kind === "walletconnect" ? (
              uri ? (
                <>
                  {!mobile && <Qr uri={uri} />}
                  <p className="modal-sub">{mobile ? "Open your wallet app to approve the connection." : "Scan this with your wallet app, then approve the connection."}</p>
                  <div className="modal-actions">
                    {mobile && <a className="btn" href={uri}>Open wallet app</a>}
                    <button className="btn ghost small" onClick={async () => { try { await navigator.clipboard.writeText(uri); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* clipboard blocked */ } }}>
                      <Copy01 width={16} height={16} aria-hidden /> {copied ? "Copied" : "Copy link"}
                    </button>
                  </div>
                </>
              ) : (
                <p className="modal-sub"><Loading02 className="spin" width={16} height={16} aria-hidden /> Preparing a connection…</p>
              )
            ) : (
              <>
                <WalletIcon o={view.option} />
                <p className="modal-sub"><Loading02 className="spin" width={16} height={16} aria-hidden /> Check {view.option.name} to approve the connection.</p>
              </>
            )}
            <button className="btn ghost small" onClick={reset}>Back to wallets</button>
          </div>
        )}

        {view.name === "error" && (
          <div className="modal-body" role="alert">
            <div className="banner banner-red" style={{ margin: 0, width: "100%" }}>
              <AlertTriangle width={18} height={18} aria-hidden />
              <span>
                <strong>{view.failure.kind === "rejected" ? "Request rejected" : view.failure.kind === "timeout" ? "Timed out" : view.failure.kind === "not-installed" ? "Wallet not found" : "Couldn't connect"}</strong>
                <br />{view.failure.message}
              </span>
            </div>
            <div className="modal-actions">
              {view.failure.kind !== "not-installed" && <button className="btn" onClick={() => pick(view.option)}>Try again</button>}
              <button className="btn ghost" onClick={reset}>Choose another wallet</button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** The header / empty-state button. Owns the modal. */
export function ConnectButton({ label = "Connect wallet", className = "btn" }: { label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={className} onClick={() => setOpen(true)} aria-haspopup="dialog">{label}</button>
      <ConnectModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
