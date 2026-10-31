import type { DefineItem, StorageItem, StorageKey } from "./types";

// The part of window.localStorage this uses.
export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

type Raw = string | null;

// Storage items for the web app, shaped like WXT's: "local:" items are JSON in
// localStorage (the encrypted vault, config, prefs), "session:" items live in
// this page's memory only, so decrypted keys never reach disk and a reload
// locks. Values are stored as JSON strings, so every read returns a copy.
export function createWebStorage(local: KeyValue, prefix = "hx:") {
  const memory = new Map<string, string>();
  const listeners = new Map<StorageKey, Set<(next: Raw, prev: Raw) => void>>();

  const isLocal = (key: StorageKey) => key.startsWith("local:");
  const name = (key: StorageKey) => key.slice(key.indexOf(":") + 1);
  const read = (key: StorageKey): Raw => (isLocal(key) ? local.getItem(prefix + name(key)) : (memory.get(name(key)) ?? null));
  const write = (key: StorageKey, raw: Raw) => {
    if (isLocal(key)) {
      if (raw === null) local.removeItem(prefix + name(key));
      else local.setItem(prefix + name(key), raw);
    } else if (raw === null) memory.delete(name(key));
    else memory.set(name(key), raw);
  };
  const notify = (key: StorageKey, next: Raw, prev: Raw) => listeners.get(key)?.forEach((cb) => cb(next, prev));
  const emit = (key: StorageKey, next: Raw, prev: Raw) => {
    if (next !== prev) notify(key, next, prev);
  };
  const change = (key: StorageKey, next: Raw) => {
    const prev = read(key);
    write(key, next);
    emit(key, next, prev);
  };

  const defineItem = (<T>(key: StorageKey, options?: { fallback: T }): StorageItem<T | null> => {
    const fallback = options ? options.fallback : null;
    const parse = (raw: Raw): T | null => (raw === null ? fallback : (JSON.parse(raw) as T));
    return {
      key,
      getValue: async () => parse(read(key)),
      setValue: async (value) => change(key, JSON.stringify(value)),
      removeValue: async () => change(key, null),
      watch(cb) {
        const listener = (next: Raw, prev: Raw) => cb(parse(next), parse(prev));
        let set = listeners.get(key);
        if (!set) listeners.set(key, (set = new Set()));
        set.add(listener);
        return () => void set.delete(listener);
      },
    };
  }) as DefineItem;

  // Feed window "storage" events here: another tab of the app changed
  // localStorage. A null key means localStorage.clear().
  const onExternalChange = (storageKey: string | null, oldValue: Raw, newValue: Raw) => {
    if (storageKey === null) {
      for (const key of listeners.keys()) if (isLocal(key)) notify(key, null, null);
      return;
    }
    if (!storageKey.startsWith(prefix)) return;
    emit(`local:${storageKey.slice(prefix.length)}`, newValue, oldValue);
  };

  return { defineItem, onExternalChange };
}
