import React from "react";

type WithdrawFundsProps = {
  onBack: () => void;
};

export default function WithdrawFunds({ onBack }: WithdrawFundsProps) {
  return (
    <div style={{ color: '#fff', padding: 16 }}>
      <button onClick={onBack} style={{ marginBottom: 16, padding: '6px 16px', borderRadius: 6, background: '#23242A', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 500 }}>
        ← Back
      </button>
      <h2>Withdraw Funds Page</h2>
      {/* TODO: need to notify the user that they should NOT withdraw funds to their Turnkey Wallet address, otherwise our service might re-deposit it */}
      <h3>TODO: need to notify the user that they should NOT withdraw funds to their Turnkey Wallet address, otherwise our service might re-deposit it</h3>
    </div>
  );
}