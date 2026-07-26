"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Address } from "viem";
import { publicEnvironment } from "@/lib/public-environment";
import {
  compareBasketAssets,
  type BasketAssetVerification,
} from "@/lib/basket-asset-order";

export type BasketAsset = {
  chainId: number;
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
  totalSupply: string;
  category: "stock" | "etf-commodity" | "crypto" | "custom";
  logoUrl: string | null;
  verification: BasketAssetVerification;
  mockOnly: boolean;
  disclosure: string | null;
  mainnetAddress: Address | null;
  referencePriceUsd: string | null;
  referencePriceAt: string | null;
  route: {
    kind: "none" | "fixed-testnet" | "uniswap-v3" | "uniswap-v4";
    ready: boolean;
    venue: Address | null;
    poolFee: number | null;
    liquidity: string | null;
    reason: string | null;
  };
};

type AssetResponse = {
  data: BasketAsset[];
  catalog?: { disclosure?: string | null };
};

function shortAddress(address: string) {
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

function verificationLabel(asset: BasketAsset) {
  if (asset.verification === "robinhood-testnet-faucet-stock")
    return "Robinhood faucet stock";
  if (asset.verification === "official-robinhood-current-chain")
    return "Official on this chain";
  if (asset.verification === "robyn-testnet-mock") return "Robyn testnet mock";
  if (asset.verification === "robyn-controlled-testnet-dex")
    return "Robyn test DEX";
  if (asset.verification === "robyn-token-list") return "Robyn verified";
  return "Unverified ERC-20";
}

function AssetLogo({ asset }: { asset: BasketAsset }) {
  const [failed, setFailed] = useState(false);
  if (asset.logoUrl && !failed) {
    return (
      // Curated URLs are supplied by the server catalog; arbitrary contracts cannot set this value.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={asset.logoUrl}
        alt=""
        width={42}
        height={42}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span className="asset-identicon" aria-hidden="true">
      {asset.symbol.slice(0, 2)}
    </span>
  );
}

export function BasketAssetPicker({
  selected,
  weights,
  onChange,
}: {
  selected: BasketAsset[];
  weights: number[];
  onChange: (assets: BasketAsset[], weights: number[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState<BasketAsset[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [customAddress, setCustomAddress] = useState("");
  const [customAsset, setCustomAsset] = useState<BasketAsset>();
  const [message, setMessage] = useState(
    "Choose up to three assets with funded conversion routes.",
  );
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      event.stopPropagation();
      const focusable = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      previouslyFocused?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open || catalog.length > 0) return;
    setLoading(true);
    void fetch("/api/assets")
      .then(async (response) => {
        if (!response.ok) throw new Error("Asset catalog is unavailable.");
        return (await response.json()) as AssetResponse;
      })
      .then((body) => {
        setCatalog(body.data);
        if (body.catalog?.disclosure) setMessage(body.catalog.disclosure);
      })
      .catch((error) =>
        setMessage(
          error instanceof Error
            ? error.message
            : "Asset catalog is unavailable.",
        ),
      )
      .finally(() => setLoading(false));
  }, [catalog.length, open]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return catalog
      .filter(
        (asset) =>
          (category === "all" || asset.category === category) &&
          (!needle ||
            asset.name.toLowerCase().includes(needle) ||
            asset.symbol.toLowerCase().includes(needle) ||
            asset.address.toLowerCase().includes(needle)),
      )
      .sort(compareBasketAssets);
  }, [catalog, category, query]);

  function evenly(count: number) {
    const base = Math.floor(100 / count);
    return Array.from(
      { length: count },
      (_, index) => base + (index === 0 ? 100 - base * count : 0),
    );
  }

  function add(asset: BasketAsset) {
    if (!asset.route.ready)
      return setMessage(
        `No funded conversion route: ${asset.route.reason ?? "unavailable"}.`,
      );
    if (
      selected.some(
        (item) => item.address.toLowerCase() === asset.address.toLowerCase(),
      )
    ) {
      return setMessage(`${asset.symbol} is already in this basket.`);
    }
    if (selected.length >= 3)
      return setMessage(
        "Remove an asset before adding another. Baskets are limited to three assets.",
      );
    const next = [...selected, asset];
    onChange(next, evenly(next.length));
    setOpen(false);
    setMessage(
      `${asset.symbol} added. Review the immutable weight before launch.`,
    );
  }

  function remove(index: number) {
    const next = selected.filter((_, offset) => offset !== index);
    onChange(next, next.length ? evenly(next.length) : []);
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= selected.length) return;
    const nextAssets = [...selected];
    const nextWeights = [...weights];
    [nextAssets[index], nextAssets[target]] = [
      nextAssets[target]!,
      nextAssets[index]!,
    ];
    [nextWeights[index], nextWeights[target]] = [
      nextWeights[target]!,
      nextWeights[index]!,
    ];
    onChange(nextAssets, nextWeights);
  }

  async function resolveCustom() {
    setLoading(true);
    setCustomAsset(undefined);
    try {
      const response = await fetch(
        `/api/assets/${encodeURIComponent(customAddress.trim())}`,
      );
      const body = (await response.json()) as {
        data?: BasketAsset;
        error?: string;
      };
      if (!response.ok || !body.data)
        throw new Error(
          body.error === "asset_not_found"
            ? "No compatible ERC-20 contract was found at that address."
            : (body.error ?? "Token lookup failed."),
        );
      setCustomAsset(body.data);
      setMessage(
        body.data.route.ready
          ? "Token metadata and route verified for this launch."
          : `Token found, but it cannot be selected: ${body.data.route.reason ?? "no funded route"}.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Token lookup failed.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="basket-asset-builder">
      <div className="basket-selected-heading">
        <div>
          <strong>Selected reward assets</strong>
          <span>{selected.length}/3 assets</span>
        </div>
        <button
          className="button"
          type="button"
          onClick={() => setOpen(true)}
          disabled={selected.length >= 3}
        >
          <span aria-hidden="true">＋</span> Choose asset
        </button>
      </div>
      <div className="basket-selected-list">
        {selected.map((asset, index) => (
          <article className="basket-selected-card" key={asset.address}>
            <AssetLogo asset={asset} />
            <div className="basket-asset-identity">
              <strong>{asset.symbol}</strong>
              <span>{asset.name}</span>
              <small>
                {verificationLabel(asset)} / {shortAddress(asset.address)}
              </small>
            </div>
            <label className="basket-weight-input">
              Weight
              <span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={weights[index] ?? 0}
                  onChange={(event) =>
                    onChange(
                      selected,
                      weights.map((value, offset) =>
                        offset === index ? Number(event.target.value) : value,
                      ),
                    )
                  }
                />
                %
              </span>
            </label>
            <div className="basket-card-actions">
              <button
                type="button"
                aria-label={`Move ${asset.symbol} up`}
                onClick={() => move(index, -1)}
                disabled={index === 0}
                title="Move up"
              >
                <span aria-hidden="true">↑</span>
              </button>
              <button
                type="button"
                aria-label={`Move ${asset.symbol} down`}
                onClick={() => move(index, 1)}
                disabled={index === selected.length - 1}
                title="Move down"
              >
                <span aria-hidden="true">↓</span>
              </button>
              <button
                type="button"
                aria-label={`Remove ${asset.symbol}`}
                onClick={() => remove(index)}
                title="Remove"
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
          </article>
        ))}
      </div>
      {selected.length ? (
        <div className="basket-balance-actions">
          <button
            className="button ghost compact"
            type="button"
            onClick={() => onChange(selected, evenly(selected.length))}
          >
            Split evenly
          </button>
          <button
            className="button ghost compact"
            type="button"
            onClick={() =>
              onChange(selected, [
                ...weights.slice(0, -1),
                Math.max(
                  0,
                  100 -
                    weights.slice(0, -1).reduce((sum, value) => sum + value, 0),
                ),
              ])
            }
          >
            Rebalance remainder
          </button>
        </div>
      ) : null}
      <p className="form-hint" role="status" aria-live="polite">
        {message}
      </p>
      {open ? (
        <div
          className="asset-picker-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Choose a reward asset"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div className="asset-picker-panel" ref={panelRef}>
            <header>
              <div>
                <p className="eyebrow">{publicEnvironment.networkLabel}</p>
                <h3>Select an asset</h3>
                <p className="form-hint">
                  Search the routed catalog or inspect any token address.
                </p>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close asset picker"
                onClick={() => setOpen(false)}
              >
                <span aria-hidden="true">×</span>
              </button>
            </header>
            <div className="asset-picker-search">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search name, symbol, or address"
                autoFocus
              />
            </div>
            <div
              className="asset-picker-tabs"
              role="tablist"
              aria-label="Asset categories"
            >
              {[
                ["all", "All"],
                ["stock", "Stocks"],
                ["etf-commodity", "ETFs & commodities"],
                ["crypto", "Crypto"],
                ["custom", "Paste address"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={category === value}
                  className={category === value ? "active" : ""}
                  onClick={() => setCategory(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            {category === "custom" ? (
              <div className="custom-asset-lookup">
                <label>
                  Token contract address
                  <input
                    value={customAddress}
                    onChange={(event) => setCustomAddress(event.target.value)}
                    placeholder="0x..."
                    autoComplete="off"
                  />
                </label>
                <button
                  className="button"
                  type="button"
                  onClick={() => void resolveCustom()}
                  disabled={loading || !customAddress.trim()}
                >
                  Find token
                </button>
                {customAsset ? (
                  <AssetRow
                    asset={customAsset}
                    selected={selected}
                    onAdd={add}
                  />
                ) : null}
                <p className="form-hint">
                  Unverified contracts can be malicious. Sherwood Forest reads
                  metadata defensively and requires a funded conversion route,
                  but route availability is not an endorsement.
                </p>
              </div>
            ) : (
              <div className="asset-picker-results" aria-busy={loading}>
                {loading ? (
                  <p>Loading verified routes...</p>
                ) : (
                  visible.map((asset) => (
                    <AssetRow
                      key={asset.address}
                      asset={asset}
                      selected={selected}
                      onAdd={add}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AssetRow({
  asset,
  selected,
  onAdd,
}: {
  asset: BasketAsset;
  selected: BasketAsset[];
  onAdd: (asset: BasketAsset) => void;
}) {
  const alreadySelected = selected.some(
    (item) => item.address.toLowerCase() === asset.address.toLowerCase(),
  );
  return (
    <article className="asset-picker-row">
      <AssetLogo asset={asset} />
      <div className="basket-asset-identity">
        <strong>
          {asset.symbol} <small>{verificationLabel(asset)}</small>
        </strong>
        <span>{asset.name}</span>
        <code>{shortAddress(asset.address)}</code>
      </div>
      <div className="asset-picker-market">
        <strong>
          {asset.referencePriceUsd
            ? `$${asset.referencePriceUsd}`
            : "No reference price"}
        </strong>
        <span
          className={asset.route.ready ? "route-ready" : "route-unavailable"}
        >
          {asset.route.ready
            ? asset.route.kind === "fixed-testnet"
              ? "Funded mock route"
              : "Live Uniswap route"
            : (asset.route.reason ?? "No route")}
        </span>
      </div>
      <button
        className="button compact"
        type="button"
        disabled={!asset.route.ready || alreadySelected}
        onClick={() => onAdd(asset)}
      >
        {alreadySelected ? "Added" : asset.route.ready ? "Add" : "Unavailable"}
      </button>
    </article>
  );
}
