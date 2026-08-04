import type { Metadata } from "next";
import type { CSSProperties } from "react";
import styles from "./film-scenes.module.css";

export const metadata: Metadata = {
  title: "Sherwood Forest film scenes",
  robots: { index: false, follow: false },
};

const sceneNames = [
  "opening",
  "discover",
  "rewards",
  "launch",
  "graduate",
  "rdao",
  "close",
] as const;

type SceneName = (typeof sceneNames)[number];

function isScene(value: string | undefined): value is SceneName {
  return sceneNames.includes(value as SceneName);
}

export default async function FilmScenesPage({
  searchParams,
}: {
  searchParams: Promise<{ scene?: string }>;
}) {
  const query = await searchParams;
  const scene: SceneName = isScene(query.scene) ? query.scene : "opening";

  return (
    <main className={`${styles.stage} ${styles[scene]}`} data-film-scene={scene}>
      {/* Film capture is a fixed 1920x1080 canvas; bypass responsive image transforms. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className={styles.forest}
        src="/media/sherwood-sizzle-forest.webp"
        alt=""
      />
      <div className={styles.vignette} />
      <div className={styles.fireflies} aria-hidden="true">
        {Array.from({ length: 14 }, (_, index) => (
          <i key={index} style={{ "--i": index } as CSSProperties} />
        ))}
      </div>

      {scene === "opening" && (
        <section className={styles.centerScene}>
          <p className={styles.kicker}>WELCOME TO SHERWOOD FOREST</p>
          <h1>Every trade can grow more.</h1>
          <p>Markets become communities. Communities share the harvest.</p>
        </section>
      )}

      {scene === "discover" && (
        <section className={styles.splitScene}>
          <div>
            <p className={styles.kicker}>FIND YOUR CROWD</p>
            <h1>Follow the story.<br />Make your move.</h1>
          </div>
          <div className={styles.marketStack}>
            {[["CANOPY", "+704%"], ["SIGNAL", "+223%"], ["MOON", "+49%"]].map(([symbol, change]) => (
              <article key={symbol}>
                <span>${symbol}</span><strong>{change}</strong>
                <div><i /></div>
              </article>
            ))}
          </div>
        </section>
      )}

      {scene === "rewards" && (
        <section className={styles.centerScene}>
          <p className={styles.kicker}>THE MARKET GROWS A BASKET</p>
          <h1>Trade. Grow. Claim.</h1>
          <div className={styles.rewardFlow}>
            <span>EVERY TRADE</span><b>→</b><span>REWARD BASKET</span><b>→</b><span>YOUR CLAIM</span>
          </div>
          <div className={styles.assetRow}><i>GOOGL</i><i>NVDA</i><i>WETH</i></div>
        </section>
      )}

      {scene === "launch" && (
        <section className={styles.splitScene}>
          <div>
            <p className={styles.kicker}>YOUR IDEA. YOUR COMMUNITY.</p>
            <h1>Launch in minutes.</h1>
            <p className={styles.subline}>Name it. Style it. Choose the rewards.</p>
          </div>
          <div className={styles.launchCard}>
            <span>01</span><strong>Choose a name</strong>
            <span>02</span><strong>Build the look</strong>
            <span>03</span><strong>Pick the basket</strong>
            <button>PLANT YOUR TOKEN →</button>
          </div>
        </section>
      )}

      {scene === "graduate" && (
        <section className={styles.centerScene}>
          <p className={styles.kicker}>FROM SPARK TO OPEN MARKET</p>
          <h1>Build momentum.<br />Graduate.</h1>
          <div className={styles.progress}><i /></div>
          <div className={styles.locked}>◆ LIQUIDITY LOCKED FOR THE LONG HAUL</div>
        </section>
      )}

      {scene === "rdao" && (
        <section className={styles.splitScene}>
          <div>
            <p className={styles.kicker}>OWN A PIECE OF THE FOREST</p>
            <h1>Stake. Earn. Vote.</h1>
          </div>
          <div className={styles.rdaoOrb}><span>RDAO</span><small>THE FOREST&apos;S HEARTBEAT</small></div>
        </section>
      )}

      {scene === "close" && (
        <section className={styles.centerScene}>
          <p className={styles.kicker}>THE NEXT STORY STARTS HERE</p>
          <h1>Trade communities.<br /><em>Harvest what they grow.</em></h1>
          <div className={styles.closeActions}><b>EXPLORE MARKETS</b><b>LAUNCH YOUR TOKEN</b></div>
          <p className={styles.brand}>SHERWOOD FOREST</p>
        </section>
      )}
    </main>
  );
}
