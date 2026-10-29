import { pacScript, type VpnExit, type VpnLocation, type VpnSettings, type VpnState } from "./vpn";

// The subset of chrome.runtime.Port the controller uses.
export interface NativePort {
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: { addListener(cb: (message: unknown) => void): void };
  onDisconnect: { addListener(cb: () => void): void };
}

export interface VpnDeps {
  connect(): NativePort;
  // chrome.runtime.lastError message inside onDisconnect.
  lastError(): string | undefined;
  setPac(script: string): Promise<void>;
  clearProxy(): Promise<void>;
  load(): Promise<VpnSettings>;
  save(settings: VpnSettings): Promise<void>;
  hosts: string[];
}

// Reply shape from native/internal/nmhost.Response.
interface HelperReply {
  id: number;
  type: string;
  error?: string;
  servers?: VpnLocation[];
  up?: boolean;
  port?: number;
  endpoint?: string;
  check?: { tunnel: VpnExit; direct: VpnExit };
  lastHandshake?: number;
  unhealthy?: string;
}

// The helper's own "up" deadline is 45 s (tunnel, two IP lookups).
const UP_TIMEOUT_MS = 60_000;
const REQUEST_TIMEOUT_MS = 30_000;

// Chrome's runtime.lastError texts for a missing or unauthorized host.
export function helperError(message: string | undefined): string {
  if (!message) return "The VPN helper exited";
  if (/not found/i.test(message)) return "The VPN helper is not installed. Run `pnpm vpn:install`, then try again.";
  if (/forbidden/i.test(message)) return "The VPN helper is not registered for this extension. Run `pnpm vpn:install` again.";
  return `VPN helper: ${message}`;
}

export class VpnController {
  private port: NativePort | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: HelperReply) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private info: { endpoint: string; exit: VpnExit; direct: VpnExit } | null = null;
  private error: string | undefined;

  constructor(private deps: VpnDeps) {}

  // On worker start: if the VPN is meant to be on, nothing is connected yet,
  // so routed hosts are blocked until the user reconnects or turns it off.
  async init() {
    if ((await this.deps.load()).enabled) await this.block();
  }

  async state(): Promise<VpnState> {
    const settings = await this.deps.load();
    let health: Pick<VpnState, "lastHandshake" | "unhealthy"> = {};
    if (this.info && this.port) {
      try {
        const r = await this.request({ type: "status" });
        if (r.up) health = { lastHandshake: r.lastHandshake, unhealthy: r.unhealthy };
        else await this.lost("The VPN tunnel stopped");
      } catch (err) {
        await this.lost((err as Error).message);
      }
    }
    return {
      enabled: settings.enabled,
      connected: this.info !== null,
      location: settings.location,
      endpoint: this.info?.endpoint,
      exit: this.info?.exit,
      direct: this.info?.direct,
      ...health,
      error: this.error,
    };
  }

  async servers(): Promise<VpnLocation[]> {
    const opened = this.port === null;
    try {
      return (await this.request({ type: "servers" })).servers ?? [];
    } finally {
      // Another request (e.g. an up started meanwhile) may share the port.
      if (opened && !this.info && this.pending.size === 0) this.close();
    }
  }

  async up(conf: string, location?: VpnLocation): Promise<VpnState> {
    await this.deps.save({ enabled: true, location });
    // Fail closed first: nothing routed may go direct while connecting.
    await this.block();
    this.info = null;
    this.error = undefined;
    try {
      const r = await this.request(
        { type: "up", conf, hosts: this.deps.hosts, server: location ? { host: location.host, publicKey: location.publicKey } : undefined },
        UP_TIMEOUT_MS,
      );
      if (!r.up || !r.port || !r.check || !r.endpoint) throw new Error("The VPN helper sent an incomplete reply");
      await this.deps.setPac(pacScript(this.deps.hosts, r.port));
      this.info = { endpoint: r.endpoint, exit: r.check.tunnel, direct: r.check.direct };
    } catch (err) {
      this.error = (err as Error).message;
      await this.block();
    }
    return this.state();
  }

  async down(): Promise<VpnState> {
    const { location } = await this.deps.load();
    await this.deps.save({ enabled: false, location });
    this.info = null;
    this.error = undefined;
    if (this.port) {
      try {
        await this.request({ type: "down" });
      } catch {
        // Closing the port stops the helper anyway.
      }
      this.close();
    }
    await this.deps.clearProxy();
    return this.state();
  }

  private async lost(message: string) {
    this.info = null;
    this.error = message;
    this.close();
    if ((await this.deps.load()).enabled) await this.block();
  }

  private block() {
    return this.deps.setPac(pacScript(this.deps.hosts, null));
  }

  private close() {
    const port = this.port;
    this.port = null;
    port?.disconnect();
    this.rejectAll(new Error("The VPN helper was stopped"));
  }

  private rejectAll(err: Error) {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(err);
    }
    this.pending.clear();
  }

  private ensurePort(): NativePort {
    if (this.port) return this.port;
    const port = this.deps.connect();
    port.onMessage.addListener((message) => {
      const reply = message as HelperReply;
      const entry = this.pending.get(reply?.id);
      if (!entry) return;
      this.pending.delete(reply.id);
      clearTimeout(entry.timer);
      if (reply.error) entry.reject(new Error(reply.error));
      else entry.resolve(reply);
    });
    port.onDisconnect.addListener(() => {
      if (port !== this.port) return;
      const message = helperError(this.deps.lastError());
      this.port = null;
      const wasUp = this.info !== null;
      this.info = null;
      this.rejectAll(new Error(message));
      if (wasUp) {
        this.error = message;
        void this.deps.load().then((s) => (s.enabled ? this.block() : undefined));
      }
    });
    this.port = port;
    return port;
  }

  private request(message: Record<string, unknown>, timeoutMs = REQUEST_TIMEOUT_MS): Promise<HelperReply> {
    const port = this.ensurePort();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`The VPN helper did not answer "${String(message.type)}" in time`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      port.postMessage({ ...message, id });
    });
  }
}
