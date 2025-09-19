import React, { useState, useEffect } from "react";
import { supabase } from "../../core/supabase";
import { TurnkeyClientHelper } from "@/lib/turnkey/index";
import { decryptExportBundle } from "@turnkey/crypto";
import { Modal, Button, Group, Tabs } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import WithdrawFunds from "./WithdrawFunds";
import { AssetList, AssetName } from "./components/AssetList";
import { DepositAsset } from "./DepositAsset";
import { checksumAddress } from "viem";
import TransferFunds from "./TransferFunds";

export default function WalletPage() {
  const [decryptedKey, setDecryptedKey] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [ethereumAddress, setEthereumAddress] = useState<string>("");
  const [walletLoading, setWalletLoading] = useState(true);
  const [walletError, setWalletError] = useState<string | null>(null);

  const [opened, { open, close }] = useDisclosure(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [depositAsset, setDepositAsset] = useState<string | null>(null);
  const [tab, setTab] = useState<string>("receive");

  useEffect(() => {
    // Fetch ethereum_address from Supabase profiles for the current user
    const fetchEthereumAddress = async () => {
      setWalletLoading(true);
      setWalletError(null);
      setEthereumAddress("");
      try {
        const { data: userData, error: userError } =
          await supabase.auth.getUser();
        if (userError || !userData?.user) {
          setWalletError("No user logged in");
          return;
        }
        const userId = userData.user.id;
        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("ethereum_address")
          .eq("id", userId)
          .single();
        if (profileError) {
          setWalletError(profileError.message);
          return;
        }
        if (!profile || !profile.ethereum_address) {
          setWalletError("No ethereum address found");
          return;
        }
        setEthereumAddress(profile.ethereum_address);
      } catch (err: any) {
        setWalletError(err.message || String(err));
      } finally {
        setWalletLoading(false);
      }
    };
    fetchEthereumAddress();
  }, []);

  const handleExportWallet = async () => {
    setExporting(true);
    setError(null);
    setDecryptedKey(null);
    try {
      const { data: userData, error: userError } =
        await supabase.auth.getUser();
      if (userError || !userData?.user) {
        setError("No user logged in");
        return;
      }
      const userId = userData.user.id;
      const { data, error: profileError } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId);
      if (profileError) {
        setError(profileError.message);
        return;
      }
      if (!data || !data[0]) {
        setError("No user data found");
        return;
      }
      const userProfile = data[0];
      const {
        ethereum_address,
        p256_pub_key,
        p256_private_key,
        p256_pub_key_uncompressed,
        sub_organization_id,
        wallet_id,
      } = userProfile;
      const userTurnkeyClientHelper = new TurnkeyClientHelper({
        apiPublicKey: p256_pub_key,
        apiPrivateKey: p256_private_key,
        organizationId: sub_organization_id,
      }).getClient();
      await userTurnkeyClientHelper.getWallets({
        organizationId: sub_organization_id,
      });
      await userTurnkeyClientHelper.getWalletAccounts({
        walletId: wallet_id,
        organizationId: sub_organization_id,
      });

      const exportEVMResult = await userTurnkeyClientHelper.exportWalletAccount(
        {
          address: checksumAddress(ethereum_address),
          targetPublicKey: p256_pub_key_uncompressed,
        }
      );
      const decrypted = await decryptExportBundle({
        exportBundle: exportEVMResult.exportBundle,
        embeddedKey: p256_private_key,
        organizationId: sub_organization_id,
        returnMnemonic: false,
        keyFormat: "HEXADECIMAL",
      });
      setDecryptedKey(decrypted);
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setExporting(false);
    }
  };

  if (showWithdraw) {
    return <WithdrawFunds onBack={() => setShowWithdraw(false)} />;
  }

  if (showTransfer) {
    return <TransferFunds onBack={() => setShowTransfer(false)} />;
  }

  if (depositAsset) {
    return (
      <DepositAsset
        assetName={depositAsset as AssetName}
        userAddress={ethereumAddress}
        onBack={() => setDepositAsset(null)}
      />
    );
  }

  return (
    <div style={{ color: "#fff", padding: 16 }}>
      <Tabs value={tab} onChange={(value) => setTab(value || "receive")}>
        <Tabs.List grow justify="space-between">
          <Tabs.Tab value="receive">Receive</Tabs.Tab>
          <Tabs.Tab value="transfer">Transfer</Tabs.Tab>
          <Tabs.Tab value="withdraw">Withdraw</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="receive">
          {/* Asset List */}
          <AssetList onAssetClick={(assetName) => setDepositAsset(assetName)} />

          {/* Modal and Button for showing address */}
          <div style={{ marginTop: 24, marginBottom: 16 }}>
            <Button variant="default" onClick={open}>
              Export Wallet
            </Button>
          </div>
          <Modal
            opened={opened}
            onClose={close}
            title="Ethereum Address"
            withinPortal={false}
            closeButtonProps={{
              style: {
                width: 24,
                height: 24,
                minWidth: 24,
                minHeight: 24,
                padding: 0,
              },
            }}
          >
            <style>
              {`
                .mantine-Modal-close {
                  width: 24px !important;
                  height: 24px !important;
                  min-width: 24px !important;
                  min-height: 24px !important;
                  padding: 0 !important;
                }
                .mantine-Modal-close svg {
                  width: 16px !important;
                  height: 16px !important;
                }
              `}
            </style>
            <div
              style={{
                fontFamily: "monospace",
                fontSize: 16,
                wordBreak: "break-all",
                marginBottom: 16,
              }}
            >
              {ethereumAddress}
            </div>
            <button
              onClick={handleExportWallet}
              disabled={exporting}
              style={{
                padding: "8px 20px",
                fontSize: 16,
                borderRadius: 8,
                background: "#ffb347",
                color: "#111",
                border: "none",
                fontWeight: 600,
                cursor: "pointer",
                marginTop: 8,
              }}
            >
              {exporting ? "Exporting..." : "Export Wallet"}
            </button>
            {error && (
              <div style={{ color: "salmon", marginTop: 16 }}>{error}</div>
            )}
            {decryptedKey && (
              <pre
                style={{
                  marginTop: 16,
                  background: "#181A20",
                  color: "#fff",
                  padding: 12,
                  borderRadius: 8,
                  maxWidth: 600,
                  overflowX: "auto",
                }}
              >
                {decryptedKey}
              </pre>
            )}
          </Modal>
        </Tabs.Panel>
        <Tabs.Panel value="transfer">
          <TransferFunds onBack={() => setTab("receive")} />
        </Tabs.Panel>
        <Tabs.Panel value="withdraw">
          <WithdrawFunds onBack={() => setTab("receive")} />
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}
