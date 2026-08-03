import type { Metadata } from "next";
import type { PublicEnvironment } from "./public-environment";

export function createSiteMetadata(environment: PublicEnvironment): Metadata {
  const title = `Sherwood Forest | ${environment.networkLabel}`;
  const description = `Launch and discover tokens with community-selected reward baskets on ${environment.chainName}.`;
  const socialImage = {
    url: "/assets/brand/sherwood-crest.png",
    width: 512,
    height: 512,
    alt: "Sherwood Forest",
  };

  return {
    title,
    description,
    metadataBase: new URL(environment.appUrl),
    alternates: { canonical: environment.appUrl },
    openGraph: {
      type: "website",
      siteName: "Sherwood Forest",
      url: environment.appUrl,
      title,
      description,
      images: [socialImage],
    },
    twitter: {
      card: "summary",
      title,
      description,
      images: [socialImage.url],
    },
    icons: {
      icon: "/favicon.ico?v=3",
      apple: "/apple-icon.png?v=3",
    },
  };
}
