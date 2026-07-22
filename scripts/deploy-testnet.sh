#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rpc_url="${ROBYN_TESTNET_RPC_URL:-https://rpc.testnet.chain.robinhood.com}"
manifest="${ROBYN_TESTNET_MANIFEST:-$repo_root/deployments/46630.json}"
rehearsal="${ROBYN_TESTNET_REHEARSAL:-false}"
broadcast="${ROBYN_TESTNET_BROADCAST:-false}"

export PATH="$HOME/.foundry/bin:$PATH"
cd "$repo_root"

if [[ "$broadcast" != "true" ]]; then
  echo "Set ROBYN_TESTNET_BROADCAST=true to authorize deployment transactions" >&2
  exit 1
fi
chain_id="$(cast chain-id --rpc-url "$rpc_url")"
if [[ "$chain_id" != "46630" ]]; then
  echo "Refusing Robinhood testnet deployment on chain $chain_id" >&2
  exit 1
fi

wallet_args=()
if [[ "$rehearsal" == "true" ]]; then
  if [[ "${ROBYN_ALLOW_UNLOCKED_REHEARSAL:-false}" != "true" || ! "$rpc_url" =~ ^http://(127\.0\.0\.1|localhost):[0-9]+$ ]]; then
    echo "Unlocked rehearsal signing is restricted to an explicitly allowed loopback RPC" >&2
    exit 1
  fi
  deployer="$(cast rpc eth_accounts --rpc-url "$rpc_url" | jq -er '.[0]')"
  wallet_args=(--from "$deployer" --unlocked)
else
  keystore="${ROBYN_TESTNET_KEYSTORE:-${ROBYN_KEYSTORE:-}}"
  password_file="${ROBYN_TESTNET_PASSWORD_FILE:-${ROBYN_PASSWORD_FILE:-}}"
  if [[ -z "$keystore" || -z "$password_file" || ! -f "$keystore" || ! -f "$password_file" ]]; then
    echo "ROBYN_TESTNET_KEYSTORE and ROBYN_TESTNET_PASSWORD_FILE must name readable files" >&2
    exit 1
  fi
  if [[ -n "$(git status --porcelain)" ]] || [[ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]]; then
    echo "Real testnet deployment requires a clean commit pushed to origin/main" >&2
    exit 1
  fi
  deployer="$(cast wallet address --keystore "$keystore" --password-file "$password_file")"
  wallet_args=(--keystore "$keystore" --password-file "$password_file")
fi

forge build --root packages/contracts >/dev/null
if grep -RqsE 'DEVNET_ONLY|robyn-devnet' packages/contracts/src/testnet; then
  echo "Devnet marker found in testnet contracts" >&2
  exit 1
fi

deploy_contract() {
  local contract="$1"
  shift
  forge create "$contract" --root packages/contracts --rpc-url "$rpc_url" "${wallet_args[@]}" --broadcast --json --constructor-args "$@" |
    jq -er '.deployedTo'
}

send_transaction() {
  cast send --rpc-url "$rpc_url" "${wallet_args[@]}" --json "$@" |
    jq -e '.status == "0x1" or .status == 1' >/dev/null
}

base="$(deploy_contract src/testnet/TestnetMockERC20.sol:TestnetMockERC20 "Testnet Mock USD" "tmUSD" "$deployer" "10000000000000000000000")"
nvda="$(deploy_contract src/testnet/TestnetMockERC20.sol:TestnetMockERC20 "Testnet Mock NVIDIA" "tmNVDA" "$deployer" "0")"
spy="$(deploy_contract src/testnet/TestnetMockERC20.sol:TestnetMockERC20 "Testnet Mock S&P 500" "tmSPY" "$deployer" "0")"
eth_reward="$(deploy_contract src/testnet/TestnetMockERC20.sol:TestnetMockERC20 "Testnet Mock Ether" "tmETH" "$deployer" "0")"
router="$(deploy_contract src/testnet/TestnetConversionRouter.sol:TestnetConversionRouter "$deployer")"
factory="$(deploy_contract src/RobynLaunchFactory.sol:RobynLaunchFactory "$base" "$router" "1000000000000000000" "86400")"
market_factory="$(deploy_contract src/testnet/TestnetMarketFactory.sol:TestnetMarketFactory "$base" "$factory" "1000000000000000" "100")"

reward_liquidity="10000000000000000000000000"
base_liquidity="10000000000000000000000000"
initial_supply="1000000000000000000000000000"
market_token_seed="500000000000000000000000000"
market_base_seed="1000000000000000000000000"

send_transaction "$base" "mint(address,uint256)" "$deployer" "$base_liquidity"
for reward in "$nvda" "$spy" "$eth_reward"; do
  send_transaction "$reward" "mint(address,uint256)" "$router" "$reward_liquidity"
done
send_transaction "$router" "setRate(address,address,uint256)" "$base" "$nvda" "1000000000000000000"
send_transaction "$router" "setRate(address,address,uint256)" "$base" "$spy" "2000000000000000000"
send_transaction "$router" "setRate(address,address,uint256)" "$base" "$eth_reward" "3000000000000000000"
send_transaction "$factory" "createLaunch(string,string,uint256,address[],uint16[])" "Robyn Testnet Genesis" "tROBYN" "$initial_supply" "[$nvda,$spy,$eth_reward]" "[4000,4000,2000]"

launch_id="$(cast call "$factory" "launchCount()(uint256)" --rpc-url "$rpc_url")"
token="$(cast call "$factory" "launchTokenById(uint256)(address)" "$launch_id" --rpc-url "$rpc_url")"
vault="$(cast call "$factory" "vaultByToken(address)(address)" "$token" --rpc-url "$rpc_url")"
send_transaction "$market_factory" "createMarket(address)" "$token"
market="$(cast call "$market_factory" "marketByToken(address)(address)" "$token" --rpc-url "$rpc_url")"
send_transaction "$token" "approve(address,uint256)" "$market" "$market_token_seed"
send_transaction "$base" "approve(address,uint256)" "$market" "$market_base_seed"
send_transaction "$market" "seed(uint256,uint256)" "$market_token_seed" "$market_base_seed"
send_transaction "$factory" "sealLaunchExclusions(address,address[])" "$token" "[$market]"

block_number="$(cast block-number --rpc-url "$rpc_url")"
git_commit="$(git rev-parse HEAD)"
mkdir -p "$(dirname "$manifest")"
temporary_manifest="$(mktemp "$(dirname "$manifest")/.46630.XXXXXX")"
jq -n --arg environment "robinhood-testnet" --arg assetStrategy "project-owned-testnet-mocks" --argjson chainId "$chain_id" --argjson blockNumber "$block_number" --arg gitCommit "$git_commit" --arg deployer "$deployer" --arg base "$base" --arg nvda "$nvda" --arg spy "$spy" --arg ethReward "$eth_reward" --arg router "$router" --arg factory "$factory" --arg marketFactory "$market_factory" --arg token "$token" --arg vault "$vault" --arg market "$market" '{
  schemaVersion: 1,
  environment: $environment,
  chainId: $chainId,
  deploymentBlock: $blockNumber,
  gitCommit: $gitCommit,
  gitSha: $gitCommit,
  deployer: $deployer,
  assetStrategy: $assetStrategy,
  mockOnly: true,
  contracts: {
    baseAsset: $base,
    rewardAssets: [$nvda, $spy, $ethReward],
    conversionRouter: $router,
    factory: $factory,
    marketFactory: $marketFactory,
    genesisToken: $token,
    genesisVault: $vault,
    genesisMarket: $market
  },
  genesisBasket: [
    {symbol: "tmNVDA", weightBps: 4000},
    {symbol: "tmSPY", weightBps: 4000},
    {symbol: "tmETH", weightBps: 2000}
  ],
  market: {basePerToken: "1000000000000000", feeBps: 100}
}' > "$temporary_manifest"
mv "$temporary_manifest" "$manifest"

ROBYN_TESTNET_RPC_URL="$rpc_url" "$repo_root/scripts/verify-testnet-deployment.sh" "$manifest"
echo "Wrote $manifest"
