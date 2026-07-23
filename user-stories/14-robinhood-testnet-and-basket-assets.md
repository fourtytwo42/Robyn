# Robinhood Testnet and basket-asset stories

### US-TESTNET-001: Add or switch the connected wallet

- Release: Robinhood Testnet candidate
- Priority: Must
- Persona: Trader
- PRD: TESTNET-003, TESTNET-004
- Depends on: US-ACCESS-002

As a wallet user, I want Robyn to request the correct network and explain recovery so that I do not submit a transaction on the wrong chain.

Acceptance criteria:

1. A connected wrong-chain wallet immediately receives a switch request.
2. Error `4902` causes Robyn to add the official chain-46630 definition and retry the switch.
3. Rejection, stale session, unsupported network, and disconnect remain explicit, and every write stays disabled.
4. The official faucet is available without Robyn automating the claim.

### US-ASSET-001: Browse a trustworthy testnet catalog

- Release: Robinhood Testnet candidate
- Priority: Must
- Persona: Creator
- PRD: ASSET-001, ASSET-002, ASSET-003, ASSET-008
- Depends on: US-TESTNET-001

As a creator, I want a searchable catalog whose provenance is clear so that I can distinguish test mocks from issuer assets.

Acceptance criteria:

1. All 24 initial assets show artwork, symbol, name, category, address, mock/verification label, reference snapshot, and route status.
2. A symbol collision never upgrades an unknown address's verification.
3. Every stock-style entry states that it is a Robyn testnet mock.
4. The deployment gate stops if Robinhood begins reporting official chain-46630 Stock Tokens.

### US-ASSET-002: Inspect a custom ERC-20

- Release: Robinhood Testnet candidate
- Priority: Must
- Persona: Creator
- PRD: ASSET-004, ASSET-005, ASSET-006
- Depends on: US-ASSET-001

As a creator, I want to paste a token address and inspect it safely so that I know whether it can enter my basket.

Acceptance criteria:

1. No-code, malformed, reverting, bytes32, oversized metadata, and unusual-decimal contracts do not crash the page.
2. Unknown contracts remain unverified and receive no arbitrary external logo.
3. An asset without a ready route remains inspectable but disabled with a reason.
4. Quotes and displayed units use the resolved decimals.

### US-ASSET-003: Construct an exact three-asset basket

- Release: Robinhood Testnet candidate
- Priority: Must
- Persona: Creator
- PRD: ASSET-005, ASSET-007
- Depends on: US-ASSET-001, US-ASSET-002

As a creator, I want an accessible basket editor so that I can launch with exact immutable weights.

Acceptance criteria:

1. The modal or mobile sheet supports search, category tabs, keyboard focus, Escape, focus trapping, and no overflow.
2. Duplicates and a fourth asset are blocked.
3. Reorder, remove, split-evenly, remainder-rebalance, numeric weight, and exact 100 percent validation work.
4. Launch simulation and execution both fail if any route becomes unavailable.

### US-TESTNET-002: Operate isolated public testnet services

- Release: Robinhood Testnet candidate
- Priority: Must
- Persona: Operator
- PRD: TESTNET-001, TESTNET-002, TESTNET-005
- Depends on: US-INFRA-001, US-TESTNET-001

As an operator, I want testnet isolated and fail-closed so that public testing cannot corrupt devnet or leak secrets.

Acceptance criteria:

1. Testnet uses separate PM2 names, ports, database, Redis DB/queue, manifest, logs, and release root.
2. A named tunnel routes only web, API, and pinned IPFS paths through loopback Nginx.
3. Remote pin secrets are loaded at runtime from a protected file and never enter PM2 configuration, bundles, Git, or manifests.
4. Real deployment cannot begin until every external input, signer, chain, provenance, gas, balance, build, and manifest gate passes.

### US-TESTNET-003: Verify the real testnet journey

- Release: Robinhood Testnet candidate
- Priority: Must
- Persona: Verifier
- PRD: TESTNET-002, ASSET-005
- Depends on: US-ASSET-003, US-TESTNET-002

As a verifier, I want transaction and state evidence so that a public candidate is not declared ready from UI appearance alone.

Acceptance criteria:

1. The canonical launch identity is decoded from its coordinator receipt.
2. Pre-graduation trade, automatic graduation, locked V3 liquidity, post-graduation trade, three-leg conversion, holder claim, creator claim, and RDAO claim are verified through RPC and explorer.
3. Fee conservation, route readiness, deployment hashes, and all 24 addresses are independently verified.
4. No mainnet broadcast occurs.
