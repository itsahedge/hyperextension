export interface GenerateDepositAddressResponse {
  address: string;
  signatures: Signatures;
  status: string;
}

export interface Signatures {
  "field-node": string;
  "hl-node": string;
  "unit-node": string;
}
