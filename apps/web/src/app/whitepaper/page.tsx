import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";

import "./whitepaper.css";

export const metadata: Metadata = {
  title: "Whitepaper | Sherwood Forest",
  description:
    "How Sherwood Forest launches tokens, grows reward baskets, graduates liquidity, distributes fees, and governs the protocol.",
};

const chapters = [
  ["01", "The compact", "compact"],
  ["02", "Token lifecycle", "lifecycle"],
  ["03", "Fee economy", "fees"],
  ["04", "Rewards", "rewards"],
  ["05", "RDAO", "governance"],
  ["06", "Trust model", "security"],
] as const;

const feeRows = [
  {
    share: "50%",
    label: "Holder basket",
    copy: "Converted into the launch’s immutable mix of reward assets and credited to eligible token holders.",
    className: "basket",
  },
  {
    share: "25%",
    label: "Token creator",
    copy: "Accrued in native ETH per created token and claimed by its canonical creator.",
    className: "creator",
  },
  {
    share: "20%",
    label: "RDAO members",
    copy: "Accrued in native ETH to eligible RDAO holders through transfer-aware accounting.",
    className: "members",
  },
  {
    share: "5%",
    label: "DAO treasury",
    copy: "Sent to the governance timelock for approved protocol work and contributor grants.",
    className: "treasury",
  },
] as const;

