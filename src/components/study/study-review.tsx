"use client";

import { Layers } from "lucide-react";
import { useState } from "react";
import { CardReview, dueCards } from "./flashcards";
import { useCards, useLectures, useNow } from "./study-hooks";
import { BackButton } from "@/components/app/back-button";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/provider";
import type { Card } from "@/lib/study/store";

/** Review the due flashcards of every lecture in one session. */
export function StudyReview() {
  const { t, fmt } = useI18n();
  const { data } = useCards();
  const { data: lectures } = useLectures();
  const now = useNow();
  const [session, setSession] = useState<Card[] | null>(null);
  const cards = data ?? [];
  const due = dueCards(cards, now);
  const titles = new Map((lectures?.docs ?? []).map((d) => [d.id, d.title]));
  const nextDue = cards.reduce<number | null>((min, c) => (min === null || c.srs.due < min ? c.srs.due : min), null);

  return (
    <main id="main" tabIndex={-1} className="mx-auto w-full max-w-2xl flex-1 px-4 pt-4 pb-10 outline-none sm:px-6">
      <BackButton fallback="/study" />
      <h1 className="mb-1 flex items-center gap-2.5 text-2xl font-semibold tracking-tight">
        <Layers className="text-primary size-6" aria-hidden />
        {t("study.review.title")}
      </h1>
      {session ? (
        <CardReview
          cards={session}
          onExit={() => setSession(null)}
          source={(c) =>
            c.docId && titles.has(c.docId) ? (
              <p className="text-muted-foreground text-[12px]" dir="auto">
                {titles.get(c.docId)}
                {c.page ? ` · ${t("study.pageLabel", { n: c.page })}` : ""}
              </p>
            ) : null
          }
        />
      ) : (
        <div className="space-y-3">
          <p className="text-muted-foreground text-[15px]" role="status">
            {data ? t("study.review.due", { count: due.length }) : ""}
          </p>
          {due.length > 0 ? (
            <Button onClick={() => setSession(due)}>{t("study.review.all")}</Button>
          ) : data && cards.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("study.cards.empty")}</p>
          ) : (
            nextDue !== null && <p className="text-muted-foreground text-sm">{t("study.cards.noneDue", { when: fmt.relative(nextDue - now) })}</p>
          )}
        </div>
      )}
    </main>
  );
}
