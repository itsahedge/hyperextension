# Hyperextension

Personal Hyperliquid trading extension for Chrome. Single user, no backend: the popup talks directly to Hyperliquid's API and signs locally with your own key or a trade-only API wallet.

## Features

| Tab | What it does |
|---|---|
| Portfolio | Total value, perp equity, spot value, unrealized PnL, margin; spot balances; perp positions with market close |
| Trade | Insilico-style order panel (see [Trade panel](#trade-panel)); open orders for the selected market |
| Orders | Open orders and active TWAPs, order history with status filters, market filter, cancel one / all / by market |
| Wallet | Perp and spot balances, spot↔perp USDC transfer, withdraw to Arbitrum, deposit address |
| Activity | Fills, funding payments (7 days), transfers and other ledger updates (30 days) |
| Settings | Network, signing mode, passkeys, API wallet create/import, remove master key, lock, reset |

The header shows the account, signing mode, and network, with a refresh button and **Lock**. Data polls on its own (account every 5s, markets every 10s, history every 30s) while the popup is open.

## Setup

1. Install dependencies and build:
   ```bash
   pnpm install
   pnpm build
   ```
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and select `.output/chrome-mv3` (press ⌘⇧. in the file picker to show the hidden `.output` folder).
3. Confirm the extension ID is `afafdoeghnoiaopgfhnipaldoekldgoo`, then pin it from the toolbar's puzzle icon.
4. Open the popup and choose **Master key** (your account's private key) or **API wallet** (the API wallet key plus your main account address), pick **Mainnet** or **Testnet**, and set a password.
5. Optional: **Settings → Passkeys → Add passkey** to unlock with Touch ID. Save it to iCloud Keychain or Google Password Manager.

After pulling changes, run `pnpm build` and click the reload icon on the extension's card. Reloading keeps the vault; **Remove** on the card deletes it.

## Development

```bash
pnpm dev         # WXT dev build with hot reload, in a separate browser profile
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest
pnpm build       # production build in .output/chrome-mv3
```

`pnpm dev` writes to `.output/chrome-mv3-dev` and opens its own browser profile, so it does not share the vault from your normal Chrome. Run all three checks before opening a PR; there is no CI.

Order math, the vault, sessions, and signing are pure modules under `src/lib` with unit tests. Exchange-facing tests run the real SDK against a fake transport and assert the exact signed payloads.

### Layout

```
src/
  entrypoints/popup/   popup entry, app shell, tab nav
  screens/             one file per tab (Trade has a trade/ folder for the panel)
  components/          shared UI: open orders, market filter, dialogs, spot balances
  hooks/               session context and TanStack Query hooks
  lib/                 vault, session, signing, markets, order planners, placement
```

## Signing modes

```
 master  : account key signs everything
 agent   : API wallet key signs L1 actions (orders, cancels, leverage,
           spot<->perp via agentSendAsset) for the master address
           user-signed actions (withdraw, usdClassTransfer, approveAgent)
           still need the master key; without it they are disabled
```

Settings can generate a fresh API wallet, approve it from the master key, switch to it, and then remove the master key from the browser.

## Trade panel

Order types, Limit: Order, Stop, Scale, Scale Side; Market: Order, Stop, Swarm, TWAP. Stop, TP/SL and TWAP are perps only.

- **Size**: base and USDC inputs kept in sync, MAX, slider and 25/33/50/66/75/100% presets. 100% uses Hyperliquid's max trade size for the side (perps) or free balance (spot); reduce mode caps at the position.
- **Scale**: 2 to 50 orders between two prices, sent as one batch. Price skew bunches rungs toward the low or high price; size skew weights size toward either end (up to 4:1). Rungs that round to the same tick are merged; every rung must be at least $10; post-only refuses rungs that would cross. A live preview shows rung prices, sizes, and the average price.
- **Scale Side**: a scale ladder anchored to the quote: longs from the bid down, shorts from the ask up, by offset and range %.
- **Stop**: stop-market or stop-limit triggered by the mark price. Whether Hyperliquid treats it as a stop or a take is picked from the trigger's side of the current price.
- **Swarm**: splits a market order into 2 to 50 lots (optionally irregular) sent together.
- **TWAP**: Hyperliquid's native TWAP, 5 minutes to 24 hours; it runs on the exchange after the popup closes.
- **TP/SL**: attaches market TP/SL children to a limit or market entry. Hyperliquid places them only if the entry fully fills.
- **Long / Short buttons** preview exactly what each side will send.
- **Footer**: margin mode and leverage, and the max slippage used by market, swarm, and close orders.

Batches report each order's outcome when Hyperliquid rejects some of them; nothing is ever resent automatically.

## Orders

Open orders include stops and TP/SL; position TP/SL show as "Position" (Hyperliquid reports their size as 0). Cancel one order, everything listed, or everything for one market; multi-order cancels confirm first and go out as one batched request. History shows the latest closed orders from `historicalOrders` (Hyperliquid returns at most 2000) with filled, canceled, and rejected filters and readable rejection reasons.

## Key storage

```
 secrets ──AES-GCM(DEK)──▶ vault data
 DEK ──wrapped by PBKDF2-SHA256(password, 600k)──▶ password slot   (always; recovery)
 DEK ──wrapped by HKDF(passkey PRF output)───────▶ passkey slot(s) (optional)
```

- The vault (`chrome.storage.local`) holds only ciphertext. Any slot recovers the same random data key (DEK).
- Unlocking decrypts the secrets into `chrome.storage.session`, which is memory-only and cleared when the browser exits. **Lock** clears it immediately; closing the popup does not.
- Withdrawals and key changes (approve/import API wallet, remove master key, add/remove passkeys) re-authorize with a passkey or the password even while unlocked.
- Host permissions are limited to `api.hyperliquid.xyz` and `api.hyperliquid-testnet.xyz`.

## Passkeys

Passkeys unlock the vault through the WebAuthn PRF extension; they cannot sign Hyperliquid actions (Hyperliquid needs secp256k1, passkeys are P-256). The provider must support PRF: iCloud Keychain (macOS 15.4+) and Google Password Manager do.

Chrome lets an extension use its own ID as the passkey RP ID, so the manifest pins the ID with a public `key` (`afafdoeghnoiaopgfhnipaldoekldgoo`). Without it, loading the unpacked build from another folder would change the ID and orphan enrolled passkeys; the password still unlocks in that case. The matching private key was not kept, so this build cannot be packed as a `.crx` with the same ID.

## No builder codes

This is a personal tool: no order carries a Hyperliquid builder code (the per-order `builder` field that routes a fee to a third party), and the app never approves builder fees or sets referrals. All orders go through `submitOrders` in `src/lib/placement.ts`; `src/lib/orders.test.ts` asserts that no signed order, TP/SL, scale, swarm, or TWAP payload contains a builder field and scans the source for builder or referral calls.

## Notes

- **viem is pinned to `2.57.11`.** viem `2.57.12` rejects EIP-712 struct names containing `:`, and Hyperliquid's user-signed types are named like `HyperliquidTransaction:Withdraw`, so withdraw, transfers, and API wallet approval fail to sign. `src/lib/signing.test.ts` fails if an upgrade reintroduces this.
- **Max size per side** comes from `activeAssetData.maxTradeSzs`. Hyperliquid does not document the index order; buy-then-sell is inferred from live data and only sizes the slider and MAX. The exchange validates every order.
- **TWAP duration** is capped at 24 hours by the SDK's request schema, although Hyperliquid's docs allow up to 7 days.
