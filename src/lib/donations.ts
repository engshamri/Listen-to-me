import methods from "@/data/donations.json";

/*
 * Donation methods for /support. Addresses live in src/data/donations.json, the
 * single source for this page, scripts/generate-donation-qr.mjs and the tests
 * (tests/unit/donations.test.ts checks their checksums and that each QR code
 * decodes to exactly this address).
 */

export type DonationMethodId = "usdt-trc20" | "btc-xlayer";

export interface DonationMethod {
  id: DonationMethodId;
  /** Receiving address exactly as wallets expect it; also the QR code content. */
  address: string;
  /** The same X Layer address in OKX Wallet's XKO display format ("XKO" instead of "0x"). */
  okxAddress?: string;
}

export const DONATION_METHODS = methods as DonationMethod[];

export const qrImagePath = (id: DonationMethodId) => `/donate/${id}.svg`;
export const qrDownloadPath = (id: DonationMethodId) => `/donate/listen-to-me-${id}-qr.png`;
