# Multi-wallet connection stories

### US-WALLET-001: Choose a specific wallet

- Release: Testnet readiness
- Priority: Must
- Persona: Trader
- PRD: WALLET-001, WALLET-002, WALLET-004
- Depends on: Protected testnet build

As a trader, I want one wallet selector that discovers installed and WalletConnect wallets so that every Robyn page uses the account I deliberately chose.

Acceptance criteria:

1. Multiple EIP-6963 announcements remain distinguishable.
2. The selected connector and address propagate across navigation.
3. Page-specific `window.ethereum` discovery does not exist in protected components.

### US-WALLET-002: Connect Robinhood Wallet

- Release: Testnet readiness
- Priority: Must
- Persona: Trader
- PRD: WALLET-002, WALLET-009, WALLET-012
- Depends on: US-WALLET-001, registered WalletConnect project and stable HTTPS origin

As a Robinhood Wallet user, I want the standard WalletConnect QR flow so that I can connect without an invented or unsupported deep link.

Acceptance criteria:

1. WalletConnect is the first recommended group.
2. The UI does not claim certification before the real-device procedure passes.
3. A valid registered project and stable HTTPS origin are required for final acceptance.

### US-WALLET-003: Resolve the wrong network

- Release: Testnet readiness
- Priority: Must
- Persona: Creator
- PRD: WALLET-003
- Depends on: US-WALLET-001

As a creator, I want a clear switch-network action so that no write is submitted on the wrong chain.

Acceptance criteria:

1. Connected wrong-chain state is not rendered as disconnected.
2. Every write surface blocks until chain `46630` is active.
3. Rejection and unsupported-chain errors are translated into user-facing text.

### US-WALLET-004: Keep identity permissions bound to the wallet

- Release: Testnet readiness
- Priority: Must
- Persona: Creator
- PRD: WALLET-004, WALLET-005, WALLET-011
- Depends on: US-WALLET-001, existing SIWE authentication

As a creator, I want profile permissions invalidated when I change wallets so that the previous address's SIWE session cannot authorize my new account.

Acceptance criteria:

1. Initial reconnect does not spuriously log out.
2. An established account change or disconnect calls logout and clears authenticated UI state.
3. The new account must sign a fresh SIWE message before protected mutations.

### US-WALLET-005: Use a safe public configuration

- Release: Testnet readiness
- Priority: Must
- Persona: Operator
- PRD: WALLET-006, WALLET-007, WALLET-008
- Depends on: Protected testnet build

As an operator, I want protected builds to fail closed on unsafe wallet configuration so that browser bundles never receive key material or privileged RPC access.

Acceptance criteria:

1. Missing/invalid WalletConnect ID, non-HTTPS app URL or private RPC fails the build.
2. Bundle scans reject devnet key and faucet markers.
3. Build evidence records the wallet layer and public-RPC validation.

### US-WALLET-006: Use the wallet UI accessibly

- Release: Testnet readiness
- Priority: Must
- Persona: Trader
- PRD: WALLET-010
- Depends on: US-WALLET-001

As a keyboard or mobile user, I want an accessible compact selector so that wallet choice is usable without layout overflow or pointer-only controls.

Acceptance criteria:

1. The modal traps focus, closes with Escape and exposes accessible names.
2. At 390 by 844, the selector remains visible and the document has no horizontal overflow.
3. Focus rings and wrong-network contrast remain visible.
