"use client";

import { useState } from "react";
import { assetVerificationLabel } from "@/lib/reward-assets";

type TokenBasketAsset = {
  address: string;
  symbol: string;
  name: string;
  description: string;
  logoUrl: string | null;
  category: string;
  verification: string;
  weight: number;
};

function short(address: string) {
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

function BasketLogo({ asset }: { asset: TokenBasketAsset }) {
  const [failed, setFailed] = useState(false);
  if (asset.logoUrl && !failed) {
    return (
      // Catalog artwork is curated by Sherwood Forest and cannot be supplied by arbitrary contracts.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={asset.logoUrl}
        alt={`${asset.name} logo`}
        width={64}
        height={64}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span className="token-basket-identicon" aria-hidden="true">
      {asset.symbol.slice(0, 2)}
    </span>
  );
}

export function TokenBasketPreviewChips({
  assets,
  explorerUrl,
}: {
  assets: TokenBasketAsset[];
  explorerUrl: string;
}) {
  const [openAddress, setOpenAddress] = useState<string | null>(null);

  return (
    <div className="decision-basket" aria-label="Reward basket composition">
      {assets.map((asset) => {
        const previewId = `basket-preview-${asset.address.slice(2)}`;
        const isOpen = openAddress === asset.address;
        return (
          <div
            className={["basket-preview-anchor", isOpen ? "is-open" : ""]
              .filter(Boolean)
              .join(" ")}
            key={asset.address}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) {
                setOpenAddress(null);
              }
            }}
          >
            <button
              type="button"
              className="decision-basket-chip"
              aria-expanded={isOpen}
              aria-controls={previewId}
              onFocus={() => setOpenAddress(asset.address)}
              onClick={() => setOpenAddress(asset.address)}
            >
              <b>{asset.symbol}</b> {(asset.weight / 100).toFixed(0)}%
            </button>
            <article
              className="basket-preview-card"
              id={previewId}
              aria-label={`${asset.name} basket asset details`}
            >
              <BasketLogo asset={asset} />
              <div>
                <div className="basket-preview-heading">
                  <strong>{asset.symbol}</strong>
                  <span>{assetVerificationLabel(asset.verification)}</span>
                </div>
                <h3>{asset.name}</h3>
                <p>{asset.description}</p>
                <dl>
                  <div>
                    <dt>Weight</dt>
                    <dd>{(asset.weight / 100).toFixed(0)}%</dd>
                  </div>
                  <div>
                    <dt>Category</dt>
                    <dd>{asset.category.replaceAll("-", " ")}</dd>
                  </div>
                </dl>
                <a
                  href={`${explorerUrl}/address/${asset.address}`}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`View ${asset.name} contract ${asset.address}`}
                >
                  {short(asset.address)}
                </a>
              </div>
            </article>
          </div>
        );
      })}
    </div>
  );
}

export function TokenBasketAssets({
  assets,
  explorerUrl,
}: {
  assets: TokenBasketAsset[];
  explorerUrl: string;
}) {
  return (
    <div className="token-basket-assets">
      {assets.map((asset) => (
        <article key={asset.address}>
          <BasketLogo asset={asset} />
          <div className="token-basket-identity">
            <div>
              <h3>{asset.name}</h3>
              <strong>{asset.symbol}</strong>
              <b>{(asset.weight / 100).toFixed(0)}%</b>
            </div>
            <p>{asset.description}</p>
            <a
              href={`${explorerUrl}/address/${asset.address}`}
              target="_blank"
              rel="noreferrer"
              aria-label={`View ${asset.name} contract ${asset.address}`}
            >
              {short(asset.address)}
            </a>
          </div>
        </article>
      ))}
    </div>
  );
}
