import { useQuery } from "@tanstack/react-query";
import { useConnection } from "wagmi";
import { EXPECTED_USDC_DECIMALS, getUsdcDecimals } from "@rienda/sdk";
import { USDC, chain, publicClient } from "./config";

export function useWallet() {
  const c = useConnection();
  const isConnected = c.status === "connected" && !!c.address;
  const onRightChain = isConnected && c.chainId === chain.id;
  return {
    address: c.address,
    isConnected,
    onRightChain,
    /** Actions (any transaction) are only allowed when connected on the right network. */
    canAct: isConnected && onRightChain,
  };
}

/** USDC decimals read from chain once (expect 6); falls back to 6 while loading. */
export function useDecimals(): number {
  const q = useQuery({
    queryKey: ["usdc-decimals", chain.id],
    queryFn: () => getUsdcDecimals(publicClient, USDC),
    staleTime: Infinity,
  });
  return q.data ?? EXPECTED_USDC_DECIMALS;
}
