"use client";

import { useState } from "react";

type TokenBasketAsset = {
  address: string;
  symbol: string;
  name: string;
  description: string;
  logoUrl: string | null;
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
