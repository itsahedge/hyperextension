export interface UserProfile {
  id: string; // uuid
  ethereum_address: string;
  sub_organization_id: string;
  p256_pub_key: string;
  p256_private_key: string;
  wallet_id: string;
  p256_pub_key_uncompressed: string;
  approved_builder_fee: boolean;
  username?: string;
}
