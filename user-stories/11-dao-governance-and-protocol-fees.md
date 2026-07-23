# User Stories 11: DAO, Governance, and Protocol Fees

## Member rewards

- As an RDAO holder, I can see balance, eligible reward supply, claimable ETH, and lifetime claims so I understand my position.
- As an RDAO holder, I can claim to myself or another valid recipient so contract and operational wallets are supported.
- As a sender, I retain rewards accrued before an RDAO transfer so transfers cannot confiscate earned ETH.
- As a recipient, I earn only deposits occurring after receipt so reward accounting is not retroactive.
- As a user, I see that instant deposits permit buy-before-conversion participation so the reward-sniping tradeoff is explicit.

## Creator rewards

- As a creator, I can see and pull my native fee balance without any fee payment occurring during a trade.
- As a creator, I can claim to another recipient so a reverting or specialized wallet does not strand the entitlement.
- As a token holder, I can verify the creator share cannot reduce the immutable 50% basket share.

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
