# Multi-wallet connection

Status: Implemented for protected testnet builds  
Date: 2026-07-23

## Product decision

Robyn supports external self-custody EVM wallets through one shared connection layer. Embedded, email, social-login and custodial wallets are outside this release. One connector and one address are active at a time.

The controlled chain-31337 devnet deliberately retains its generated/restored session wallet. Protected chain-46630 builds select RainbowKit `2.2.11`, wagmi `2.19.5`, TanStack Query `5.101.4` and viem `2.55.4` at build time, preventing devnet key modules from entering the testnet bundle.

## Requirements

- `WALLET-001` Testnet pages MUST consume one shared connector, account, chain, public client and wallet client.
- `WALLET-002` The selector MUST support EIP-6963 discovery and WalletConnect, prioritize Robinhood Wallet through standard WalletConnect, and include MetaMask, Rabby, Coinbase Wallet, Rainbow, Trust Wallet, Safe and Ledger connectors where available.
- `WALLET-003` The UI MUST distinguish disconnected, connecting, connected and wrong-chain states and block writes outside chain `46630`.
- `WALLET-004` Account changes and disconnects MUST propagate across Create, trading, Portfolio, creator rewards, DAO and governance without a page-specific provider cache.
- `WALLET-005` Changing or disconnecting the established account MUST invalidate the prior wallet's SIWE session.
- `WALLET-006` Connection MUST never request, display or persist a recovery phrase or private key.
- `WALLET-007` Protected builds MUST require a WalletConnect project ID, HTTPS application URL and browser-safe public HTTPS RPC.
- `WALLET-008` The protected bundle MUST exclude devnet session-key and faucet modules and MUST NOT contain an operator or private RPC configuration.
- `WALLET-009` Wallet availability MUST NOT be represented as verified Robinhood Testnet compatibility until it passes the published compatibility procedure.
- `WALLET-010` The connection modal and account control MUST be keyboard accessible, responsive at 390 pixels and consistent with Robyn's dark design system.
- `WALLET-011` Wallet connection and SIWE authentication MUST remain separate user actions.
- `WALLET-012` A real WalletConnect acceptance test MUST remain blocked until a valid project ID and its stable HTTPS origin are registered with the WalletConnect/Reown dashboard.

## Acceptance boundary

The implementation, test-only protected build, connector modal and responsive UI are complete. A fabricated build-only project ID is permitted only for isolated compilation and layout testing. It is not evidence that the WalletConnect relay, Robinhood Wallet, reconnect or SIWE mobile flow works.

