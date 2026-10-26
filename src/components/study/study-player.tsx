"use client";

import { Bookmark, Loader2, Pause, Play, Repeat1, SkipBack, SkipForward, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { PLAYBACK_RATES, useSpeechSettings } from "@/components/studio/hooks";
import { seekAndPlay, seekTo, useReadAlong } from "@/components/studio/read-along";
import { sentenceStart } from "@/components/studio/reading-mode";
import { Button } from "@/components/ui/button";
import { mp3DurationSeconds } from "@/lib/audio/mp3";
import { registerExclusivePlayer, setListeningSpeed } from "@/lib/audio/playback";
import { useI18n } from "@/lib/i18n/provider";
import { prepareForSpeech, splitIntoChunks } from "@/lib/text/chunk";
import { detectScript } from "@/lib/text/stats";
import { assemble, createJob, runJob } from "@/lib/tts/engine";
import { buildTimeline, EMPTY_TIMELINE, type Timeline } from "@/lib/tts/timeline";
import { DEFAULT_VOICE_ID, getVoice, type Voice } from "@/lib/voices/catalog";

/*
 * The listening bar of the study workspace: reads a paragraph, a selection, a
 * page or a translation with the site's voices, highlighting the sentence and
 * word being spoken.
 */

const DEFAULT_ARABIC_VOICE = "ar-SA-HamedNeural";

export interface ListenRequest {
  text: string;
  label: string;
  /** Changes on every request, so the same text can be played again. */
  key: number;
}

/** The voice for a text: the student's chosen voice when it speaks that language, else a default. */
export function voiceFor(text: string, chosen: string): Voice {
  const arabic = detectScript(text) === "Arabic";
  const mine = getVoice(chosen);
  if (mine && (arabic ? mine.lang === "ar" : mine.lang !== "ar")) return mine;
  return getVoice(arabic ? DEFAULT_ARABIC_VOICE : DEFAULT_VOICE_ID)!;
}

type Status = { phase: "loading" } | { phase: "ready"; url: string; timeline: Timeline; duration: number } | { phase: "error" };

export function StudyPlayer({ request, onClose, onBookmark }: { request: ListenRequest; onClose: () => void; onBookmark: (sentence: string) => void }) {
  const { t, fmt } = useI18n();
  const [settings, setSettings] = useSpeechSettings();
  const [status, setStatus] = useState<Status>({ phase: "loading" });
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const voiceId = settings.voiceId;

  // Generate the audio (the parts in parallel), then play it.
  useEffect(() => {
    const ctrl = new AbortController();
    let url: string | null = null;
    const voice = voiceFor(request.text, voiceId);
    const text = request.text.replace(/\r\n?/g, "\n");
    const displayChunks = splitIntoChunks(text, { locale: voice.lang });
    const job = createJob({ voiceId: voice.id, rate: "+0%", pitch: "+0Hz" }, displayChunks.map((c) => prepareForSpeech(c, { lang: voice.lang, pauseAtLineBreaks: true })));
    void (async () => {
      try {
        await runJob(job, { signal: ctrl.signal, concurrency: 3 });
        const blob = assemble(job);
        const audioParts = job.audio.filter((a): a is ArrayBuffer => a !== null);
        const timeline = buildTimeline({ text, displayChunks, audio: audioParts, words: job.words, estimated: job.estimated, locale: voice.lang });
        url = URL.createObjectURL(blob);
        setStatus({ phase: "ready", url, timeline, duration: mp3DurationSeconds(new Uint8Array(await blob.arrayBuffer())) });
      } catch {
        if (!ctrl.signal.aborted) setStatus({ phase: "error" });
      }
    })();
    return () => {
      ctrl.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [request, voiceId]);

  useEffect(() => (audio ? registerExclusivePlayer(audio) : undefined), [audio]);
  useEffect(() => {
    if (audio) setListeningSpeed(audio, settings.playbackRate);
  }, [audio, settings.playbackRate, status]);
  useEffect(() => {
    if (!audio || status.phase !== "ready") return;
    void audio.play().catch(() => {});
    const sync = () => setPlaying(!audio.paused);
    for (const e of ["play", "pause", "ended"]) audio.addEventListener(e, sync);
    return () => {
      for (const e of ["play", "pause", "ended"]) audio.removeEventListener(e, sync);
    };
  }, [audio, status]);

  const timeline = status.phase === "ready" ? status.timeline : EMPTY_TIMELINE;
  const position = useReadAlong(audio, timeline);
  const sentence = timeline.sentences[position.sentence];

  // Repeat the current sentence: back to its start when it ends.
  const repeatRef = useRef({ repeat, sentence });
  useEffect(() => {
    repeatRef.current = { repeat, sentence };
  });
  useEffect(() => {
    if (!audio) return;
    let held: { start: number; end: number } | null = null;
    const onTime = () => {
      const { repeat: on, sentence: s } = repeatRef.current;
      if (!on) return void (held = null);
      held ??= s ? { start: s.start, end: s.end } : null;
      if (held && audio.currentTime >= held.end - 0.05) seekTo(audio, held.start);
    };
    audio.addEventListener("timeupdate", onTime);
    return () => audio.removeEventListener("timeupdate", onTime);
  }, [audio, repeat]);

  const step = useCallback(
    (direction: 1 | -1) => {
      if (!audio) return;
      const target = sentenceStart(timeline, audio.currentTime, direction);
      if (target !== null) seekAndPlay(audio, target);
    },
    [audio, timeline],
  );

  // The sentence as written, with the word being spoken marked.
  const shown = useMemo(() => {
    if (!sentence) return null;
    const text = timeline.text;
    const cur = timeline.words[position.word];
    if (!cur || cur.from < sentence.from || cur.to > sentence.to) return { before: text.slice(sentence.from, sentence.to), word: "", after: "" };
    return { before: text.slice(sentence.from, cur.from), word: text.slice(cur.from, cur.to), after: text.slice(cur.to, sentence.to) };
  }, [sentence, timeline, position.word]);

  return (
    <section aria-label={t("study.listen")} className="bg-card border-t px-3 py-2 shadow-[0_-4px_12px_rgb(0_0_0/0.06)] sm:px-4">
      <div className="mx-auto flex max-w-5xl items-center gap-2" dir="ltr">
        <Button size="icon-sm" variant="ghost" aria-label={t("readAlong.previous")} onClick={() => step(-1)} disabled={status.phase !== "ready"}>
          <SkipBack aria-hidden />
        </Button>
        <Button
          size="icon"
          className="size-10 shrink-0 rounded-full"
          aria-label={playing ? t("readAlong.pause") : t("readAlong.play")}
          disabled={status.phase !== "ready"}
          onClick={() => {
            if (!audio) return;
            if (audio.paused) void audio.play().catch(() => {});
            else audio.pause();
          }}
        >
          {status.phase === "loading" ? <Loader2 className="animate-spin" aria-hidden /> : playing ? <Pause aria-hidden /> : <Play aria-hidden />}
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label={t("readAlong.next")} onClick={() => step(1)} disabled={status.phase !== "ready"}>
          <SkipForward aria-hidden />
        </Button>
        <div className="min-w-0 flex-1 px-1" dir="auto">
          <p className="text-muted-foreground truncate text-[12px]">{request.label}</p>
          <p className="truncate text-sm" role="status" aria-live="polite">
            {status.phase === "loading" ? (
              t("study.preparingAudio")
            ) : status.phase === "error" ? (
              <span className="text-destructive">{t("generate.errors.ENGINE_UNAVAILABLE")}</span>
            ) : shown ? (
              <>
                {shown.before}
                {shown.word && <span className="bg-primary text-primary-foreground rounded-[3px] px-0.5">{shown.word}</span>}
                {shown.after}
              </>
            ) : (
              request.text.slice(0, 120)
            )}
          </p>
          {status.phase === "ready" && timeline.approximate && <p className="text-muted-foreground truncate text-[11px]">{t("readAlong.approximate")}</p>}
        </div>
        <Button size="icon-sm" variant={repeat ? "secondary" : "ghost"} aria-pressed={repeat} aria-label={t("study.repeatSentence")} title={t("study.repeatSentence")} onClick={() => setRepeat((r) => !r)} disabled={status.phase !== "ready"}>
          <Repeat1 aria-hidden />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t("study.bookmarkSentence")}
          title={t("study.bookmarkSentence")}
          disabled={!sentence}
          onClick={() => {
            if (!sentence) return;
            onBookmark(timeline.text.slice(sentence.from, sentence.to).trim());
            toast.success(t("bookmarks.added"));
          }}
        >
          <Bookmark aria-hidden />
        </Button>
        <label className="sr-only" htmlFor="study-speed">
          {t("readAlong.speed")}
        </label>
        <select id="study-speed" value={settings.playbackRate} onChange={(e) => setSettings({ playbackRate: Number(e.target.value) })} className="border-input bg-background h-8 rounded-md border px-1.5 text-[13px]">
          {PLAYBACK_RATES.map((r) => (
            <option key={r} value={r}>
              {t("readAlong.speedValue", { n: fmt.number(r) })}
            </option>
          ))}
        </select>
        <Button size="icon-sm" variant="ghost" aria-label={t("study.closePlayer")} onClick={onClose}>
          <X aria-hidden />
        </Button>
        {status.phase === "ready" && <audio ref={setAudio} src={status.url} preload="auto" hidden />}
      </div>
    </section>
  );
}
