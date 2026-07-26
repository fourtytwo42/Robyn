export type PublicNetworkMode = "devnet" | "testnet" | "mainnet";

type PublicEnvironmentInput = {
  mode?: string;
  rpcUrl?: string;
  explorerUrl?: string;
  appUrl?: string;
};

export type PublicEnvironment = {
  mode: PublicNetworkMode;
  isDevnet: boolean;
  isTestnet: boolean;
  isMainnet: boolean;
  isPublicChain: boolean;
  chainId: number;
  chainName: string;
  networkLabel: string;
  rpcUrl: string;
  explorerUrl: string;
  appUrl: string;
  faucetUrl?: string;
};

const DEFAULTS = {
  devnet: {
    chainId: 31337,
    chainName: "Sherwood Controlled Network",
    networkLabel: "Controlled network",
    rpcUrl: "/rpc",
    explorerUrl: "",
    appUrl: "http://127.0.0.1:3000",
  },
  testnet: {
    chainId: 46630,
    chainName: "Robinhood Chain Testnet",
    networkLabel: "Robinhood Testnet",
    rpcUrl: "https://rpc.testnet.chain.robinhood.com",
    explorerUrl: "https://explorer.testnet.chain.robinhood.com",
    appUrl: "https://testnet.sherwoodforest.trade",
    faucetUrl: "https://faucet.testnet.chain.robinhood.com",
  },
  mainnet: {
    chainId: 4663,
    chainName: "Robinhood Chain",
    networkLabel: "Robinhood Chain",
    rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
    explorerUrl: "https://robinhoodchain.blockscout.com",
    appUrl: "https://sherwoodforest.trade",
  },
} as const;

export function resolvePublicEnvironment(
  input: PublicEnvironmentInput,
): PublicEnvironment {
  const mode = input.mode ?? "devnet";
  if (mode !== "devnet" && mode !== "testnet" && mode !== "mainnet") {
    throw new Error(`Unsupported public network mode: ${mode}`);
  }
  const defaults = DEFAULTS[mode];
  return {
    mode,
    isDevnet: mode === "devnet",
    isTestnet: mode === "testnet",
    isMainnet: mode === "mainnet",
    isPublicChain: mode !== "devnet",
    chainId: defaults.chainId,
    chainName: defaults.chainName,
    networkLabel: defaults.networkLabel,
    rpcUrl: input.rpcUrl || defaults.rpcUrl,
    explorerUrl: input.explorerUrl || defaults.explorerUrl,
    appUrl: input.appUrl || defaults.appUrl,
    ...("faucetUrl" in defaults ? { faucetUrl: defaults.faucetUrl } : {}),
  };
}

export const publicEnvironment = resolvePublicEnvironment({
  mode: process.env.NEXT_PUBLIC_ROBYN_NETWORK_MODE,
  rpcUrl: process.env.NEXT_PUBLIC_ROBYN_RPC_URL,
  explorerUrl: process.env.NEXT_PUBLIC_ROBYN_EXPLORER_URL,
  appUrl: process.env.NEXT_PUBLIC_APP_URL,
});
