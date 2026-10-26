"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { GeneratePanel, type GenState } from "./generate-panel";
import { clearSavedDraft, useDraftAutosave, useElapsed, useHealth, useHydrated, useLatest, useSavedDraft, useSpeechSettings } from "./hooks";
import { PreviewProvider } from "./preview-context";
import { ResultPanel, type AudioResult, type ConvertFormat } from "./result-panel";
import { SettingsPanel } from "./settings-panel";
import { TextPanel } from "./text-panel";
import { EMPTY_BROWSER_FILTERS, VoiceBrowser, navForVoice, type BrowserFilters, type BrowserNav } from "./voice-browser";
import { VoicePanel } from "./voice-panel";
import { ContinueListening } from "@/components/library/continue-listening";
import { libraryErrorKey, saveResult } from "@/components/library/library-hooks";
import { mp3DurationSeconds } from "@/lib/audio/mp3";
import { MAX_TEXT_CHARS } from "@/lib/files/limits";
import { useI18n } from "@/lib/i18n/provider";
import { prepareForSpeech, splitIntoChunks } from "@/lib/text/chunk";
import { GenerationError, assemble, completedCount, contiguousPrefix, createJob, runJob, type Job } from "@/lib/tts/engine";
import { buildTimeline } from "@/lib/tts/timeline";
import { DEFAULT_VOICE_ID, VOICES, VOICE_LANGUAGES, getVoice } from "@/lib/voices/catalog";

const MAX_RESULTS = 5;

