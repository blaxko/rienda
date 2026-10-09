export type RiendaDeployment = {
  rienda: `0x${string}` | null;
  usdc: `0x${string}`;
  deployBlock: bigint | null;
};

export const addresses = {
  testnet: {
    rienda: "0x70c3Bd491D1d39C29ee3D22434A5b7Ec78caaECb",
    usdc: "0x534b2f3A21130d7a60830c2Df862319e593943A3",
    deployBlock: 69462264n,
  },
  mainnet: {
    rienda: null,
    usdc: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
    deployBlock: null,
  },
} as const satisfies Record<"testnet" | "mainnet", RiendaDeployment>;
