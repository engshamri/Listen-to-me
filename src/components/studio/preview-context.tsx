"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useLatest } from "./hooks";
import { registerExclusivePlayer } from "@/lib/audio/playback";
import { useI18n } from "@/lib/i18n/provider";

type PreviewStatus = "idle" | "loading" | "playing";

interface PreviewContextValue {
  voiceId: string | null;
  status: PreviewStatus;
  toggle: (voiceId: string) => void;
  stop: () => void;
}

const PreviewContext = createContext<PreviewContextValue | null>(null);

/**
 * One shared <audio> element for all voice previews, so only one preview can
 * ever play. It is registered as an exclusive player: starting a preview
 * pauses the result player and vice versa.
 */
export function PreviewProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [status, setStatus] = useState<PreviewStatus>("idle");
  // `pause` events are delivered asynchronously; these refs let handlers
  // ignore events that belong to a preview that has already been replaced.
  const latestId = useRef<string | null>(null);
  const loading = useRef(false);
  const tRef = useLatest(t);

  const reset = useCallback(() => {
    latestId.current = null;
    loading.current = false;
    setStatus("idle");
    setVoiceId(null);
  }, []);

  useEffect(() => {
    const el = new Audio();
    el.preload = "none";
    audioRef.current = el;
    const unregister = registerExclusivePlayer(el);
    const onPlaying = () => {
      loading.current = false;
      setStatus("playing");
    };
    const onStopped = () => {
      if (!loading.current) reset();
    };
    const onError = () => {
      if (!latestId.current) return;
      reset();
      toast.error(tRef.current("voices.previewFailed"));
    };
    el.addEventListener("playing", onPlaying);
    el.addEventListener("ended", onStopped);
    el.addEventListener("pause", onStopped);
    el.addEventListener("error", onError);
    return () => {
      unregister();
      latestId.current = null;
      el.pause();
      el.removeAttribute("src");
      el.removeEventListener("playing", onPlaying);
      el.removeEventListener("ended", onStopped);
      el.removeEventListener("pause", onStopped);
      el.removeEventListener("error", onError);
    };
  }, [reset, tRef]);

  const stop = useCallback(() => {
    loading.current = false;
    audioRef.current?.pause();
    reset();
  }, [reset]);

  const toggle = useCallback(
    (id: string) => {
      const el = audioRef.current;
      if (!el) return;
      if (latestId.current === id) {
        stop();
        return;
      }
      latestId.current = id;
      loading.current = true;
      el.pause();
      el.src = `/api/preview?voice=${encodeURIComponent(id)}`;
      setVoiceId(id);
      setStatus("loading");
      el.play().catch((e: DOMException) => {
        if (latestId.current !== id) return; // replaced by another preview
        if (e?.name === "AbortError" && !el.paused) return;
        reset();
      });
    },
    [stop, reset],
  );

  const value = useMemo(() => ({ voiceId, status, toggle, stop }), [voiceId, status, toggle, stop]);
  return <PreviewContext.Provider value={value}>{children}</PreviewContext.Provider>;
}

export function usePreview(): PreviewContextValue {
  const ctx = useContext(PreviewContext);
  if (!ctx) throw new Error("usePreview must be used inside PreviewProvider");
  return ctx;
}
