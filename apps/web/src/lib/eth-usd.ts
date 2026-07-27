type CoinbaseSpotResponse = {
  data?: {
    amount?: string;
    currency?: string;
  };
};

const PRICE_CACHE_TTL_MS = 60_000;
let cachedPrice: { value: number; expiresAt: number } | null = null;

export async function getEthUsdPrice() {
  const useMemoryCache = process.env.NODE_ENV !== "test";
  const now = Date.now();
  if (useMemoryCache && cachedPrice && cachedPrice.expiresAt > now) {
    return cachedPrice.value;
  }

  try {
    const response = await fetch(
      "https://api.coinbase.com/v2/prices/ETH-USD/spot",
      {
        headers: { accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(3_500),
      },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as CoinbaseSpotResponse;
    const price = Number(body.data?.amount);
    if (
      body.data?.currency !== "USD" ||
      !Number.isFinite(price) ||
      price <= 0
    ) {
      return null;
    }
    if (useMemoryCache) {
      cachedPrice = { value: price, expiresAt: now + PRICE_CACHE_TTL_MS };
    }
    return price;
  } catch {
    return null;
  }
}
