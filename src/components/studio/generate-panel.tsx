"use client";

import { AudioLines, Headphones, Loader2, RotateCw, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useShell } from "@/components/app/app-shell";
import { ProgressBar } from "./primitives";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/provider";
import type { TKey } from "@/lib/i18n/translate";
import type { GenerationErrorCode } from "@/lib/tts/engine";
import { cn } from "@/lib/utils";

export type GenState =
  | { phase: "idle" }
  | { phase: "running"; done: number; total: number; waiting: number; startedAt: number; /** Finished leading parts, playable now. */ ready: number }
  | { phase: "failed"; code: GenerationErrorCode; index: number; fallbackAvailable: boolean; done: number; total: number };

interface GeneratePanelProps {
  state: GenState;
  elapsed: number;
  disabledReason: string | null;
  backupEnabled: boolean;
  onGenerate: () => void;
  onCancel: () => void;
  /** Opens reading mode on the parts that are ready while the rest generate. */
  onListenNow: () => void;
  onRetry: () => void;
  onUseBackup: () => void;
  onKeepPartial: () => void;
  onDismiss: () => void;
  className?: string;
}

export function GeneratePanel(props: GeneratePanelProps) {
  const { state, elapsed, disabledReason, backupEnabled, className } = props;
  const { t, fmt } = useI18n();
  const { openAbout } = useShell();
  const running = state.phase === "running";
  const ref = useRef<HTMLElement>(null);

  // Reserve room for the fixed mobile bar so it never hides page content.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const update = () => {
      const fixed = getComputedStyle(el).position === "fixed";
      root.style.setProperty("--generate-bar-h", fixed ? `${Math.ceil(el.getBoundingClientRect().height)}px` : "0px");
    };
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    update();
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
      root.style.removeProperty("--generate-bar-h");
    };
  }, []);

  return (
    <section
      ref={ref}
      aria-label={t("generate.button")}
      className={cn(
        // Small screens: a bar fixed to the bottom of the viewport. Its height is
        // published as --generate-bar-h so the page reserves that space.
        "bg-background/95 supports-[backdrop-filter]:bg-background/85 fixed inset-x-0 bottom-0 z-30 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur",
        "lg:bg-card lg:static lg:z-auto lg:rounded-xl lg:border lg:p-5 lg:shadow-card lg:backdrop-blur-none",
        className,
      )}
    >
      <div className="mx-auto max-w-3xl space-y-3 lg:max-w-none">
        {state.phase === "failed" && (
          <div role="alert" className="bg-destructive-soft text-destructive scroll-thin max-h-[45vh] space-y-3 overflow-y-auto rounded-lg p-3.5 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1">
                <p className="font-semibold">{t(`generate.errors.${state.code}` as TKey)}</p>
                {state.total > 1 && (
                  <p>
                    {t("generate.failedAt", { part: state.index + 1, total: state.total })} {state.done > 0 && t("generate.partsReady", { count: state.done })}
                  </p>
                )}
              </div>
              <Button variant="ghost" size="icon-sm" className="text-destructive -me-1.5 -mt-1.5" onClick={props.onDismiss} aria-label={t("generate.dismiss")}>
                <X aria-hidden />
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={props.onRetry}>
                <RotateCw aria-hidden />
                {t("generate.retry")}
              </Button>
              {state.done > 0 && state.index > 0 && (
                <Button size="sm" variant="outline" onClick={props.onKeepPartial}>
                  {t("generate.keepPartial")}
                </Button>
              )}
              {backupEnabled && state.fallbackAvailable && (
                <Button size="sm" variant="outline" onClick={props.onUseBackup}>
                  {t("generate.useBackup")}
                </Button>
              )}
            </div>
            {backupEnabled && state.fallbackAvailable && <p className="text-[13px] leading-relaxed opacity-90">{t("generate.backupExplain")}</p>}
          </div>
        )}

        {running ? (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-3 text-sm">
              <p role="status" aria-live="polite" className="flex min-w-0 items-center gap-2 font-medium">
                <Loader2 className="text-primary size-4 shrink-0 animate-spin" aria-hidden />
                <span className="truncate">
                  {state.waiting > 0
                    ? t("generate.waitingRetry", { seconds: state.waiting })
                    : state.total > 1
                      ? `${t("generate.generating")} ${t("generate.part", { done: Math.min(state.done + 1, state.total), total: state.total })}`
                      : t("generate.generating")}
                </span>
              </p>
              <span className="text-muted-foreground shrink-0 text-[13px] tabular-nums" aria-hidden>
                {fmt.clock(elapsed)}
              </span>
            </div>
            <ProgressBar
              value={state.total > 1 ? (state.done / state.total) * 100 : null}
              label={t("generate.generating")}
              valueText={state.total > 1 ? t("generate.part", { done: state.done, total: state.total }) : undefined}
            />
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={props.onCancel}>
                <X aria-hidden />
                {t("generate.cancel")}
              </Button>
              {state.total > 1 && state.ready > 0 && (
                <Button className="flex-1" onClick={props.onListenNow}>
                  <Headphones aria-hidden />
                  {t("generate.listenNow")}
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <Button size="lg" className="w-full text-[15px] font-semibold aria-disabled:opacity-60" onClick={props.onGenerate} aria-describedby={disabledReason ? "generate-reason" : "generate-privacy"} aria-disabled={Boolean(disabledReason) || undefined}>
              <AudioLines className="size-5" aria-hidden />
              {t("generate.button")}
              <span className="ms-1 hidden items-center gap-1 text-[12px] font-normal lg:inline-flex" aria-hidden>
                Ctrl+Enter
              </span>
            </Button>
            {disabledReason ? (
              <p id="generate-reason" className="text-muted-foreground text-center text-[13px]">
                {disabledReason}
              </p>
            ) : (
              <p id="generate-privacy" className="text-muted-foreground flex items-center justify-center gap-1.5 text-center text-[12px] leading-relaxed">
                <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
                <span>
                  {t("generate.privacy")}{" "}
                  <button type="button" className="text-primary font-medium underline-offset-4 hover:underline" onClick={() => openAbout("privacy")}>
                    {t("generate.learnMore")}
                  </button>
                </span>
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
