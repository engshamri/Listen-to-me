"use client";

import { Library, Play } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { inProgress, useLibraryItems } from "./library-hooks";
import { LibraryPlayer } from "./library-player";
import { ProgressBar } from "@/components/studio/primitives";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/provider";

/** The saved recording the listener was last in the middle of, with a way back in. */
export function ContinueListening() {
  const { t, fmt } = useI18n();
  const { items } = useLibraryItems();
  const [playing, setPlaying] = useState<string | null>(null);
  const item = items?.find(inProgress);

  return (
    <>
      {item && (
        <section aria-labelledby="continue-title" className="bg-card shadow-card mb-5 flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:gap-5">
          <div className="min-w-0 flex-1">
            <h2 id="continue-title" className="text-muted-foreground text-[13px] font-medium">
              {t("library.resume")}
            </h2>
            <p className="truncate font-semibold" dir="auto">
              {item.title}
            </p>
            <div className="mt-2 flex items-center gap-3">
              <ProgressBar
                value={(item.position / Math.max(item.duration, 0.1)) * 100}
                label={t("library.resume")}
                valueText={t("library.resumeDetail", { time: fmt.clock(item.position), total: fmt.clock(item.duration) })}
                className="max-w-xs"
              />
              <span className="text-muted-foreground shrink-0 text-[13px] tabular-nums">
                {t("library.resumeDetail", { time: fmt.clock(item.position), total: fmt.clock(item.duration) })}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button onClick={() => setPlaying(item.id)} aria-describedby="continue-title">
              <Play aria-hidden />
              {t("library.continue")}
            </Button>
            <Button asChild variant="outline">
              <Link href="/library">
                <Library aria-hidden />
                {t("header.library")}
              </Link>
            </Button>
          </div>
        </section>
      )}
      {playing && <LibraryPlayer key={playing} id={playing} onClose={() => setPlaying(null)} />}
    </>
  );
}
