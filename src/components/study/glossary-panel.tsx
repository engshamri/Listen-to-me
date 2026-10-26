"use client";

import { Plus, Trash2, Volume2 } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { useGlossary } from "./study-hooks";
import { useWorkspace } from "./workspace-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n/provider";
import { deleteGlossaryEntry, saveGlossaryEntry } from "@/lib/study/store";

/** Preferred translations of terms, applied whenever the student translates. */
export function GlossaryPanel({ draft }: { draft: string }) {
  const { t } = useI18n();
  const ws = useWorkspace();
  const { data } = useGlossary();
  const [term, setTerm] = useState(draft);
  const [translation, setTranslation] = useState("");
  const [showOriginal, setShowOriginal] = useState(true);
  const id = useId();

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!term.trim()) return;
    try {
      await saveGlossaryEntry({ term, translation, showOriginal, note: "" });
      setTerm("");
      setTranslation("");
    } catch {
      toast.error(t("library.errors.FAILED"));
    }
  }

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-3">
      <h2 id={`${id}-title`} className="text-sm font-semibold">
        {t("study.glossary")}
      </h2>
      <p className="text-muted-foreground text-[13px] leading-relaxed">{t("study.glossaryIntro")}</p>
      <form onSubmit={(e) => void add(e)} className="space-y-2 rounded-lg border p-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <label htmlFor={`${id}-term`} className="text-[13px] font-medium">
              {t("study.term")}
            </label>
            <Input id={`${id}-term`} value={term} dir="auto" maxLength={120} onChange={(e) => setTerm(e.target.value)} className="mt-1 h-9" />
          </div>
          <div>
            <label htmlFor={`${id}-translation`} className="text-[13px] font-medium">
              {t("study.termTranslation")}
            </label>
            <Input id={`${id}-translation`} value={translation} dir="auto" maxLength={200} onChange={(e) => setTranslation(e.target.value)} className="mt-1 h-9" />
          </div>
        </div>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" className="accent-primary size-4" checked={showOriginal} onChange={(e) => setShowOriginal(e.target.checked)} />
          {t("study.showOriginal")}
        </label>
        <Button type="submit" size="sm" disabled={!term.trim()}>
          <Plus aria-hidden />
          {t("study.addTerm")}
        </Button>
      </form>
      {data && data.length === 0 ? (
        <p className="text-muted-foreground text-sm leading-relaxed">{t("study.noTerms")}</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {(data ?? []).map((g) => (
            <li key={g.id} className="flex items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium" dir="auto">
                  {g.term}
                </p>
                <p className="text-muted-foreground truncate text-[13px]" dir="auto">
                  {g.translation ? (g.showOriginal ? `${g.translation} (${g.term})` : g.translation) : g.term}
                </p>
              </div>
              <Button size="icon-sm" variant="ghost" aria-label={t("study.pronounce", { term: g.term })} title={t("study.pronounce", { term: g.term })} onClick={() => ws.listen(g.term, t("study.glossary"))}>
                <Volume2 aria-hidden />
              </Button>
              <Button size="icon-sm" variant="ghost" aria-label={t("study.deleteTerm", { term: g.term })} onClick={() => void deleteGlossaryEntry(g.id)}>
                <Trash2 aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
