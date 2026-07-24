#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import process from "node:process";
import {
  createPublicClient,
  encodeAbiParameters,
  getAddress,
  http,
  keccak256,
  parseAbi,
} from "viem";

const manifestPath = process.argv.find((arg) => arg.endsWith(".json")) ??
  "deployments/46630-uniswap-v4-shared.json";
const allowPending = process.argv.includes("--allow-pending");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const rpcUrl = process.env.ROBYN_TESTNET_RPC_URL ??
  "https://rpc.testnet.chain.robinhood.com";
const mainnetRpcUrl = process.env.ROBYN_MAINNET_RPC_URL ??
  "https://rpc.mainnet.chain.robinhood.com";
const client = createPublicClient({ transport: http(rpcUrl) });
const mainnetClient = createPublicClient({ transport: http(mainnetRpcUrl) });
const failures = [];
const checks = [];

function check(condition, label, details = {}) {
  checks.push({ label, ok: Boolean(condition), ...details });
  if (!condition) failures.push(label);
}

const hashContracts = [
  "poolManager",
  "positionManager",
  "quoter",
  "universalRouter",
  "permit2",
];
check(await client.getChainId() === 46630, "RPC chain ID is 46630");
check(manifest.chainId === 46630, "manifest chain ID is 46630");
check(
  manifest.venue === "shared-unlisted-robinhood-testnet-uniswap-v4-mirror",
  "venue disclosure label is exact",
);
check(
  manifest.pinnedPackages?.v4Core?.version === "1.0.2",
  "v4-core package version is pinned",
);
check(
  manifest.pinnedPackages?.v4Periphery?.version === "1.0.3",
  "v4-periphery package version is pinned",
);
check(
  manifest.pinnedPackages?.v4Periphery?.integrity ===
    "sha512-JxLL0Djv9XcMvI2PatEnWrCrxuEaYNVhHxstndBOP+aJfh1XLg5ec8SDZ0xyoVfg2ElJTvuKpBgnu90bNValsg==",
  "v4-periphery package integrity is frozen",
);

for (const name of hashContracts) {
  const entry = manifest.contracts[name];
  const code = await client.getCode({ address: getAddress(entry.address) });
  check(code && code !== "0x", `${name} has runtime code`);
  check(keccak256(code) === entry.runtimeCodeHash, `${name} runtime hash matches`);
  const mainnetCode = await mainnetClient.getCode({ address: getAddress(entry.address) });
  check(
    mainnetCode && keccak256(mainnetCode) === entry.robinhoodMainnetRuntimeCodeHash,
    `${name} frozen Robinhood-mainnet comparison hash matches`,
  );
  const receipt = await client.getTransactionReceipt({ hash: entry.creationTransaction });
  check(
    Number(receipt.blockNumber) === entry.deploymentBlock,
    `${name} deployment block matches`,
  );
}

const positionAbi = parseAbi([
  "function poolManager() view returns (address)",
  "function permit2() view returns (address)",
  "function tokenDescriptor() view returns (address)",
  "function WETH9() view returns (address)",
]);
for (const [field, functionName] of [
  ["poolManager", "poolManager"],
  ["permit2", "permit2"],
  ["tokenDescriptor", "tokenDescriptor"],
  ["weth9", "WETH9"],
]) {
  const value = await client.readContract({
    address: getAddress(manifest.contracts.positionManager.address),
    abi: positionAbi,
    functionName,
  });
  check(
    value.toLowerCase() === manifest.contracts.positionManager[field].toLowerCase(),
    `PositionManager ${field} wiring matches`,
  );
}

for (const [label, component] of Object.entries({
  "PositionManager descriptor has no code":
    manifest.missingOrBrokenOptionalComponents.positionDescriptor,
  "PositionManager WETH9 has no code":
    manifest.missingOrBrokenOptionalComponents.positionManagerWeth9,
})) {
  const code = await client.getCode({ address: getAddress(component.address) });
  check(code === undefined || code === "0x", label);
}

