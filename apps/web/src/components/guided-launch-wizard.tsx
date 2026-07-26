"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Image from "next/image";
import type { Address, Hex } from "viem";
import { TokenArt } from "@/components/launchpad-visuals";
import { LAUNCH_TOKEN_EVENT } from "@/components/launch-token-trigger";
import {
  BasketAssetPicker,
  type BasketAsset,
} from "@/components/basket-asset-picker";

type WizardProps = {
  account?: Address;
  busy: boolean;
  name: string;
  setName: (value: string) => void;
  symbol: string;
  setSymbol: (value: string) => void;
  weights: number[];
  setWeights: (value: number[]) => void;
  status: string;
  walletActionLabel: string;
  onWalletAction: () => void | Promise<void>;
  assetSymbols?: [string, string, string];
  basketAssets?: BasketAsset[];
  setBasketAssets?: (assets: BasketAsset[], weights: number[]) => void;
  marketSummary?: string;
  atomicInitialPurchase?: boolean;
  signMessage: (message: string) => Promise<Hex>;
  onLaunch: (draft: {
    artworkMediaId?: string;
    description: string;
    website: string;
    xUrl: string;
    initialPurchaseNative: string;
  }) => Promise<void>;
  launchedToken?: Address;
  onStartAnother?: () => void;
  openByDefault?: boolean;
  showExplainer?: boolean;
};

type Session = { address: Address; chainId: number };
async function responseData<T>(response: Response): Promise<T> {
  const rawBody = await response.text();
  let body: { data?: T; error?: string } = {};
  try {
    body = JSON.parse(rawBody) as { data?: T; error?: string };
  } catch {
    if (!response.ok) {
      throw new Error(`request_failed_${response.status}`);
    }
    throw new Error("invalid_api_response");
  }
  if (!response.ok || body.data === undefined)
    throw new Error(body.error ?? `request_failed_${response.status}`);
  return body.data;
}

async function centeredSquareWebp(file: File, zoom: number) {
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  try {
    const side = Math.min(bitmap.width, bitmap.height) / zoom;
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 1024;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("image_processing_unavailable");
    context.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      1024,
      1024,
    );
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", 0.9),
    );
    if (!blob) throw new Error("image_processing_failed");
    return blob;
  } finally {
    bitmap.close();
  }
}

