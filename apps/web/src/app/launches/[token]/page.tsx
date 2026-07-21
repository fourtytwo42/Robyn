import Link from "next/link";
import { notFound } from "next/navigation";
import { LaunchRewardState } from "@/components/launch-reward-state";
import { SiteHeader } from "@/components/site-header";
import { getLaunch, getLaunchActivity } from "@/lib/data-api";
import { TokenArt } from "@/components/launchpad-visuals";

export const dynamic = "force-dynamic";

function AddressRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <code>{value}</code>
      </dd>
    </div>
  );
}

export default async function LaunchDetail({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const isTestnet = process.env.ROBYN_NETWORK_MODE === "testnet";
  if (!/^0x[0-9a-fA-F]{40}$/.test(token)) notFound();
  let detail;
  let activity;
  try {
    [detail, activity] = await Promise.all([
      getLaunch(token),
      getLaunchActivity(token),
    ]);
  } catch {
    notFound();
  }
  const launch = detail.data;

  return (
    <main id="main">
      <div className="ambient ambient-right" aria-hidden="true" />
      <SiteHeader />
      <section className="page-shell">
        <header className="detail-hero">
          <TokenArt
            symbol={launch.symbol}
            className="detail-token-art"
            priority
          />
          <div>
            <p className="eyebrow">Canonical launch #{launch.launch_id}</p>
            <h1>
              {launch.name} <span>{launch.symbol}</span>
            </h1>
            <code className="full-address">{launch.token}</code>
          </div>
          <span className="risk-badge">
            Experimental ·{" "}
            {isTestnet
              ? "Robinhood testnet mocks"
              : "controlled development network"}
          </span>
        </header>

        <div className="detail-grid">
          <section className="detail-card" aria-labelledby="market-heading">
            <p className="card-label">Market</p>
            <h2 id="market-heading">Fixed-price development market</h2>
            <p>
              Trading and reward claiming are operationally separate. The live
              console revalidates chain {isTestnet ? "46630" : "31337"} and
              transaction targets before submitting.
            </p>
            <dl className="address-list">
              <AddressRow label="Market" value={launch.market} />
              <AddressRow label="Creator" value={launch.creator} />
              <AddressRow label="Token" value={launch.token} />
            </dl>
            <div className="action-row">
              <Link
                className="button primary"
                href={isTestnet ? "/#testnet-console" : "/#devnet-console"}
              >
                Open live trading console
              </Link>
              <Link className="button" href="/portfolio">
                View portfolio
              </Link>
            </div>
          </section>

          <section
            className="detail-card basket-detail"
            aria-labelledby="basket-heading"
          >
            <p className="card-label">Immutable reward basket</p>
            <h2 id="basket-heading">What holders earn</h2>
            <LaunchRewardState
              vault={launch.vault}
              indexedBlock={detail.asOfBlock}
              detailed
            />
          </section>
        </div>

        <section
          className="verification-card"
          aria-labelledby="verification-heading"
        >
          <div>
            <p className="card-label">Verify independently</p>
            <h2 id="verification-heading">Contracts and indexed provenance</h2>
          </div>
          <dl className="address-list verification-list">
            <AddressRow label="Launch token" value={launch.token} />
            <AddressRow label="Reward vault" value={launch.vault} />
            <AddressRow label="Market" value={launch.market} />
            <AddressRow label="Creator wallet" value={launch.creator} />
            <AddressRow
              label="Formula version"
              value={launch.formula_version}
            />
            <AddressRow label="Created block" value={launch.created_block} />
            <AddressRow
              label="Indexed through"
              value={detail.asOfBlock ?? "unavailable"}
            />
          </dl>
        </section>

        <section className="activity-card" aria-labelledby="activity-heading">
          <div className="section-heading">
            <div>
              <p className="card-label">Protocol activity</p>
              <h2 id="activity-heading">Canonical logs</h2>
            </div>
            <span className="live-chip">
              {Math.min(activity.data.length, 20)} shown
              {activity.data.length > 20
                ? " of " + activity.data.length + " recent events"
                : " recent events"}
            </span>
          </div>
          {activity.data.length === 0 ? (
            <p className="empty-state">No indexed activity is available.</p>
          ) : (
            <ol className="activity-list">
              {activity.data.slice(0, 20).map((event) => (
                <li key={event.transaction_hash + ":" + event.log_index}>
                  <span>Block {event.block_number}</span>
                  <code>{event.transaction_hash}</code>
                  <small>
                    Contract {event.address} · topic{" "}
                    {event.topics[0] ?? "unavailable"}
                  </small>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="notice" aria-label="Reward disclosure">
          This launch token is not redeemable for the basket. Rewards shown are
          funded only by mock market fees, and all displayed assets have no
          real-world value.
        </section>
      </section>
    </main>
  );
}
