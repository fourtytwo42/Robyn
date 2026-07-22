export type CreatorProfileInput = {
  displayName?: unknown;
  bio?: unknown;
  website?: unknown;
  xUrl?: unknown;
  telegramUrl?: unknown;
  discordUrl?: unknown;
  avatarMediaId?: unknown;
};

export type ValidCreatorProfile = {
  displayName: string;
  bio: string;
  website: string | null;
  xUrl: string | null;
  telegramUrl: string | null;
  discordUrl: string | null;
  avatarMediaId: string | null;
};

function optionalHttpsUrl(value: unknown, hosts?: string[]) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 200)
    throw new Error("invalid_url");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("invalid_url");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password)
    throw new Error("https_url_required");
  if (hosts && !hosts.includes(parsed.hostname.toLowerCase()))
    throw new Error("unexpected_social_host");
  parsed.hash = "";
  return parsed.toString();
}

export function validateCreatorProfile(
  input: CreatorProfileInput,
): ValidCreatorProfile {
  if (typeof input.displayName !== "string")
    throw new Error("display_name_required");
  const displayName = input.displayName.trim();
  if (
    displayName.length < 1 ||
    displayName.length > 48 ||
    /[\u0000-\u001f\u007f]/.test(displayName)
  )
    throw new Error("invalid_display_name");
  const bio = input.bio === undefined ? "" : input.bio;
  if (
    typeof bio !== "string" ||
    bio.length > 280 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(bio)
  )
    throw new Error("invalid_bio");
  const avatarMediaId =
    input.avatarMediaId === undefined ||
    input.avatarMediaId === null ||
    input.avatarMediaId === ""
      ? null
      : input.avatarMediaId;
  if (
    avatarMediaId !== null &&
    (typeof avatarMediaId !== "string" ||
      !/^[0-9a-f-]{36}$/.test(avatarMediaId))
  )
    throw new Error("invalid_avatar_media_id");
  return {
    displayName,
    bio,
    website: optionalHttpsUrl(input.website),
    xUrl: optionalHttpsUrl(input.xUrl, [
      "x.com",
      "www.x.com",
      "twitter.com",
      "www.twitter.com",
    ]),
    telegramUrl: optionalHttpsUrl(input.telegramUrl, ["t.me", "telegram.me"]),
    discordUrl: optionalHttpsUrl(input.discordUrl, [
      "discord.com",
      "www.discord.com",
      "discord.gg",
    ]),
    avatarMediaId,
  };
}

export function validateReportReason(value: unknown) {
  if (typeof value !== "string") throw new Error("report_reason_required");
  const reason = value.trim();
  if (reason.length < 10 || reason.length > 500)
    throw new Error("invalid_report_reason");
  return reason;
}
