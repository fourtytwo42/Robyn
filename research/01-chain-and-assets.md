# Robinhood Chain capabilities and assets

Last verified: 2026-07-20

## What Robinhood launched

Robinhood Chain public mainnet launched on 2026-07-01. It is an Ethereum Layer 2 built with the Arbitrum stack. It uses Ethereum blobs for data availability, settles to Ethereum, is EVM-compatible, and uses ETH as its native gas token.

Core network values:

| Property | Mainnet | Testnet |
|---|---:|---:|
| Chain ID | `4663` | `46630` |
| Public RPC | `https://rpc.mainnet.chain.robinhood.com` | `https://rpc.testnet.chain.robinhood.com` |
| Gas token | ETH | ETH |
| Explorer | [Blockscout](https://robinhoodchain.blockscout.com/) | [Testnet Blockscout](https://explorer.testnet.chain.robinhood.com/) |

Robinhood documents sub-second soft confirmations, Ethereum posting within minutes, and full Ethereum finality approximately 13 minutes after posting. The canonical L2-to-L1 withdrawal path has the normal Arbitrum challenge period of about seven days.

Sources: [mainnet announcement](https://robinhood.com/us/en/newsroom/robinhood-accelerates-global-expansion-robinhood-chain-mainnet-stock-tokens-agentic-trading/), [connection details](https://docs.robinhood.com/chain/connecting/), [finality](https://docs.robinhood.com/chain/transaction-finality/), [bridging](https://docs.robinhood.com/chain/bridging/).

### Testnet development details

Robinhood operates a public EVM-compatible testnet and recommends deploying there before mainnet.

| Property | Testnet value |
|---|---|
| Network name | Robinhood Chain Testnet |
| Chain ID | `46630` (`0xb626`) |
| Gas token | ETH |
| Public JSON-RPC | `https://rpc.testnet.chain.robinhood.com` |
| Public sequencer feed | `wss://feed.testnet.chain.robinhood.com` |
| Public sequencer endpoint | `https://sequencer.testnet.chain.robinhood.com` |
| Alchemy RPC | `https://robinhood-testnet.g.alchemy.com/v2/{API_KEY}` |
| Alchemy WebSocket | `wss://robinhood-testnet.g.alchemy.com/v2/{API_KEY}` |
| Explorer | [explorer.testnet.chain.robinhood.com](https://explorer.testnet.chain.robinhood.com/) |
| Blockscout verification API | `https://explorer.testnet.chain.robinhood.com/api/` |

Fresh checks on 2026-07-20 confirmed:

- `eth_chainId` returned `0xb626`, which is decimal `46630`.
- `eth_blockNumber` returned a live advancing chain height; the observed height was `91,820,526` at the time of the check.
- The explorer returned HTTP 200.
- A browser CORS preflight to the public testnet RPC returned HTTP 204 and allowed cross-origin `POST` requests with the `content-type` header.

The public testnet RPC is suitable for development, wallet traffic, and ordinary browser testing, but Robinhood labels all public endpoints as rate-limited and not recommended as production dependencies. Alchemy is Robinhood's recommended hosted provider; the documentation also identifies QuickNode, Blockdaemon, dRPC, and Validation Cloud as supported providers.

Important current gaps:

- No official public testnet ETH faucet was located in the Robinhood Chain documentation reviewed on 2026-07-20. Testnet deployment is blocked until a funding route is confirmed or test ETH is supplied by Robinhood or an infrastructure partner.
- The official token-contract page currently publishes canonical WETH, USDG, Stock Token, and ETF addresses for Robinhood Chain mainnet, but no canonical testnet Stock Token registry or testnet token-address table was located.
- Do not assume mainnet Stock Token addresses exist on testnet. The accounting proof should deploy mock ERC-20 reward assets, mock price feeds, and a mock issuer-control token with pause, block, multiplier, and administrative-burn behavior.
- Testnet tokens have no monetary value. Under the [Robinhood Chain Terms](https://docs.robinhood.com/chain/terms-of-service/), Robinhood may change or discontinue the testnet without notice.

Minimal wallet configuration:

```json
{
  "chainId": "0xb626",
  "chainName": "Robinhood Chain Testnet",
  "nativeCurrency": {
    "name": "Ether",
    "symbol": "ETH",
    "decimals": 18
  },
  "rpcUrls": ["https://rpc.testnet.chain.robinhood.com"],
  "blockExplorerUrls": ["https://explorer.testnet.chain.robinhood.com"]
}
```

Sources: [connecting to Robinhood Chain](https://docs.robinhood.com/chain/connecting/), [adding the network to a wallet](https://docs.robinhood.com/chain/add-network-to-wallet/), [deploying smart contracts](https://docs.robinhood.com/chain/deploy-smart-contracts/), [token contracts](https://docs.robinhood.com/chain/contracts/), and [Chain Terms](https://docs.robinhood.com/chain/terms-of-service/).

## What standard Ethereum tooling works

Solidity and Vyper contracts deploy using ordinary Foundry, Hardhat, viem, ethers, and OpenZeppelin patterns. The chain supports ERC-4337 and EIP-7702 account abstraction, including smart accounts, transaction batching, gas sponsorship, spending policies, session keys, and embedded wallets through providers such as Alchemy, ZeroDev, and Privy.

Arbitrum-specific differences still matter:

- `block.number` is an L1 estimate, not a precise L2 counter. Use `ArbSys.arbBlockNumber()` when the L2 block number matters.
- `block.prevrandao` is constant and cannot provide randomness.
- Fees contain both L2 execution and L1 data components.
- L1-to-L2 contract messages use address aliasing.
- The maximum deployed code size is larger than Ethereum's limit, but that should not replace modular design.

Sources: [deploying contracts](https://docs.robinhood.com/chain/deploy-smart-contracts/), [differences from Ethereum](https://docs.robinhood.com/chain/differences-from-ethereum/), [account abstraction](https://docs.robinhood.com/chain/account-abstraction/), [gas and fees](https://docs.robinhood.com/chain/gas-and-fees/).

## Trading and liquidity infrastructure

The useful mainnet primitives are already present:

- Uniswap v2, v3, v4, and UniswapX are live. Uniswap describes itself as the primary public AMM and supports Robinhood Stock Tokens through both AMM and intent-based routes.
- 0x provides RFQ liquidity for Stock Tokens and cross-chain swap access. Robinhood's developer examples use an `NVDA` to `USDG` RFQ trade as the stock-token integration pattern.
- Chainlink Data Feeds provide per-asset prices for Stock Tokens and crypto assets. Chainlink Data Streams and CCIP are also live.
- The canonical Arbitrum bridge, LayerZero/Stargate, Chainlink CCIP/Transporter, Relay, Across, LI.FI, and 0x provide bridge or cross-chain routes.
- Canonical WETH is `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`.
- Canonical USDG is `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`.

Sources: [Uniswap launch](https://blog.uniswap.org/robinhood-chain-is-live), [0x launch support](https://www.prnewswire.com/news-releases/0x-to-power-swap-liquidity-and-cross-chain-access-on-robinhood-chain-at-launch-302816080.html), [oracles](https://docs.robinhood.com/chain/oracles-and-price-feeds/), [token contracts](https://docs.robinhood.com/chain/contracts/).

## Activity is real but should not be over-interpreted

A live DefiLlama API read on 2026-07-20 returned approximately:

- `$263.0M` chain TVL.
- `$438.4M` DEX volume over 24 hours.
- `$4.56B` DEX volume over seven days.
- `$7.70B` DEX volume over 30 days, which in practice is the chain's lifetime because mainnet is less than a month old.

This confirms substantial launch-period activity. It does not prove durable organic demand. Public analysis indicates that much of the early volume is concentrated in memecoins and a small set of pools, with reports of volume bots and strong week-to-week volatility. Product planning should use live liquidity, distinct traders, fee revenue, retained holders, and executable slippage rather than headline DEX volume alone.

Sources: [DefiLlama chain page](https://defillama.com/chain/robinhood-chain), [DefiLlama chains API](https://api.llama.fi/v2/chains), [DefiLlama DEX API](https://api.llama.fi/overview/dexs/Robinhood%20Chain?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true&dataType=dailyVolume).

## Robinhood Stock Tokens are not wrapped common stock

The informal phrase “wrapped stocks” is misleading. Robinhood Stock Tokens are tokenized debt securities issued by Robinhood Assets (Jersey) Limited, or RHJ. They provide economic exposure to an underlying stock or ETF but do not give holders legal or beneficial ownership of the underlying security or normal shareholder rights.

Technical properties:

- Standard ERC-20 interface with 18 decimals.
- Freely held, transferred, and composed by smart contracts at the token-interface level.
- ERC-8056 scaled UI multiplier for dividends, splits, and other corporate actions.
- A Chainlink price feed for each token.
- The price feed already includes the multiplier and tracks total-return-style economics rather than only the quoted share price.
- Stock feeds update 24/5. Onchain transfers and markets may remain open while the feed is stale outside its update schedule.
- Oracle publication may pause during corporate actions. Integrations must check `oraclePaused()`, feed staleness, positive values, and L2 sequencer status.

Robinhood's own developer documentation explicitly lists “indices and baskets” as a supported use case.

Sources: [Stock Token overview](https://docs.robinhood.com/chain/stock-tokens/), [building with Stock Tokens](https://docs.robinhood.com/chain/building-with-stock-tokens/), [oracles and price feeds](https://docs.robinhood.com/chain/oracles-and-price-feeds/).

## Current asset availability

The official live registry returned 96 active Stock Tokens and tokenized ETFs on 2026-07-20. The full snapshot is in [05-asset-registry-snapshot.md](05-asset-registry-snapshot.md).

Relevant examples:

| Requested or notable asset | Result | Canonical contract |
|---|---|---|
| NVIDIA | Available as `NVDA` | `0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC` |
| S&P 500 | Available through `SPY` | `0x117cc2133c37B721F49dE2A7a74833232B3B4C0C` |
| Invesco QQQ | Available as `QQQ` | `0xD5f3879160bc7c32ebb4dC785F8a4F505888de68` |
| Block, Inc. / Cash App | Not in the registry as `XYZ` or its former ticker `SQ` | Not available |
| Robinhood Markets | Not in the current registry as `HOOD` | Not available |

The launchpad must not accept a stock name or ticker without resolving it through the live canonical registry. A user-created token can copy a ticker, so symbol matching alone is unsafe.

Live registry sources: [official contract page](https://docs.robinhood.com/chain/contracts/), [official asset API](https://api.robinhood.com/rhj/assets).

Corporate-name source: [Block's official `SQ` to `XYZ` ticker-change announcement](https://investors.block.xyz/investor-news/news-details/2025/Block-Announces-Ticker-Symbol-Change-to-XYZ-To-Report-Fourth-Quarter-Results/default.aspx).

## Issuer and upgrade controls found onchain

The canonical `NVDA` token is a verified BeaconProxy. Its current verified `Stock` implementation exposes role-gated minting and burning, an `adminBurn(address,uint256)` function, token and registry-level pause behavior, oracle pause controls, metadata controls, and multiplier updates. The beacon design also means the shared implementation can be upgraded by the beacon owner.

These controls are understandable for a regulated tokenized security, but they are important product dependencies:

- A stock token can be paused while rewards are being purchased or claimed.
- An issuer action can change balances or availability.
- A shared implementation upgrade can affect every dependent basket.
- A vault cannot promise unconditional redemption if an underlying token is paused or administratively burned.

Source: [canonical NVDA proxy and verified implementation](https://robinhoodchain.blockscout.com/address/0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC?tab=contract).

## Practical conclusion for the launchpad

Robinhood Chain supplies every basic technical primitive needed to deploy the product. The limiting issues are not Solidity compatibility. They are:

1. Reliable execution into Stock Tokens, which depends on RFQ or intent liquidity and often an offchain quote service.
2. Eligibility and transfer restrictions on the tokenized debt securities.
3. Accurate holder reward accounting without an unbounded push loop.
4. Oracle staleness, corporate-action pauses, and issuer controls.
5. Differentiation from the already-live Vimen basket and hood.fun community-reward products.
