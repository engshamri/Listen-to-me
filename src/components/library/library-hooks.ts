"use client";

import { useEffect, useState } from "react";
import type { AudioResult } from "@/components/studio/result-panel";
import type { TKey } from "@/lib/i18n/translate";
import { LibraryError, listItems, requestPersistence, saveRecording, subscribe, updateItem, type LibraryErrorCode, type LibraryItem } from "@/lib/library/store";

export function libraryErrorKey(e: unknown): TKey {
  const code: LibraryErrorCode = e instanceof LibraryError ? e.code : "FAILED";
  return `library.errors.${code}`;
}

/** The library's items, kept current across tabs; null while loading. */
export function useLibraryItems(): { items: LibraryItem[] | null; error: unknown } {
  const [state, setState] = useState<{ items: LibraryItem[] | null; error: unknown }>({ items: null, error: null });
  useEffect(() => {
    let alive = true;
    const load = () =>
      listItems().then(
        (items) => alive && setState({ items, error: null }),
        (error: unknown) => alive && setState({ items: [], error }),
      );
    void load();
    const off = subscribe(() => void load());
    return () => {
      alive = false;
      off();
    };
  }, []);
  return state;
}

export async function saveResult(result: AudioResult): Promise<LibraryItem> {
  const item = await saveRecording({
    voiceId: result.voiceId,
    speed: result.speed,
    pitch: result.pitch,
    duration: result.duration,
    size: result.blob.size,
    partsDone: result.partsDone,
    partsTotal: result.partsTotal,
    backupParts: result.backupParts,
    timeline: result.timeline,
    audio: result.blob,
  });
  requestPersistence();
  return item;
}

const SAVE_EVERY_MS = 5000;

/** Remembers where the listener is in a saved recording: every 5 s while playing, and on pause, seek, end or leaving the page. */
export function useSavePosition(audio: HTMLAudioElement | null, id: string | undefined) {
  useEffect(() => {
    if (!audio || !id) return;
    let last = 0;
    let played = false;
    const save = (force: boolean) => {
      const now = Date.now();
      if (!played || (!force && now - last < SAVE_EVERY_MS)) return;
      last = now;
      void updateItem(id, { position: audio.currentTime, lastPlayedAt: now }).catch(() => {});
    };
    const onPlay = () => {
      played = true;
    };
    const onTime = () => {
      if (!audio.paused) save(false);
    };
    const onStop = () => save(true);
    const onHide = () => {
      if (document.visibilityState === "hidden") save(true);
    };
    audio.addEventListener("play", onPlay);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("pause", onStop);
    audio.addEventListener("seeked", onStop);
    audio.addEventListener("ended", onStop);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onStop);
    return () => {
      save(true);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("pause", onStop);
      audio.removeEventListener("seeked", onStop);
      audio.removeEventListener("ended", onStop);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onStop);
    };
  }, [audio, id]);
}

/** True when the listener has started but not finished a recording. */
export function inProgress(item: LibraryItem): boolean {
  return item.lastPlayedAt !== null && item.position > 1 && item.position < item.duration - 2;
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
