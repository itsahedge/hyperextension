import usdcIcon from "data-base64:~assets/usdc-small.png";
import btcIcon from "data-base64:~assets/bitcoin-small.png";
import ethIcon from "data-base64:~assets/ethereum-small.png";
import solIcon from "data-base64:~assets/solana-small.png";
import hypeIcon from "data-base64:~assets/hyperliquid.png";

// Define AssetName type
export type AssetName =
  | "USDC"
  | "Bitcoin"
  | "Ethereum"
  | "Solana"
  | "Hyperliquid Core tokens";

export const assetNames: AssetName[] = [
  "USDC",
  "Bitcoin",
  "Ethereum",
  "Solana",
  "Hyperliquid Core tokens",
];

// AssetListItem component
export const AssetListItem = ({ icon, name, network, onClick }: { icon: string; name: AssetName; network: string; onClick?: () => void }) => {
  const clickable = !!onClick;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '10px 0',
        cursor: clickable ? 'pointer' : 'default',
        opacity: clickable ? 1 : 0.7,
      }}
      onClick={onClick}
      tabIndex={clickable ? 0 : -1}
      role={clickable ? 'button' : undefined}
    >
      <img src={icon as unknown as string} alt={name} width={36} height={36} />
      <div>
        <div style={{ fontSize: 18, fontWeight: 500 }}>{name}</div>
        <div style={{ fontSize: 14, color: '#aaa' }}>{network}</div>
      </div>
    </div>
  );
}

// AssetList component
export const AssetList = ({ onAssetClick }: { onAssetClick?: (assetName: AssetName) => void }) => {
  const assets: { icon: string; name: AssetName; network: string }[] = [
    { icon: usdcIcon as unknown as string, name: 'USDC', network: 'Arbitrum, Hyperliquid network' },
    { icon: btcIcon as unknown as string, name: 'Bitcoin', network: 'Bitcoin network' },
    { icon: ethIcon as unknown as string, name: 'Ethereum', network: 'Ethereum network' },
    { icon: solIcon as unknown as string, name: 'Solana', network: 'Solana network' },
    { icon: hypeIcon as unknown as string, name: 'Hyperliquid Core tokens', network: 'Hyperliquid Core network' },
  ];
  return (
    <div style={{ margin: '32px 0 24px 0' }}>
      <div style={{ fontSize: 22, fontWeight: 600, marginBottom: 16 }}>Select currency</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {assets.map((asset) => (
          <AssetListItem
            key={asset.name}
            icon={asset.icon}
            name={asset.name}
            network={asset.network}
            onClick={onAssetClick ? () => onAssetClick(asset.name) : undefined}
          />
        ))}
      </div>
    </div>
  );
}