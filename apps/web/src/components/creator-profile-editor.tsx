"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import type { Address, Hex, WalletClient } from "viem";

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

type ProfileDraft = {
  displayName: string;
  bio: string;
  website: string;
  xUrl: string;
  telegramUrl: string;
  discordUrl: string;
  avatarMediaId: string;
};

async function responseData<T>(response: Response): Promise<T> {
  const body = (await response.json()) as { data?: T; error?: string };
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

export function CreatorProfileEditor({
  account,
  walletClient,
  onClose,
  onSaved,
}: {
  account: Address;
  walletClient: WalletClient;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [session, setSession] = useState<Session>();
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState<string>();
  const [zoom, setZoom] = useState(1);
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState("Loading your creator profile...");
  const [profile, setProfile] = useState<ProfileDraft>({
    displayName: "",
    bio: "",
    website: "",
    xUrl: "",
    telegramUrl: "",
    discordUrl: "",
    avatarMediaId: "",
  });

  useEffect(() => {
    void Promise.all([
      fetch("/api/auth/session", { credentials: "same-origin" })
        .then((response) => responseData<Session | null>(response))
        .catch(() => null),
      fetch(`/api/profiles/${account}`, { cache: "no-store" })
        .then((response) => responseData<PublicProfile | null>(response))
        .catch(() => null),
    ]).then(([activeSession, saved]) => {
      setSession(activeSession ?? undefined);
      if (saved) {
        setProfile({
          displayName: saved.display_name,
          bio: saved.bio,
          website: saved.website ?? "",
          xUrl: saved.x_url ?? "",
          telegramUrl: saved.telegram_url ?? "",
          discordUrl: saved.discord_url ?? "",
          avatarMediaId: saved.avatar_media_id ?? "",
        });
      }
      setStatus(
        "Choose how your creator identity appears across Sherwood Forest.",
      );
    });
  }, [account]);

  useEffect(() => {
    if (!file) {
      setPreview(undefined);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function authenticate() {
    if (session?.address.toLowerCase() === account.toLowerCase())
      return session;
    const nonce = await responseData<{ message: string }>(
      await fetch("/api/auth/nonce", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: account }),
      }),
    );
    const signature: Hex = await walletClient.signMessage({
      account: walletClient.account ?? account,
      message: nonce.message,
    });
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
  }

  async function uploadAvatar() {
    if (!file) return profile.avatarMediaId;
    const blob = await centeredSquareWebp(file, zoom);
    const uploaded = await responseData<{ media_id: string }>(
      await fetch("/api/media?purpose=avatar", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "image/webp" },
        body: blob,
      }),
    );
    return uploaded.media_id;
  }

  async function saveProfile() {
    setWorking(true);
    try {
      await authenticate();
      let profileToSave = profile;
      if (file) {
        setStatus("Preparing avatar...");
        const avatarMediaId = await uploadAvatar();
        profileToSave = { ...profile, avatarMediaId };
        setProfile(profileToSave);
      }
      setStatus("Saving creator profile...");
      await responseData(
        await fetch("/api/profile", {
          method: "PUT",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(profileToSave),
        }),
      );
      setStatus("Creator profile saved.");
      await onSaved();
      onClose();
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Profile save failed.",
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <div
      className="profile-editor-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="profile-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-editor-title"
      >
        <header>
          <div>
            <p className="eyebrow">Your public identity</p>
            <h2 id="profile-editor-title">Edit creator profile</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close profile editor"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="profile-editor-avatar">
          <label className="profile-avatar-upload">
            <span className="profile-avatar-preview">
              {preview ? (
                <Image
                  src={preview}
                  alt="Avatar crop preview"
                  fill
                  unoptimized
                  style={{ transform: `scale(${zoom})` }}
                />
              ) : profile.avatarMediaId ? (
                <Image
                  src={`/api/media/${profile.avatarMediaId}`}
                  alt="Current creator avatar"
                  fill
                  unoptimized
                />
              ) : null}
              <span className="profile-avatar-add-icon" aria-hidden="true">
                +
              </span>
            </span>
            <span className="sr-only">Choose creator avatar image</span>
            <input
              className="sr-only"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={working}
              onChange={(event) => {
                const nextFile = event.target.files?.[0];
                setFile(nextFile);
                if (nextFile) {
                  setZoom(1);
                  setStatus(
                    "New avatar selected. Save your profile to publish it.",
                  );
                }
              }}
            />
          </label>
          <div>
            <p className="profile-avatar-helper">
              Click the plus to choose a new avatar. It will be applied when you
              save your profile.
            </p>
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
          </div>
        </div>
        <div className="creator-profile-fields">
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
            X / Twitter
            <input
              type="url"
              placeholder="https://x.com/"
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
              placeholder="https://t.me/"
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
              placeholder="https://discord.gg/"
              value={profile.discordUrl}
              onChange={(event) =>
                setProfile({ ...profile, discordUrl: event.target.value })
              }
            />
          </label>
        </div>
        <p className="form-hint" role="status">
          {status}
        </p>
        <footer>
          <button className="button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            type="button"
            disabled={working || !profile.displayName.trim()}
            onClick={() => void saveProfile()}
          >
            {working ? "Saving..." : "Save profile"}
          </button>
        </footer>
      </section>
    </div>
  );
}
