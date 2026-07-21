# Launchpad terms, access, and creator-obligation comparison

Research date: 2026-07-20

This document compares the public terms and legal notices for the 13 launchpads in the Robyn UX study. It is product and integration research, not legal advice. Terms can change without notice, and the absence of a public terms page does not mean that a platform or activity is unrestricted.

## Method and evidence artifacts

Official terms, policies, issuer notices, and first-party product pages were preferred. Fresh anonymous browser sessions inspected homepage and subpage footers, menus, gates, and legal links without connecting a wallet, accepting terms, solving a CAPTCHA, or initiating a transaction.

The browser discovery evidence is preserved in [launchpad-legal-links.json](launchpad-legal-links.json). Text extracted from selected JavaScript-rendered terms and disclaimer pages is preserved in [dynamic-launchpad-terms.json](dynamic-launchpad-terms.json). The reproducible inspection scripts are [discover-launchpad-legal-links.mjs](../scripts/discover-launchpad-legal-links.mjs) and [inspect-dynamic-launchpad-terms.mjs](../scripts/inspect-dynamic-launchpad-terms.mjs).

These JSON files are point-in-time capture evidence, not authoritative legal documents. The live official source controls whenever it differs from a saved extract. Some captured page text contains source-site or browser-encoding artifacts; the findings below were checked against the rendered page or official indexed source before being documented.

## Executive findings

- The terms landscape is inconsistent. Pump.fun, Bags, Believe, BONKfun, DAOS.FUN, Zora, PinkSale, Virtuals, and hood.fun publish substantial terms. Four.meme publishes a trading disclaimer but no full platform terms were located. No public platform terms were located for Clanker or pons. SunPump has a coverage gap: SUN.io publishes general 2022 terms, but SunPump's current site does not clearly link a SunPump-specific agreement.
- DAOS.FUN expressly excludes users in the United States. The general SUN.io terms also exclude the United States, but their application to the current SunPump interface is unclear. None of the other reviewed agreements states a blanket United States exclusion, although all impose sanctions, lawful-use, or jurisdictional restrictions.
- Believe expressly prohibits VPN, proxy, and Tor use to evade geographic controls. Virtuals says it may detect VPN masking and apply geoblocking. Zora, Pump.fun, and others reserve broad rights to block or restrict interface access.
- Nearly every detailed agreement puts legality, taxes, wallet security, transaction finality, token risk, intellectual-property rights, and the truthfulness of creator statements on the user or creator.
- Zora provides the clearest warning for Robyn's marketing: creators may not promote future efforts in a way that creates an expectation of token profits. PinkSale and hood.fun expressly prohibit market manipulation, while Pump.fun puts securities, commodities, AML, KYC, and economic-representation duties on creators.
- Terms do not make tokenized stocks freely programmable in a legal or commercial sense. A smart contract may technically transfer a Stock Token, but issuer restrictions, sanctions, upstream interface terms, securities rules, liquidity-provider terms, and asset-level controls can still apply.

## Comparison matrix

