# Multi-wallet architecture and operations

## Runtime boundary

`apps/web/next.config.ts` resolves wallet provider and header-control aliases to devnet or testnet modules. Devnet imports no RainbowKit/wagmi provider and keeps the existing session wallet. Testnet wraps the application once with Wagmi, TanStack Query and RainbowKit.

`useRobynTestnetWallet` is the only testnet component interface. It exposes the active account/connector, required-chain state, public client, wallet client, connect, chain switch and disconnect. Transaction components retain their existing simulation, receipt and error paths.

## Connector policy

| Surface | Status |
|---|---|
| Robinhood Wallet | Available through generic WalletConnect; real-device chain-46630 acceptance pending |
| EIP-6963 installed wallets | Supported discovery; each product still requires chain-46630 acceptance |
| MetaMask, Rabby, Coinbase, Rainbow, Trust | Listed connectors; compatibility is conditional on custom-chain support |
| Safe, Ledger | Configured; RainbowKit may hide a connector when its required environment is unavailable |
| Embedded/social/custodial wallets | Out of scope |

“Available” means the connector can be offered. It does not mean Robyn has certified that wallet on Robinhood Testnet.

## Required deployment configuration

```text
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=<32-character public project ID>
NEXT_PUBLIC_APP_URL=https://<registered-stable-hostname>
ROBYN_TESTNET_BROWSER_RPC_URL=https://rpc.testnet.chain.robinhood.com
```

Register the exact stable HTTPS origin in the WalletConnect/Reown dashboard. A Quick Tunnel hostname is preview-only because it changes. The build refuses loopback, HTTP and RFC1918 browser RPCs.

The testnet response CSP permits the configured RPC plus WalletConnect/Reown relay domains. Operator RPCs, deployment keys and server credentials remain unavailable to the browser.

## Acceptance procedure

1. Build a protected candidate with the real project ID and registered stable URL.
2. Confirm the header, modal grouping and wrong-chain state in the Codex in-app browser at desktop, tablet and 390 by 844.
3. Connect Robinhood Wallet through WalletConnect without sending a transaction.
4. Add/switch to chain `46630`, reload and prove reconnect.
5. Sign SIWE, inspect the authenticated session, switch accounts and prove the old session is invalidated.
6. Disconnect and confirm all wallet-only controls disappear.
7. Repeat with one installed EIP-6963 wallet.
8. Record connector name/version, device, result and date in the compatibility matrix.

No seed phrase, private key or recovery material is accepted during this procedure.

