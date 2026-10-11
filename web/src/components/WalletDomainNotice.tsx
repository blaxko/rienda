import { useEffect, useState } from "react";
import { AlertTriangle, XClose } from "@untitledui/icons";

const BLOCKED = /origin not allowed|code: ?3000/i;

/**
 * WalletConnect's relay refuses sites that are not on the project's allowed-domains list ("Unauthorized: origin not
 * allowed", code 3000). The wallet modal then just keeps spinning, so say what is wrong instead.
 */
export function WalletDomainNotice() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const on = (msg: unknown) => { if (BLOCKED.test(String(msg))) setShow(true); };
    const onError = (e: ErrorEvent) => on(e.message);
    const onRejection = (e: PromiseRejectionEvent) => on((e.reason as Error)?.message ?? e.reason);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => { window.removeEventListener("error", onError); window.removeEventListener("unhandledrejection", onRejection); };
  }, []);
  if (!show) return null;
  return (
    <div className="toast glass tone-err" role="alert">
      <AlertTriangle width={18} height={18} aria-hidden />
      <span>Wallet connection is blocked for this web address ({window.location.host}). Whoever runs the site needs to add it to the allowed domains in the Reown dashboard.</span>
      <button className="icon-btn" aria-label="Dismiss" onClick={() => setShow(false)}><XClose width={16} height={16} aria-hidden /></button>
    </div>
  );
}
