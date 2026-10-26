"use client";

import { Download, Film, Loader2, Music, Play, RotateCcw, Trash2, X } from "lucide-react";
import { forwardRef, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Notice, Panel, StepHeading } from "./primitives";
import { Button } from "@/components/ui/button";
import { downloadName } from "@/lib/audio/filename";
import { registerExclusivePlayer } from "@/lib/audio/playback";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { getVoice, voiceName, voiceSubtitle } from "@/lib/voices/catalog";

export type ConvertFormat = "m4a" | "mp4";

export interface AudioResult {
  id: string;
  blob: Blob;
  url: string;
  createdAt: Date;
  voiceId: string;
  speed: number;
  pitch: number;
  duration: number;
  partsDone: number;
  partsTotal: number;
  /** 1-based numbers of parts read by the backup voice. */
  backupParts: number[];
  conversions: Partial<Record<ConvertFormat, { url: string; size: number }>>;
}

interface ResultPanelProps {
  result: AudioResult;
  history: AudioResult[];
  converterAvailable: boolean;
  convertMaxBytes: number;
  onOpen: (id: string) => void;
  onRemove: (id: string) => void;
  onConverted: (id: string, format: ConvertFormat, blob: Blob) => void;
  className?: string;
}

export const ResultPanel = forwardRef<HTMLElement, ResultPanelProps>(function ResultPanel(
  { result, history, converterAvailable, convertMaxBytes, onOpen, onRemove, onConverted, className },
  ref,
) {
  const { t, locale, fmt } = useI18n();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [converting, setConverting] = useState<{ format: ConvertFormat; ctrl: AbortController } | null>(null);
  const voice = getVoice(result.voiceId);

  useEffect(() => {
    const el = audioRef.current;
    return el ? registerExclusivePlayer(el) : undefined;
  }, []);

  // Cancel an in-flight conversion if another result is opened or the panel unmounts.
  const convertCtrl = useRef<AbortController | null>(null);
  useEffect(() => {
    return () => {
      convertCtrl.current?.abort();
      setConverting(null);
    };
  }, [result.id]);

  async function convert(format: ConvertFormat) {
    const ctrl = new AbortController();
    convertCtrl.current = ctrl;
    setConverting({ format, ctrl });
    try {
      const res = await fetch(`/api/convert?format=${format}`, { method: "POST", headers: { "Content-Type": "audio/mpeg" }, body: result.blob, signal: ctrl.signal });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { code?: string } };
        // A hosting platform may refuse the upload itself (413) before the app sees it.
        throw new Error(body.error?.code ?? (res.status === 413 ? "PAYLOAD_TOO_LARGE" : "CONVERSION_FAILED"));
      }
      onConverted(result.id, format, await res.blob());
    } catch (e) {
      if (ctrl.signal.aborted) return;
      const code = (e as Error).message;
      toast.error(
        code === "CONVERTER_NOT_INSTALLED"
          ? t("result.ffmpegMissing")
          : code === "PAYLOAD_TOO_LARGE"
            ? t("result.tooLargeToConvert", { size: fmt.bytes(convertMaxBytes) })
            : t("result.convertFailed"),
      );
    } finally {
      setConverting((c) => (c?.ctrl === ctrl ? null : c));
    }
  }

  const name = voice ? voiceName(voice, locale) : result.voiceId;
  const fileBase = (ext: string) => downloadName(voice?.name ?? "voice", voice?.locale ?? "xx", result.createdAt, ext);
  const speedText = t("units.speed", { n: fmt.number(result.speed, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) });
  const pitchText = result.pitch === 0 ? t("settings.normal") : t("units.pitch", { n: `${result.pitch > 0 ? "+" : "−"}${fmt.number(Math.abs(result.pitch))}` });
  const partial = result.partsDone < result.partsTotal;
  const tooLarge = result.blob.size > convertMaxBytes;
  const convertNote = !converterAvailable
    ? t("result.ffmpegMissing")
    : tooLarge
      ? t("result.tooLargeToConvert", { size: fmt.bytes(convertMaxBytes) })
      : null;

  const meta: [string, string][] = [
    [t("result.voice"), name],
    [t("result.language"), voice ? voiceSubtitle(voice, locale) : "—"],
    [t("result.duration"), fmt.clock(result.duration)],
    [t("result.size"), fmt.bytes(result.blob.size)],
    [t("result.speed"), speedText],
    [t("result.pitch"), pitchText],
    [t("result.format"), "MP3"],
    [t("result.status"), partial ? t("result.partial", { done: result.partsDone, total: result.partsTotal }) : t("result.complete")],
  ];

  const formats: { format: ConvertFormat; label: string; ready: string; hint: string; icon: typeof Music }[] = [
    { format: "m4a", label: t("result.downloadM4a"), ready: t("result.downloadM4aReady"), hint: t("result.m4aHint"), icon: Music },
    { format: "mp4", label: t("result.createVideo"), ready: t("result.downloadVideo"), hint: t("result.videoHint"), icon: Film },
  ];

  return (
    <Panel ref={ref as React.Ref<HTMLElement>} aria-labelledby="result-title" className={cn("scroll-mt-20 space-y-4 p-4 sm:p-5", className)}>
      <StepHeading id="result-title">
        <span tabIndex={-1} id="result-heading" className="outline-none">
          {t("result.title")}
        </span>
      </StepHeading>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <audio ref={audioRef} src={result.url} controls preload="metadata" className="h-11 w-full min-w-0 flex-1" aria-label={t("result.title")} />
        <Button
          variant="outline"
          onClick={() => {
            const el = audioRef.current;
            if (!el) return;
            el.currentTime = 0;
            void el.play();
          }}
        >
          <RotateCcw aria-hidden />
          {t("result.restart")}
        </Button>
      </div>

      {(partial || result.backupParts.length > 0) && (
        <Notice tone="warning">
          {partial && <p>{t("result.partial", { done: result.partsDone, total: result.partsTotal })}</p>}
          {result.backupParts.length > 0 && <p>{t("result.backupUsed", { parts: result.backupParts.map((p) => fmt.number(p)).join(", ") })}</p>}
        </Notice>
      )}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
        {meta.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-muted-foreground text-[13px]">{k}</dt>
            <dd className="truncate font-medium" dir="auto">
              {v}
            </dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap gap-2 border-t pt-4">
        <Button asChild size="lg" className="font-semibold">
          <a href={result.url} download={fileBase("mp3")}>
            <Download className="size-5" aria-hidden />
            {t("result.downloadMp3")}
          </a>
        </Button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {formats.map(({ format, label, ready, hint, icon: Icon }) => {
          const done = result.conversions[format];
          const busy = converting?.format === format;
          return (
            <div key={format} className="rounded-lg border p-3">
              <div className="flex items-center justify-between gap-2">
                {done ? (
                  <Button asChild variant="outline" size="sm">
                    <a href={done.url} download={fileBase(format)}>
                      <Download aria-hidden />
                      {ready}
                      <span className="text-muted-foreground font-normal">{fmt.bytes(done.size)}</span>
                    </a>
                  </Button>
                ) : busy ? (
                  <Button variant="outline" size="sm" onClick={() => converting?.ctrl.abort()} aria-label={t("result.cancelConvert")}>
                    <Loader2 className="animate-spin" aria-hidden />
                    {t("result.converting")}
                    <X className="text-muted-foreground" aria-hidden />
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => void convert(format)} disabled={convertNote !== null || Boolean(converting)}>
                    <Icon aria-hidden />
                    {label}
                  </Button>
                )}
              </div>
              <p className="text-muted-foreground mt-2 text-[13px] leading-relaxed">{convertNote ?? hint}</p>
            </div>
          );
        })}
      </div>

      {history.length > 0 && (
        <div className="space-y-2 border-t pt-4">
          <div>
            <h3 className="text-sm font-semibold">{t("result.history")}</h3>
            <p className="text-muted-foreground text-[13px]">{t("result.historyNote")}</p>
          </div>
          <ul className="divide-y rounded-lg border">
            {history.map((h) => {
              const v = getVoice(h.voiceId);
              return (
                <li key={h.id} className="flex items-center gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium" dir="auto">{v ? voiceName(v, locale) : h.voiceId}</p>
                    <p className="text-muted-foreground text-[13px] tabular-nums">
                      {fmt.time(h.createdAt)} · {fmt.clock(h.duration)} · {fmt.bytes(h.blob.size)}
                    </p>
                  </div>
                  <Button variant="ghost" size="icon-sm" onClick={() => onOpen(h.id)} aria-label={`${t("result.load")}: ${fmt.time(h.createdAt)}`} title={t("result.load")}>
                    <Play aria-hidden />
                  </Button>
                  <Button asChild variant="ghost" size="icon-sm">
                    <a href={h.url} download={downloadName(v?.name ?? "voice", v?.locale ?? "xx", h.createdAt, "mp3")} aria-label={`${t("result.downloadMp3")}: ${fmt.time(h.createdAt)}`} title={t("result.downloadMp3")}>
                      <Download aria-hidden />
                    </a>
                  </Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => onRemove(h.id)} aria-label={`${t("result.remove")}: ${fmt.time(h.createdAt)}`} title={t("result.remove")}>
                    <Trash2 aria-hidden />
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Panel>
  );
});
