import { useEffect, useState } from "react";
import { AssetName } from "./components/AssetList";
import { HyperunitClient } from "@/lib/hyperunit/client";
import { MainLoader } from "@/app/components/Loader";
import { Modal, Button } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { QRCodeSVG } from 'qrcode.react';

// TODO:
// better UX would be if we just generated all the deposit addresses ahead of time, so we dont have to keep hitting the hyperunit endpoint every time

type AssetDepositInfo = {
  minimum?: string;
  networkInstruction?: string;
};

const assetDepositInfo: Record<AssetName, AssetDepositInfo> = {
  USDC: {
    networkInstruction: "Only send USDC on the Arbitrum or Hyperliquid Core network (not HyperEVM) to this wallet address. Sending NFTs, other crypto or USDC over a different network can lead to a loss of funds. Bridging is powered by Hyperunit protocol.",
  },
  "Hyperliquid Core tokens": {
    networkInstruction:
      "Only send tokens on the Hyperliquid Core network (not HyperEVM) to this wallet address. Sending tokens over a different network can lead to a loss of funds.",
  },
  Solana: {
    minimum: "0.1 SOL minimum",
    networkInstruction:
      "Only send SOL on the Solana network to this wallet address. Sending NFTs or other crypto, or sending SOL over a different network, can lead to a loss of funds. Bridging is powered by Hyperunit protocol.",
  },
  Ethereum: {
    minimum: "0.05 ETH minimum",
    networkInstruction: "Only send ETH on the Ethereum network to this wallet address. Sending NFTs, other crypto or ETH over a different network can lead to a loss of funds. Bridging is powered by Hyperunit protocol.",
  },
  Bitcoin: {
    minimum: "0.002 BTC minimum",
    networkInstruction: "Only send BTC on the Bitcoin network to this wallet address. Sending other crypto or BTC over a different network can lead to a loss of funds. Bridging is powered by Hyperunit protocol.",
  },
};

// Mapping from AssetName to Hyperunit API srcChain and asset
const assetApiParams: Record<AssetName, { srcChain: string; asset: string } | null> = {
  USDC: null,
  Bitcoin: { srcChain: "bitcoin", asset: "btc" },
  Ethereum: { srcChain: "ethereum", asset: "eth" },
  Solana: { srcChain: "solana", asset: "sol" },
  "Hyperliquid Core tokens": null,
};

// Helper to check if asset is simple (just show userAddress)
const isSimpleAsset = (assetName: AssetName) => assetName === 'USDC' || assetName === 'Hyperliquid Core tokens';

// Reusable DepositAsset sub-page for all assets
export const DepositAsset = ({ assetName, userAddress, onBack }: { assetName: AssetName; userAddress: string; onBack: () => void }) => {
  const { minimum, networkInstruction } = assetDepositInfo[assetName];

  // Generalized deposit address state
  const [depositAddress, setDepositAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [qrOpen, { open: openQR, close: closeQR }] = useDisclosure(false);

  useEffect(() => {
    const apiParams = assetApiParams[assetName];
    if (isSimpleAsset(assetName) && userAddress) {
      setDepositAddress(userAddress);
      setLoading(false);
      setError(null);
      return;
    }
    if (apiParams && userAddress) {
      setLoading(true);
      setError(null);
      setDepositAddress(null);
      const client = new HyperunitClient();
      client.generateDepositAddress(apiParams.srcChain, apiParams.asset, userAddress)
        .then((res) => {
          setDepositAddress(res.address);
        })
        .catch((err) => {
          setError(err.message || String(err));
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [assetName, userAddress]);

  // Render deposit address box (with loading/error for non-simple assets)
  const renderDepositAddress = () => {
    if (!depositAddress && !loading && !error) return null;
    if (!isSimpleAsset(assetName)) {
      if (loading) return <MainLoader />;
      if (error) return <div style={{ color: 'salmon' }}>{error}</div>;
    }
    return (
      <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
        {depositAddress && (
          <div style={{ background: '#fff', padding: 8, borderRadius: 8, display: 'inline-block', marginBottom: 12 }}>
            <QRCodeSVG value={depositAddress} size={180} bgColor="#fff" fgColor="#181A20" style={{ display: 'block' }} />
          </div>
        )}
        <div style={{ fontFamily: 'monospace', fontSize: 16, wordBreak: 'break-all', background: '#181A20', padding: 8, borderRadius: 6, marginBottom: 12, textAlign: 'center', width: '100%' }}>{depositAddress}</div>
      </div>
    );
  };

  return (
    <div style={{ color: '#fff', padding: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
      <button onClick={onBack} style={{ marginBottom: 16, padding: '6px 16px', borderRadius: 6, background: '#23242A', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 500, alignSelf: 'flex-start' }}>
        ← Back
      </button>
      <h2 style={{ textAlign: 'center', width: '100%' }}>Deposit {assetName}</h2>
      {renderDepositAddress()}
      {minimum && <div style={{ color: '#ffb347', fontWeight: 600, marginBottom: 12 }}>{minimum}</div>}
      {networkInstruction && (
        <div style={{ color: '#ffb347', fontWeight: 500, marginBottom: 12, fontSize: 15 }}>
          {networkInstruction}
        </div>
      )}
    </div>
  );
}