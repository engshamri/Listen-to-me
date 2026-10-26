"use client";

import { Crosshair, Layers, Plus } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { FlashcardsSection, makeCards } from "./flashcards";
import { QuizSection } from "./quiz-panel";
import { useWorkspace } from "./workspace-context";
import { Notice } from "@/components/studio/primitives";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/provider";
import { findDefinitions, type Definition } from "@/lib/study/definitions";
import { cn } from "@/lib/utils";

type Section = "definitions" | "quiz" | "cards";
const SECTIONS: Section[] = ["definitions", "quiz", "cards"];

/** Practice without AI: definitions found in the lecture, quizzes built from them, and flashcards. */
export function PracticePanel() {
  const { t, locale } = useI18n();
  const ws = useWorkspace();
  const [section, setSection] = useState<Section>("definitions");
  // Only the text matters here; saved translations don't change the definitions.
  const signature = ws.pages.map((p) => `${p.page}:${p.source}:${p.paragraphs.length}`).join();
  const definitions = useMemo(
    () => findDefinitions(ws.pages, locale),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature, locale],
  );

  return (
    <div className="space-y-3">
      <div role="group" aria-label={t("study.tabs.practice")} className="bg-muted flex gap-1 rounded-lg p-1">
        {SECTIONS.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={section === s}
            className={cn("flex-1 rounded-md px-2 py-1.5 text-[13px] font-medium", section === s ? "bg-background shadow-card" : "text-muted-foreground hover:text-foreground")}
            onClick={() => setSection(s)}
          >
            {t(`study.practice.sections.${s}`)}
          </button>
        ))}
      </div>
      <p className="text-muted-foreground text-[12px] leading-relaxed">{t("study.practice.notAi")}</p>
      {section === "definitions" && <DefinitionsSection definitions={definitions} />}
      {/* Kept mounted so a quiz in progress survives switching sections. */}
      <div hidden={section !== "quiz"}>
        <QuizSection definitions={definitions} />
      </div>
      {section === "cards" && <FlashcardsSection />}
    </div>
  );
}

function DefinitionsSection({ definitions }: { definitions: Definition[] }) {
  const { t } = useI18n();
  const ws = useWorkspace();
  const id = useId();
  const toCard = (d: Definition) => ({ docId: ws.doc.id, front: d.term, back: d.definition, source: "definition" as const, page: d.page });

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${id}-title`} className="text-sm font-semibold">
          {t("study.practice.found", { count: definitions.length })}
        </h2>
        {definitions.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => void makeCards(definitions.map(toCard), t)}>
            <Layers aria-hidden />
            {t("study.practice.addAll")}
          </Button>
        )}
      </div>
      {definitions.length === 0 ? (
        <Notice tone="info">
          <p>{t("study.practice.noDefinitions")}</p>
        </Notice>
      ) : (
        <ol className="space-y-2">
          {definitions.map((d) => (
            <li key={`${d.page}-${d.term}`} className="rounded-lg border p-2.5">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1" dir="auto" style={{ fontSize: ws.textSize }}>
                  <p className="leading-relaxed">
                    <span className="font-semibold">{d.term}</span>
                    {" — "}
                    {d.definition}
                  </p>
                </div>
                <Button size="icon-sm" variant="ghost" aria-label={t("study.practice.addOne", { term: d.term })} title={t("study.practice.addOne", { term: d.term })} onClick={() => void makeCards([toCard(d)], t)}>
                  <Plus aria-hidden />
                </Button>
              </div>
              <Button variant="link" size="sm" className="mt-1 h-auto gap-1 p-0 text-[12px]" onClick={() => ws.focusParagraph(d.page, d.box)}>
                <Crosshair className="size-3.5" aria-hidden />
                {t("study.pageLabel", { n: d.page })}
              </Button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
