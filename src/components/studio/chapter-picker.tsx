"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n/provider";
import type { Chapter } from "@/lib/text/chapters";
import { estimateDurationSeconds } from "@/lib/text/stats";

/**
 * Lets the reader convert only some chapters of a long text. `chosen` null
 * means all chapters; applying with every chapter ticked returns null too.
 */
export function ChapterPicker({
  open,
  onOpenChange,
  text,
  chapters,
  chosen,
  speed,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  text: string;
  chapters: Chapter[];
  chosen: number[] | null;
  speed: number;
  onApply: (chosen: number[] | null) => void;
}) {
  const { t, fmt } = useI18n();
  // Fresh choices each time the dialog opens.
  const [ticked, setTicked] = useState<Set<number>>(() => new Set(chosen ?? chapters.map((_, i) => i)));
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setTicked(new Set(chosen ?? chapters.map((_, i) => i)));
  }

  const durations = useMemo(() => chapters.map((c) => estimateDurationSeconds(text.slice(c.from, c.to), speed)), [chapters, text, speed]);
  const toggle = (i: number) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("common.close")} className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("chapters.choose")}</DialogTitle>
          <DialogDescription>{t("chapters.chooseDescription")}</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setTicked(new Set(chapters.map((_, i) => i)))}>
            {t("chapters.selectAll")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setTicked(new Set())}>
            {t("chapters.selectNone")}
          </Button>
        </div>
        <ul className="scroll-thin max-h-[45vh] divide-y overflow-y-auto rounded-lg border">
          {chapters.map((c, i) => (
            <li key={c.from}>
              <label className="hover:bg-accent/60 flex cursor-pointer items-center gap-3 px-3 py-2.5">
                <input type="checkbox" className="accent-primary size-4 shrink-0" checked={ticked.has(i)} onChange={() => toggle(i)} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium" dir="auto">
                  {c.title || t("chapters.beginning")}
                </span>
                <span className="text-muted-foreground shrink-0 text-[13px] tabular-nums">≈ {fmt.duration(durations[i])}</span>
              </label>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("chapters.cancel")}
          </Button>
          <Button
            disabled={ticked.size === 0}
            onClick={() => {
              onApply(ticked.size === chapters.length ? null : [...ticked].sort((a, b) => a - b));
              onOpenChange(false);
            }}
          >
            {t("chapters.apply", { count: ticked.size })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