| Platform | Public terms status | Eligibility and geography | Creator and conduct rules | Law and disputes | Robyn relevance |
|---|---|---|---|---|---|
| Pump.fun | Full terms; updated 2026-05-02 | Age of majority; lawful use; sanctions and specified high-risk countries; no blanket U.S. exclusion stated | Creator is responsible for token legality, taxes, IP, economic accuracy, and securities, commodities, AML and KYC compliance; manipulation and circumvention prohibited | British Virgin Islands law; binding individual arbitration and class waiver | Strong model for creator representations and fee-recipient disclaimers |
| Bags | Full terms; updated 2026-02-11 | 18+; capacity; not a restricted or sanctioned party; no blanket U.S. exclusion stated | Fraud, gambling, unlawful use, abuse and IP infringement prohibited; user controls keys and taxes | Delaware law; ICC arbitration in Los Angeles; class and jury waivers | Best adapter candidate, but public terms do not replace an integration or rewards agreement |
| Believe | Full terms; updated 2025-11-19 | Age of majority; long restricted-territory and sanctions list; citizens of restricted territories remain excluded; VPN/proxy/Tor evasion prohibited | Creator Tokens confer no equity, ownership, profit share or return; minter owns configuration, disclosures, legality and diligence | Cayman Islands law; CI-MAC arbitration in George Town; class waiver; 12-month claim period | Useful model for separating token utility from ownership or investment rights |
| BONKfun | Full terms; updated 2025-09-30 | 18+; no sanctioned or otherwise unlawful jurisdiction; no named country list or blanket U.S. exclusion | Wallet responsibility, lawful content and use; no custody, brokerage or advice; fees may change | British Virgin Islands law; binding arbitration | Useful interface/protocol and third-party DEX language |
| DAOS.FUN | Full terms; updated 2025-01-28 | 18+; expressly excludes the United States and many other countries and regions | Creators launch and manage DAOs, make content/IP representations, and accept platform review or removal; extreme loss warning | Delaware law; AAA individual arbitration; class waiver | Incompatible with a claim that the same interface is universally available |
| Clanker | No public platform terms located | Not publicly specified | Token pages show warnings and contract/fee information, but no comprehensive creator agreement was located | Not publicly specified | Major diligence gap before selecting it as an adapter |
| Zora | Full terms; updated 2026-05-15 | Majority-age framework, with limited parent/guardian provisions for minors; sanctions and lawful-use rules; no blanket U.S. exclusion | IP rights required; manipulation, wash trading, front-running, spoofing, pump-and-dumps and rug pulls prohibited; creators cannot induce profit expectations from future efforts | Delaware law; JAMS arbitration, 30-day postal opt-out, class waiver | Best precedent for creator marketing and anti-manipulation controls |
| Four.meme | Trading disclaimer located; no full platform terms located | Not stated in the public disclaimer | Users must assess risk and conduct their own research; no success or profitability warranty | Not stated | Disclaimer is helpful, but leaves operator, creator duties, privacy, liability and disputes unresolved |
| PinkSale | Full terms in official docs; no clear effective date visible | Age of majority; sanctions and lawful-use restrictions; no blanket U.S. exclusion stated | Fraud, misrepresentation, IP violations, market manipulation, unregistered offerings and other securities/derivatives violations prohibited | Binding arbitration and class waiver; governing forum was not identified in the accessible text reviewed | Strong prohibited-conduct and sophisticated-user language |
| SunPump | No clearly linked SunPump-specific terms; general SUN.io terms dated 2022-01-04 | General SUN.io agreement excludes Chinese Mainland, Taiwan, Hong Kong, United States and Singapore, plus sanctioned users | General noncustodial, lawful-use, risk and tax obligations | Binding arbitration and class waiver in the general SUN.io agreement | Coverage and freshness gap must be resolved before relying on SunPump as an upstream service |
| Virtuals | Full PDF terms; version dated 2025-09-24 | Age of majority; named restricted territories and sanctions; may geoblock and detect VPN masking; no blanket U.S. exclusion stated | Broad IP/content license and warranties; AML and source-of-funds review may be requested; third-party Dapp and self-custody risks | Panama law; individual binding arbitration and class waiver, subject to local law | Important precedent for third-party integration, content and compliance-reservation clauses |
| pons | No public platform terms located | Not publicly specified | Homepage says every transaction is wallet-submitted, noncustodial and irreversible, with volatility and total-loss risk; no complete creator rules located | Not publicly specified | Major diligence gap despite its promising fee-wallet design |
| hood.fun | Full terms; version 1 effective 2026-07-16 | Legal age; lawful jurisdiction; sanctions restrictions; no named country list or blanket U.S. exclusion | No issuer endorsement; securities, commodities, AML/CTF, sanctions evasion, IP violations, manipulation and wash trading prohibited; rewards are not interest, yield, dividends or promised profit | No governing-law or arbitration clause in version 1 | Closest terms precedent for holder rewards, but its dispute provisions are incomplete |

## Platform notes

### Pump.fun

