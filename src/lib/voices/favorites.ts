"use client";

import { useCallback, useSyncExternalStore } from "react";
import { isKnownVoice } from "./catalog";

/**
 * Favorite voices, saved in this browser (there are no user accounts).
 * Kept in localStorage, newest first, and synced across open tabs.
 */
const KEY = "asmani:favorites";
const MAX = 100;
const EMPTY: readonly string[] = [];

let cache: readonly string[] | null = null;
const listeners = new Set<() => void>();

function load(): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(parsed)) return EMPTY;
    // Drop ids of voices that no longer exist and any duplicates.
    return [...new Set(parsed.filter(isKnownVoice))].slice(0, MAX);
  } catch {
    return EMPTY;
  }
}

function getSnapshot(): readonly string[] {
  cache ??= load();
  return cache;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    cache = load();
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function save(next: readonly string[]) {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage blocked: favorites work for this visit only.
  }
  listeners.forEach((l) => l());
}

export function toggleFavorite(id: string): boolean {
  const current = getSnapshot();
  const isFav = current.includes(id);
  save(isFav ? current.filter((x) => x !== id) : [id, ...current].slice(0, MAX));
  return !isFav;
}

export function useFavorites() {
  const ids = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
  const isFavorite = useCallback((id: string) => ids.includes(id), [ids]);
  return { ids, isFavorite, toggle: toggleFavorite };
}
