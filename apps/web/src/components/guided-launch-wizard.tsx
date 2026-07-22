"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Image from "next/image";
import type { Address, Hex } from "viem";
import { TokenArt } from "@/components/launchpad-visuals";

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
  walletHint: string;
  walletActionLabel: string;
  onWalletAction: () => void | Promise<void>;
  assetSymbols?: [string, string, string];
  marketSummary?: string;
  signMessage: (message: string) => Promise<Hex>;
  onLaunch: (artworkMediaId?: string) => Promise<void>;
  openByDefault?: boolean;
};

type Session = { address: Address; chainId: number };
type PublicProfile = {
  display_name: string;
  bio: string;
  website: string | null;
  x_url: string | null;
  telegram_url: string | null;
  discord_url: string | null;
  avatar_media_id: string | null;
};

async function responseData<T>(response: Response): Promise<T> {
  const body = (await response.json()) as { data?: T; error?: string };
  if (!response.ok || body.data === undefined)
    throw new Error(body.error ?? "request_failed");
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
    "Prove wallet control to upload immutable token artwork.",
  );
  const [working, setWorking] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [avatarFile, setAvatarFile] = useState<File>();
  const [avatarPreview, setAvatarPreview] = useState<string>();
  const [avatarZoom, setAvatarZoom] = useState(1);
  const [profile, setProfile] = useState({
    displayName: "",
    bio: "",
    website: "",
    xUrl: "",
    telegramUrl: "",
    discordUrl: "",
    avatarMediaId: "",
  });

  useEffect(() => {
    void fetch("/api/auth/session", { credentials: "same-origin" })
      .then((response) => responseData<Session | null>(response))
      .then((value) => setSession(value ?? undefined))
      .catch(() => setSession(undefined));
  }, []);

  useEffect(() => {
    if (!account) return;
    void fetch(`/api/profiles/${account}`)
      .then((response) => responseData<PublicProfile>(response))
      .then((value) =>
        setProfile({
          displayName: value.display_name,
          bio: value.bio,
          website: value.website ?? "",
          xUrl: value.x_url ?? "",
          telegramUrl: value.telegram_url ?? "",
          discordUrl: value.discord_url ?? "",
          avatarMediaId: value.avatar_media_id ?? "",
        }),
      )
      .catch(() => undefined);
  }, [account]);

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

  useEffect(() => {
    if (!avatarFile) {
      setAvatarPreview(undefined);
      return;
    }
    const url = URL.createObjectURL(avatarFile);
    setAvatarPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [avatarFile]);

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

  async function proveWallet() {
    setWorking(true);
    try {
      await authenticate();
      setMessage("Wallet control proven for this one-hour creator session.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sign-in failed.");
    } finally {
      setWorking(false);
    }
  }

  async function upload() {
    if (!file) return setMessage("Choose a JPEG, PNG, or static WebP first.");
    setWorking(true);
    try {
      if (!session || session.address.toLowerCase() !== account?.toLowerCase())
        await authenticate();
      setMessage("Cropping and sanitizing artwork…");
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
      setMessage("Sanitized artwork is ready and will bind after launch.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setWorking(false);
    }
  }

  async function saveProfile() {
    setWorking(true);
    try {
      if (!session || session.address.toLowerCase() !== account?.toLowerCase())
        await authenticate();
      await responseData(
        await fetch("/api/profile", {
          method: "PUT",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(profile),
        }),
      );
      setMessage(
        "Creator profile saved. Social links are not externally verified.",
      );
      setProfileOpen(false);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Profile save failed.",
      );
    } finally {
      setWorking(false);
    }
  }

  async function uploadAvatar() {
    if (!avatarFile) return setMessage("Choose a profile avatar first.");
    setWorking(true);
    try {
      if (!session || session.address.toLowerCase() !== account?.toLowerCase())
        await authenticate();
      const blob = await centeredSquareWebp(avatarFile, avatarZoom);
      const uploaded = await responseData<{ media_id: string }>(
        await fetch("/api/media?purpose=avatar", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "image/webp" },
          body: blob,
        }),
      );
      setProfile((value) => ({
        ...value,
        avatarMediaId: uploaded.media_id,
      }));
      setMessage(
        "Sanitized profile avatar is ready. Save the profile to publish it.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Avatar upload failed.",
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="creator-setup" aria-labelledby="creator-setup-title">
      <div className="creator-setup-heading">
        <div>
          <strong id="creator-setup-title">Token artwork and creator</strong>
          <span>
            {session ? "Wallet control proven" : "Optional until launch"}
          </span>
        </div>
        <button
          className="button ghost compact"
          type="button"
          onClick={() => void proveWallet()}
          disabled={!account || working}
        >
          {session ? "Re-authenticate" : "Prove wallet"}
        </button>
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
            <TokenArt symbol="NEW" alt="Robyn fallback artwork" />
          )}
        </div>
        <div className="artwork-controls">
          <label>
            Artwork
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
          <label>
            Crop zoom {zoom.toFixed(1)}×
            <input
              type="range"
              min="1"
              max="3"
              step="0.1"
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
              disabled={!file}
            />
          </label>
          <button
            className="button"
            type="button"
            onClick={() => void upload()}
            disabled={!account || !file || working}
          >
            {mediaId ? "Artwork ready" : "Sanitize artwork"}
          </button>
        </div>
      </div>
      <button
        className="text-button"
        type="button"
        onClick={() => setProfileOpen((value) => !value)}
        aria-expanded={profileOpen}
      >
        {profileOpen ? "Hide creator profile" : "Edit creator profile"}
      </button>
      {profileOpen ? (
        <div className="creator-profile-fields">
          <div className="profile-avatar-editor">
            <div className="profile-avatar-preview">
              {avatarPreview ? (
                <Image
                  src={avatarPreview}
                  alt="Profile avatar crop"
                  fill
                  unoptimized
                  style={{ transform: `scale(${avatarZoom})` }}
                />
              ) : profile.avatarMediaId ? (
                <Image
                  src={`/api/media/${profile.avatarMediaId}`}
                  alt="Current profile avatar"
                  fill
                  unoptimized
                />
              ) : (
                <span aria-hidden="true">+</span>
              )}
            </div>
            <div>
              <label>
                Profile avatar
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(event) => setAvatarFile(event.target.files?.[0])}
                />
              </label>
              <label>
                Avatar zoom {avatarZoom.toFixed(1)}×
                <input
                  type="range"
                  min="1"
                  max="3"
                  step="0.1"
                  value={avatarZoom}
                  onChange={(event) =>
                    setAvatarZoom(Number(event.target.value))
                  }
                  disabled={!avatarFile}
                />
              </label>
              <button
                className="button ghost compact"
                type="button"
                onClick={() => void uploadAvatar()}
                disabled={!avatarFile || working}
              >
                Sanitize avatar
              </button>
            </div>
          </div>
          <label>
            Display name
            <input
              maxLength={48}
              value={profile.displayName}
              onChange={(event) =>
                setProfile({ ...profile, displayName: event.target.value })
              }
            />
          </label>
          <label>
            Bio
            <textarea
              maxLength={280}
              value={profile.bio}
              onChange={(event) =>
                setProfile({ ...profile, bio: event.target.value })
              }
            />
          </label>
          <label>
            Website
            <input
              type="url"
              placeholder="https://"
              value={profile.website}
              onChange={(event) =>
                setProfile({ ...profile, website: event.target.value })
              }
            />
          </label>
          <label>
            X profile
            <input
              type="url"
              placeholder="https://x.com/…"
              value={profile.xUrl}
              onChange={(event) =>
                setProfile({ ...profile, xUrl: event.target.value })
              }
            />
          </label>
          <label>
            Telegram
            <input
              type="url"
              placeholder="https://t.me/…"
              value={profile.telegramUrl}
              onChange={(event) =>
                setProfile({ ...profile, telegramUrl: event.target.value })
              }
            />
          </label>
          <label>
            Discord
            <input
              type="url"
              placeholder="https://discord.gg/…"
              value={profile.discordUrl}
              onChange={(event) =>
                setProfile({ ...profile, discordUrl: event.target.value })
              }
            />
          </label>
          <button
            className="button"
            type="button"
            onClick={() => void saveProfile()}
            disabled={!account || working || !profile.displayName.trim()}
          >
            Save profile
          </button>
          <p className="form-hint">
            This proves wallet control only. External identity and social
            accounts are not verified.
          </p>
        </div>
      ) : null}
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
    walletHint,
    walletActionLabel,
    onWalletAction,
    signMessage,
    onLaunch,
    openByDefault = false,
    assetSymbols = ["mNVDA", "mSPY", "mETH"],
    marketSummary = "Bonding curve → locked liquidity",
  } = props;
  const [open, setOpen] = useState(openByDefault);
  const [rendered, setRendered] = useState(openByDefault);
  const [step, setStep] = useState(1);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [draftVersion, setDraftVersion] = useState(0);
  const [artworkMediaId, setArtworkMediaId] = useState<string>();
  const [artworkPreview, setArtworkPreview] = useState<string>();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const total = weights.reduce((sum, value) => sum + value, 0);
  const validToken =
    Boolean(name.trim()) && /^[A-Z0-9]{2,8}$/.test(symbol.trim());
  const validBasket =
    total === 100 &&
    weights.every((value) => Number.isInteger(value) && value >= 0);
  const dirty =
    name !== "My Community" ||
    symbol !== "MYCO" ||
    weights.join(",") !== "40,40,20" ||
    Boolean(artworkMediaId) ||
    Boolean(artworkPreview);

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
                <p className="eyebrow">Create on Robyn</p>
                <h2 id={titleId}>
                  {step === 1
                    ? "Token and artwork"
                    : step === 2
                      ? "Reward basket"
                      : "Review and launch"}
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
              {["Token and artwork", "Reward basket", "Review and launch"].map(
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
                    <button
                      className="button"
                      type="button"
                      onClick={() => void onWalletAction()}
                    >
                      {walletActionLabel}
                    </button>
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
                  <p
                    className={
                      validBasket ? "weight-total valid" : "weight-total"
                    }
                  >
                    Total {total}%
                  </p>
                </div>
                <div className="launch-review" hidden={step !== 3}>
                  <div>
                    <span>Token</span>
                    <strong>
                      {name || "Untitled"} · ${symbol || "—"}
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
                      {assetSymbols
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
                        : "Robyn fallback artwork"}
                    </strong>
                  </div>
                  <p className="form-hint">
                    Basket weights and token artwork cannot be changed after the
                    canonical creator binds them. Mock assets have no real-world
                    value.
                  </p>
                  <button
                    className="button primary launch-submit"
                    type="button"
                    disabled={busy || !account || !validToken || !validBasket}
                    onClick={() => void onLaunch(artworkMediaId)}
                  >
                    {busy ? "Launching…" : "Launch token and market"}
                  </button>
                  {!account ? (
                    <div className="wizard-wallet-required">
                      <p className="form-hint">{walletHint}</p>
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
                  {assetSymbols.map((asset, index) =>
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