[Pump.fun Terms and Conditions](https://pump.fun/docs/terms-and-conditions) identify Baton Corp., Bracket Ltd. and affiliates as the relevant Pump entities. Users must have legal capacity, comply with applicable law and avoid prohibited or high-risk countries and sanctioned parties. The country examples include Russia, Cuba, Iran, North Korea and Syria; the agreement does not state a blanket U.S. exclusion.

The terms are unusually relevant to Robyn because they address creator-fee sharing directly. Pump.fun says it does not control how downstream recipients use creator fees. The creator remains responsible for taxes, accurate descriptions of token economics, and compliance with securities, commodities, AML and KYC rules. Fraud, manipulation, proxy circumvention and infringement are prohibited. Disputes are governed by BVI law and individual arbitration with a class waiver.

### Bags

[Bags Terms](https://bags.fm/terms) are between the user and Bags Holdings, Inc. They require users to be at least 18, legally capable and not a restricted party. Bags is presented as noncustodial; users retain responsibility for private keys, taxes, digital-asset risks and lawful conduct. The public page prohibits unlawful use, fraud, gambling, abuse and IP infringement.

The agreement uses Delaware law and ICC arbitration seated in Los Angeles, with class and jury waivers. Its liability cap is generally the greater of $100 or direct payments made to Bags in the prior six months. The current page summarizes some fee and tax provisions and instructs users to contact support for the complete text of sections 12 through 18. Before Robyn depends on Bags, obtain the complete current agreement and written confirmation that a contract can be the creator-fee claimant and that the proposed holder-reward flow is permitted.

### Believe

[Believe Foundation Terms of Use](https://believe.app/terms) expressly separate the interface from the permissionless Solana protocol. Transactions are noncustodial and irreversible. Creator Tokens do not represent equity, ownership, profit sharing or entitlement to returns. The minter is responsible for configuration, disclosures, legal compliance and due diligence.

Restricted Persons include residents, entities and citizens of a long list of sanctioned territories, even when a citizen is physically elsewhere. The terms expressly prohibit VPNs, proxies or Tor used to evade geographic restrictions, and say IP, geolocation and wallet activity may be used for enforcement. Cayman Islands law applies, with CI-MAC arbitration in George Town, a class waiver and a 12-month claim limit. General liability is capped at $100.

### BONKfun

[BONKfun Terms of Service](https://www.letsbonk.fun/terms-of-service) describe a noncustodial front end to Solana and Raydium contracts, not a broker, custodian or adviser. Users must be 18 or older and may not use it from a sanctioned, restricted or otherwise unlawful jurisdiction. The agreement does not enumerate a comprehensive country list or state a blanket U.S. exclusion.

Users own wallet security and transaction risk; Raydium is a third party. Fees are disclosed before confirmation and may be changed. The agreement is governed by BVI law and requires binding arbitration.

### DAOS.FUN

[DAOS.FUN Terms of Service](https://www.daos.fun/terms-of-service) are with Tailwind Labs, Inc., a Delaware corporation. They warn that creating or trading tokens is not a legitimate investment strategy and that the vast majority of tokens lose value.

DAOS.FUN expressly lists the United States among prohibited jurisdictions, together with China Mainland, Panama, Cuba, Iran, North Korea, Syria, specified Ukrainian regions, Belarus, Russia and numerous others. Creators accept responsibility for DAO operation and content rights. The platform may review, restrict or remove tokens and may set launch, burn and DEX-transfer parameters. Delaware law and AAA individual arbitration apply; class proceedings are waived. The liability cap is generally the lesser of $100 or fees paid in the preceding 12 months.

### Clanker

No public platform terms, privacy policy or legal page was located through the [Clanker site](https://www.clanker.world/), its footer, menu or public token pages on 2026-07-20. Public pages do provide token-level warnings, external-link warnings and contract or fee disclosures.

That is not enough for an integration decision. Robyn would need the operator identity, age and geographic rules, sanctions position, creator warranties, fee rights, privacy terms, governing law, dispute process, indemnity and liability rules in writing.

### Zora

[Zora Terms of Service](https://support.zora.co/en/articles/6171073) are with Zora Labs, Inc. Zora says it is not a wallet provider, exchange, broker, dealer or financial institution and does not custody or execute token transactions. Token creation and transfers are final and may be immutable at the protocol level.

Creators must own or license submitted content. The agreement prohibits manipulation, wash trading, front-running, spoofing, pump-and-dumps and rug pulls. It also prohibits using a creator's potential future efforts to produce an expectation of profit in a token. That clause should directly shape Robyn's copy: market the transparent fee-routing mechanism, not a creator's promise to increase token value.

Zora applies sanctions and lawful-use restrictions, can block IP or device addresses, and does not state a blanket U.S. exclusion. Delaware law and JAMS arbitration apply, with a class waiver and a 30-day postal opt-out from arbitration.

### Four.meme

No full first-party platform terms were located on the [Four.meme site](https://four.meme/en) or its public token pages on 2026-07-20. A token page's apparent “Terms of Use” link belonged to an embedded third-party fiat provider, not Four.meme.

Four.meme does display a prominent disclaimer: digital assets and memecoins are speculative and may lose all value; success or profitability is not warranted; participation is not endorsement or a recommendation; and users must assess their own finances and risk and conduct their own research. This is a risk notice, not a substitute for a complete user or creator agreement.

### PinkSale

[PinkSale Terms of Service](https://docs.pinksale.finance/important/terms-of-service) describe a website interface to a decentralized, noncustodial protocol. Users must have legal capacity, not be sanctioned and comply with applicable law. The agreement does not state a blanket U.S. exclusion.

Prohibited activities include infringement, cyberattacks, fraud, false statements, rug pulls, pumping and dumping, wash trading, unregistered securities offerings and unlawful securities or derivatives activity. PinkSale states that it is not SEC-registered, does not solicit trades or give investment advice, and owes no fiduciary duty. It may share wallet and transaction data with blockchain analytics providers to prevent financial crime. The agreement includes arbitration and a class waiver, but the accessible text reviewed did not clearly identify the governing forum.

### SunPump

The current [SunPump site](https://sunpump.meme/) did not expose a SunPump-specific terms or privacy link in the reviewed anonymous session. SUN.io documentation identifies SunPump as a SUN.io module and publishes a [general SUN.io Terms of Use PDF](https://sun.io/docs/SUN_Terms_of_Use_en.pdf), last updated 2022-01-04.

The general agreement is for the sun.io interface, so it should not be assumed to govern every current SunPump surface without confirmation. It excludes users in Chinese Mainland, Taiwan, Hong Kong, the United States and Singapore, plus sanctioned users; it also contains noncustodial, risk, lawful-use, tax, arbitration and class-waiver provisions. The age and coverage of this document are material integration risks.

### Virtuals

[Virtuals Terms of Use](https://app.virtuals.io/terms_of_use.pdf) cover launchpad, swap, bridge, third-party Dapp and self-custodial interactions. Users must be adults and not fall within the named restricted territories or sanctions regimes. The list includes Malaysia, Iran, North Korea, Russia, certain occupied Ukrainian regions, Cuba, Yemen, Sudan, South Sudan, Libya, Lebanon and Syria; it does not state a blanket U.S. exclusion.

Virtuals may use geoblocking and detect VPN masking, and may request AML or source-of-funds evidence and suspend access when unsatisfied. Creator content carries broad licenses and rights warranties. Panama law and individual arbitration apply, subject to local law, with a class waiver.

### pons

No public platform terms, privacy policy or legal page was located on [pons](https://pons.money/) on 2026-07-20. Its homepage says the user's wallet submits every transaction, pons does not take custody, transactions are irreversible, tokens are volatile and may lose all value, and the product provides neither warranties nor financial advice.

Those warnings do not establish who operates the service, who may use it, the sanctions policy, creator duties, fee rights, data practices, liability, governing law or disputes. Obtain those items and test smart-contract fee recipients before using pons as a Robyn adapter.

### hood.fun

[hood.fun Terms](https://hood.fun/terms), version 1 effective 2026-07-16, separate the website interface from an immutable permissionless protocol. hood.fun does not custody assets, reverse transactions, issue or endorse user-created tokens, provide advice or act as a broker or fiduciary.

Users must be of legal age, act lawfully and not be sanctioned. The terms prohibit securities and commodities violations, money laundering, terrorist financing, sanctions evasion, infringement, manipulation, wash trading and impersonation. Community rewards are expressly not interest, yield, dividends or a promise of profit; they are variable and based on onchain trading activity. Fees are onchain and taxes remain the user's responsibility. Liability is capped at $100. Version 1 does not identify governing law or an arbitration forum.

## What Robyn's own terms need

Robyn should not copy a competitor's terms. Counsel should draft an agreement around the actual contracts, entity, jurisdictions and interface. At minimum it should cover:

1. **Operator and scope.** Legal entity, contact method, effective date, version history, covered websites and services, and which components are independent protocols or third parties.
2. **Interface versus contracts.** State what the interface can moderate or disable and what deployed permissionless contracts can continue doing. Do not promise that the operator can reverse an irreversible transaction.
3. **Eligibility.** Legal age and capacity, lawful use, sanctions, export controls and the user's responsibility for local law. The product can omit a blocking eligibility gate while still stating contractual restrictions.
4. **No endorsement.** User-created tokens, baskets and links are not issued, vetted, audited, endorsed or guaranteed by Robyn unless explicitly stated.
5. **Creator representations.** The creator owns or licenses names, images and content; metadata and economics are accurate; weights and fee shares are disclosed; the launch does not infringe rights, manipulate markets, mislead users or violate securities, commodities, AML, CTF, sanctions or consumer-protection rules.
6. **Accurate reward description.** A nonredeemable launch token does not own the basket. Rewards are variable, may be zero, and are not interest, dividends, yield, equity, a Stock Token, a share of the underlying company or a guaranteed return. Robinhood Stock Tokens are tokenized debt instruments, not wrapped shares.
7. **Basket mechanics.** Explain immutable weights, fee source, harvest timing, swaps, slippage, oracle checks, failed-asset fallback, retained WETH or USDG, epoch accounting, claim deadlines if any, and whether assets can ever be replaced.
8. **Fees and taxes.** Disclose launch, trading, swap, harvest, protocol and gas fees; who receives each fee; and that users and creators handle their own tax obligations.
9. **Third parties.** Wallets, public RPCs, Bags or another launchpad, Uniswap or 0x, Chainlink, bridges, indexers and asset issuers are independent dependencies with their own terms and failure modes.
10. **Risk and finality.** Smart-contract, oracle, bridge, liquidity, MEV, depeg, issuer-control, pause, upgrade, admin-burn, regulatory, volatility, total-loss and transaction-finality risks.
11. **Content and moderation.** Content license, takedown and IP process, interface delisting, prohibited impersonation and misleading ticker or company references.
12. **Standard contract provisions.** Privacy, warranties, liability limits, indemnity, termination, amendments, notices, governing law, arbitration or court forum, class waiver where enforceable, severability and survival.

## Effect of the current open-access decision

The current product decision is to assume users are non-U.S. and not add KYC, IP geoblocking, wallet denylists, eligibility attestations or onchain claim restrictions. Technically, launch, harvest and claim contracts can remain permissionless.

That decision does not make every use lawful and should not be phrased as universal eligibility. A sensible initial implementation is:

- display a non-blocking age, sanctions, lawful-use and local-law notice;
- require creators to accept stronger launch-specific representations before deployment;
- reserve the ability to hide content or restrict the hosted interface without suggesting that immutable contracts can be disabled;
- avoid collecting nationality or making an unsupported representation that every user is non-U.S.;
- do not attempt to contract around an upstream launchpad, liquidity venue or Stock Token issuer restriction;
- retain a documented extension point for future jurisdictional controls if counsel, an issuer or an integration requires them.

The sharpest conflict is DAOS.FUN, whose terms expressly exclude the United States. The general SUN.io terms do the same, although SunPump coverage is ambiguous. Believe and Virtuals also demonstrate that some operators expect active geographic-control enforcement. If Robyn uses any of these services or their interfaces, Robyn's policy does not override their terms.

## Adapter diligence checklist

Before choosing an upstream launchpad, obtain written answers to these questions:

- Can the creator-fee recipient be a smart contract rather than an externally owned wallet?
- Can that contract automatically swap creator fees into unrelated Stock Tokens and crypto assets?
- Can the resulting assets be distributed to launch-token holders without violating the platform's rewards, referral, anti-circumvention or securities provisions?
- Does the platform claim any license, control or ownership over the token, metadata, creator fees or reward stream?
- Which users, countries, assets and marketing claims are prohibited?
- Can the platform change the fee split, remove the token from its interface or terminate API access?
- Is there a separate developer, API, referral, rewards or commercial agreement not linked from the public terms?
- Who bears failed swaps, bad quotes, sanctions screening, taxes, IP complaints, exploits and holder claims?

For the current shortlist, Bags has the clearest published multiple-claimer mechanics, but its complete agreement and contract-recipient compatibility still need written confirmation and a live test. pons remains technically interesting but has the largest public legal-document gap. hood.fun supplies the closest holder-reward language but does not yet provide complete governing-law and dispute terms.

## Official sources

- [Pump.fun Terms and Conditions](https://pump.fun/docs/terms-and-conditions)
- [Bags Terms](https://bags.fm/terms)
- [Believe Foundation Terms of Use](https://believe.app/terms)
- [BONKfun Terms of Service](https://www.letsbonk.fun/terms-of-service)
- [DAOS.FUN Terms of Service](https://www.daos.fun/terms-of-service)
- [Clanker](https://www.clanker.world/)
- [Zora Terms of Service](https://support.zora.co/en/articles/6171073)
- [Four.meme](https://four.meme/en)
- [PinkSale Terms of Service](https://docs.pinksale.finance/important/terms-of-service)
- [SunPump](https://sunpump.meme/)
- [SUN.io Terms of Use PDF](https://sun.io/docs/SUN_Terms_of_Use_en.pdf)
- [Virtuals Terms of Use PDF](https://app.virtuals.io/terms_of_use.pdf)
- [pons](https://pons.money/)
- [hood.fun Terms](https://hood.fun/terms)
