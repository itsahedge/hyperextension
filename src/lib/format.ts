const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const signedUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
  signDisplay: "exceptZero",
});
const pct = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 2,
  signDisplay: "exceptZero",
});
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

const toNumber = (v: string | number) => (typeof v === "number" ? v : Number(v));

export const fmtUsd = (v: string | number) => usd.format(toNumber(v));
export const fmtSignedUsd = (v: string | number) => signedUsd.format(toNumber(v));
// Input is a fraction: 0.0125 -> "+1.25%".
export const fmtPct = (v: string | number) => pct.format(toNumber(v));
export const fmtCompactUsd = (v: string | number) => `$${compact.format(toNumber(v))}`;

// Funding rates are tiny fractions (0.0000125 = 0.00125%/h); keep 4 decimals of percent.
export function fmtRate(v: string | number): string {
  const n = toNumber(v) * 100;
  return `${n > 0 ? "+" : ""}${n.toFixed(4)}%`;
}

// Prices keep up to 6 significant digits so small-cap prices stay readable.
export function fmtPrice(v: string | number): string {
  const n = toNumber(v);
  if (!Number.isFinite(n)) return "-";
  return n.toLocaleString("en-US", { maximumSignificantDigits: 6 });
}

export function fmtSize(v: string | number, decimals = 6): string {
  const n = toNumber(v);
  if (!Number.isFinite(n)) return "-";
  return n.toLocaleString("en-US", { maximumFractionDigits: decimals });
}

export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const toneOf = (v: string | number) => {
  const n = toNumber(v);
  return n > 0 ? "text-up" : n < 0 ? "text-down" : "text-muted";
};
