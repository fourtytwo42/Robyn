import Link from "next/link";
import deployment from "@robyn/deployment";
import { SiteHeader } from "@/components/site-header";
import { publicEnvironment } from "@/lib/public-environment";

export const metadata = {
  title: "Security and accounting | Sherwood Forest",
  description:
    "A plain-English map of Sherwood Forest custody, fee accounting, controls, governance, and risk.",
};

const split = [
  ["50%", "Holder basket", "Acquires the launch’s selected reward assets."],
  ["25%", "Creator", "Accrues to the configured creator recipient."],
  ["20%", "RDAO staking", "Funds eligible stakers as WETH rewards."],
  ["5%", "Treasury", "Accrues to the governed protocol treasury."],
] as const;

function AddressLink({ label, address }: { label: string; address?: string }) {
  if (!address) return null;
  const short = `${address.slice(0, 8)}…${address.slice(-6)}`;
  return publicEnvironment.explorerUrl ? (
    <a
      href={`${publicEnvironment.explorerUrl}/address/${address}`}
      target="_blank"
      rel="noreferrer"
    >
      <span>{label}</span>
      <code>{short}</code>
    </a>
  ) : (
    <span>
      <span>{label}</span>
      <code>{short}</code>
    </span>
  );
}

export default function SecurityPage() {
  return (
    <main id="main" className="marketing-page security-page">
      <div className="ambient ambient-right" aria-hidden="true" />
      <SiteHeader />
      <section className="marketing-hero security-hero">
        <div>
          <p className="eyebrow">Security and accounting</p>
          <h1>Know what moves. Know what cannot.</h1>
          <p className="lede">
            Sherwood Forest records who each fee belongs to before attempting
            conversions or other maintenance. This page explains the boundaries
            without asking you to read Solidity first.
          </p>
          {publicEnvironment.isDevnet ? (
            <p className="fixture-note">
              This Devnet deployment is a testing fixture with no real-world
              value.
            </p>
          ) : null}
        </div>
        <aside className="security-promise">
          <span>Core accounting rule</span>
          <strong>
            Assign first.
            <br />
            Move second.
          </strong>
          <p>
            A failed helper task cannot silently reclassify another
            participant’s share.
          </p>
        </aside>
      </section>

      <section
        className="allocation-section"
        aria-labelledby="allocation-heading"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">Every applicable protocol fee</p>
            <h2 id="allocation-heading">One exact allocation.</h2>
          </div>
        </div>
        <div
          className="allocation-bar"
          aria-label="50 percent holder basket, 25 percent creator, 20 percent RDAO staking, 5 percent treasury"
        >
          {split.map(([amount, label]) => (
            <span key={label}>
              <strong>{amount}</strong>
              {label}
            </span>
          ))}
        </div>
        <div className="allocation-grid">
          {split.map(([amount, label, detail]) => (
            <article key={label}>
              <span>{amount}</span>
              <h3>{label}</h3>
              <p>{detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="security-explainers">
        <article>
          <p className="eyebrow">Per-launch custody</p>
          <h2>Rewards are bought before a claim.</h2>
          <p>
            Each launch tracks its own liabilities and basket assets. Claims
            transfer already acquired, vested assets. They do not sell the
            holder’s launch tokens and then shop for rewards at claim time.
          </p>
        </article>
        <article>
          <p className="eyebrow">Best-effort maintenance</p>
          <h2>The trade is the primary action.</h2>
          <p>
            A buy, sell, or claim may attempt one bounded maintenance task after
            succeeding. If that task fails, the completed user action stays
            completed and the attributed work remains pending for a later
            action.
          </p>
        </article>
        <article>
          <p className="eyebrow">Independent basket legs</p>
          <h2>One bad route does not freeze the basket.</h2>
          <p>
            Healthy legs continue independently. A leg can record objective
            route failures and, after the configured observation window, convert
            only its pending allocation into canonical WETH. Earlier rewards and
            future primary-route attempts do not change.
          </p>
        </article>
        <article>
          <p className="eyebrow">Pull withdrawals</p>
          <h2>You decide when to claim.</h2>
          <p>
            Holder, creator, staking, and treasury entitlements remain
            pull-based. Permissionless claim-for functions may help execution
            but can only pay the named beneficiary.
          </p>
        </article>
      </section>

      <section className="control-matrix" aria-labelledby="controls-heading">
        <div>
          <p className="eyebrow">Protocol boundaries</p>
          <h2 id="controls-heading">Controls are powerful, not unlimited.</h2>
        </div>
        <div className="control-columns">
          <article>
            <h3>Administrators can</h3>
            <ul>
              <li>Pause new launches and reward processing.</li>
              <li>Disable unhealthy routes and financial submission.</li>
              <li>Propose governed changes through the Timelock.</li>
              <li>Respond through the documented emergency authority.</li>
            </ul>
          </article>
          <article>
            <h3>Administrators cannot</h3>
            <ul>
              <li>Mint beyond a token’s fixed supply.</li>
              <li>Rewrite an existing launch’s basket weights.</li>
              <li>Remove permanently locked liquidity principal.</li>
              <li>Seize staked principal or erase accrued rewards.</li>
              <li>Redirect a permissionless claim-for payment.</li>
            </ul>
          </article>
        </div>
      </section>

      <section className="rdao-security">
        <div>
          <p className="eyebrow">RDAO</p>
          <h2>Sale, staking, and governance are separate jobs.</h2>
          <p>
            The fixed one-billion supply allocates 800m retained, 150m to the
            public bonding sale, and 50m to permanently locked RDAO/WETH
            liquidity. Staking has a 24-hour warm-up, pays variable WETH
            rewards, and does not create more votes. Governance uses 10% quorum,
            a four-hour vote, and a one-hour Timelock.
          </p>
        </div>
        <Link className="button ghost" href="/dao">
          Open RDAO workspace
        </Link>
      </section>

      <section className="risk-register">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Risk is not a footnote</p>
            <h2>What can still go wrong.</h2>
          </div>
        </div>
        <div className="risk-grid">
          {[
            "Smart-contract defects",
            "Thin or volatile markets",
            "Unavailable liquidity routes",
            "Stale or paused oracles",
            "RPC or indexer degradation",
            "Chain reorgs and outages",
            "Irreversible wallet transactions",
            "Governance concentration",
          ].map((risk) => (
            <span key={risk}>{risk}</span>
          ))}
        </div>
        <p>
          These controls reduce risk; they cannot promise safety, and the fee
          mechanics do not create a guarantee of rewards, liquidity, or profit.
        </p>
        <p>
          No projected APY, guaranteed return, guaranteed safety, independent
          audit, penetration test, or legal endorsement is claimed here.
        </p>
      </section>

      <section className="verification-panel">
        <div>
          <p className="eyebrow">Verify the running system</p>
          <h2>Addresses and source identity.</h2>
          <p>
            Schema {deployment.schemaVersion ?? "current"} · source{" "}
            <code>{deployment.gitCommit.slice(0, 12)}</code> · chain{" "}
            {deployment.chainId}
          </p>
        </div>
        <div className="address-grid">
          <AddressLink
            label="Launch factory"
            address={deployment.contracts.factory}
          />
          <AddressLink
            label="Fee router"
            address={deployment.contracts.protocolFeeRouter}
          />
          <AddressLink
            label="Maintenance"
            address={deployment.contracts.maintenanceCoordinator}
          />
          <AddressLink label="RDAO" address={deployment.contracts.daoToken} />
          <AddressLink
            label="RDAO staking"
            address={deployment.contracts.rdaoStaking}
          />
          <AddressLink
            label="Timelock"
            address={deployment.contracts.timelock}
          />
        </div>
        <div className="verification-links">
          <Link className="text-link" href="/whitepaper">
            Read the whitepaper →
          </Link>
          {publicEnvironment.isDevnet ? (
            <Link className="text-link" href="/admin/health">
              View Devnet health →
            </Link>
          ) : null}
        </div>
      </section>
    </main>
  );
}
