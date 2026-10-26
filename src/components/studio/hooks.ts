"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { MAX_TEXT_CHARS } from "@/lib/files/limits";
import { DEFAULT_VOICE_ID, isKnownVoice, suggestVoiceId } from "@/lib/voices/catalog";

const SETTINGS_KEY = "asmani:settings";
const DRAFT_KEY = "asmani:draft";

/** A ref that always holds the latest value, for reading inside event handlers. */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

// ---------------------------------------------------------------------------
// Speech settings: an external store backed by localStorage. The server
// snapshot is the defaults, so hydration matches; the client then switches to
// the saved values. Changes in another tab are picked up via `storage` events.
// ---------------------------------------------------------------------------

export interface SpeechSettings {
  voiceId: string;
  speed: number;
  pitch: number;
  pauses: boolean;
  /** Highlight the text while it is read (read-along). */
  readAlong: boolean;
  /** Listening speed of the player (changes playback only, not the generated audio). */
  playbackRate: number;
  /** Text size step in the full-screen reading mode. */
  readingSize: number;
  /** Save every new recording to the library. */
  autoSave: boolean;
}

export const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;
export const READING_SIZES = [18, 21, 24, 28, 32] as const;

export const DEFAULT_SETTINGS: SpeechSettings = { voiceId: DEFAULT_VOICE_ID, speed: 1, pitch: 0, pauses: true, readAlong: true, playbackRate: 1, readingSize: 1, autoSave: false };

function clamp(n: unknown, min: number, max: number, fallback: number): number {
  return typeof n === "number" && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function loadSettings(): SpeechSettings {
  let saved: Partial<SpeechSettings> | null = null;
  try {
    saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null");
  } catch {
    saved = null;
  }
  return {
    voiceId: isKnownVoice(saved?.voiceId) ? saved.voiceId : suggestVoiceId(navigator.languages?.length ? navigator.languages : [navigator.language]),
    speed: clamp(saved?.speed, 0.5, 2, 1),
    pitch: clamp(saved?.pitch, -20, 20, 0),
    pauses: typeof saved?.pauses === "boolean" ? saved.pauses : true,
    readAlong: typeof saved?.readAlong === "boolean" ? saved.readAlong : true,
    playbackRate: PLAYBACK_RATES.includes(saved?.playbackRate as (typeof PLAYBACK_RATES)[number]) ? saved!.playbackRate! : 1,
    readingSize: Math.round(clamp(saved?.readingSize, 0, READING_SIZES.length - 1, 1)),
    autoSave: saved?.autoSave === true,
  };
}

let settingsCache: SpeechSettings | null = null;
const settingsListeners = new Set<() => void>();

function subscribeSettings(listener: () => void) {
  settingsListeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== SETTINGS_KEY) return;
    settingsCache = loadSettings();
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    settingsListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function getSettings(): SpeechSettings {
  settingsCache ??= loadSettings();
  return settingsCache;
}

function setSettings(patch: Partial<SpeechSettings>) {
  settingsCache = { ...getSettings(), ...patch };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settingsCache));
  } catch {
    // Storage blocked (private mode): settings simply won't persist.
  }
  settingsListeners.forEach((l) => l());
}

export function useSpeechSettings() {
  const settings = useSyncExternalStore(subscribeSettings, getSettings, () => DEFAULT_SETTINGS);
  return [settings, setSettings] as const;
}

// ---------------------------------------------------------------------------
// Draft text: autosaved (debounced) so a refresh or crash doesn't lose work.
// ---------------------------------------------------------------------------

let savedDraftAtLoad: string | null | undefined;

function getSavedDraft(): string | null {
  if (savedDraftAtLoad === undefined) {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      savedDraftAtLoad = saved && saved.trim() ? saved : null;
    } catch {
      savedDraftAtLoad = null;
    }
  }
  return savedDraftAtLoad;
}

const noopSubscribe = () => () => {};

/** The draft that was saved before this page load (null on the server). */
export function useSavedDraft(): string | null {
  return useSyncExternalStore(noopSubscribe, getSavedDraft, () => null);
}

export function useDraftAutosave(text: string, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const id = setTimeout(() => {
      try {
        if (!text.trim()) localStorage.removeItem(DRAFT_KEY);
        else if (text.length <= MAX_TEXT_CHARS) localStorage.setItem(DRAFT_KEY, text);
      } catch {}
    }, 600);
    return () => clearTimeout(id);
  }, [text, enabled]);
}

export function clearSavedDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {}
}

// ---------------------------------------------------------------------------

export interface HealthState {
  loaded: boolean;
  converter: boolean;
  /** Largest MP3 the server can convert to M4A/MP4. */
  convertMaxBytes: number;
  backupVoice: boolean;
}

export function useHealth(): HealthState {
  const [health, setHealth] = useState<HealthState>({ loaded: false, converter: true, convertMaxBytes: Number.POSITIVE_INFINITY, backupVoice: true });
  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/health", { signal: ctrl.signal })
      .then((r) => r.json())
      .then((h: Omit<HealthState, "loaded">) => setHealth({ loaded: true, converter: h.converter, convertMaxBytes: h.convertMaxBytes, backupVoice: h.backupVoice }))
      .catch(() => {});
    return () => ctrl.abort();
  }, []);
  return health;
}

/** Whole seconds since `startedAt` (ms timestamp), ticking once a second; 0 when null. */
export function useElapsed(startedAt: number | null): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (startedAt === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  return startedAt === null ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000));
}

/** False during server rendering and hydration, true afterwards. */
export function useHydrated(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}