function rateString(speed: number): string {
  const pct = Math.round((speed - 1) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}%`;
}

function pitchString(pitch: number): string {
  return `${pitch >= 0 ? "+" : ""}${Math.round(pitch)}Hz`;
}

let resultCounter = 0;

function revoke(r: AudioResult) {
  URL.revokeObjectURL(r.url);
  for (const c of Object.values(r.conversions)) if (c) URL.revokeObjectURL(c.url);
}

interface ActiveJob {
  job: Job;
  voiceId: string;
  speed: number;
  pitch: number;
  /** The text as it was when generation started (line endings normalized), for read-along. */
  text: string;
  /** Chunks as cut from `text`, before the speech-only changes of prepareForSpeech. */
  displayChunks: string[];
  locale: string;
}

function StudioInner() {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const textRef = useLatest(text);
  const [settings, updateSettings] = useSpeechSettings();
  const settingsRef = useLatest(settings);
  const voice = getVoice(settings.voiceId) ?? getVoice(DEFAULT_VOICE_ID) ?? VOICES[0];
  const health = useHealth();
  // The browser keeps its place (and filters) between openings.
  const [browserOpen, setBrowserOpen] = useState(false);
  const [browserNav, setBrowserNav] = useState<BrowserNav | null>(null);
  const [browserFilters, setBrowserFilters] = useState<BrowserFilters>(EMPTY_BROWSER_FILTERS);

  const [gen, setGen] = useState<GenState>({ phase: "idle" });
  const activeRef = useRef<ActiveJob | null>(null);
  const ctrlRef = useRef<AbortController | null>(null);
  const elapsed = useElapsed(gen.phase === "running" ? gen.startedAt : null);

  const [results, setResults] = useState<AudioResult[]>([]);
  const resultsRef = useLatest(results);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const resultRef = useRef<HTMLElement>(null);
  const scrollToResult = useRef(false);

  // Restore the draft saved before the last refresh (adjusting state during
  // render, once, as soon as the client-side snapshot is available).
  const hydrated = useHydrated();
  const savedDraft = useSavedDraft();
  const [draft, setDraft] = useState<"pending" | "restored" | "done">("pending");
  if (hydrated && draft === "pending") {
    if (savedDraft && !text) {
      setText(savedDraft);
      setDraft("restored");
    } else {
      setDraft("done");
    }
  }
  useDraftAutosave(text, draft !== "pending");
  useEffect(() => {
    if (draft !== "restored") return;
    toast(t("editor.draftRestored"), {
      action: {
        label: t("editor.discard"),
        onClick: () => {
          setText("");
          clearSavedDraft();
        },
      },
      duration: 8000,
    });
    // Announce once per page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  // Release object URLs when the page goes away.
  useEffect(() => () => resultsRef.current.forEach(revoke), [resultsRef]);

  const replaceText = useCallback(
    (next: string, message: string) => {
      const prev = textRef.current;
      setText(next);
      toast(message, { action: { label: t("editor.undo"), onClick: () => setText(prev) }, duration: 8000 });
    },
    [t, textRef],
  );

  const disabledReason = !text.trim() ? t("generate.needText") : text.length > MAX_TEXT_CHARS ? t("generate.tooLong") : null;

  const finish = useCallback(
    async (active: ActiveJob, upTo: number) => {
      const { job } = active;
      const blob = assemble(job, upTo);
      const duration = mp3DurationSeconds(new Uint8Array(await blob.arrayBuffer()));
      const timeline = buildTimeline({
        text: active.text,
        displayChunks: active.displayChunks.slice(0, upTo),
        audio: job.audio.slice(0, upTo).filter((a): a is ArrayBuffer => a !== null),
        words: job.words.slice(0, upTo),
        locale: active.locale,
      });
      const result: AudioResult = {
        id: `r${Date.now()}-${++resultCounter}`,
        blob,
        url: URL.createObjectURL(blob),
        createdAt: new Date(),
        voiceId: active.voiceId,
        speed: active.speed,
        pitch: active.pitch,
        duration,
        partsDone: upTo,
        partsTotal: job.chunks.length,
        backupParts: job.engines.slice(0, upTo).flatMap((e, i) => (e === "backup" ? [i + 1] : [])),
        conversions: {},
        timeline,
      };
      setResults((prev) => {
        const next = [result, ...prev];
        next.slice(MAX_RESULTS).forEach(revoke);
        return next.slice(0, MAX_RESULTS);
      });
      setCurrentId(result.id);
      if (settingsRef.current.autoSave) {
        saveResult(result).then(
          (item) => setResults((prev) => prev.map((r) => (r.id === result.id ? { ...r, libraryId: item.id } : r))),
          (e: unknown) => toast.error(t(libraryErrorKey(e))),
        );
      }
      activeRef.current = null;
      setGen({ phase: "idle" });
      scrollToResult.current = true;
      toast.success(t("generate.success"));
    },
    [t, settingsRef],
  );

  // Bring a new result into view and move focus to its heading (announced by screen readers).
  useEffect(() => {
    if (!scrollToResult.current || !resultRef.current) return;
    scrollToResult.current = false;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    resultRef.current.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    document.getElementById("result-heading")?.focus({ preventScroll: true });
  }, [currentId]);

  const run = useCallback(
    async (active: ActiveJob) => {
      const { job } = active;
      const ctrl = new AbortController();
      ctrlRef.current = ctrl;
      setGen({ phase: "running", done: completedCount(job), total: job.chunks.length, waiting: 0, startedAt: Date.now() });
      try {
        await runJob(job, {
          signal: ctrl.signal,
          concurrency: 3,
          onProgress: (done, total) => setGen((g) => (g.phase === "running" ? { ...g, done, total } : g)),
          onWait: (seconds) => setGen((g) => (g.phase === "running" ? { ...g, waiting: seconds } : g)),
        });
        await finish(active, job.chunks.length);
      } catch (e) {
        if (ctrl.signal.aborted) {
          activeRef.current = null;
          setGen({ phase: "idle" });
          toast.info(t("generate.cancelled"));
          return;
        }
        const err = e instanceof GenerationError ? e : new GenerationError("UNKNOWN", contiguousPrefix(job), false);
        setGen({ phase: "failed", code: err.code, index: err.index, fallbackAvailable: err.fallbackAvailable, done: completedCount(job), total: job.chunks.length });
      } finally {
        if (ctrlRef.current === ctrl) ctrlRef.current = null;
      }
    },
    [finish, t],
  );

  const generate = useCallback(() => {
    if (gen.phase === "running") return;
    if (disabledReason) {
      toast.info(disabledReason);
      document.getElementById("editor")?.focus();
      return;
    }
    const snapshot = textRef.current.replace(/\r\n?/g, "\n");
    const displayChunks = splitIntoChunks(snapshot, { locale: voice.lang });
    const chunks = displayChunks.map((c) => prepareForSpeech(c, { lang: voice.lang, pauseAtLineBreaks: settings.pauses }));
    const job = createJob({ voiceId: voice.id, rate: rateString(settings.speed), pitch: pitchString(settings.pitch) }, chunks);
    const active = { job, voiceId: voice.id, speed: settings.speed, pitch: settings.pitch, text: snapshot, displayChunks, locale: voice.lang };
    activeRef.current = active;
    void run(active);
  }, [gen.phase, disabledReason, voice, settings, run, textRef]);

  /** Opens the browser where it was left, or at the selected voice's country the first time. */
  const openBrowser = useCallback(
    (overrides?: { nav?: BrowserNav; filters?: Partial<BrowserFilters> }) => {
      if (overrides?.filters) setBrowserFilters((f) => ({ ...f, ...overrides.filters }));
      setBrowserNav((n) => overrides?.nav ?? n ?? navForVoice(voice));
      setBrowserOpen(true);
    },
    [voice],
  );

  const findVoice = useCallback((lang: string | null) => openBrowser({ filters: { ...EMPTY_BROWSER_FILTERS, lang } }), [openBrowser]);

  const current = results.find((r) => r.id === currentId) ?? results[0] ?? null;
  const history = results.filter((r) => r !== current);

  return (
    <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 px-4 pt-6 pb-8 outline-none sm:px-6 lg:pb-10">
      <div className="mb-5 max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">{t("page.title")}</h1>
        <p className="text-muted-foreground mt-1 text-[15px] leading-relaxed">{t("page.subtitle", { languages: VOICE_LANGUAGES.length })}</p>
      </div>

      <ContinueListening />

      {/*
        DOM order = task order (text → voice → settings → generate → result), so
        keyboard, screen-reader and visual order agree. On large screens the
        controls form a right-hand column and the result sits under the text.
      */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(340px,400px)] lg:grid-rows-[auto_auto_1fr] lg:gap-5">
        <TextPanel
          className="lg:col-start-1 lg:row-start-1"
          text={text}
          onTextChange={setText}
          replaceText={replaceText}
          voice={voice}
          speed={settings.speed}
          onGenerate={generate}
          onFindVoice={findVoice}
        />
        <div className="flex min-w-0 flex-col gap-4 lg:col-start-2 lg:row-span-3 lg:row-start-1 lg:gap-5">
          <VoicePanel
            voice={voice}
            onSelect={(voiceId) => updateSettings({ voiceId })}
            onBrowse={() => openBrowser()}
            onBrowseFavorites={() => openBrowser({ nav: { level: "favorites" }, filters: EMPTY_BROWSER_FILTERS })}
          />
          <SettingsPanel settings={settings} onChange={updateSettings} />
        </div>
        {/* After voice and settings in reading order; shown under the editor on large screens. */}
        <GeneratePanel
          className="lg:col-start-1 lg:row-start-2"
          state={gen}
          elapsed={elapsed}
          disabledReason={disabledReason}
          backupEnabled={health.backupVoice}
          onGenerate={generate}
          onCancel={() => ctrlRef.current?.abort()}
          onRetry={() => activeRef.current && void run(activeRef.current)}
          onUseBackup={() => {
            if (!activeRef.current) return;
            activeRef.current.job.allowBackup = true;
            void run(activeRef.current);
          }}
          onKeepPartial={() => activeRef.current && void finish(activeRef.current, contiguousPrefix(activeRef.current.job))}
          onDismiss={() => {
            activeRef.current = null;
            setGen({ phase: "idle" });
          }}
        />
        {current && (
          <ResultPanel
            ref={resultRef}
            className="lg:col-start-1 lg:row-start-3 lg:self-start"
            result={current}
            history={history}
            converterAvailable={health.converter}
            convertMaxBytes={health.convertMaxBytes}
            onOpen={setCurrentId}
            onRemove={(id) =>
              setResults((prev) => {
                const gone = prev.find((r) => r.id === id);
                if (gone) revoke(gone);
                return prev.filter((r) => r.id !== id);
              })
            }
            onSaved={(id, libraryId) => setResults((prev) => prev.map((r) => (r.id === id ? { ...r, libraryId } : r)))}
            onConverted={(id, format: ConvertFormat, blob) =>
              setResults((prev) =>
                prev.map((r) => (r.id === id ? { ...r, conversions: { ...r.conversions, [format]: { url: URL.createObjectURL(blob), size: blob.size } } } : r)),
              )
            }
          />
        )}
      </div>

      <VoiceBrowser
        open={browserOpen}
        onOpenChange={setBrowserOpen}
        selectedId={voice.id}
        onSelect={(voiceId) => updateSettings({ voiceId })}
        nav={browserNav ?? navForVoice(voice)}
        onNavChange={setBrowserNav}
        filters={browserFilters}
        onFiltersChange={setBrowserFilters}
      />
    </main>
  );
}

export function Studio() {
  return (
    <PreviewProvider>
      <StudioInner />
    </PreviewProvider>
  );
}