export default function WhitepaperPage() {
  return (
    <main id="main" className="whitepaper">
      <div className="ambient ambient-left" aria-hidden="true" />
      <div className="ambient ambient-right" aria-hidden="true" />
      <SiteHeader />

      <article>
        <header className="whitepaper-hero">
          <div className="whitepaper-hero-copy">
            <p className="eyebrow">The Sherwood Compact · living whitepaper</p>
            <h1>A fairer market, grown together.</h1>
            <p className="whitepaper-deck">
              Sherwood Forest is a permissionless token launchpad where every
              token carries an immutable reward basket. Trading activity grows
              that basket, creators share in what they build, and the wider
              community governs the forest through RDAO.
            </p>
            <div className="whitepaper-status">
              <span>Robinhood Chain Testnet</span>
              <span>Native ETH markets</span>
              <span>Uniswap v4 graduation</span>
            </div>
          </div>
          <div className="whitepaper-hero-art" aria-hidden="true">
            <Image
              src="/assets/whitepaper/sherwood-journey.webp"
              alt=""
              width={1774}
              height={887}
              priority
            />
          </div>
          <p className="whitepaper-caption">
            Plant a token. Gather a band. Grow its market. Lock the common
            ground. Return value to the people holding the token.
          </p>
        </header>

        <nav className="chapter-trail" aria-label="Whitepaper chapters">
          {chapters.map(([number, label, id]) => (
            <a href={`#${id}`} key={id}>
              <span>{number}</span>
              {label}
            </a>
          ))}
        </nav>

        <section id="compact" className="paper-section compact-section">
          <div className="paper-heading">
            <p className="eyebrow">01 · The compact</p>
            <h2>What Sherwood promises</h2>
            <p>
              The Robin Hood story is our organizing metaphor: open access,
              strength through a band of participants, and market value routed
              back toward the community creating it. The contracts—not a
              character, company promise, or hidden operator—define the terms.
            </p>
          </div>
          <div className="compact-grid">
            <article>
              <span className="compact-rune">↗</span>
              <h3>Anyone may plant</h3>
              <p>
                A wallet chooses a name, symbol, immutable metadata, and up to
                three supported basket assets. No token-launch allocation or
                creator pre-mint is hidden from buyers.
              </p>
            </article>
            <article>
              <span className="compact-rune">⌘</span>
              <h3>The rules take root</h3>
              <p>
                Supply, creator identity, basket weights, fee policy, and
                metadata are fixed at launch. Existing promises cannot be
                rewritten by governance.
              </p>
            </article>
            <article>
              <span className="compact-rune">♧</span>
              <h3>Activity grows rewards</h3>
              <p>
                Protocol fees are measured onchain, split under one permanent
                policy, converted through bounded routes, and claimed by the
                wallets entitled to them.
              </p>
            </article>
          </div>
        </section>

        <section id="lifecycle" className="paper-section">
          <div className="paper-heading">
            <p className="eyebrow">02 · From seed to open market</p>
            <h2>The token lifecycle</h2>
          </div>
          <ol className="lifecycle-path">
            <li>
              <span>1</span>
              <div>
                <p className="trail-kicker">Plant</p>
                <h3>One atomic launch</h3>
                <p>
                  A single creator transaction deploys the fixed-supply token
                  and basket vault, creates its bonding market, initializes the
                  future v4 pool, seeds the full inventory, seals reward
                  exclusions, and emits the canonical launch identity. If any
                  step fails, all of it reverts.
                </p>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <p className="trail-kicker">Gather</p>
                <h3>Price discovery on the curve</h3>
                <p>
                  Buyers and sellers trade against deterministic virtual
                  reserves. The constant-product curve moves price as inventory
                  changes. One billion tokens exist: 800 million are allocated
                  to the curve and 200 million to graduation liquidity.
                </p>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <p className="trail-kicker">Graduate</p>
                <h3>Liquidity becomes common ground</h3>
                <p>
                  When curve inventory is exhausted, the reserved tokens and
                  accumulated native ETH move into the pool initialized at
                  launch. Its position NFT and principal liquidity are locked;
                  the interface continues routing trades through the open v4
                  market.
                </p>
              </div>
            </li>
            <li>
              <span>4</span>
              <div>
                <p className="trail-kicker">Harvest</p>
                <h3>Fees become claimable assets</h3>
                <p>
                  Keepers settle bounded work without custody. Basket assets,
                  creator ETH, RDAO ETH, and treasury ETH accrue independently.
                  Users pull what they have earned instead of depending on a
                  push payment.
                </p>
              </div>
            </li>
          </ol>

          <div className="atomic-map" aria-label="Atomic launch architecture">
            <div>
              <span>Wallet</span>
              <strong>Launch request</strong>
            </div>
            <i aria-hidden="true">→</i>
            <div>
              <span>Coordinator</span>
              <strong>All or nothing</strong>
            </div>
            <i aria-hidden="true">→</i>
            <div>
              <span>Token + vault</span>
              <strong>Immutable roots</strong>
            </div>
            <i aria-hidden="true">→</i>
            <div>
              <span>Curve + v4 pool</span>
              <strong>Continuous market</strong>
            </div>
          </div>
        </section>

        <section className="paper-section tokenomics-section">
          <div className="paper-heading">
            <p className="eyebrow">Supply · curve · liquidity</p>
            <h2>Launch-token economics</h2>
            <p>
              Every launch uses the same fixed-supply structure. Creators choose
              the token’s identity and reward basket, not a private supply
              schedule.
            </p>
          </div>
          <div className="tokenomics-layout">
            <div className="supply-orbit" aria-label="One billion token supply">
              <div className="supply-orbit-inner">
                <strong>1B</strong>
                <span>fixed supply</span>
              </div>
              <span className="orbit-label curve-label">80% curve</span>
              <span className="orbit-label pool-label">20% liquidity</span>
            </div>
            <dl className="economics-list">
              <div>
                <dt>Curve allocation</dt>
                <dd>800,000,000 tokens</dd>
              </div>
              <div>
                <dt>Graduation allocation</dt>
                <dd>200,000,000 tokens</dd>
              </div>
              <div>
                <dt>Creator token allocation</dt>
                <dd>0 hidden tokens</dd>
              </div>
              <div>
                <dt>Bonding fee</dt>
                <dd>1% of each trade</dd>
              </div>
              <div>
                <dt>Mainnet policy candidate</dt>
                <dd>6 ETH net graduation</dd>
              </div>
              <div>
                <dt>Mainnet terminal FDV</dt>
                <dd>27.5 ETH</dd>
              </div>
            </dl>
          </div>
          <div className="status-note">
            <strong>Environment matters.</strong>
            <p>
              Testnet deliberately uses tiny values so the full lifecycle can be
              exercised. The accepted chain-4663 candidate is 6 ETH net,
              approximately 6.0606 ETH of gross buy demand before offsetting
              sells, and a 0.5 ETH maximum individual curve buy. It is a
              reviewed configuration decision—not a deployed mainnet claim.
            </p>
          </div>
        </section>

        <section id="fees" className="paper-section fee-section">
          <div className="paper-heading">
            <p className="eyebrow">03 · Follow every leaf</p>
            <h2>One fee policy, four destinations</h2>
            <p>
              Every fee Sherwood receives is attributed to its source token and
              conserved through the same immutable split.
            </p>
          </div>

          <div
            className="fee-canopy"
            role="img"
            aria-label="Fee distribution: 50 percent holder basket, 25 percent creator, 20 percent RDAO members, 5 percent treasury"
          >
            <div className="fee-bar">
              {feeRows.map((row) => (
                <span
                  className={row.className}
                  style={{ width: row.share }}
                  key={row.label}
                >
                  {row.share}
                </span>
              ))}
            </div>
            <div className="fee-legend">
              {feeRows.map((row) => (
                <article key={row.label}>
                  <span className={`fee-swatch ${row.className}`} />
                  <div>
                    <strong>
                      {row.share} · {row.label}
                    </strong>
                    <p>{row.copy}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div className="fee-source-grid">
            <article>
              <p className="trail-kicker">Before graduation</p>
              <h3>1% bonding reward fee</h3>
              <p>
                Collected directly by the bonding market and routed without
                waiting for graduation.
              </p>
            </article>
            <article>
              <p className="trail-kicker">After graduation</p>
              <h3>1% Sherwood reward fee</h3>
              <p>
                Schema v9’s v4 hook charges every Sherwood-pool swap regardless
                of router or liquidity provider. It is additional to the pool’s
                LP fee and cannot be diluted by third-party liquidity.
              </p>
              <span className="development-badge">
                Schema v9 · testnet validation in progress
              </span>
            </article>
            <article>
              <p className="trail-kicker">Locked position</p>
              <h3>Its share of the 1% LP fee</h3>
              <p>
                Sherwood also routes fees earned by its permanently locked
                position. Other liquidity providers retain the LP fees earned by
                their own positions.
              </p>
            </article>
          </div>
          <p className="fine-print">
            Post-graduation nominal fees are approximately 2%: a 1% Uniswap LP
            fee plus an additional 1% Sherwood reward fee. Exact effective cost
            varies slightly by swap direction, rounding, and price impact. The
            interface shows minimum received or maximum paid before signing.
          </p>
        </section>

        <section id="rewards" className="paper-section">
          <div className="paper-heading">
            <p className="eyebrow">04 · The reward roots</p>
            <h2>How basket rewards reach holders</h2>
          </div>
          <div className="reward-river">
            <article>
              <span>1</span>
              <h3>Fees arrive</h3>
              <p>
                Half of attributed protocol revenue enters the token’s vault.
              </p>
            </article>
            <article>
              <span>2</span>
              <h3>Weights divide it</h3>
              <p>
                The vault assigns pending value across one to three immutable
                basket legs totaling exactly 100%.
              </p>
            </article>
            <article>
              <span>3</span>
              <h3>Routes convert it</h3>
              <p>
                Permissionless keepers use approved, liquidity-checked routes
                with deadlines, slippage bounds, and measured balance changes.
              </p>
            </article>
            <article>
              <span>4</span>
              <h3>Holders claim it</h3>
              <p>
                Transfer-aware accounting preserves earned rewards for sellers
                and prevents new buyers from taking earlier distributions.
              </p>
            </article>
          </div>
          <div className="claim-callout">
            <div>
              <p className="eyebrow">Pull, don’t push</p>
              <h3>Rewards accrue continuously; claiming is intentional.</h3>
            </div>
            <p>
              Holders claim basket assets from a token page or Portfolio.
              Creators claim each token’s ETH separately from that token page or
              claim several owned launches from Portfolio. RDAO members claim
              their native ETH from the DAO workspace.
            </p>
          </div>
        </section>

        <section id="governance" className="paper-section governance-section">
          <div className="paper-heading">
            <p className="eyebrow">05 · The council beneath the oak</p>
            <h2>RDAO governance and rewards</h2>
            <p>
              RDAO is a transferable, fixed-supply governance and reward token.
              Token balance determines future native-reward weight; delegated
              timestamp checkpoints determine voting power.
            </p>
          </div>
          <div className="governance-layout">
            <div
              className="rdao-seal"
              aria-label="One billion fixed RDAO supply"
            >
              <span>RDAO</span>
              <strong>1,000,000,000</strong>
              <small>fixed forever · no mint function</small>
            </div>
            <div className="governance-columns">
              <article>
                <h3>The DAO may govern</h3>
                <ul>
                  <li>Treasury spending and contributor grants</li>
                  <li>Supported assets for future launches</li>
                  <li>Approved conversion venues and safety limits</li>
                  <li>Enrollment of reviewed future factory versions</li>
                </ul>
              </article>
              <article>
                <h3>The DAO may not rewrite</h3>
                <ul>
                  <li>An existing token’s basket or creator</li>
                  <li>Its promised fee percentages</li>
                  <li>Locked liquidity principal</li>
                  <li>Historical rewards or completed votes</li>
                </ul>
              </article>
            </div>
          </div>
          <dl className="governance-parameters">
            <div>
              <dt>Mainnet voting delay</dt>
              <dd>1 day</dd>
            </div>
            <div>
              <dt>Voting period</dt>
              <dd>3 days</dd>
            </div>
            <div>
              <dt>Execution timelock</dt>
              <dd>2 days</dd>
            </div>
            <div>
              <dt>Quorum</dt>
              <dd>10%</dd>
            </div>
            <div>
              <dt>Proposal threshold</dt>
              <dd>1%</dd>
            </div>
          </dl>
          <p className="fine-print">
            Testnet uses deliberately shortened governance timing for end-to-end
            testing. Initial testnet RDAO is held by the project wallet. Mainnet
            allocation and contributor vesting must be published and reviewed
            before distribution.
          </p>
        </section>

        <section className="paper-section metadata-section">
          <div className="paper-heading">
            <p className="eyebrow">Identity that survives the interface</p>
            <h2>Immutable metadata and artwork</h2>
          </div>
          <div className="metadata-flow">
            <div>
              <strong>Sanitize</strong>
              <span>Decode, crop, strip metadata, derive PNG + WebP</span>
            </div>
            <i>→</i>
            <div>
              <strong>Address</strong>
              <span>Pin deterministic bytes to local IPFS by CID</span>
            </div>
            <i>→</i>
            <div>
              <strong>Commit</strong>
              <span>ERC-1046 tokenURI fixed in CREATE2 launch identity</span>
            </div>
          </div>
          <p>
            Robyn-sanitized metadata is distinguished from externally supplied
            IPFS metadata. Quarantine can change what Sherwood renders, but it
            cannot pretend that already published public IPFS content was
            deleted or mutate the token’s onchain URI.
          </p>
        </section>

        <section id="security" className="paper-section security-section">
          <div className="paper-heading">
            <p className="eyebrow">06 · Trust as little as possible</p>
            <h2>Security model</h2>
            <p>
              Sherwood is designed around constrained components, immutable
              launch promises, pull payments, measured accounting, and
              fail-closed integration checks.
            </p>
          </div>
          <div className="security-grid">
            <article>
              <h3>Atomic creation</h3>
              <p>
                No half-launched token, unseeded market, or unsealed exclusions.
              </p>
            </article>
            <article>
              <h3>Locked principal</h3>
              <p>
                The graduation position cannot approve, transfer, or reduce
                liquidity.
              </p>
            </article>
            <article>
              <h3>Bounded conversion</h3>
              <p>
                TWAP, deviation, impact, deadline, route, and amount checks fail
                closed.
              </p>
            </article>
            <article>
              <h3>Solvent liabilities</h3>
              <p>
                Creator, holder, RDAO, treasury, and vault balances reconcile
                independently.
              </p>
            </article>
            <article>
              <h3>Limited guardian</h3>
              <p>
                Pause and cancellation powers cannot seize treasury assets or
                rewrite votes.
              </p>
            </article>
            <article>
              <h3>Versioned evolution</h3>
              <p>
                Material changes require fresh contracts, manifests, testing,
                and governance enrollment.
              </p>
            </article>
          </div>
        </section>

        <section className="paper-section disclosure-section">
          <div>
            <p className="eyebrow">Read before entering the forest</p>
            <h2>Risks and current status</h2>
          </div>
          <div>
            <p>
              Sherwood Forest is currently a Robinhood Chain Testnet
              application. Faucet stocks and Robyn mocks have no real-world
              value, backing, redemption rights, or claim to official Stock
              Token status. Local IPFS pinning has no remote redundancy yet.
            </p>
            <p>
              Smart contracts, bonding curves, token prices, reward conversion,
              governance, wallets, RPC services, hooks, and liquidity markets
              carry technical and economic risk. A fixed fee policy does not
              guarantee profit, reward value, liquidity, basket availability, or
              successful graduation.
            </p>
            <p>
              Mainnet remains blocked on a separate deployment review,
              production asset and venue verification, legal and tax review,
              independent professional contract audit, external penetration
              testing, recovery validation, and real-wallet acceptance.
            </p>
          </div>
        </section>

        <footer className="whitepaper-footer">
          <div>
            <p className="eyebrow">Join the band on testnet</p>
            <h2>Explore the living protocol.</h2>
          </div>
          <div>
            <Link className="button primary" href="/discover">
              Explore markets
            </Link>
            <a
              className="button ghost"
              href="https://docs.robinhood.com/chain/"
              target="_blank"
              rel="noreferrer"
            >
              Robinhood Chain docs
            </a>
          </div>
        </footer>
      </article>
    </main>
  );
}
