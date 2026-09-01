import { wrapFetchWithPayment, x402Client } from "@x402/fetch";

const mockClient = new x402Client();

// The MVP intentionally has no wallet signer or settlement backend. The wrapper is
// still the real x402 fetch client, so replacing the data URL with a protected
// endpoint and registering a payment scheme is the only integration seam required.
const fetchWithPayment = wrapFetchWithPayment(globalThis.fetch, mockClient);

export async function simulateX402Settlement(
  totalCostUsdc: number,
  architectureHash: string,
) {
  const payload = encodeURIComponent(
    JSON.stringify({
      success: true,
      network: "eip155:84532",
      token: "USDC",
      amount: totalCostUsdc.toFixed(2),
      architectureHash,
    }),
  );

  const response = await fetchWithPayment(`data:application/json,${payload}`);
  const receipt = (await response.json()) as {
    success: boolean;
    network: string;
    token: string;
    amount: string;
    architectureHash: string;
  };

  await new Promise((resolve) => window.setTimeout(resolve, 900));

  return {
    ...receipt,
    transaction: `0xmock${Date.now().toString(16)}`,
    protocol: "x402-v2-mock",
  };
}
