"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { libraryErrorKey, useSavePosition } from "./library-hooks";
import { useLatest, useSpeechSettings } from "@/components/studio/hooks";
import { seekAndPlay } from "@/components/studio/read-along";
import { ReadingMode } from "@/components/studio/reading-mode";
import { registerExclusivePlayer, setListeningSpeed } from "@/lib/audio/playback";
import { useI18n } from "@/lib/i18n/provider";
import { loadRecording, type Recording } from "@/lib/library/store";

/**
 * Plays a saved recording in the full-screen reading mode, from where the
 * listener stopped. Render it with `key={id}` so each recording starts fresh.
 */
export function LibraryPlayer({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useI18n();
  const [settings] = useSpeechSettings();
  const [loaded, setLoaded] = useState<{ recording: Recording; url: string } | null>(null);
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);
  const latest = useLatest({ t, onClose });

  useEffect(() => {
    let alive = true;
    let url: string | null = null;
    loadRecording(id).then(
      (recording) => {
        if (!alive) return;
        url = URL.createObjectURL(recording.audio);
        setLoaded({ recording, url });
      },
      (e: unknown) => {
        if (!alive) return;
        toast.error(latest.current.t(libraryErrorKey(e)));
        latest.current.onClose();
      },
    );
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, latest]);

  useEffect(() => (audio ? registerExclusivePlayer(audio) : undefined), [audio]);

  useEffect(() => {
    if (audio) setListeningSpeed(audio, settings.playbackRate);
  }, [audio, settings.playbackRate]);

  // Start from where the listener stopped (or from the beginning once finished).
  useEffect(() => {
    if (!audio || !loaded) return;
    const { position, duration } = loaded.recording.item;
    const start = () => seekAndPlay(audio, position > 1 && position < duration - 2 ? position : 0);
    if (audio.readyState >= 1) {
      start();
      return;
    }
    audio.addEventListener("loadedmetadata", start, { once: true });
    return () => audio.removeEventListener("loadedmetadata", start);
  }, [audio, loaded]);

  useSavePosition(audio, loaded ? id : undefined);

  if (!loaded) return null;
  const { item, timeline } = loaded.recording;
  return (
    <>
      <audio ref={setAudio} src={loaded.url} preload="auto" hidden />
      <ReadingMode
        open
        onOpenChange={(open) => {
          if (open) return;
          audio?.pause();
          onClose();
        }}
        audio={audio}
        timeline={timeline}
        duration={item.duration}
        title={item.title}
      />
    </>
  );
}
