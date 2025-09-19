import { Turnkey } from "@turnkey/sdk-server";

const turnkeyOrgId = process.env.TURNKEY_ORGANIZATION_ID!;
const turnkeyPublicKey = process.env.TURNKEY_PUBLIC_KEY!;
const turnkeyPrivateKey = process.env.TURNKEY_PRIVATE_KEY!;

const turnkey = new Turnkey({
  apiBaseUrl: "https://api.turnkey.com",
  apiPublicKey: turnkeyPublicKey,
  apiPrivateKey: turnkeyPrivateKey,
  defaultOrganizationId: turnkeyOrgId,
});

const turnkeyProxyHandler = turnkey.nextProxyHandler({
  allowedMethods: ["createSubOrganization", "emailAuth", "getSubOrgIds"],
});

export {
  turnkeyProxyHandler as GET,
  turnkeyProxyHandler as POST,
  turnkeyProxyHandler as OPTIONS,
};
export default turnkeyProxyHandler;