function CreatorSetup({
  account,
  signMessage,
  mediaId,
  setMediaId,
  onPreviewChange,
}: {
  account?: Address;
  signMessage: (message: string) => Promise<Hex>;
  mediaId?: string;
  setMediaId: (value: string | undefined) => void;
  onPreviewChange: (value: string | undefined) => void;
}) {
  const [session, setSession] = useState<Session>();
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState<string>();
  const [zoom, setZoom] = useState(1);
  const [message, setMessage] = useState(
    "Artwork is optional. Choose an image or use the Sherwood Forest fallback.",
  );
  const [working, setWorking] = useState(false);

  useEffect(() => {
    void fetch("/api/auth/session", { credentials: "same-origin" })
      .then((response) => responseData<Session | null>(response))
      .then((value) => setSession(value ?? undefined))
      .catch(() => setSession(undefined));
  }, []);

  useEffect(() => {
    if (!file) {
      setPreview(undefined);
      onPreviewChange(undefined);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    onPreviewChange(url);
    return () => {
      onPreviewChange(undefined);
      URL.revokeObjectURL(url);
    };
  }, [file, onPreviewChange]);

  const authenticate = useCallback(async () => {
    if (!account) throw new Error("Connect a wallet first.");
    const nonce = await responseData<{ message: string }>(
      await fetch("/api/auth/nonce", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: account }),
      }),
    );
    const signature = await signMessage(nonce.message);
    const verified = await responseData<Session>(
      await fetch("/api/auth/verify", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: nonce.message, signature }),
      }),
    );
    setSession(verified);
    return verified;
  }, [account, signMessage]);

  async function upload() {
    if (!file) return setMessage("Choose a JPEG, PNG, or static WebP first.");
    setWorking(true);
    try {
      if (!session || session.address.toLowerCase() !== account?.toLowerCase())
        await authenticate();
      setMessage("Preparing square artwork…");
      const blob = await centeredSquareWebp(file, zoom);
      const uploaded = await responseData<{ media_id: string }>(
        await fetch("/api/media?purpose=token", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "image/webp" },
          body: blob,
        }),
      );
      setMediaId(uploaded.media_id);
      setMessage("Artwork is ready and will be pinned when you launch.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="creator-setup" aria-labelledby="creator-setup-title">
      <div className="creator-setup-heading">
        <div>
          <strong id="creator-setup-title">Token artwork</strong>
          <span>Optional, square images work best</span>
        </div>
      </div>
      <div className="artwork-crop-row">
        <div
          className="artwork-crop-frame"
          aria-label="Square artwork crop preview"
        >
          {preview ? (
            <Image
              src={preview}
              alt="Selected token artwork crop"
              fill
              unoptimized
              style={{ transform: `scale(${zoom})` }}
            />
          ) : (
            <TokenArt symbol="NEW" alt="Sherwood Forest fallback artwork" />
          )}
        </div>
        <div className="artwork-controls">
          <label className="artwork-file-label">
            Choose artwork
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => {
                const selected = event.target.files?.[0];
                if (selected && selected.size > 2 * 1024 * 1024) {
                  setMessage("Artwork must be 2 MiB or smaller.");
                  return;
                }
                setFile(selected);
                setMediaId(undefined);
              }}
            />
          </label>
          {file ? (
            <label>
              Crop zoom {zoom.toFixed(1)}×
              <input
                type="range"
                min="1"
                max="3"
                step="0.1"
                value={zoom}
                onChange={(event) => setZoom(Number(event.target.value))}
              />
            </label>
          ) : null}
          <button
            className="button compact"
            type="button"
            onClick={() => void upload()}
            disabled={!account || !file || working}
          >
            {working ? "Preparing…" : mediaId ? "Artwork ready" : "Use artwork"}
          </button>
        </div>
      </div>
      <p className="form-hint" role="status" aria-live="polite">
        {message}
      </p>
    </section>
  );
}

