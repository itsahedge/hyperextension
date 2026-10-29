# Hyperextension

Personal Hyperliquid trading extension for Chrome. Single user, no backend: the popup talks directly to Hyperliquid's API and signs locally with your own key or a trade-only API wallet.

## Features

| Tab | What it does |
|---|---|
| Portfolio | Total value, perp equity, spot value, unrealized PnL, margin; spot balances; perp positions with market close |
| Trade | Insilico-style order panel (see [Trade panel](#trade-panel)); favorite markets; open orders for the selected market |
| Orders | Open orders and active TWAPs, order history with status filters, market filter, cancel one / all / by market |
| Wallet | Perp and spot balances, USDC deposit from Arbitrum (CCTP), Unit deposit addresses, spot↔perp USDC transfer, withdraw to Arbitrum, Hyperliquid address |
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

- **Favorites**: star markets in the market picker (or the star beside the selected market). Favorites are pinned at the top of the list, shown as one-tap chips under the picker, and the first one opens by default. They are saved per network, since spot market ids differ between mainnet and testnet.

- **Size**: base and USDC inputs kept in sync, MAX, slider and 25/33/50/66/75/100% presets. 100% uses Hyperliquid's max trade size for the side (perps) or free balance (spot); reduce mode caps at the position.
- **Scale**: 2 to 50 orders between two prices, sent as one batch. Price skew bunches rungs toward the low or high price; size skew weights size toward either end (up to 4:1). Rungs that round to the same tick are merged; every rung must be at least $10; post-only refuses rungs that would cross. A live preview shows rung prices, sizes, and the average price.
- **Scale Side**: a scale ladder anchored to the quote: longs from the bid down, shorts from the ask up, by offset and range %.
- **Stop**: stop-market or stop-limit triggered by the mark price. Whether Hyperliquid treats it as a stop or a take is picked from the trigger's side of the current price.
- **Swarm**: splits a market order into 2 to 50 lots (optionally irregular) sent together.
- **TWAP**: Hyperliquid's native TWAP, 5 minutes to 24 hours; it runs on the exchange after the popup closes.
- **TP/SL**: attaches market TP/SL children to a limit or market entry. Hyperliquid places them only if the entry fully fills.
- **Side toggle**: pick Buy/Long or Sell/Short first; everything below (max size, slider, previews, warnings, Available) describes that side only, and one submit button sends it, previewing exactly what it will send. Warnings name the side and the price they cross, e.g. "All 10 buy orders are at or above the best ask".
- **Footer**: margin mode and leverage, and the max slippage used by market, swarm, and close orders.

Batches report each order's outcome when Hyperliquid rejects some of them; nothing is ever resent automatically.

## Deposits

USDC deposits use Circle CCTP, which Hyperliquid's docs name as the preferred route (the old Arbitrum bridge is deprecated):

```
 sign EIP-3009 ReceiveWithAuthorization (USDC -> CctpExtension)
   -> CctpExtension.batchDepositForBurnWithAuth   (one Arbitrum tx, gas in ETH)
   -> burn on Arbitrum (domain 3), mint on HyperEVM (domain 19)
   -> CctpForwarder hook -> this account's HyperCore perps or spot balance
```

- Needs the master key and a little ETH on Arbitrum (Arbitrum Sepolia on testnet). Circle charges a flat 0.20 USDC forwarding fee (fetched live); the confirmation shows the minimum amount that arrives.
- Contract addresses come from Circle's "HyperCore CCTP-enablement contract addresses" and "USDC contract addresses" pages (`src/lib/cctp.ts`). Circle warns that a wrong mint recipient or destination caller strands funds permanently, so `assertDepositSafe` re-checks both, the recipient, and the hook data right before signing, and the call is simulated before it is sent.
- The USDC EIP-712 domain (name/version) is read from the token contract at send time.
- The "Hyperliquid address" card is for transfers from other Hyperliquid accounts; sending USDC to it on Arbitrum does not deposit.

Other assets (BTC, ETH, SOL, XPL, MON, ZEC, AVAX, VIRTUAL and several Solana tokens) use Unit Protocol deposit addresses (`src/lib/unit.ts`). Nothing is signed: Unit's `/gen` API returns a permanent source-chain address tied to this account, and the card shows it only after verifying the guardian signatures:

```
GET /gen/{chain}/hyperliquid/{asset}/{checksummed dst}
  -> { address, signatures: { nodeId: base64 r||s } }
  -> ECDSA P-256 / SHA-256 per guardian over
       "{nodeId}:user-{coinType}-hyperliquid-{dst}-{address}"   (current)
       "{nodeId}:{dst}-hyperliquid-{asset}-{address}-{chain}-deposit"  (legacy)
  -> >= 2 of 3 guardians verified, else the address is refused
```

- `coinType` is `ethereum` for every EVM source chain, so Ethereum, Base, Avalanche, Plasma and Monad share one address. The card states the exact asset, chain and Unit's minimum.
- Guardian keys are per network, from Unit's "Guardian Signatures" page; unit tests verify captured live testnet responses and reject substituted addresses, other destinations, wrong coin types and the other network's keys.
- Unit's terms list the United States and United Kingdom among prohibited jurisdictions, and its API geofences (HTTP 403). The card says so; there is no workaround.

## Orders

Open orders include stops and TP/SL; position TP/SL show as "Position" (Hyperliquid reports their size as 0). Narrow the list by market, side (buy/sell), and kind (limit/trigger); in the all-markets view orders are grouped by market. The bulk cancel button acts only on the orders shown and names them, e.g. "Cancel 10 sell orders · KNTQ/USDC"; each market group has its own cancel. Multi-order cancels show a breakdown, confirm first, and go out as one batched request. History shows the latest closed orders from `historicalOrders` (Hyperliquid returns at most 2000) with filled, canceled, and rejected filters and readable rejection reasons.

## Key storage

```
 secrets ──AES-GCM(DEK)──▶ vault data
 DEK ──wrapped by PBKDF2-SHA256(password, 600k)──▶ password slot   (always; recovery)
 DEK ──wrapped by HKDF(passkey PRF output)───────▶ passkey slot(s) (optional)
```

- The vault (`chrome.storage.local`) holds only ciphertext. Any slot recovers the same random data key (DEK).
- Unlocking decrypts the secrets into `chrome.storage.session`, which is memory-only and cleared when the browser exits. **Lock** clears it immediately; closing the popup does not.
- **Auto-lock** (Settings → Security): locks after 5, 15 (default), 30, or 60 minutes without a click or keypress in the popup, or never. A background worker checks every 30 seconds via `chrome.alarms`, and opening the popup enforces an expired timeout immediately. With **Lock when the screen locks** on (default), `chrome.idle` reporting `locked` locks it at once.
- **Withdrawal allowlist** (Settings → Withdrawal addresses): withdrawals can only go to this account's address or an allowlisted one; there is no free-text destination. The list is sealed inside the encrypted vault, so adding or removing an address requires a passkey or password, and the destination is rechecked against it at send time.
- Withdrawals and key changes (approve/import API wallet, remove master key, add/remove passkeys) re-authorize with a passkey or the password even while unlocked.
- Permissions: `storage`, `alarms` and `idle` (auto-lock); host permissions only for `api.hyperliquid.xyz` and `api.hyperliquid-testnet.xyz`.

## Passkeys

Passkeys unlock the vault through the WebAuthn PRF extension; they cannot sign Hyperliquid actions (Hyperliquid needs secp256k1, passkeys are P-256). The provider must support PRF: iCloud Keychain (macOS 15.4+) and Google Password Manager do.

Chrome lets an extension use its own ID as the passkey RP ID, so the manifest pins the ID with a public `key` (`afafdoeghnoiaopgfhnipaldoekldgoo`). Without it, loading the unpacked build from another folder would change the ID and orphan enrolled passkeys; the password still unlocks in that case. The matching private key was not kept, so this build cannot be packed as a `.crx` with the same ID.

## No builder codes

This is a personal tool: no order carries a Hyperliquid builder code (the per-order `builder` field that routes a fee to a third party), and the app never approves builder fees or sets referrals. All orders go through `submitOrders` in `src/lib/placement.ts`; `src/lib/orders.test.ts` asserts that no signed order, TP/SL, scale, swarm, or TWAP payload contains a builder field and scans the source for builder or referral calls.

## Notes

- **Dependency release delay.** `pnpm-workspace.yaml` sets `minimumReleaseAge: 10080`, so pnpm refuses package versions published less than 7 days ago (including transitive ones). To take an urgent fix sooner, add the package to `minimumReleaseAgeExclude` for that install.
- **viem is pinned to `2.57.11`.** viem `2.57.12` rejects EIP-712 struct names containing `:`, and Hyperliquid's user-signed types are named like `HyperliquidTransaction:Withdraw`, so withdraw, transfers, and API wallet approval fail to sign. `src/lib/signing.test.ts` fails if an upgrade reintroduces this.
- **Max size per side** comes from `activeAssetData.maxTradeSzs`. Hyperliquid does not document the index order; buy-then-sell is inferred from live data and only sizes the slider and MAX. The exchange validates every order.
- **TWAP duration** is capped at 24 hours by the SDK's request schema, although Hyperliquid's docs allow up to 7 days.
