// The web app never calls an API directly: every request goes to the Mac
// mini's relay (native/internal/relay), which sends it on through the VPN
// tunnel, or from the Mac mini's own connection while the VPN is off, or not
// at all while it is on but down. The page's CSP allows only its own origin.
//
//   https://api.hyperliquid.xyz/info  ->  https://<page host>/relay/api.hyperliquid.xyz/info
//   wss://api.hyperliquid.xyz/ws      ->  wss://<page host>/relay/api.hyperliquid.xyz/ws
export function relayUrl(url: string, page: { protocol: string; host: string }): string {
  const u = new URL(url);
  if (u.protocol !== "https:" && u.protocol !== "wss:") throw new Error(`Only https or wss URLs can be relayed: ${url}`);
  if (u.port) throw new Error(`Relayed URLs use the default port: ${url}`);
  if (u.username || u.password) throw new Error(`Relayed URLs cannot carry credentials: ${url}`);
  const scheme = u.protocol === "wss:" ? (page.protocol === "https:" ? "wss:" : "ws:") : page.protocol;
  return `${scheme}//${page.host}/relay/${u.hostname}${u.pathname}${u.search}`;
}
