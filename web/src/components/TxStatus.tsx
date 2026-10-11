import { CheckCircle, Loading02, XCircle } from "@untitledui/icons";
import type { TxState } from "../lib/tx";
import { txUrl } from "../config";

/** Every transaction phase is visible: waiting for the wallet, pending onchain, confirmed, failed. */
export function TxStatus({ state }: { state: TxState }) {
  if (state.phase === "idle") return null;
  const link = "hash" in state && state.hash ? (
    <>
      {" "}
      <a href={txUrl(state.hash)} target="_blank" rel="noreferrer">View transaction →</a>
    </>
  ) : null;
  if (state.phase === "wallet")
    return <p className="tx tx-wait" role="status"><Loading02 className="spin" width={16} height={16} aria-hidden /><span>{state.label}: confirm in your wallet.</span></p>;
  if (state.phase === "pending")
    return <p className="tx tx-wait" role="status"><Loading02 className="spin" width={16} height={16} aria-hidden /><span>{state.label}: waiting for confirmation.{link}</span></p>;
  if (state.phase === "done")
    return <p className="tx tx-ok" role="status"><CheckCircle width={16} height={16} aria-hidden /><span>{state.label}: confirmed.{link}</span></p>;
  return <p className="tx tx-err" role="alert"><XCircle width={16} height={16} aria-hidden /><span>{state.label} failed: {state.message}{link}</span></p>;
}
