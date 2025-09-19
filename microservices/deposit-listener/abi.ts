// Minimal ABI for Transfer event
export const USDC_ABI = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "from", type: "address" },
      { indexed: true, internalType: "address", name: "to", type: "address" },
      {
        indexed: false,
        internalType: "uint256",
        name: "value",
        type: "uint256",
      },
    ],
    name: "Transfer",
    type: "event",
  },
  {
    constant: true,
    inputs: [
      {
        name: "account",
        type: "address",
      },
    ],
    name: "balanceOf",
    outputs: [
      {
        name: "",
        type: "uint256",
      },
    ],
    payable: false,
    stateMutability: "view",
    type: "function",
  },
] as const;

// Correct ABI for batchedDepositWithPermit
export const BATCHED_DEPOSIT_WITH_PERMIT_ABI = [
  {
    inputs: [
      {
        components: [
          { internalType: "address", name: "user", type: "address" },
          { internalType: "uint64", name: "usd", type: "uint64" },
          { internalType: "uint64", name: "deadline", type: "uint64" },
          {
            components: [
              { internalType: "uint256", name: "r", type: "uint256" },
              { internalType: "uint256", name: "s", type: "uint256" },
              { internalType: "uint8", name: "v", type: "uint8" },
            ],
            internalType: "struct Signature",
            name: "signature",
            type: "tuple",
          },
        ],
        internalType: "struct DepositWithPermit[]",
        name: "deposits",
        type: "tuple[]",
      },
    ],
    name: "batchedDepositWithPermit",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
];
