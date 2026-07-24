# Robinhood Testnet deployment and basket assets

Status: Implemented candidate, external-input gated
Version: 1.0
Date: 2026-07-23

## Product outcome

Robyn keeps chain `31337` as its controlled regression environment and publishes a separate candidate on Robinhood Testnet chain `46630`. Users connect external EVM wallets, are prompted to add or switch to Robinhood Testnet, can open the official faucet, and can create an immutable basket from up to three route-ready assets.

## Requirements

### TESTNET-001: Environment isolation

The testnet web, API, indexer, keeper, artifact service, PostgreSQL database, Redis namespace, logs, manifest, and PM2 process names MUST remain isolated from controlled devnet.

### TESTNET-002: Broadcast boundary

Every real broadcast MUST require chain `46630`, a clean exact `origin/main`, encrypted testnet signer, verified DEX manifest, reviewed RDAO allocation, real WalletConnect project ID, fresh execution and conservative L1-data cost estimate, and at least 25 percent balance headroom. The current owner-approved testnet preview MAY use local-only IPFS pinning and an explicitly allowlisted Quick Tunnel when both exceptions are enabled by named operator flags and disclosed in the manifest and UI. These exceptions MUST remain forbidden for mainnet or production-readiness claims.

### TESTNET-003: Wallet switching

After connection, the UI MUST request a switch to chain `46630`; error `4902` MUST trigger `wallet_addEthereumChain` using official RPC, explorer, ETH currency, and chain ID, followed by a second switch request. No write is enabled until the provider confirms `46630`.

### TESTNET-004: Faucet

Zero/low-balance, wrong-network, header, and Create funding surfaces MUST link to `https://faucet.testnet.chain.robinhood.com`. Faucet actions open a new tab and MUST NOT automate eligibility or CAPTCHA.

### ASSET-001: Canonical identity

Every asset is identified by chain ID plus checksummed contract address. Symbol, name, artwork, or matching mainnet provenance alone MUST NOT establish authenticity.

### ASSET-002: Curated mock catalog

The initial chain-46630 catalog MUST contain 23 visibly labeled Robyn stock/ETF/commodity mocks plus WETH from the Robyn-controlled test DEX. It MUST disclose that mocks are not official Robinhood Stock Tokens, backed instruments, or redeemable assets.

### ASSET-003: Official provenance recheck

Immediately before broadcast, deployment tooling MUST requery Robinhood's official asset API, verify the committed chain-4663 reference addresses, and fail closed if official chain-46630 Stock Token deployments have appeared.

### ASSET-004: Defensive address resolution

Manual lookup MUST require code on chain `46630`, safely read string or bytes32 name/symbol, validate decimals from 0 through 36, read total supply without trusting it, never trust arbitrary remote artwork, and classify unknown contracts as unverified.

### ASSET-005: Route readiness

Only assets with a live funded fixed-test route or guarded direct tmUSD Uniswap V3 route MAY be selected. Missing inventory, pause, missing pool, low liquidity, stale TWAP, or excessive tick deviation MUST disable selection and fail atomic launch.

### ASSET-006: Decimal correctness

API, quote, keeper, formatting, and accounting paths MUST use the token's actual decimals and MUST NOT assume external assets have 18 decimals.

### ASSET-007: Basket editor

The Create flow MUST provide searchable categories, manual-address inspection, rich provenance and route state, a three-asset maximum, duplicate prevention, reorder controls, numeric weights, equal split, remainder rebalance, exact 100 percent validation, and immutable review details.

### ASSET-008: Public interfaces

The API MUST expose catalog search, opaque pagination cursor, address resolution, nonbinding quote, and versioned catalog manifest. Chain, address, decimals, verification, mock disclosure, reference-price timestamp, route type, readiness, liquidity, and failure reason are required response fields.

### TESTNET-005: Stable public candidate

The temporary public candidate MAY use an owner-approved Quick Tunnel routed through loopback Nginx. Its exact origin MUST be registered in Reown and rebuilt into the protected bundle. The URL is ephemeral and MUST be replaced by a named Cloudflare Tunnel and stable registered HTTPS hostname before production readiness. Raw RPC, Kubo RPC, databases, and PM2 ports MUST NOT be exposed.

### TESTNET-006: Initial DAO concentration

The initial controlled testnet deployment allocates 100 percent of fixed-supply RDAO to the encrypted deployer wallet. The UI and manifest MUST disclose this centralized starting state. Governance decentralization and contributor allocations are later onchain transfers or governance actions, not hidden deployment assumptions.

## Acceptance

- The chain-46630 contract and five-service rehearsals pass from an isolated native Anvil process.
- The protected testnet build contains WalletConnect and chain `46630` and contains no devnet key, session-wallet, faucet API, private RPC, or loopback marker.
- All 24 catalog routes are live in the rehearsal manifest and the three genesis legs convert and claim.
- MetaMask add/switch, WalletConnect, Robinhood Wallet, SIWE invalidation, manual address lookup, responsive picker, and all transaction surfaces pass browser acceptance on the currently registered HTTPS candidate.
- A real testnet launch/trade/graduation/conversion/claim journey is verified by RPC and explorer only after all broadcast gates pass.
