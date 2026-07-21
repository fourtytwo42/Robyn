# Robinhood Chain and Stock Token terms for launchpads and smart contracts

Research date: 2026-07-20

This document answers whether Robinhood publishes terms for launchpads, protocols, legal entities, or smart contracts that interact with Robinhood Stock Tokens. It separates the network-access agreement from the securities terms because they govern different things. This is product and integration research, not legal advice.

## Bottom line

Yes, Robinhood expressly permits and encourages developers to deploy smart contracts and compose Stock Tokens into applications. Its official examples include trading interfaces, lending markets, indices and baskets, yield vaults, price-aware contracts, and derivatives.

That technical permission is not permission to deliver the tokens to everyone. Robinhood Stock Tokens are tokenised debt securities. The issuer's terms restrict who may acquire or benefit from them, where they may be offered or delivered, and when a transfer is legally effective. A smart contract can accept an ERC-20 transfer while the associated legal transfer is restricted, voidable, frozen, or denied recognition.

For Robyn:

- A basket-buying and reward-vault contract is technically supported and is close to use cases Robinhood documents.
- Robyn does not need to become an Authorised Participant merely to compose Stock Tokens already circulating on the secondary market.
- Robyn cannot mint Stock Tokens. Only an RHJ Authorised Participant may subscribe directly from the issuer after KYB onboarding.
- A contract address does not eliminate the restrictions applying to the entity controlling the contract or the people who beneficially receive the tokens.
- Sending Stock Tokens to arbitrary launch-token holders creates a direct risk of offering, selling, or delivering securities to a U.S. Person or other prohibited investor.
- The current no-geoblocking and no-eligibility-gate decision is therefore technically implementable but not aligned with the issuer's transfer restrictions for a permissionless Stock Token reward distribution.

## The three legal layers

