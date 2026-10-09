import type { TxState } from "../lib/tx";
import { txUrl } from "../config";

export function TxStatus({ state }: { state: TxState }) {
  if (state.phase === "idle") return null;
  const link = "hash" in state && state.hash ? (
    <>
      {" "}
      <a href={txUrl(state.hash)} target="_blank" rel="noreferrer">view tx</a>
    </>
  ) : null;
  if (state.phase === "wallet") return <p className="tx tx-wait">{state.label}: confirm in your wallet…</p>;
  if (state.phase === "pending") return <p className="tx tx-wait">{state.label}: waiting for confirmation…{link}</p>;
  if (state.phase === "done") return <p className="tx tx-ok">{state.label}: confirmed.{link}</p>;
  return <p className="tx tx-err">{state.label} failed: {state.message}{link}</p>;
}
