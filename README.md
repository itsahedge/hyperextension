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

```
 secrets ──AES-GCM(DEK)──▶ vault data
 DEK ──wrapped by PBKDF2-SHA256(password, 600k)──▶ password slot   (always; recovery)
 DEK ──wrapped by HKDF(passkey PRF output)───────▶ passkey slot(s) (optional)
```

- The vault (`chrome.storage.local`) holds only ciphertext. Any slot recovers the same random data key (DEK).
- Unlocking decrypts the secrets into `chrome.storage.session`, which is memory-only and cleared when the browser exits. **Lock** clears it immediately.
- Withdrawals and key changes (approve/import API wallet, remove master key, add/remove passkeys) re-authorize with a passkey or the password even while unlocked.
- Host permissions are limited to `api.hyperliquid.xyz` and `api.hyperliquid-testnet.xyz`.

## Passkeys

Passkeys unlock the vault through the WebAuthn PRF extension; they cannot sign Hyperliquid actions (Hyperliquid needs secp256k1, passkeys are P-256). The provider must support PRF: iCloud Keychain (macOS 15.4+) and Google Password Manager do.

Chrome lets an extension use its own ID as the passkey RP ID, so the manifest pins the ID with a public `key` (`afafdoeghnoiaopgfhnipaldoekldgoo`). Without it, loading the unpacked build from another folder would change the ID and orphan enrolled passkeys; the password still unlocks in that case. The matching private key was not kept, so this build cannot be packed as a `.crx` with the same ID.

## viem is pinned

`viem` is pinned to `2.57.11`. viem `2.57.12` rejects EIP-712 struct names containing `:`, and Hyperliquid's user-signed types are named like `HyperliquidTransaction:Withdraw`, so withdraw, transfers, and API wallet approval fail to sign. `src/lib/signing.test.ts` fails if an upgrade reintroduces this.
