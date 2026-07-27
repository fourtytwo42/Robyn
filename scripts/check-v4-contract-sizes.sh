#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
export PATH="$HOME/.foundry/bin:$PATH"
forge build --root packages/contracts >/dev/null

runtime_limit=24576
init_limit=49152
contracts=(
  RobynNativeLaunchFactoryV4
  RobynNativeLaunchDeployerV4
  RobynNativeVaultDeployerV4
  RobynV4LaunchCoordinatorV5
  RobynV4MarketFactory
  RobynV4BondingCurveMarket
  RobynV4GraduationAdapter
  RobynV4FeeAndPhaseHook
  RobynV4FeePositionLocker
  RobynNativeBasketVaultV2
  RobynNativeProtocolFeeRouterV4
  RobynTokenSink
  RobynV4AssetRouter
  RobynV4TestAssetLiquidityLocker
  RobynV4AdapterDeployer
  RobynV4LockerDeployer
  RobynV4MarketDeployer
  RobynDaoToken
  RobynTestnetGovernor
)

failed=0
for contract in "${contracts[@]}"; do
  artifact="packages/contracts/out/$contract.sol/$contract.json"
  [[ -f "$artifact" ]] || { echo "missing artifact: $artifact" >&2; exit 1; }
  runtime="$(jq -er '.deployedBytecode.object' "$artifact")"
  creation="$(jq -er '.bytecode.object' "$artifact")"
  runtime_bytes=$(((${#runtime} - 2) / 2))
  creation_bytes=$(((${#creation} - 2) / 2))
  printf '%-36s runtime=%5d init=%5d\n' "$contract" "$runtime_bytes" "$creation_bytes"
  if ((runtime_bytes > runtime_limit || creation_bytes > init_limit)); then
    failed=1
  fi
done

if ((failed)); then
  echo "A v4 contract exceeds EIP-170 or EIP-3860 limits" >&2
  exit 1
fi