| Layer | Main document | What it governs | Effect on Robyn |
|---|---|---|---|
| Network and developer services | [Robinhood Chain Terms of Service](https://docs.robinhood.com/chain/terms-of-service/) | Sequencer, public RPC, node snapshots, testnet, documentation, SDKs, APIs, and related services supplied by RHDA, LLC | Robyn and any operating entity using these services accept lawful-use, sanctions, identity, IP, risk, indemnity, and arbitration provisions |
| Permissionless chain | [About Robinhood Chain](https://docs.robinhood.com/chain/) | The public EVM network and third-party contracts | Anyone can interact, build applications, and deploy contracts; Robinhood says the chain itself and third-party applications are not part of its Services |
| Stock Token security | [RHJ Base Prospectus](https://cdn.robinhood.com/assets/robinhood/legal/rhj_base_prospectus.pdf), RHJ disclosures, and each asset's Final Terms | The legal debt security, its holder rights, issuance, transfers, selling restrictions, redemption, sanctions, and issuer powers | Each Stock Token transfer and beneficial holder remains subject to the securities terms even if an ERC-20 transaction succeeds |

## 1. Robinhood Chain Terms of Service

The [Robinhood Chain Terms](https://docs.robinhood.com/chain/terms-of-service/) are provided by RHDA, LLC and apply to both individuals and companies. If a person uses the Services for an entity, that person represents that they can bind the entity.

### What the agreement covers

The defined Services include:

- the Robinhood Chain sequencer;
- the public RPC;
- full-node snapshots;
- testnet;
- documentation, SDKs, APIs, tools and functionality made available through the Chain documentation site.

The terms expressly say that Robinhood Chain itself, its protocol contracts, bridging contracts, and third-party infrastructure are not part of the Services. Robinhood also says it does not control what third parties build on the chain or what users do there.

This distinction matters. Robinhood is not granting a special launchpad license or endorsing each deployed application. It is providing network-access and developer services around a permissionless chain while disclaiming responsibility for independent protocols.

### Eligibility and prohibited use

Users of the Services must:

- be at least 18 and legally capable;
- use them only where permitted by applicable law;
- not be sanctioned, located in a comprehensively sanctioned jurisdiction, or owned or controlled by such a person;
- not use a VPN, proxy, or similar tool to mask identity, location, or IP address;
- avoid unlawful activity, fraud, deception, IP violations, network abuse, bypassing technical limits, and false claims of Robinhood affiliation;
- conduct only transactions lawful in their jurisdiction;
- accept responsibility for their transactions, contracts, disclosures, and agreements.

The terms say the Services are to be used for lawful testing, experimentation, evaluation, and development. They do not publish a separate launchpad, DeFi protocol, or production-dApp approval process. Because the same documentation explicitly tells developers to ship contracts and lists production protocols, this appears intended to enable application development, but the wording does not clearly grant an unlimited right to operate every production business through Robinhood's hosted Services. A commercial launchpad should request written confirmation from the Chain team.

### Public RPC implications

Robinhood expressly says the public RPC:

- is rate limited;
- is not intended for production-grade, high-throughput, or latency-sensitive applications;
- has no uptime, availability, or data-completeness guarantee;
- may be throttled, suspended, changed, or discontinued without notice.

The terms prohibit automated tools when they interfere with, degrade, or circumvent service or network restrictions. That is not written as a blanket ban on ordinary dApp RPC traffic, but a client must not bypass rate limits or abuse the endpoint.

Robyn can still use the public RPC directly from individual browsers for ordinary reads and wallet broadcasts. It should be treated as a free best-effort path, not the only production dependency. Correctness-critical indexing, reward epochs, harvesting, monitoring, and transaction simulation need a separate production-capable provider or node.

### Other material terms

- Robinhood may restrict or block wallets and applications from the Services.
- It can change or discontinue Services without liability.
- The Services and blockchain data are provided as-is; users must verify data independently.
- Robinhood disclaims custody, fiduciary duties, and responsibility for third-party protocols.
- General liability is capped at $100.
- Users indemnify Robinhood for claims arising from their use, legal violations, third-party rights violations, or misconduct.
- Delaware law applies and the terms contain elective individual arbitration and a class waiver, with an opt-out procedure.
- The terms prohibit implying Robinhood endorsement or affiliation and restrict use of Robinhood materials, branding, and documentation in competing products.

That last point does not prohibit deploying an independent contract on the chain. It does mean Robyn should avoid Robinhood branding, copied interfaces or documentation, and any statement that Robinhood approves, backs, audits, or partners with the launchpad.

## 2. Robinhood explicitly supports Stock Token composability

The official [Stock Token overview](https://docs.robinhood.com/chain/stock-tokens/) says Stock Tokens are standard ERC-20s that can be held, transferred, and composed into onchain applications. It calls out programmable RWAs, normal wallet and library compatibility, live Chainlink feeds, and self-custody.

The [Building with Stock Tokens guide](https://docs.robinhood.com/chain/building-with-stock-tokens/) provides concrete approved examples:

- wallets and portfolio displays;
- RFQ trading interfaces;
- lending and borrowing markets;
- indices and baskets, including an example AI basket containing NVDA, MSFT, and GOOGL;
- yield strategies and vaults;
- price-aware contracts;
- perpetuals and derivatives;
- eligible-region applications providing U.S. equity exposure.

It shows ordinary `balanceOf`, `transfer`, and `approve` calls and instructs developers to display, swap, collateralize, or otherwise compose the tokens. Robinhood therefore anticipates contracts like a basket vault. Robyn's proposed fee router and reward vault are not prohibited as a technical pattern by the developer documentation.

The same guide qualifies “global access” with **in eligible regions**. Technical composability and legal eligibility are deliberately separate.

## 3. RHJ Stock Token product terms

Robinhood Assets (Jersey) Limited, or RHJ, issues the Stock Tokens. RHJ is a Jersey private company and states that the issuer itself is not regulated, although its base prospectus has received the relevant prospectus approval and Jersey consents. The approval is not an endorsement or prudential supervision.

Each asset is governed by:

- the [RHJ Base Prospectus dated 2026-06-30](https://cdn.robinhood.com/assets/robinhood/legal/rhj_base_prospectus.pdf);
- any prospectus supplements;
- that asset's Final Terms in the [RHJ disclosure library](https://robinhood.com/eu/en/legal/rhj/);
- the registration agreement embedded in the terms;
- current notices on the [RHJ issuer site](https://docs.robinhood.com/rhj/).

### What the Stock Token legally is

The Product is a tokenised debt security that tracks an underlying share or ETF. It does not give the holder ownership, voting rights, or other shareholder rights in the underlying company or fund. The holder instead has a limited-recourse claim against RHJ for the applicable redemption amount.

The blockchain smart contract is the securities ledger. RHJ says one block confirmation is currently sufficient for a legal transfer, but the Base Prospectus adds a crucial condition: a transfer is legally effective only when it transfers direct or indirect power of disposal from one natural or legal person to another **and** complies with the registration agreement and product terms.

### Issuance, secondary trading, and redemption

- Only an Authorised Participant may subscribe directly from RHJ after KYB onboarding. At launch, the only Authorised Participant named by Robinhood is BBVI.
- Developers are told to compose with existing secondary-market tokens, not mint them.
- The Base Prospectus calls the tokens freely transferable on the secondary market, including blockchain trading from another investor.
- “Freely transferable” does not remove selling restrictions. The same prospectus says investors must comply with those restrictions.
- Purchasing from or redeeming through an Authorised Participant involves that participant's KYC, appropriateness, and target-market processes.
- Direct redemption with RHJ, when available, requires issuer KYC and AML checks. A vault contract cannot itself satisfy those checks without an identified legal owner, controller, and beneficial owner structure.

### Prohibited investors and jurisdictions

Stock Tokens may not be offered, sold, delivered, pledged, or otherwise transferred:

- in the United States;
- to, for the account of, or for the benefit of a U.S. Person under Regulation S;
- to other Prohibited Investors.

The [current restricted-jurisdictions notice](https://docs.robinhood.com/rhj/restricted-jurisdictions/) also identifies Canada, the United Kingdom, and Switzerland as restricted and currently lists Cuba, Belarus, Iran, North Korea, Russia, Syria, Ukraine, South Sudan, Sudan, Myanmar, and Venezuela as Prohibited Investor jurisdictions. The detailed legal scope must be checked against the current prospectus and Final Terms before each release because the list can change.

The restrictions apply to beneficial owners, not just wallet addresses. RHJ may require an investor or beneficial owner to certify that they are not prohibited and provide substantiating information.

### Issuer enforcement powers

The token contracts and terms give RHJ, acting as tokenizer, powers to:

- pause all transfers;
- freeze products;
- block transfers to or from identified addresses;
- seize or transfer products to competent authorities;
- destroy tokens in specified circumstances;
- update, migrate, or replace the token contract or securities ledger;
- refuse to honor or deem null and void a prohibited transfer;
- withhold redemption or other payments;
- require investor and beneficial-owner certification.

The smart-contract infrastructure is designed to block known or reasonably suspected sanctioned addresses. A sanctions event may affect the investor, beneficial owner, intended counterparty, collateral, or the underlying asset.

Most importantly, the Base Prospectus says a Prohibited Investor has no rights under the Product, including no right to the redemption amount, and RHJ and the transaction parties have no obligation to that investor. An onchain balance is therefore not an unconditional legal claim.

## 4. Does Robinhood have special terms for launchpads?

No public Robinhood document located on 2026-07-20 creates a separate “launchpad operator,” “Stock Token protocol,” or “smart-contract integrator” license. The published structure is instead:

1. anyone may build and deploy on the permissionless chain;
2. the person or entity using Robinhood's hosted Chain Services accepts the Chain Terms;
3. every Stock Token investor, holder, beneficial owner, transfer, offer, sale, and delivery remains subject to RHJ's product terms;
4. any exchange, RFQ provider, Authorised Participant, wallet, RPC provider, or other integration adds its own terms and regulatory obligations.

This means a launchpad does not need Robinhood's technical approval merely to deploy an EVM contract. It may still need regulatory authorization, a lawful distribution model, upstream commercial agreements, and written clarification from RHJ or Robinhood depending on what it does with the securities.

## 5. How the rules apply to Robyn

### Fee vault buys Stock Tokens and keeps them

Technically supported. The contract can hold standard ERC-20 Stock Tokens. Legally, the operating entity, controller, beneficiaries, and economic structure still matter. If launch-token holders have a defined economic entitlement to the vault, they may be treated as beneficial owners or investors even before a claim. The public documents do not answer how RHJ will treat a permissionless vault with changing anonymous beneficiaries.

Result: possible, but obtain written RHJ and securities-counsel analysis before mainnet.

### Vault distributes Stock Tokens to holders

Technically supported by `transfer`. Legally, every claim is a delivery to a transferee and cannot be made to or for the benefit of a U.S. Person or other Prohibited Investor. A completely permissionless claim function cannot make that determination.

Result: this is the clearest conflict with the current no-eligibility-gate policy.

### Vault pays holders in WETH or USDG after selling the Stock Tokens

This avoids directly delivering Stock Tokens to every holder, but it does not automatically eliminate securities, derivatives, collective-investment, distribution, or beneficial-ownership analysis. Robyn would be selling Stock Tokens and distributing proceeds based on another token's ownership.

Result: potentially easier operationally, not automatically legally cleared.

### Launch token represents ownership or redemption rights in a basket

This starts to resemble a new basket security, fund interest, structured product, derivative, or collective-investment arrangement issued by Robyn. Robinhood's example of indices and baskets proves technical feasibility, not legal permission to issue such a product without authorization.

Result: materially higher regulatory burden than a discretionary, nonredeemable promotional reward.

### Launch token receives variable fee-funded rewards

This is the current recommended model, but using Stock Tokens as the actual reward asset still triggers transfer restrictions. Keeping the first mainnet version crypto-only avoids the RHJ distribution problem while the Stock Token model is clarified.

Result: crypto-only remains the cleaner first release.

## 6. Required diligence before using Stock Tokens

Send a written request to `chain-developers-group@robinhood.com` and `contact.rhj@robinhood.com` describing the exact flow and asking:

1. May an immutable smart contract be the onchain holder of RHJ Stock Tokens for a changing set of launch-token beneficiaries?
2. Who does RHJ regard as the Investor and beneficial owner when a contract holds the Products?
3. Does a pro-rata claim right make every launch-token holder a beneficial owner before claiming?
4. May the contract deliver Stock Tokens to self-custodied wallets without an eligibility attestation?
5. Does a launchpad or basket vault count as an offeror, distributor, market maker, collective investment undertaking, or other regulated intermediary under RHJ's distribution framework?
6. Are Stock Tokens permitted in holder-reward programs funded by trading fees?
7. Will RHJ provide an eligibility, sanctions, or transfer-control interface that contracts can check before transfer?
8. How should a smart contract respond if a token, address, transfer, or entire series is blocked, frozen, paused, migrated, seized, redeemed, or declared void?
9. May Robyn display Robinhood names, tickers, logos, issuer data, Chainlink data, and RHJ documents, and what attribution and trademark rules apply?
10. Is a separate integration, developer, data, API, distribution, or commercial agreement required?

## Recommended product decision

Proceed with Robinhood Chain and the launchpad architecture. Robinhood explicitly designed the chain and Stock Tokens for smart-contract composition.

Keep the production sequence:

1. testnet accounting proof with mock assets;
2. crypto-only permissionless launchpad and rewards;
3. written RHJ response and jurisdiction-specific legal analysis;
4. Stock Token beta only after deciding whether claims require eligibility controls or whether a different economic model avoids direct delivery;
5. audit and incident handling for issuer pause, block, seizure, multiplier, migration, and redemption events.

Do not treat the EVM transaction succeeding as proof that the legal transfer is valid. Do not market Robyn as affiliated with Robinhood. Do not call the Stock Tokens direct shares. Do not promise universal or U.S. access.

## Official sources

- [Robinhood Chain Terms of Service](https://docs.robinhood.com/chain/terms-of-service/)
- [About Robinhood Chain](https://docs.robinhood.com/chain/)
- [Deploy a smart contract](https://docs.robinhood.com/chain/deploy-smart-contracts/)
- [Stock Token overview](https://docs.robinhood.com/chain/stock-tokens/)
- [Building with Stock Tokens](https://docs.robinhood.com/chain/building-with-stock-tokens/)
- [RHJ issuer site](https://docs.robinhood.com/rhj/)
- [RHJ Product](https://docs.robinhood.com/rhj/product/)
- [RHJ FAQ](https://docs.robinhood.com/rhj/faq/)
- [RHJ Restricted Jurisdictions](https://docs.robinhood.com/rhj/restricted-jurisdictions/)
- [RHJ Use of Website](https://docs.robinhood.com/rhj/use-of-website/)
- [RHJ Base Prospectus](https://cdn.robinhood.com/assets/robinhood/legal/rhj_base_prospectus.pdf)
- [RHJ Disclosure Library and asset Final Terms](https://robinhood.com/eu/en/legal/rhj/)