export function GuidedLaunchWizard(props: WizardProps) {
  const {
    account,
    busy,
    name,
    setName,
    symbol,
    setSymbol,
    weights,
    setWeights,
    status,
    walletActionLabel,
    onWalletAction,
    signMessage,
    onLaunch,
    launchedToken,
    onStartAnother,
    openByDefault = false,
    showExplainer = true,
    assetSymbols = ["mNVDA", "mSPY", "mETH"],
    basketAssets,
    setBasketAssets,
    marketSummary = "Bonding curve → locked liquidity",
    atomicInitialPurchase = false,
  } = props;
  const [open, setOpen] = useState(openByDefault);
  const [rendered, setRendered] = useState(openByDefault);
  const [step, setStep] = useState(1);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [draftVersion, setDraftVersion] = useState(0);
  const [artworkMediaId, setArtworkMediaId] = useState<string>();
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [xUrl, setXUrl] = useState("");
  const [initialPurchaseNative, setInitialPurchaseNative] = useState("0");
  const [artworkPreview, setArtworkPreview] = useState<string>();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const total = weights.reduce((sum, value) => sum + value, 0);
  const displayAssetSymbols = basketAssets
    ? basketAssets.map((asset) => asset.symbol)
    : assetSymbols;
  const validToken =
    Boolean(name.trim()) && /^[A-Z0-9]{2,8}$/.test(symbol.trim());
  const validBasket =
    total === 100 &&
    (!basketAssets ||
      (basketAssets.length >= 1 &&
        basketAssets.length <= 3 &&
        basketAssets.length === weights.length &&
        basketAssets.every((asset) => asset.route.ready))) &&
    weights.every((value) => Number.isInteger(value) && value >= 0);
  const dirty =
    name !== "My Community" ||
    symbol !== "MYCO" ||
    weights.join(",") !== "40,40,20" ||
    Boolean(basketAssets && basketAssets.length !== 3) ||
    Boolean(description) ||
    Boolean(website) ||
    Boolean(xUrl) ||
    initialPurchaseNative !== "0" ||
    Boolean(artworkMediaId) ||
    Boolean(artworkPreview);

  useEffect(() => {
    const openLaunchWizard = () => {
      setRendered(true);
      setOpen(true);
    };
    window.addEventListener(LAUNCH_TOKEN_EVENT, openLaunchWizard);
    return () =>
      window.removeEventListener(LAUNCH_TOKEN_EVENT, openLaunchWizard);
  }, []);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLElement>("button, input")?.focus();
    document.body.classList.add("modal-open");
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (dirty) setConfirmDiscard(true);
        else setOpen(false);
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = [
        ...dialog.querySelectorAll<HTMLElement>(
          "button:not([disabled]),input:not([disabled]),textarea:not([disabled]),[href]",
        ),
      ];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.body.classList.remove("modal-open");
      document.removeEventListener("keydown", keydown);
      previous?.focus();
    };
  }, [dirty, open]);

  const requestClose = () => {
    if (dirty) setConfirmDiscard(true);
    else setOpen(false);
  };

  return (
    <>
      {showExplainer ? (
        <section
          className="launch-explainer"
          aria-labelledby="launch-explainer-title"
        >
          <div>
            <p className="eyebrow">Three guided steps</p>
            <h2 id="launch-explainer-title">
              Build the token holders want to earn with.
            </h2>
            <p>
              Your saved draft stays in this browser while you review token
              identity, immutable basket weights, and the final onchain launch.
            </p>
          </div>
          <button
            className="button primary"
            type="button"
            onClick={() => {
              setRendered(true);
              setOpen(true);
            }}
          >
            Start launch
          </button>
        </section>
      ) : null}
      {rendered ? (
        <div
          className="launch-modal-backdrop"
          role="presentation"
          hidden={!open}
        >
          <div
            className="launch-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            ref={dialogRef}
          >
            <header className="launch-modal-header">
              <div>
                <p className="eyebrow">Plant in Sherwood Forest</p>
                <h2 id={titleId}>
                  {step === 1
                    ? "Seed and artwork"
                    : step === 2
                      ? "Reward roots"
                      : "Review and plant"}
                </h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close launch setup"
                onClick={requestClose}
              >
                ×
              </button>
            </header>
            <nav className="wizard-steps" aria-label="Launch progress">
              {["Seed and artwork", "Reward roots", "Review and plant"].map(
                (label, index) => (
                  <button
                    key={label}
                    type="button"
                    className={step === index + 1 ? "active" : ""}
                    aria-current={step === index + 1 ? "step" : undefined}
                    onClick={() => index + 1 < step && setStep(index + 1)}
                  >
                    <b>0{index + 1}</b>
                    <span>{label}</span>
                  </button>
                ),
              )}
            </nav>
            <div className="wizard-layout">
              <div className="wizard-panel">
                <div className="wizard-fields" hidden={step !== 1}>
                  <div className="wizard-wallet-callout">
                    <div>
                      <span>Launch wallet</span>
                      <strong>
                        {account
                          ? `${account.slice(0, 8)}…${account.slice(-6)}`
                          : "Not connected"}
                      </strong>
                    </div>
                    {walletActionLabel ? (
                      <button
                        className="button"
                        type="button"
                        onClick={() => void onWalletAction()}
                      >
                        {walletActionLabel}
                      </button>
                    ) : null}
                  </div>
                  <label>
                    Token name
                    <input
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      maxLength={32}
                      autoComplete="off"
                    />
                  </label>
                  <label>
                    Symbol
                    <input
                      value={symbol}
                      onChange={(event) =>
                        setSymbol(
                          event.target.value
                            .toUpperCase()
                            .replace(/[^A-Z0-9]/g, ""),
                        )
                      }
                      maxLength={8}
                      autoComplete="off"
                    />
                  </label>
                  <label>
                    Description <span className="muted">(optional)</span>
                    <textarea
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      maxLength={280}
                      rows={3}
                      placeholder="What makes this reward basket worth following?"
                    />
                    <small>{description.length}/280</small>
                  </label>
                  <div className="wizard-social-fields">
                    <label>
                      Website <span className="muted">(optional)</span>
                      <input
                        type="url"
                        value={website}
                        onChange={(event) => setWebsite(event.target.value)}
                        placeholder="https://yourproject.example"
                      />
                    </label>
                    <label>
                      X / Twitter <span className="muted">(optional)</span>
                      <input
                        type="url"
                        value={xUrl}
                        onChange={(event) => setXUrl(event.target.value)}
                        placeholder="https://x.com/yourproject"
                      />
                    </label>
                  </div>
                  <CreatorSetup
                    key={draftVersion}
                    account={account}
                    signMessage={signMessage}
                    mediaId={artworkMediaId}
                    setMediaId={setArtworkMediaId}
                    onPreviewChange={setArtworkPreview}
                  />
                </div>
                <div className="wizard-fields" hidden={step !== 2}>
                  <p>
                    Choose whole percentages. The basket becomes immutable at
                    launch.
                  </p>
                  {basketAssets && setBasketAssets ? (
                    <BasketAssetPicker
                      selected={basketAssets}
                      weights={weights}
                      onChange={(assets, nextWeights) => {
                        setBasketAssets(assets, nextWeights);
                        setWeights(nextWeights);
                      }}
                    />
                  ) : (
                    <fieldset className="basket-builder">
                      <legend>Reward basket weights</legend>
                      {assetSymbols.map((asset, index) => (
                        <label key={asset}>
                          <span>{asset}</span>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            value={weights[index]}
                            onChange={(event) =>
                              setWeights(
                                weights.map((value, offset) =>
                                  offset === index
                                    ? Number(event.target.value)
                                    : value,
                                ),
                              )
                            }
                          />
                          <b>{weights[index]}%</b>
                        </label>
                      ))}
                    </fieldset>
                  )}
                  <p
                    className={
                      validBasket ? "weight-total valid" : "weight-total"
                    }
                  >
                    Total {total}%
                  </p>
                  {atomicInitialPurchase ? (
                    <label className="initial-purchase-field">
                      Initial purchase <span className="muted">(optional)</span>
                      <span>
                        <input
                          type="number"
                          min="0"
                          step="0.0001"
                          inputMode="decimal"
                          value={initialPurchaseNative}
                          onChange={(event) =>
                            setInitialPurchaseNative(event.target.value)
                          }
                        />
                        <b>ETH</b>
                      </span>
                      <small>
                        This buy executes inside the launch transaction before
                        anyone else can trade.
                      </small>
                    </label>
                  ) : null}
                </div>
                <div className="launch-review" hidden={step !== 3}>
                  <div>
                    <span>Token</span>
                    <strong>
                      {name || "Untitled"} · ${symbol || "Ticker pending"}
                    </strong>
                  </div>
                  <div>
                    <span>Supply</span>
                    <strong>1,000,000,000 fixed</strong>
                  </div>
                  <div>
                    <span>Market</span>
                    <strong>{marketSummary}</strong>
                  </div>
                  <div>
                    <span>Reward basket</span>
                    <strong>
                      {displayAssetSymbols
                        .map((asset, index) => `${asset} ${weights[index]}%`)
                        .filter((_, index) => weights[index] > 0)
                        .join(" · ")}
                    </strong>
                  </div>
                  <div>
                    <span>Artwork</span>
                    <strong>
                      {artworkMediaId
                        ? "Sanitized custom artwork"
                        : "Sherwood Forest fallback artwork"}
                    </strong>
                  </div>
                  {atomicInitialPurchase ? (
                    <div>
                      <span>Creator purchase</span>
                      <strong>
                        {initialPurchaseNative || "0"} ETH, atomic
                      </strong>
                    </div>
                  ) : null}
                  {website || xUrl ? (
                    <div>
                      <span>Project links</span>
                      <strong>
                        {[website ? "Website" : "", xUrl ? "X" : ""]
                          .filter(Boolean)
                          .join(" · ")}
                      </strong>
                    </div>
                  ) : null}
                  <p className="form-hint">
                    Basket weights and token artwork cannot be changed after the
                    canonical creator binds them. Mock assets have no real-world
                    value.
                  </p>
                  <button
                    className="button primary launch-submit"
                    type="button"
                    disabled={
                      busy ||
                      Boolean(launchedToken) ||
                      !account ||
                      !validToken ||
                      !validBasket
                    }
                    onClick={() =>
                      void onLaunch({
                        ...(artworkMediaId ? { artworkMediaId } : {}),
                        description,
                        website,
                        xUrl,
                        initialPurchaseNative,
                      })
                    }
                  >
                    {launchedToken
                      ? "Token planted"
                      : busy
                        ? "Planting…"
                        : "Plant token and market"}
                  </button>
                  {launchedToken ? (
                    <div className="wizard-wallet-required">
                      <a className="button" href={`/launches/${launchedToken}`}>
                        View growing market
                      </a>
                      {onStartAnother ? (
                        <button
                          className="button ghost"
                          type="button"
                          onClick={() => {
                            onStartAnother();
                            setArtworkMediaId(undefined);
                            setDescription("");
                            setWebsite("");
                            setXUrl("");
                            setInitialPurchaseNative("0");
                            setArtworkPreview(undefined);
                            setDraftVersion((value) => value + 1);
                            setStep(1);
                          }}
                        >
                          Plant another token
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  {!account ? (
                    <div className="wizard-wallet-required">
                      <p className="form-hint">
                        Connect a wallet to plant this token.
                      </p>
                      <button
                        className="button"
                        type="button"
                        onClick={() => void onWalletAction()}
                      >
                        {walletActionLabel}
                      </button>
                    </div>
                  ) : null}
                  <p
                    className="transaction-status"
                    role="status"
                    aria-live="polite"
                  >
                    {status}
                  </p>
                </div>
              </div>
              <aside
                className="wizard-preview"
                aria-label="Live token card preview"
              >
                <div className="launch-art-preview">
                  <TokenArt
                    symbol={symbol || "NEW"}
                    alt={`${symbol || "New"} token artwork preview`}
                    priority
                    artworkSrc={artworkPreview}
                  />
                  <div>
                    <span className="hot-chip">Live preview</span>
                    <strong>{name || "Your token"}</strong>
                    <span>${symbol || "SYMBOL"}</span>
                  </div>
                </div>
                <div
                  className="basket-weight-bar"
                  aria-label="Preview basket weights"
                >
                  {weights.map((weight, index) => (
                    <i
                      key={index}
                      className={`weight-${index + 1}`}
                      style={{ width: `${Math.max(0, weight)}%` }}
                    />
                  ))}
                </div>
                <div className="preview-basket-labels">
                  {displayAssetSymbols.map((asset, index) =>
                    weights[index] > 0 ? (
                      <span key={asset}>
                        {asset} {weights[index]}%
                      </span>
                    ) : null,
                  )}
                </div>
              </aside>
            </div>
            <footer className="wizard-footer">
              <button
                className="button ghost"
                type="button"
                onClick={() =>
                  step === 1 ? requestClose() : setStep(step - 1)
                }
              >
                {step === 1 ? "Close" : "Back"}
              </button>
              {step < 3 ? (
                <button
                  className="button primary"
                  type="button"
                  disabled={step === 1 ? !validToken : !validBasket}
                  onClick={() => setStep(step + 1)}
                >
                  Continue
                </button>
              ) : null}
            </footer>
            {confirmDiscard ? (
              <div
                className="discard-confirm"
                role="alertdialog"
                aria-modal="true"
                aria-label="Close launch draft"
              >
                <p>
                  <strong>Close launch setup?</strong>
                </p>
                <p>
                  Your draft will stay available when you reopen it. Use discard
                  only if you want to reset it.
                </p>
                <div className="action-row">
                  <button
                    className="button"
                    type="button"
                    onClick={() => {
                      setConfirmDiscard(false);
                      setOpen(false);
                    }}
                  >
                    Keep draft and close
                  </button>
                  <button
                    className="button ghost"
                    type="button"
                    onClick={() => {
                      setName("My Community");
                      setSymbol("MYCO");
                      setWeights([40, 40, 20]);
                      setArtworkMediaId(undefined);
                      setDescription("");
                      setWebsite("");
                      setXUrl("");
                      setInitialPurchaseNative("0");
                      setArtworkPreview(undefined);
                      setDraftVersion((value) => value + 1);
                      setStep(1);
                      setConfirmDiscard(false);
                      setOpen(false);
                    }}
                  >
                    Discard draft
                  </button>
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => setConfirmDiscard(false)}
                  >
                    Continue editing
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
