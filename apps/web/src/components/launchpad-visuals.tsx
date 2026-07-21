import Image from "next/image";

const tokenArt: Record<string, string> = {
  ROBYN: "/assets/launchpad/token-robyn.webp",
  EVID: "/assets/launchpad/token-signal.webp",
  ONE: "/assets/launchpad/token-orbit.webp",
  MYCO: "/assets/launchpad/token-lucky.webp",
  SOAK: "/assets/launchpad/token-soak.webp",
};

export const basketArt = {
  mNVDA: "/assets/launchpad/asset-mnvda.webp",
  mSPY: "/assets/launchpad/asset-mspy.webp",
  mETH: "/assets/launchpad/asset-meth.webp",
} as const;

export type BasketArtSymbol = keyof typeof basketArt;

export function TokenArt({
  symbol,
  alt,
  className = "token-art",
  priority = false,
}: {
  symbol: string;
  alt?: string;
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      className={className}
      src={
        tokenArt[symbol.toUpperCase()] ??
        "/assets/launchpad/token-fallback.webp"
      }
      width={768}
      height={768}
      sizes="(max-width: 720px) 42vw, 240px"
      alt={alt ?? `${symbol} token artwork`}
      priority={priority}
    />
  );
}

export function BasketAssetArt({
  symbol,
  priority = false,
}: {
  symbol: BasketArtSymbol;
  priority?: boolean;
}) {
  return (
    <Image
      className="basket-asset-art"
      src={basketArt[symbol]}
      width={160}
      height={160}
      sizes="72px"
      alt={`${symbol} basket asset artwork`}
      priority={priority}
    />
  );
}
