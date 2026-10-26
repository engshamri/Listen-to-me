"use client";

import { Crosshair, ExternalLink, History, Languages, Loader2, Search, Volume2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { useConsent } from "./consent";
import { useWorkspace } from "./workspace-context";
import { Notice } from "@/components/studio/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n/provider";
import { UNTRANSLATED_KINDS } from "@/lib/study/layout";
import { buildIndex, searchIndex, tokens, type Passage, type SearchHit } from "@/lib/study/search-index";
import { getPages, listDocs, type StudyPage } from "@/lib/study/store";
import { translateViaApi } from "@/lib/study/translate";

/*
 * "Ask your lecture": passage search over the lecture (or its course). Not AI:
 * it returns the lecture's own paragraphs with their pages, and says plainly
 * when the material doesn't contain the question's words.
 */

type Scope = "lecture" | "course";

interface Asked {
  question: string;
  /** What was searched: the question, or its translation. */
  searched: string;
  scope: Scope;
  hits: SearchHit[];
}

function passagesOf(docId: string, pages: StudyPage[]): Passage[] {
  return pages.flatMap((p) => p.paragraphs.flatMap((para, index) => (UNTRANSLATED_KINDS.has(para.kind) || !para.text.trim() ? [] : [{ docId, page: p.page, index, text: para.text, box: para.box }])));
}

/** Share of letters that are Arabic (0–1). */
function arabicShare(text: string): number {
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  return letters ? (text.match(/\p{Script=Arabic}/gu)?.length ?? 0) / letters : 0;
}

export function AskPanel() {
  const { t } = useI18n();
  const ws = useWorkspace();
  const ask = useConsent();
  const id = useId();
  const [question, setQuestion] = useState("");
  const [scope, setScope] = useState<Scope>("lecture");
  const [course, setCourse] = useState<{ passages: Passage[]; titles: Map<string, string> } | null>(null);
  const [history, setHistory] = useState<Asked[]>([]);
  const [translating, setTranslating] = useState(false);
  const current = history[0] ?? null;

  // Rebuild only when the lecture's text changes (not on every saved translation).
  const signature = ws.pages.map((p) => `${p.page}:${p.source}:${p.paragraphs.length}`).join();
  const lecturePassages = useMemo(
    () => passagesOf(ws.doc.id, ws.pages),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ws.doc.id, signature],
  );
  const lectureIndex = useMemo(() => buildIndex(lecturePassages), [lecturePassages]);
  const lectureArabic = useMemo(() => arabicShare(lecturePassages.slice(0, 400).map((p) => p.text).join(" ")), [lecturePassages]);

  // Other lectures of the course, loaded when the student searches the whole course.
  useEffect(() => {
    if (scope !== "course" || course || !ws.doc.courseId) return;
    let alive = true;
    void (async () => {
      const docs = (await listDocs()).filter((d) => d.courseId === ws.doc.courseId && d.id !== ws.doc.id);
      const titles = new Map(docs.map((d) => [d.id, d.title]));
      const passages: Passage[] = [];
      for (const d of docs) passages.push(...passagesOf(d.id, await getPages(d.id)));
      if (alive) setCourse({ passages, titles });
    })().catch(() => alive && setCourse({ passages: [], titles: new Map() }));
    return () => {
      alive = false;
    };
  }, [scope, course, ws.doc.courseId, ws.doc.id]);
  const courseIndex = useMemo(() => (course ? buildIndex([...lecturePassages, ...course.passages]) : null), [course, lecturePassages]);

  function run(q: string, searched = q, where: Scope = scope) {
    const text = q.trim();
    if (!text) return;
    const idx = where === "course" && courseIndex ? courseIndex : lectureIndex;
    const hits = searchIndex(idx, searched, 5);
    setHistory((h) => [{ question: text, searched, scope: where, hits }, ...h.filter((x) => x.question !== text || x.scope !== where)].slice(0, 20));
  }

  // The question's script differs from the lecture's: offer to translate it.
  const mismatchTarget = current && current.question === current.searched ? (arabicShare(current.question) > 0.5 && lectureArabic < 0.3 ? "en" : arabicShare(current.question) < 0.2 && lectureArabic > 0.7 ? "ar" : null) : null;

  async function translateAndRun() {
    if (!current || !mismatchTarget) return;
    if (!(await ask("translate"))) return;
    setTranslating(true);
    try {
      const out = (await translateViaApi(current.question, mismatchTarget)).trim();
      if (out) run(current.question, out, current.scope);
    } catch {
      toast.error(t("study.translateFailed"));
    } finally {
      setTranslating(false);
    }
  }

  const titleOf = (docId: string) => (docId === ws.doc.id ? ws.doc.title : (course?.titles.get(docId) ?? ""));

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${id}-title`} className="text-sm font-semibold">
          {t("study.ask.title")}
        </h2>
        <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[12px] font-medium">{t("study.ask.badge")}</span>
      </div>
      <p className="text-muted-foreground text-[13px] leading-relaxed">{t("study.ask.intro")}</p>

      {lecturePassages.length === 0 ? (
        <Notice tone="info">
          <p>{t("study.ask.noText")}</p>
        </Notice>
      ) : (
        <form
          role="search"
          aria-labelledby={`${id}-title`}
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(question);
          }}
        >
          <label htmlFor={`${id}-q`} className="text-[13px] font-medium">
            {t("study.ask.label")}
          </label>
          <div className="flex gap-2">
            <Input id={`${id}-q`} dir="auto" value={question} maxLength={500} placeholder={t("study.ask.placeholder")} onChange={(e) => setQuestion(e.target.value)} className="h-9 min-w-0 flex-1" />
            <Button type="submit" size="sm" className="h-9" disabled={!question.trim() || (scope === "course" && !course)}>
              <Search aria-hidden />
              {t("study.ask.submit")}
            </Button>
          </div>
          {ws.doc.courseId && (
            <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
              <legend className="sr-only">{t("study.ask.scope")}</legend>
              {(["lecture", "course"] as const).map((s) => (
                <label key={s} className="flex items-center gap-1.5">
                  <input type="radio" name={`${id}-scope`} className="accent-primary size-4" checked={scope === s} onChange={() => setScope(s)} />
                  {s === "lecture" ? t("study.ask.scopeLecture") : t("study.ask.scopeCourse")}
                </label>
              ))}
              {scope === "course" && !course && <Loader2 className="text-muted-foreground size-4 animate-spin" aria-hidden />}
            </fieldset>
          )}
        </form>
      )}

      {current && (
        <div className="space-y-2" aria-live="polite">
          {current.searched !== current.question && (
            <p className="text-muted-foreground text-[13px]" dir="auto">
              {t("study.ask.searchedFor", { text: current.searched })}
            </p>
          )}
          {mismatchTarget && (
            <Notice tone="info">
              <p>{t("study.ask.crossLanguage")}</p>
              <Button size="sm" variant="outline" className="mt-2 h-auto min-h-8 py-1.5 whitespace-normal" disabled={translating} onClick={() => void translateAndRun()}>
                {translating ? <Loader2 className="animate-spin" aria-hidden /> : <Languages aria-hidden />}
                {t("study.ask.translateQuestion", { lang: t(`study.ask.languages.${mismatchTarget}`) })}
              </Button>
            </Notice>
          )}
          {current.hits.length === 0 ? (
            <Notice tone="warning" role="status">
              <p className="font-semibold">{t("study.ask.notFound")}</p>
              <p>{t("study.ask.notFoundHint")}</p>
            </Notice>
          ) : (
            <>
              <p role="status" className="text-[13px] font-medium">
                {t("study.ask.results", { count: current.hits.length })}
              </p>
              <ol className="space-y-2">
                {current.hits.map((hit) => (
                  <HitItem key={`${hit.passage.docId}-${hit.passage.page}-${hit.passage.index}`} hit={hit} title={hit.passage.docId === ws.doc.id ? null : titleOf(hit.passage.docId)} />
                ))}
              </ol>
            </>
          )}
        </div>
      )}

      {history.length > 1 && (
        <div>
          <h3 className="text-muted-foreground mb-1 flex items-center gap-1.5 text-[13px] font-semibold">
            <History className="size-3.5" aria-hidden />
            {t("study.ask.history")}
          </h3>
          <ul className="flex flex-wrap gap-1.5">
            {history.slice(1).map((h) => (
              <li key={`${h.scope}-${h.question}`}>
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-auto max-w-full py-1 text-start whitespace-normal"
                  dir="auto"
                  onClick={() => {
                    setQuestion(h.question);
                    setScope(h.scope);
                    run(h.question, h.searched, h.scope);
                  }}
                >
                  {h.question}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function HitItem({ hit, title }: { hit: SearchHit; title: string | null }) {
  const { t } = useI18n();
  const ws = useWorkspace();
  const { passage } = hit;
  const matched = new Set(hit.matched);
  const parts = passage.text.split(/([\p{L}\p{N}]+)/u);
  return (
    <li className="rounded-lg border p-2.5">
      <p className="text-primary text-[12px] font-semibold" dir="auto">
        {title === null ? t("study.pageLabel", { n: passage.page }) : t("study.ask.where", { title, page: passage.page })}
      </p>
      <p dir="auto" className="mt-1 leading-relaxed" style={{ fontSize: ws.textSize }}>
        {parts.map((part, i) => (i % 2 === 1 && tokens(part).some((x) => matched.has(x)) ? <mark key={i} className="bg-primary-soft text-foreground rounded-sm px-0.5">{part}</mark> : part))}
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {title === null ? (
          <Button size="sm" variant="ghost" onClick={() => ws.focusParagraph(passage.page, passage.box)}>
            <Crosshair aria-hidden />
            {t("study.ask.showOnPage")}
          </Button>
        ) : (
          <Button asChild size="sm" variant="ghost">
            <Link href={`/study/${passage.docId}?page=${passage.page}`}>
              <ExternalLink aria-hidden />
              {t("study.ask.openLecture")}
            </Link>
          </Button>
        )}
        {title === null && (
          <Button size="sm" variant="ghost" onClick={() => ws.listen(passage.text, t("study.pageLabel", { n: passage.page }))}>
            <Volume2 aria-hidden />
            {t("study.listen")}
          </Button>
        )}
      </div>
    </li>
  );
}
