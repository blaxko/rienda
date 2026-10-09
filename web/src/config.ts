import { createPublicClient } from "viem";
import { createConfig } from "wagmi";
import { injected } from "wagmi/connectors";
import { addresses, chainFor, createRienda, explorerUrl, transportFor, type Network } from "@rienda/sdk";

const env = import.meta.env;

export const NETWORK: Network = env.VITE_NETWORK === "mainnet" ? "mainnet" : "testnet";
export const chain = chainFor(NETWORK);
export const deployment = addresses[NETWORK];
export const RIENDA = deployment.rienda;
export const USDC = deployment.usdc;

const transport = transportFor(NETWORK, {
  RPC_URL_TESTNET: env.VITE_RPC_URL_TESTNET,
  RPC_URL_MAINNET: env.VITE_RPC_URL_MAINNET,
});

export const wagmiConfig = createConfig({
  chains: [chain],
  // EIP-6963: every installed wallet (MetaMask, Rabby, …) announces itself and becomes its own connector.
  // The generic injected() connector stays only as a fallback for wallets that don't announce.
  multiInjectedProviderDiscovery: true,
  connectors: [injected()],
  transports: { [chain.id]: transport },
});

/** Read-only client, independent of the wallet (works before connecting and on the wrong network). */
export const publicClient = createPublicClient({ chain, transport });

export const rienda = RIENDA ? createRienda({ address: RIENDA, publicClient }) : null;

export const txUrl = (hash: string) => explorerUrl(NETWORK, "tx", hash);
export const addressUrl = (addr: string) => explorerUrl(NETWORK, "address", addr);
