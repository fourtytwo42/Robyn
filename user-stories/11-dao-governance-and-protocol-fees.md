# User Stories 11: DAO, Governance, and Protocol Fees

## Member rewards

- As an RDAO holder, I can see balance, eligible reward supply, claimable ETH, and lifetime claims so I understand my position.
- As an RDAO holder, I can claim to myself or another valid recipient so contract and operational wallets are supported.
- As a sender, I retain rewards accrued before an RDAO transfer so transfers cannot confiscate earned ETH.
- As a recipient, I earn only the portion unlocking while I hold RDAO so reward accounting is not retroactive.
- As a member, I can claim any unlocked amount during the rolling one-hour release without forfeiting the remainder.

## Creator rewards

- As a creator recipient, I see each token's claimable native ETH, amount still
  unlocking over one hour, lifetime assigned, and lifetime claimed
  independently.
- As a creator, I can claim a launch's native fees from that token page only when the connected wallet is its immutable canonical creator.
- As a creator with multiple launches, I can claim one token without changing any other token's balance.
- As a creator, I can use Portfolio to see every token I created, claim individually, or Claim All in one transaction.
- As a creator, I can reveal an advanced Portfolio control to send an atomic batch claim to another valid recipient.
- As a noncreator or disconnected visitor, I do not see personal claim controls on a token page.
- As a protocol observer, I understand that wallet-gated controls do not make public onchain balances or events private.
- As a DAO member, I no longer see creator-claim controls in DAO Rewards; Treasury retains aggregate creator-liability monitoring.
- As a token holder, I can verify the creator share cannot reduce the immutable 50% basket share.
- As a creator, I can assign the creator share to one through eight recipients,
  change an open split for future fees only, or irreversibly lock it.
- As a removed split recipient, I retain and continue unlocking every amount
  assigned before the split changed.

## Delegation and voting

- As a holder, I can delegate to myself or another wallet and see current delegated voting power.
- As an eligible delegate, I can create a proposal after a successful simulation and see the exact targets, values, calldata, and public description.
- As a voter, I can vote for, against, or abstain once and see my receipt and weight.
- As any user, I can see quorum progress, state, delay, deadline, ETA, and execution history.
- As any user, I can permissionlessly queue a succeeded proposal and execute it after the two-day timelock.
- As a cautious member, I can use safe templates or clearly identified advanced calldata.

## Treasury and operations

- As a member, I can see treasury ETH, creator liabilities, RDAO rewards, per-token fee queues, cumulative conversions, and guardian status.
- As a keeper, I can harvest and convert bounded batches without special privileges.
- As a keeper, unsafe TWAP, liquidity, quote, impact, pause, or deadline conditions fail closed and leave funds retryable.
- As a guardian, I can pause conversions and cancel a malicious queued operation but cannot unpause alone, withdraw treasury, or rewrite votes.
- As a member, I can verify the Governor is sole proposer, execution is open, and setup administration is renounced.

## Immutability and safety

- As a launch holder, I can verify governance cannot alter my basket, fee split, creator, LP principal lock, or accrued rewards.
- As an auditor, I can reconcile every fee through basket, creator, RDAO, and treasury destinations including dust and partial batches.
- As an operator, I can rebuild DAO views from contracts and logs after database loss.
- As a testnet user, I only receive project-owned mock assets and see the Robyn-controlled Uniswap test venue label.
- As a release operator, I cannot broadcast to public testnet without explicit authorization, sufficient funded-wallet verification, frozen manifests, and a protected build.
