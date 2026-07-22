#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rpc_url="${ROBYN_OPERATOR_RPC_URL:-http://127.0.0.1:8545}"
manifest="${ROBYN_DEVNET_MANIFEST:-$repo_root/deployments/31337.json}"
force="${ROBYN_FORCE_DEPLOY:-false}"

export PATH="$HOME/.foundry/bin:$PATH"
cd "$repo_root"

chain_id="$(cast chain-id --rpc-url "$rpc_url")"
if [[ "$chain_id" != "31337" ]]; then
  echo "Refusing devnet deployment on chain $chain_id" >&2
  exit 1
fi

if [[ -f "$manifest" && "$force" != "true" ]]; then
  existing_factory="$(jq -r '.contracts.factory // empty' "$manifest")"
  if [[ -n "$existing_factory" && "$(cast code "$existing_factory" --rpc-url "$rpc_url")" != "0x" ]]; then
    echo "Existing live deployment: $manifest"
    "$repo_root/scripts/verify-devnet-deployment.sh" "$manifest"
    exit 0
  fi
fi

deployer="$(cast rpc eth_accounts --rpc-url "$rpc_url" | jq -r '.[0]')"
if [[ -z "$deployer" || "$deployer" == "null" ]]; then
  echo "No unlocked operator account is available on loopback RPC" >&2
  exit 1
fi

forge build --root packages/contracts >/dev/null

deploy_contract() {
  local contract="$1"
  shift
  forge create "$contract" --root packages/contracts --rpc-url "$rpc_url" --from "$deployer" --unlocked --broadcast --json --constructor-args "$@" |
    jq -er '.deployedTo'
}

send_transaction() {
  cast send --rpc-url "$rpc_url" --from "$deployer" --unlocked --json "$@" |
    jq -e '.status == "0x1" or .status == 1' >/dev/null
}

base="$(deploy_contract src/devnet/DevnetMockERC20.sol:DevnetMockERC20 "Mock USD" "mUSD" "$deployer" "10000000000000000000000")"
nvda="$(deploy_contract src/devnet/DevnetMockERC20.sol:DevnetMockERC20 "Mock NVIDIA" "mNVDA" "$deployer" "0")"
spy="$(deploy_contract src/devnet/DevnetMockERC20.sol:DevnetMockERC20 "Mock S&P 500" "mSPY" "$deployer" "0")"
eth_reward="$(deploy_contract src/devnet/DevnetMockERC20.sol:DevnetMockERC20 "Mock Ether" "mETH" "$deployer" "0")"
router="$(deploy_contract src/devnet/DevnetConversionRouter.sol:DevnetConversionRouter "$deployer")"
factory="$(deploy_contract src/RobynLaunchFactory.sol:RobynLaunchFactory "$base" "$router" "1000000000000000000" "86400")"
curve_token_allocation="800000000000000000000000000"
graduation_token_allocation="200000000000000000000000000"
initial_virtual_token_reserve="1066666666666666666666666666"
initial_virtual_base_reserve="2166666666666666666667"
graduation_threshold_base="6500000000000000000000"
market_factory="$(deploy_contract src/devnet/DevnetMarketFactory.sol:DevnetMarketFactory "$base" "$factory" "$curve_token_allocation" "$graduation_token_allocation" "$initial_virtual_token_reserve" "$initial_virtual_base_reserve" "$graduation_threshold_base" "100")"

reward_liquidity="10000000000000000000000000"
base_liquidity="10000000000000000000000000"
initial_supply="1000000000000000000000000000"
market_token_seed="$initial_supply"

send_transaction "$base" "mint(address,uint256)" "$deployer" "$base_liquidity"
for reward in "$nvda" "$spy" "$eth_reward"; do
  send_transaction "$reward" "mint(address,uint256)" "$router" "$reward_liquidity"
done

send_transaction "$router" "setRate(address,address,uint256)" "$base" "$nvda" "1000000000000000000"
send_transaction "$router" "setRate(address,address,uint256)" "$base" "$spy" "2000000000000000000"
send_transaction "$router" "setRate(address,address,uint256)" "$base" "$eth_reward" "3000000000000000000"

send_transaction "$factory" "createLaunch(string,string,uint256,address[],uint16[])" "Robyn Genesis" "ROBYN" "$initial_supply" "[$nvda,$spy,$eth_reward]" "[4000,4000,2000]"

launch_id="$(cast call "$factory" "launchCount()(uint256)" --rpc-url "$rpc_url")"
token="$(cast call "$factory" "launchTokenById(uint256)(address)" "$launch_id" --rpc-url "$rpc_url")"
vault="$(cast call "$factory" "vaultByToken(address)(address)" "$token" --rpc-url "$rpc_url")"
send_transaction "$market_factory" "createMarket(address)" "$token"
market="$(cast call "$market_factory" "marketByToken(address)(address)" "$token" --rpc-url "$rpc_url")"

send_transaction "$token" "approve(address,uint256)" "$market" "$market_token_seed"
send_transaction "$market" "seed(uint256,uint256)" "$market_token_seed" "0"
pool="$(cast call "$market" "graduatedPool()(address)" --rpc-url "$rpc_url")"
send_transaction "$factory" "sealLaunchExclusions(address,address[])" "$token" "[$market,$pool]"

block_number="$(cast block-number --rpc-url "$rpc_url")"
git_commit="$(git rev-parse HEAD)"
mkdir -p "$(dirname "$manifest")"
temporary_manifest="$(mktemp "$(dirname "$manifest")/.31337.XXXXXX")"
jq -n --arg environment "robyn-devnet" --argjson chainId "$chain_id" --argjson blockNumber "$block_number" --arg gitCommit "$git_commit" --arg deployer "$deployer" --arg base "$base" --arg nvda "$nvda" --arg spy "$spy" --arg ethReward "$eth_reward" --arg router "$router" --arg factory "$factory" --arg marketFactory "$market_factory" --arg token "$token" --arg vault "$vault" --arg market "$market" --arg pool "$pool" --arg curveTokens "$curve_token_allocation" --arg graduationTokens "$graduation_token_allocation" --arg virtualTokens "$initial_virtual_token_reserve" --arg virtualBase "$initial_virtual_base_reserve" --arg threshold "$graduation_threshold_base" '{
    environment: $environment,
    chainId: $chainId,
    deploymentBlock: $blockNumber,
    gitCommit: $gitCommit,
    deployer: $deployer,
    contracts: {
      baseAsset: $base,
      rewardAssets: [$nvda, $spy, $ethReward],
      conversionRouter: $router,
      factory: $factory,
      marketFactory: $marketFactory,
      genesisToken: $token,
      genesisVault: $vault,
      genesisMarket: $market,
      genesisGraduatedPool: $pool
    },
    genesisBasket: [
      {symbol: "mNVDA", weightBps: 4000},
      {symbol: "mSPY", weightBps: 4000},
      {symbol: "mETH", weightBps: 2000}
    ],
    market: {
      type: "bonding-curve-v1",
      feeBps: 100,
      curveTokenAllocation: $curveTokens,
      graduationTokenAllocation: $graduationTokens,
      initialVirtualTokenReserve: $virtualTokens,
      initialVirtualBaseReserve: $virtualBase,
      graduationThresholdBase: $threshold
    }
  }' >"$temporary_manifest"
mv "$temporary_manifest" "$manifest"

"$repo_root/scripts/verify-devnet-deployment.sh" "$manifest"
echo "Wrote $manifest"
