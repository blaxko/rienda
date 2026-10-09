import { useState } from "react";
import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError, type Hash, type TransactionReceipt } from "viem";
import { useWriteContract } from "wagmi";
import { publicClient } from "../config";

export type TxState =
  | { phase: "idle" }
  | { phase: "wallet"; label: string }
  | { phase: "pending"; label: string; hash: Hash }
  | { phase: "done"; label: string; hash: Hash }
  | { phase: "error"; label: string; message: string; hash?: Hash };

export function errorText(err: unknown): string {
  if (err instanceof BaseError) {
    if (err.walk((e) => e instanceof UserRejectedRequestError)) return "Rejected in your wallet.";
    const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      return `Contract rejected it: ${reverted.data?.errorName ?? reverted.reason ?? "reverted"}`;
    }
    return err.shortMessage;
  }
  return err instanceof Error ? err.message : String(err);
}

type WriteParams = Parameters<ReturnType<typeof useWriteContract>["mutateAsync"]>[0];

/**
 * One transaction at a time: simulate (to surface named contract errors before the wallet opens),
 * ask the wallet, wait for the receipt. `state` drives the progress UI.
 */
export function useTx() {
  const { mutateAsync } = useWriteContract();
  const [state, setState] = useState<TxState>({ phase: "idle" });

  async function run(label: string, params: WriteParams, account: `0x${string}`): Promise<TransactionReceipt> {
    let hash: Hash | undefined;
    try {
      setState({ phase: "wallet", label });
      await publicClient.simulateContract({ ...(params as any), account });
      hash = await mutateAsync(params);
      setState({ phase: "pending", label, hash });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Transaction reverted onchain");
      setState({ phase: "done", label, hash });
      return receipt;
    } catch (err) {
      setState({ phase: "error", label, message: errorText(err), hash });
      throw err;
    }
  }

  return { state, run, reset: () => setState({ phase: "idle" }), busy: state.phase === "wallet" || state.phase === "pending" };
}
