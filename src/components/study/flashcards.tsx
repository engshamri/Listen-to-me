"use client";

import { BookA, Download, Highlighter, Layers, Plus, Trash2, Upload } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useCards, useGlossary, useNow } from "./study-hooks";
import { useWorkspace } from "./workspace-context";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { downloadBlob } from "@/components/library/library-hooks";
import { useI18n } from "@/lib/i18n/provider";
import { cardsCsv, cardsJson, parseCards } from "@/lib/study/cards-io";
import { GRADES, isDue, schedule, type Grade } from "@/lib/study/srs";
import { addCards, deleteCard, reviewCard, type Card } from "@/lib/study/store";

/** Adds cards and says how many were new. */
export async function makeCards(cards: Parameters<typeof addCards>[0], t: ReturnType<typeof useI18n>["t"]) {
  try {
    const n = await addCards(cards);
    if (n) toast.success(t("study.practice.added", { count: n }));
    else toast.info(t("study.practice.exist"));
  } catch {
    toast.error(t("library.errors.FAILED"));
  }
}

/** Due cards first (oldest due first). */
export const dueCards = (cards: Card[], now: number) => cards.filter((c) => isDue(c.srs, now)).sort((a, b) => a.srs.due - b.srs.due);

/** The lecture's flashcards: review, make, import and export. */
export function FlashcardsSection() {
  const { t, fmt } = useI18n();
  const ws = useWorkspace();
  const id = useId();
  const { data } = useCards(ws.doc.id);
  const { data: glossary } = useGlossary();
  const now = useNow();
  const [reviewing, setReviewing] = useState<Card[] | null>(null);
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const importInput = useRef<HTMLInputElement>(null);
  const cards = data ?? [];
  const due = dueCards(cards, now);
  const nextDue = cards.reduce<number | null>((min, c) => (min === null || c.srs.due < min ? c.srs.due : min), null);
  const noted = ws.annotations.filter((a) => a.kind === "highlight" && a.note.trim() && a.quote.trim());
  const slug = ws.doc.title.replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 60) || "lecture";

  if (reviewing) return <CardReview cards={reviewing} onExit={() => setReviewing(null)} source={(c) => (c.page ? <PageLink page={c.page} /> : null)} />;

  async function importFile(file: File) {
    const found = parseCards(await file.text().catch(() => ""));
    if (!found.length) return void toast.error(t("study.cards.importNone"));
    await makeCards(
      found.map((c) => ({ ...c, docId: ws.doc.id, source: "manual" as const, page: null })),
      t,
    );
  }

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${id}-title`} className="text-sm font-semibold">
          {t("study.cards.stats", { total: fmt.number(cards.length), due: fmt.number(due.length) })}
        </h2>
        {due.length > 0 ? (
          <Button size="sm" onClick={() => setReviewing(due)}>
            <Layers aria-hidden />
            {t("study.cards.review", { count: due.length })}
          </Button>
        ) : (
          nextDue !== null && <p className="text-muted-foreground text-[13px]">{t("study.cards.noneDue", { when: fmt.relative(nextDue - now) })}</p>
        )}
      </div>
      {cards.length === 0 && <p className="text-muted-foreground text-[13px] leading-relaxed">{t("study.cards.empty")}</p>}

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!glossary?.some((g) => g.translation)}
          onClick={() => void makeCards((glossary ?? []).filter((g) => g.translation).map((g) => ({ docId: ws.doc.id, front: g.term, back: g.translation, source: "glossary" as const, page: null })), t)}
        >
          <BookA aria-hidden />
          {t("study.cards.fromGlossary")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!noted.length}
          title={t("study.cards.highlightsHint")}
          onClick={() => void makeCards(noted.map((a) => ({ docId: ws.doc.id, front: a.note.trim(), back: a.quote.trim(), source: "highlight" as const, page: a.page })), t)}
        >
          <Highlighter aria-hidden />
          {t("study.cards.fromHighlights")}
        </Button>
      </div>

      <form
        className="space-y-2 rounded-lg border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!front.trim() || !back.trim()) return;
          void makeCards([{ docId: ws.doc.id, front, back, source: "manual", page: ws.page }], t).then(() => {
            setFront("");
            setBack("");
          });
        }}
      >
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-[13px] font-medium">
            {t("study.cards.front")}
            <Textarea dir="auto" rows={2} value={front} maxLength={2000} onChange={(e) => setFront(e.target.value)} className="mt-1 min-h-0 px-2.5 py-1.5 text-sm" />
          </label>
          <label className="text-[13px] font-medium">
            {t("study.cards.back")}
            <Textarea dir="auto" rows={2} value={back} maxLength={4000} onChange={(e) => setBack(e.target.value)} className="mt-1 min-h-0 px-2.5 py-1.5 text-sm" />
          </label>
        </div>
        <Button type="submit" size="sm" disabled={!front.trim() || !back.trim()}>
          <Plus aria-hidden />
          {t("study.cards.add")}
        </Button>
      </form>

      <div className="flex flex-wrap gap-1">
        <input
          ref={importInput}
          type="file"
          accept=".csv,.tsv,.txt,.json,text/csv,application/json,text/plain"
          className="hidden"
          aria-hidden
          tabIndex={-1}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void importFile(file);
          }}
        />
        <Button size="sm" variant="ghost" onClick={() => importInput.current?.click()}>
          <Upload aria-hidden />
          {t("study.cards.import")}
        </Button>
        {cards.length > 0 && (
          <>
            <Button size="sm" variant="ghost" onClick={() => downloadBlob(new Blob([cardsCsv(cards)], { type: "text/csv;charset=utf-8" }), `${slug}_flashcards.csv`)}>
              <Download aria-hidden />
              {t("study.cards.exportCsv")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => downloadBlob(new Blob([cardsJson(cards)], { type: "application/json" }), `${slug}_flashcards.json`)}>
              <Download aria-hidden />
              {t("study.cards.exportJson")}
            </Button>
          </>
        )}
      </div>

      {cards.length > 0 && (
        <details className="rounded-lg border">
          <summary className="cursor-pointer px-3 py-2 text-[13px] font-semibold">{t("study.cards.all", { count: fmt.number(cards.length) })}</summary>
          <ul className="divide-y border-t">
            {cards.map((c) => (
              <li key={c.id} className="flex items-start gap-2 px-3 py-2">
                <div className="min-w-0 flex-1 text-sm" dir="auto">
                  <p className="font-medium">{c.front}</p>
                  <p className="text-muted-foreground line-clamp-2">{c.back}</p>
                  <p className="text-muted-foreground mt-0.5 text-[12px]">{t("study.cards.dueAt", { when: fmt.relative(c.srs.due - now) })}</p>
                </div>
                <Button size="icon-sm" variant="ghost" aria-label={t("study.cards.deleteCard", { front: c.front.slice(0, 60) })} onClick={() => void deleteCard(c.id).catch(() => toast.error(t("library.errors.FAILED")))}>
                  <Trash2 aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function PageLink({ page }: { page: number }) {
  const { t } = useI18n();
  const ws = useWorkspace();
  return (
    <Button variant="link" size="sm" className="h-auto p-0 text-[12px]" onClick={() => ws.goTo(page)}>
      {t("study.pageLabel", { n: page })}
    </Button>
  );
}

/** One review session: front, then back, then a grade that schedules the card. Cards marked "Again" come back at the end. */
export function CardReview({ cards, onExit, source }: { cards: Card[]; onExit: () => void; source?: (card: Card) => ReactNode }) {
  const { t, fmt } = useI18n();
  const now = useNow();
  const [queue, setQueue] = useState(cards);
  const [shown, setShown] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [busy, setBusy] = useState(false);
  const region = useRef<HTMLDivElement>(null);
  const card = queue[0];

  useEffect(() => {
    region.current?.focus();
  }, [card?.id, shown]);

  async function grade(g: Grade) {
    if (!card || busy) return;
    setBusy(true);
    try {
      const updated = await reviewCard(card.id, g);
      setQueue((q) => (g === "again" ? [...q.slice(1), updated] : q.slice(1)));
      setReviewed((n) => n + 1);
      setShown(false);
    } catch {
      toast.error(t("library.errors.FAILED"));
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const onButton = (e.target as HTMLElement).tagName === "BUTTON";
    if ((e.key === " " || e.key === "Enter") && !onButton && !shown) {
      e.preventDefault();
      setShown(true);
    } else if (shown && /^[1-4]$/.test(e.key)) {
      e.preventDefault();
      void grade(GRADES[Number(e.key) - 1]);
    }
  }

  return (
    <section aria-label={t("study.review.title")} className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-[13px] font-medium" role="status">
          {card ? t("study.cards.progress", { n: reviewed + 1, total: reviewed + queue.length }) : t("study.cards.done", { count: reviewed })}
        </p>
        <Button size="sm" variant="ghost" onClick={onExit}>
          {t("study.cards.endReview")}
        </Button>
      </div>
      {card && (
        <div ref={region} tabIndex={-1} onKeyDown={onKeyDown} className="space-y-3 rounded-xl border p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <p className="text-lg leading-relaxed font-semibold" dir="auto">
            {card.front}
          </p>
          {source?.(card)}
          {shown ? (
            <>
              <p className="border-t pt-3 text-[15px] leading-relaxed" dir="auto">
                {card.back}
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {GRADES.map((g, i) => (
                  <Button key={g} variant={g === "again" ? "outline" : g === "medium" ? "default" : "secondary"} disabled={busy} className="h-auto flex-col gap-0 py-1.5" onClick={() => void grade(g)}>
                    <span>
                      <span className="me-1 text-[11px]" aria-hidden>
                        {i + 1}
                      </span>
                      {t(`study.cards.grades.${g}`)}
                    </span>
                    <span className="text-[11px] font-normal">{fmt.relative(schedule(card.srs, g, now).due - now)}</span>
                  </Button>
                ))}
              </div>
            </>
          ) : (
            <Button onClick={() => setShown(true)}>{t("study.cards.showAnswer")}</Button>
          )}
          <p className="text-muted-foreground text-[12px]">{t("study.cards.keys")}</p>
        </div>
      )}
    </section>
  );
}