const erc20Abi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
]);
const quoterAbi = [{
  type: "function",
  name: "quoteExactInputSingle",
  stateMutability: "nonpayable",
  inputs: [{
    name: "params",
    type: "tuple",
    components: [
      {
        name: "poolKey",
        type: "tuple",
        components: [
          { name: "currency0", type: "address" },
          { name: "currency1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "hooks", type: "address" },
        ],
      },
      { name: "zeroForOne", type: "bool" },
      { name: "exactAmount", type: "uint128" },
      { name: "hookData", type: "bytes" },
    ],
  }],
  outputs: [
    { name: "amountOut", type: "uint256" },
    { name: "gasEstimate", type: "uint256" },
  ],
}];
let faucetRuntimeHash;
for (const route of manifest.faucetStockRoutes) {
  const address = getAddress(route.address);
  const [name, symbol, decimals, supply, code] = await Promise.all([
    client.readContract({ address, abi: erc20Abi, functionName: "name" }),
    client.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
    client.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
    client.readContract({ address, abi: erc20Abi, functionName: "totalSupply" }),
    client.getCode({ address }),
  ]);
  check(name.length > 0, `${route.symbol} onchain name is nonempty`);
  check(symbol === route.symbol, `${route.symbol} onchain symbol matches`);
  check(decimals === 18, `${route.symbol} decimals are 18`);
  check(supply > 0n, `${route.symbol} supply is nonzero`);
  const codeHash = keccak256(code);
  faucetRuntimeHash ??= codeHash;
  check(codeHash === faucetRuntimeHash, `${route.symbol} shares faucet Stock runtime`);

  const poolKey = {
    currency0: "0x0000000000000000000000000000000000000000",
    currency1: address,
    fee: route.fee,
    tickSpacing: route.tickSpacing,
    hooks: getAddress(route.hook),
  };
  const calculatedPoolId = keccak256(encodeAbiParameters(
    [
      { type: "address" },
      { type: "address" },
      { type: "uint24" },
      { type: "int24" },
      { type: "address" },
    ],
    [
      poolKey.currency0,
      poolKey.currency1,
      poolKey.fee,
      poolKey.tickSpacing,
      poolKey.hooks,
    ],
  ));
  check(calculatedPoolId === route.poolId, `${route.symbol} pool ID matches exact key`);
  for (const zeroForOne of [true, false]) {
    const quote = await client.simulateContract({
      address: getAddress(manifest.contracts.quoter.address),
      abi: quoterAbi,
      functionName: "quoteExactInputSingle",
      args: [{
        poolKey,
        zeroForOne,
        exactAmount: 1_000_000_000_000n,
        hookData: "0x",
      }],
    });
    check(
      quote.result[0] > 0n,
      `${route.symbol} ${zeroForOne ? "native-to-stock" : "stock-to-native"} quote succeeds`,
      { output: quote.result[0].toString() },
    );
  }
}
check(
  faucetRuntimeHash ===
    "0x2f367e6a678e7b30ab613d5963e541e6f4d3ca586de76e2f441fbfeb1a27c440",
  "faucet Stock runtime hash matches frozen value",
);

const registry = await fetch(
  "https://api.github.com/repos/Uniswap/contracts/contents/deployments",
  { headers: { accept: "application/vnd.github+json", "user-agent": "robyn-verifier" } },
);
check(registry.ok, "official Uniswap registry is reachable");
if (registry.ok) {
  const entries = await registry.json();
  check(
    !entries.some((entry) => String(entry.name).includes("46630")),
    "official Uniswap registry remains unlisted for 46630",
  );
}

const stateView = manifest.contracts.stateView;
if (stateView.address) {
  const code = await client.getCode({ address: getAddress(stateView.address) });
  check(code && keccak256(code) === stateView.runtimeCodeHash, "Robyn StateView hash matches");
} else {
  check(allowPending, "Robyn StateView is deployed");
}
check(
  allowPending ||
    manifest.verification.faucetStockBidirectionalSwaps === "passed",
  "bounded live bidirectional faucet-stock swaps passed",
);
check(
  allowPending || manifest.verification.releaseReady === true,
  "venue manifest is release-ready",
);

console.log(JSON.stringify({
  manifest: manifestPath,
  checkedAt: new Date().toISOString(),
  allowPending,
  checks,
  failures,
}, null, 2));
if (failures.length) process.exit(1);
