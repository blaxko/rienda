import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useConnect, useConnectors } from "wagmi";
import { useAppKit } from "@reown/appkit/react";
import { AlertTriangle, Loading02, XClose } from "@untitledui/icons";
import { USE_APPKIT, chain } from "../config";
import { RiendaMark } from "./Logo";
import { redact } from "../lib/errors";
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

/** Small last-resort link for phones: reopen this page inside a wallet's own browser (it reloads the whole site there). */
export function TroubleLink() {
  if (!isMobileBrowser()) return null;
  return <a className="trouble" href={metamaskDeepLink(window.location)}>Having trouble? Open in your wallet’s browser</a>;
}

// ───────────── fallback modal (no WalletConnect project id): installed wallets and Coinbase only ─────────────

type View =
  | { name: "list" }
  | { name: "connecting"; option: WalletOption }
  | { name: "error"; option: WalletOption; failure: ConnectFailure };

function FallbackModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const connect = useConnect();
  const connectors = useConnectors();
  const [view, setView] = useState<View>({ name: "list" });
  const dialogRef = useRef<HTMLDivElement>(null);
  const attempt = useRef(0);

  const hasLegacy = typeof window !== "undefined" && !!(window as { ethereum?: unknown }).ethereum;
  const options = walletOptions(connectors, { hasLegacyProvider: hasLegacy }).filter((o) => o.kind !== "walletconnect");
  const recent = recentConnectorId();

  const reset = useCallback(() => { attempt.current++; connect.reset(); setView({ name: "list" }); }, [connect]);
  const close = useCallback(() => { reset(); onClose(); }, [reset, onClose]);

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
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = overflow; prev?.focus?.(); };
  }, [open, close]);

  async function pick(option: WalletOption) {
    const mine = ++attempt.current;
    setView({ name: "connecting", option });
    try {
      await withTimeout(connect.mutateAsync({ connector: option.connector, chainId: chain.id }), 60_000);
      if (attempt.current === mine) { reset(); onClose(); }
    } catch (e) {
      if (attempt.current === mine) setView({ name: "error", option, failure: classifyConnectError(e, option.name) });
    }
  }

  if (!open) return null;
  const title = view.name === "list" ? "Connect a wallet" : view.option.name;

  return createPortal(
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal glass" role="dialog" aria-modal="true" aria-labelledby="connect-title" ref={dialogRef}>
        <div className="modal-head">
          <span className="modal-brand"><RiendaMark size={32} />Rienda</span>
          <button className="icon-btn" onClick={close} aria-label="Close"><XClose width={20} height={20} aria-hidden /></button>
        </div>
        <h2 id="connect-title" className="modal-title">{title}</h2>

        {view.name === "list" && (
          <>
            <p className="modal-sub">Choose a wallet. Rienda never holds your keys.</p>
            <ul className="wallet-list">
              {options.map((o) => (
                <li key={o.connector.uid}>
                  <button className="wallet-row" onClick={() => pick(o)}>
                    {o.icon && <img src={o.icon} alt="" width={32} height={32} />}
                    <span className="wallet-name">{o.name}</span>
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
            <TroubleLink />
          </>
        )}

        {view.name === "connecting" && (
          <div className="modal-body" aria-live="polite">
            {view.option.icon && <img src={view.option.icon} alt="" width={32} height={32} />}
            <p className="modal-sub"><Loading02 className="spin" width={16} height={16} aria-hidden /> Check {view.option.name} to approve the connection.</p>
            <button className="btn ghost small" onClick={reset}>Back to wallets</button>
          </div>
        )}

        {view.name === "error" && (
          <div className="modal-body" role="alert">
            <div className="banner banner-red" style={{ margin: 0, width: "100%" }}>
              <AlertTriangle width={18} height={18} aria-hidden />
              <span>
                <strong>{view.failure.kind === "rejected" ? "Request rejected" : view.failure.kind === "timeout" ? "Timed out" : view.failure.kind === "not-installed" ? "Wallet not found" : "Couldn't connect"}</strong>
                <br />{view.failure.kind === "other" ? "Try again, or pick another wallet." : view.failure.message}
                {view.failure.kind === "other" && <details className="err-details"><summary>Details</summary><pre>{redact(view.failure.message)}</pre></details>}
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

function FallbackButton({ label, className }: { label: string; className: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={className} onClick={() => setOpen(true)} aria-haspopup="dialog">{label}</button>
      <FallbackModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function AppKitButton({ label, className }: { label: string; className: string }) {
  const { open } = useAppKit();
  const connect = useConnect();
  const connectors = useConnectors();
  // Inside a wallet's own browser (MetaMask, Trust, Coinbase, ...) the wallet is already there: connect in one tap
  // instead of making the user pick it from a list.
  const inWalletBrowser = typeof window !== "undefined" && isMobileBrowser() && !!(window as { ethereum?: unknown }).ethereum;
  const injectedConnector = inWalletBrowser ? (connectors.find((c) => c.type === "injected" && c.id !== "injected") ?? connectors.find((c) => c.id === "injected")) : undefined;
  const name = injectedConnector && injectedConnector.id !== "injected" ? injectedConnector.name : "wallet";

  async function onClick() {
    if (injectedConnector) {
      try {
        await connect.mutateAsync({ connector: injectedConnector, chainId: chain.id });
        return;
      } catch (e) {
        if (classifyConnectError(e).kind === "rejected") return; // the user said no: don't pop another dialog
      }
    }
    void open({ view: "Connect" });
  }
  return <button className={className} onClick={onClick} aria-haspopup="dialog" disabled={connect.isPending}>{connect.isPending ? "Connecting…" : injectedConnector ? `Connect ${name}` : label}</button>;
}

/** The header / empty-state button. Opens the Reown AppKit modal, or the small fallback modal without a project id. */
export function ConnectButton({ label = "Connect wallet", className = "btn" }: { label?: string; className?: string }) {
  return USE_APPKIT ? <AppKitButton label={label} className={className} /> : <FallbackButton label={label} className={className} />;
}
