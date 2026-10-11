import { createPortal } from "react-dom";
import { AlertTriangle, XClose } from "@untitledui/icons";
import { RiendaMark } from "./Logo";
import { dismissWalletTrouble, retryPairing, useWalletTrouble } from "../lib/walletWatch";
import { isMobileBrowser, metamaskDeepLink } from "../lib/wallet";

/** Shown over the wallet modal when pairing doesn't start: plain words, a retry, and a way around it. */
export function WalletTrouble() {
  const trouble = useWalletTrouble();
  if (!trouble) return null;
  return createPortal(
    <div className="trouble-scrim" onMouseDown={(e) => e.target === e.currentTarget && dismissWalletTrouble()}>
      <div className="trouble-card glass" role="alertdialog" aria-modal="true" aria-labelledby="trouble-title">
        <div className="modal-head">
          <span className="modal-brand"><RiendaMark size={28} />Rienda</span>
          <button className="icon-btn" onClick={dismissWalletTrouble} aria-label="Close"><XClose width={20} height={20} aria-hidden /></button>
        </div>
        <h2 id="trouble-title" className="modal-title"><AlertTriangle width={20} height={20} aria-hidden style={{ verticalAlign: "-3px", marginRight: 8, color: "var(--red)" }} />Couldn’t reach your wallet app</h2>
        <p className="modal-sub" style={{ display: "block" }}>
          Try again, switch network (Wi-Fi to mobile data, or the other way round), or open Rienda inside your wallet’s browser.
        </p>
        <div className="modal-actions" style={{ justifyContent: "stretch", flexDirection: "column" }}>
          <button className="btn large" onClick={() => void retryPairing()}>Try again</button>
          <a className="btn ghost large" href={metamaskDeepLink(window.location)}>Open in MetaMask</a>
        </div>
        {!isMobileBrowser() && <p className="card-note" style={{ marginTop: 14 }}>On a computer, scan the QR code with your phone, or use a wallet extension.</p>}
      </div>
    </div>,
    document.body,
  );
}
