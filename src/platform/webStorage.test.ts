import { describe, expect, it, vi } from "vitest";
import { createWebStorage, type KeyValue } from "./webStorage";

function memoryLocal(): KeyValue & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe("createWebStorage", () => {
  it("persists local items as JSON under the prefix", async () => {
    const local = memoryLocal();
    const item = createWebStorage(local).defineItem<{ a: number }>("local:vault");
    expect(await item.getValue()).toBeNull();
    await item.setValue({ a: 1 });
    expect(local.data.get("hx:vault")).toBe('{"a":1}');
    expect(await item.getValue()).toEqual({ a: 1 });
    await item.removeValue();
    expect(local.data.has("hx:vault")).toBe(false);
    expect(await item.getValue()).toBeNull();
  });

  it("keeps session items in memory only", async () => {
    const local = memoryLocal();
    const store = createWebStorage(local);
    await store.defineItem<string>("session:unlocked").setValue("secret");
    expect(local.data.size).toBe(0);
    expect(await store.defineItem<string>("session:unlocked").getValue()).toBe("secret");
    // A new page load is a new store: session values are gone, local ones stay.
    await store.defineItem<number>("local:prefs").setValue(1);
    const reloaded = createWebStorage(local);
    expect(await reloaded.defineItem<string>("session:unlocked").getValue()).toBeNull();
    expect(await reloaded.defineItem<number>("local:prefs").getValue()).toBe(1);
  });

  it("does not share values between local and session items with the same name", async () => {
    const store = createWebStorage(memoryLocal());
    await store.defineItem<number>("local:x").setValue(1);
    expect(await store.defineItem<number>("session:x").getValue()).toBeNull();
  });

  it("returns copies, so callers cannot mutate stored values", async () => {
    const item = createWebStorage(memoryLocal()).defineItem<{ list: number[] }>("session:s");
    const value = { list: [1] };
    await item.setValue(value);
    value.list.push(2);
    const read = await item.getValue();
    read!.list.push(3);
    expect(await item.getValue()).toEqual({ list: [1] });
  });

  it("applies the fallback when the value is missing", async () => {
    const item = createWebStorage(memoryLocal()).defineItem("local:vpn", { fallback: { enabled: false } });
    expect(await item.getValue()).toEqual({ enabled: false });
  });

  it("notifies watchers of changes with the new and previous values", async () => {
    const item = createWebStorage(memoryLocal()).defineItem<number>("session:n");
    const cb = vi.fn();
    const stop = item.watch(cb);
    await item.setValue(1);
    await item.setValue(1); // unchanged: no event
    await item.setValue(2);
    await item.removeValue();
    expect(cb.mock.calls).toEqual([
      [1, null],
      [2, 1],
      [null, 2],
    ]);
    stop();
    await item.setValue(3);
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it("notifies every item defined for the same key", async () => {
    const store = createWebStorage(memoryLocal());
    const cb = vi.fn();
    store.defineItem<number>("local:k").watch(cb);
    await store.defineItem<number>("local:k").setValue(5);
    expect(cb).toHaveBeenCalledWith(5, null);
  });

  it("relays another tab's localStorage change to local watchers only", () => {
    const store = createWebStorage(memoryLocal());
    const local = vi.fn();
    const session = vi.fn();
    store.defineItem<number>("local:vault").watch(local);
    store.defineItem<number>("session:vault").watch(session);
    store.onExternalChange("hx:vault", null, "7");
    store.onExternalChange("other:vault", null, "8"); // not ours
    expect(local.mock.calls).toEqual([[7, null]]);
    // localStorage.clear() in another tab reports no key: every local item
    // may have changed, and the previous values are unknown.
    store.onExternalChange(null, null, null);
    expect(local.mock.calls).toEqual([
      [7, null],
      [null, null],
    ]);
    expect(session).not.toHaveBeenCalled();
  });
});
