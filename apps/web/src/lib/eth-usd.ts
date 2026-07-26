type CoinbaseSpotResponse = {
  data?: {
    amount?: string;
    currency?: string;
  };
};

export async function getEthUsdPrice() {
  try {
    const response = await fetch(
      "https://api.coinbase.com/v2/prices/ETH-USD/spot",
      {
        headers: { accept: "application/json" },
        next: { revalidate: 60 },
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
    return price;
  } catch {
    return null;
  }
}
