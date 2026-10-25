"use client";

import { Check, Languages } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useI18n } from "@/lib/i18n/provider";
import { joinPreservingLines, splitPreservingLines } from "@/lib/text/lines";
import { TRANSLATE_REQUEST_CHARS, TRANSLATION_LANGUAGES, baseLanguage, languageLabel } from "@/lib/translate/languages";

export interface TranslationOutcome {
  original: string;
  translated: string;
  from: string | null;
  to: string;
}

export class TranslateFailure extends Error {}

/** Translates long text request by request, keeping paragraph breaks intact. */
export async function translateLongText(
  text: string,
  source: string,
  target: string,
  { signal, onProgress }: { signal: AbortSignal; onProgress: (done: number, total: number) => void },
): Promise<{ text: string; detected: string | null }> {
  const leading = /^\s*/.exec(text)![0];
  const trailing = /\s*$/.exec(text)![0];
  const { pieces, separators } = splitPreservingLines(text.trim(), TRANSLATE_REQUEST_CHARS);
  const out: string[] = [];
  let detected: string | null = null;
  onProgress(0, pieces.length);
  for (let i = 0; i < pieces.length; i++) {
    const res = await fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "translate", text: pieces[i], source, target }),
      signal,
    });
    if (!res.ok) throw new TranslateFailure(String(res.status));
    const data = (await res.json()) as { text: string; detectedSource: string | null };
    detected ??= data.detectedSource;
    out.push(data.text.trim());
    onProgress(i + 1, pieces.length);
  }
  return { text: leading + joinPreservingLines(out, separators) + trailing, detected };
}

interface TranslateControlProps {
  text: string;
  disabled?: boolean;
  voiceLang: string;
  onTranslate: (target: string, source: string) => void;
}

export function TranslateControl({ text, disabled, voiceLang, onTranslate }: TranslateControlProps) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState("auto");
  const [detected, setDetected] = useState<{ sample: string; lang: string | null } | null>(null);
  const sample = text.trim().slice(0, 400);
  const detecting = open && Boolean(sample) && detected?.sample !== sample;

  // Detect the source language when the panel opens (once per text sample).
  useEffect(() => {
    if (!detecting) return;
    const ctrl = new AbortController();
    fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "detect", text: sample }),
      signal: ctrl.signal,
    })
      .then((r) => (r.ok ? r.json() : { detectedSource: null }))
      .then((d: { detectedSource: string | null }) => setDetected({ sample, lang: d.detectedSource }))
      .catch(() => {
        if (!ctrl.signal.aborted) setDetected({ sample, lang: null });
      });
    return () => ctrl.abort();
  }, [detecting, sample]);

  const collator = useMemo(() => new Intl.Collator(locale), [locale]);
  const all = useMemo(
    () => TRANSLATION_LANGUAGES.map((code) => ({ code, label: languageLabel(code, locale), english: languageLabel(code, "en") })).sort((a, b) => collator.compare(a.label, b.label)),
    [locale, collator],
  );
  const suggested = useMemo(() => {
    const wanted = [locale, voiceLang, "en", "ar", "fr", "es"];
    const codes: string[] = [];
    for (const w of wanted) {
      const match = TRANSLATION_LANGUAGES.find((c) => c === w || baseLanguage(c) === w);
      if (match && !codes.includes(match)) codes.push(match);
    }
    return codes.slice(0, 5).map((code) => all.find((a) => a.code === code)!).filter(Boolean);
  }, [locale, voiceLang, all]);

  const detectedLang = detected?.sample === sample ? detected.lang : null;

  function choose(target: string) {
    setOpen(false);
    onTranslate(target, source);
  }

  const item = (l: { code: string; label: string }, prefix: string) => (
    <CommandItem key={prefix + l.code} value={`${prefix}${l.code}`} onSelect={() => choose(l.code)}>
      <span className="flex-1 truncate">{l.label}</span>
      {detectedLang && baseLanguage(detectedLang) === baseLanguage(l.code) && <Check className="text-muted-foreground" aria-hidden />}
    </CommandItem>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          <Languages aria-hidden />
          {t("translate.button")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="space-y-1.5 border-b p-3">
          <label htmlFor="translate-source" className="text-[13px] font-medium">
            {t("translate.from")}
          </label>
          <select
            id="translate-source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="border-input bg-card h-9 w-full rounded-lg border px-2.5 text-sm outline-none focus-visible:border-ring"
          >
            <option value="auto">
              {detecting ? t("translate.detecting") : detectedLang ? `${t("translate.auto")} · ${languageLabel(detectedLang, locale)}` : t("translate.auto")}
            </option>
            {all.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
        <Command
          filter={(value, search) => {
            const code = value.replace(/^(s:|a:)/, "");
            const l = all.find((x) => x.code === code);
            const hay = l ? `${l.label} ${l.english} ${l.code}` : value;
            return hay.toLocaleLowerCase().includes(search.toLocaleLowerCase()) ? 1 : 0;
          }}
        >
          <CommandInput placeholder={t("translate.search")} aria-label={t("translate.to")} />
          <CommandList className="max-h-72">
            <CommandEmpty>{t("translate.noResults")}</CommandEmpty>
            <CommandGroup heading={t("translate.suggested")}>{suggested.map((l) => item(l, "s:"))}</CommandGroup>
            <CommandGroup heading={t("translate.allLanguages")}>{all.map((l) => item(l, "a:"))}</CommandGroup>
          </CommandList>
        </Command>
        <p className="text-muted-foreground border-t p-3 text-[12px] leading-relaxed">{t("translate.note")}</p>
      </PopoverContent>
    </Popover>
  );
}
