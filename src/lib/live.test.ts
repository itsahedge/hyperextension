import { describe, expect, it, vi } from "vitest";
import { acquireFeed, type FeedStart } from "./live";

const tick = () => new Promise((r) => setTimeout(r, 0));

// A fake subscription: `confirm()` resolves it, `fail()` reports a later
// failure, `emit()` pushes an event.
function fakeStart() {
  const unsubscribe = vi.fn(async () => {});
  let confirm!: () => void;
  let reject!: (e: Error) => void;
  let onFail!: () => void;
  let push!: (d: unknown) => void;
  const start = vi.fn<FeedStart>((p, f) => {
    push = p;
    onFail = f;
    return new Promise((res, rej) => {
      confirm = () => res({ unsubscribe });
      reject = rej;
    });
  });
  return { start, unsubscribe, confirm: () => confirm(), reject: (e: Error) => reject(e), fail: () => onFail(), emit: (d: unknown) => push(d) };
}

describe("acquireFeed", () => {
  it("starts one subscription per key and shares it", async () => {
    const f = fakeStart();
    const got: unknown[] = [];
    const a = acquireFeed("k1", f.start, (d) => got.push(d), () => {});
    const b = acquireFeed("k1", f.start, (d) => got.push(d), () => {});
    expect(f.start).toHaveBeenCalledTimes(1);
    f.confirm();
    await tick();
    f.emit("x");
    expect(got).toEqual(["x"]);
    a();
    expect(f.unsubscribe).not.toHaveBeenCalled();
    b();
    await tick();
    expect(f.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("reports live once confirmed, and not live after a failure", async () => {
    const f = fakeStart();
    const states: boolean[] = [];
    const release = acquireFeed("k2", f.start, () => {}, (live) => states.push(live));
    expect(states).toEqual([false]);
    f.confirm();
    await tick();
    expect(states).toEqual([false, true]);
    f.fail();
    expect(states).toEqual([false, true, false]);
    // A late joiner sees the current state immediately.
    const late: boolean[] = [];
    const release2 = acquireFeed("k2", f.start, () => {}, (live) => late.push(live));
    expect(late).toEqual([false]);
    release();
    release2();
  });

  it("stays not live when subscribing is rejected, and can be retried by a new acquire", async () => {
    const f = fakeStart();
    const states: boolean[] = [];
    const release = acquireFeed("k3", f.start, () => {}, (live) => states.push(live));
    f.reject(new Error("socket closed"));
    await tick();
    expect(states).toEqual([false]);
    release();
    const g = fakeStart();
    const release2 = acquireFeed("k3", g.start, () => {}, () => {});
    expect(g.start).toHaveBeenCalledTimes(1);
    release2();
  });

  it("unsubscribes a subscription that confirms after everyone left", async () => {
    const f = fakeStart();
    const states: boolean[] = [];
    const release = acquireFeed("k4", f.start, () => {}, (live) => states.push(live));
    release();
    f.confirm();
    await tick();
    expect(f.unsubscribe).toHaveBeenCalledTimes(1);
    expect(states).toEqual([false]);
  });
});
