import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle, Loading02, XCircle, XClose } from "@untitledui/icons";
import type { TxState } from "../lib/tx";
import { explain } from "../lib/errors";
import { txUrl } from "../config";

/** Glass toast for every transaction phase: wallet prompt, pending, confirmed (auto-hides), failed (stays until closed). */
export function TxStatus({ state }: { state: TxState }) {
  const [dismissed, setDismissed] = useState<string>("");
  const key = state.phase === "idle" ? "" : `${state.phase}:${"hash" in state ? state.hash ?? "" : ""}:${state.label}`;
  useEffect(() => {
    if (state.phase !== "done") return;
    const t = setTimeout(() => setDismissed(key), 7000);
    return () => clearTimeout(t);
  }, [key, state.phase]);
  if (state.phase === "idle" || dismissed === key) return null;

  const link = "hash" in state && state.hash ? (
    <>
      {" "}
      <a href={txUrl(state.hash)} target="_blank" rel="noreferrer">View transaction →</a>
    </>
  ) : null;

  let tone = "wait", icon = <Loading02 className="spin" width={18} height={18} aria-hidden />, body: React.ReactNode;
  if (state.phase === "wallet") body = <>{state.label}: confirm in your wallet.</>;
  else if (state.phase === "pending") body = <>{state.label}: waiting for confirmation.{link}</>;
  else if (state.phase === "done") { tone = "ok"; icon = <CheckCircle width={18} height={18} aria-hidden />; body = <>{state.label}: confirmed.{link}</>; }
  else {
    tone = "err"; icon = <XCircle width={18} height={18} aria-hidden />;
    const ex = explain(state.message);
    body = <><span className="err-text">{ex.kind === "rejected" ? ex.hint : `${state.label} didn't go through. ${ex.hint}`}</span>{link}{ex.detail && <details className="err-details"><summary>Details</summary><pre>{ex.detail}</pre></details>}</>;
  }

  return createPortal(
    <div className={`toast glass tone-${tone}`} role={state.phase === "error" ? "alert" : "status"}>
      {icon}
      <span>{body}</span>
      {(state.phase === "done" || state.phase === "error") && (
        <button className="icon-btn" aria-label="Dismiss" onClick={() => setDismissed(key)}><XClose width={16} height={16} aria-hidden /></button>
      )}
    </div>,
    document.body,
  );
}
