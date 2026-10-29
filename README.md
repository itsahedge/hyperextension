# Hyperextension

Personal Hyperliquid trading extension for Chrome. Single user, no backend: the popup talks directly to Hyperliquid's API and signs locally.

## Stack

WXT (MV3) + React 19 + Tailwind v4 + Headless UI, `@nktkas/hyperliquid` for the API, viem for keys and signing, TanStack Query for data.

## Run

```bash
pnpm install
pnpm dev      # opens Chrome with the extension loaded and hot reload
pnpm build    # production build in .output/chrome-mv3
```

To install the build: `chrome://extensions` → Developer mode → Load unpacked → `.output/chrome-mv3`.

Checks: `pnpm typecheck`, `pnpm test`, `pnpm build`.

## Signing modes

```
 master  : account key signs everything
 agent   : API wallet key signs L1 actions (orders, cancels, leverage,
           spot<->perp via agentSendAsset) for the master address
           user-signed actions (withdraw, usdClassTransfer, approveAgent)
           still need the master key; without it they are disabled
```

Settings can generate a fresh API wallet, approve it from the master key, switch to it, and then remove the master key from the browser.

## Key storage

- Keys are encrypted with AES-GCM using a key derived from your password (PBKDF2-SHA256, 600,000 iterations) and stored in `chrome.storage.local`.
- Unlocking decrypts them into `chrome.storage.session`, which is memory-only and cleared when the browser exits. **Lock** clears it immediately.
- Host permissions are limited to `api.hyperliquid.xyz` and `api.hyperliquid-testnet.xyz`.

## viem is pinned

`viem` is pinned to `2.57.11`. viem `2.57.12` rejects EIP-712 struct names containing `:`, and Hyperliquid's user-signed types are named like `HyperliquidTransaction:Withdraw`, so withdraw, transfers, and API wallet approval fail to sign. `src/lib/signing.test.ts` fails if an upgrade reintroduces this.
