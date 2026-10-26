"use client";

import { ClipboardPaste, FileText, FileUp, ListTree, Loader2, Sparkles, Trash2, Wand2, X } from "lucide-react";
import { useCallback, useDeferredValue, useMemo, useState } from "react";
import { toast } from "sonner";
import { ChapterPicker } from "./chapter-picker";
import { useFileImport, type ImportedFile } from "./file-import";
import { useLatest } from "./hooks";
import { Notice, Panel, ProgressBar, StepHeading } from "./primitives";
import { TranslateControl, translateLongText, type TranslationOutcome } from "./translate-control";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { decodeTextFile, TEXT_ENCODINGS, type TextEncoding } from "@/lib/files/decode-text";
import { MAX_PDF_BYTES, MAX_TEXT_CHARS, MAX_TXT_BYTES } from "@/lib/files/limits";
import { useI18n } from "@/lib/i18n/provider";
import { detectChapters } from "@/lib/text/chapters";
import { applyCleanup, type CleanupAction } from "@/lib/text/cleanup";
import { splitIntoChunks } from "@/lib/text/chunk";
import { countWords, detectScript, estimateDurationSeconds, scriptMismatch, type Script } from "@/lib/text/stats";
import { TRANSLATE_MAX_CHARS, baseLanguage, languageLabel } from "@/lib/translate/languages";
import { cn } from "@/lib/utils";
import { VOICE_LANGUAGES, voiceName, type Voice } from "@/lib/voices/catalog";

/** Most likely language for a script, used to pre-filter voices. Latin is ambiguous. */
const SCRIPT_LANG: Partial<Record<Script, string>> = {
  Arabic: "ar", Cyrillic: "ru", Greek: "el", Hebrew: "he", Han: "zh", Kana: "ja", Hangul: "ko", Devanagari: "hi",
  Bengali: "bn", Tamil: "ta", Telugu: "te", Kannada: "kn", Malayalam: "ml", Gujarati: "gu", Thai: "th", Lao: "lo",
  Khmer: "km", Myanmar: "my", Georgian: "ka", Ethiopic: "am", Sinhala: "si", CanadianSyllabics: "iu",
};

/** Toolbar button: icon-only with a tooltip on narrow screens, icon + label on wide ones. */
function ToolButton({ icon: Icon, label, onClick }: { icon: typeof FileUp; label: string; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="sm" onClick={onClick} aria-label={label} className="px-2.5">
          <Icon aria-hidden />
          <span className="hidden xl:inline">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent className="xl:hidden">{label}</TooltipContent>
    </Tooltip>
  );
}

interface TextPanelProps {
  text: string;
  onTextChange: (text: string) => void;
  /** Replaces the text and offers an Undo toast. */
  replaceText: (next: string, message: string) => void;
  voice: Voice;
  speed: number;
  onGenerate: () => void;
  onFindVoice: (lang: string | null) => void;
  /** Chapters chosen for conversion (indexes), or null for the whole text. */
  chosenChapters: number[] | null;
  onChooseChapters: (chosen: number[] | null) => void;
  className?: string;
}

export function TextPanel({ text, onTextChange, replaceText, voice, speed, onGenerate, onFindVoice, chosenChapters, onChooseChapters, className }: TextPanelProps) {
  const { t, locale, dir, fmt } = useI18n();
  const textRef = useLatest(text);
  const [file, setFile] = useState<ImportedFile | null>(null);
  const [dragging, setDragging] = useState(false);
  const [translation, setTranslation] = useState<TranslationOutcome | null>(null);
  const [translating, setTranslating] = useState<{ done: number; total: number; ctrl: AbortController } | null>(null);

  const deferred = useDeferredValue(text);
  const stats = useMemo(() => {
    const words = countWords(deferred);
    const script = detectScript(deferred);
    return {
      chars: deferred.length,
      words,
      seconds: estimateDurationSeconds(deferred, speed, words),
      parts: deferred.length > MAX_TEXT_CHARS ? 0 : splitIntoChunks(deferred, { locale: voice.lang }).length,
      script,
    };
  }, [deferred, speed, voice.lang]);
  const overLimit = text.length > MAX_TEXT_CHARS;
  const chapterCount = useMemo(() => (deferred.length > MAX_TEXT_CHARS ? 0 : detectChapters(deferred).length), [deferred]);
  const [pickerOpen, setPickerOpen] = useState(false);
  // The picker works on the text as it is now, so its choices match what Generate will read.
  const pickerChapters = useMemo(() => (pickerOpen ? detectChapters(text) : []), [pickerOpen, text]);
  const mismatch = stats.words >= 3 && scriptMismatch(stats.script, voice.lang, voice.multilingual);

  const onImport = useCallback(
    (imported: string, info: ImportedFile) => {
      setTranslation(null);
      setFile(info);
      onTextChange(imported);
    },
    [onTextChange],
  );
  const importer = useFileImport({ getText: () => textRef.current, onImport });

  function removeImport() {
    if (!file) return;
    setFile(null);
    replaceText(file.previousText, t("file.removed"));
  }

  function changeEncoding(encoding: TextEncoding) {
    if (!file?.buffer) return;
    const decoded = decodeTextFile(file.buffer, encoding);
    setFile({ ...file, encoding, confident: true, importedText: decoded.text });
    onTextChange(decoded.text);
  }

  async function paste() {
    try {
      const clip = await navigator.clipboard.readText();
      if (!clip) return void toast.info(t("editor.clipboardEmpty"));
      onTextChange(textRef.current ? `${textRef.current.replace(/\s*$/, "")}\n\n${clip}` : clip);
      toast.success(t("editor.pasted"));
    } catch {
      toast.error(t("editor.clipboardDenied"));
    }
  }

  function cleanup(action: CleanupAction) {
    const next = applyCleanup(textRef.current, action);
    if (next === textRef.current) return void toast.info(t("editor.cleanupNoChange"));
    replaceText(next, t("editor.cleanupDone"));
  }

  async function translate(target: string, source: string) {
    const original = textRef.current;
    if (!original.trim()) return void toast.info(t("translate.empty"));
    if (original.length > TRANSLATE_MAX_CHARS) return void toast.error(t("translate.tooLong", { max: TRANSLATE_MAX_CHARS }));
    const ctrl = new AbortController();
    setTranslating({ done: 0, total: 1, ctrl });
    try {
      const result = await translateLongText(original, source, target, {
        signal: ctrl.signal,
        onProgress: (done, total) => setTranslating((s) => (s ? { ...s, done, total } : s)),
      });
      const from = result.detected ?? (source === "auto" ? null : source);
      onTextChange(result.text);
      setTranslation({ original, translated: result.text, from, to: target });
      toast.success(t("translate.done", { from: from ? languageLabel(from, locale) : "—", to: languageLabel(target, locale) }));
    } catch {
      if (!ctrl.signal.aborted) toast.error(t("translate.failed"));
    } finally {
      setTranslating(null);
    }
  }

  function restoreOriginal() {
    if (!translation) return;
    setTranslation(null);
    replaceText(translation.original, t("translate.restored"));
  }

  const targetHasVoices = translation && VOICE_LANGUAGES.some((l) => l.code === baseLanguage(translation.to));
  const showVoiceHint = translation && targetHasVoices && baseLanguage(translation.to) !== voice.lang && !voice.multilingual;

  function insertSample() {
    if (textRef.current.trim()) replaceText(t("editor.sampleText"), t("editor.sampleInserted"));
    else onTextChange(t("editor.sampleText"));
  }

  const toolbar = (
    <div className="flex items-center gap-0.5">
      <ToolButton icon={FileUp} label={t("editor.upload")} onClick={() => importer.openPicker()} />
      <ToolButton icon={ClipboardPaste} label={t("editor.paste")} onClick={() => void paste()} />
      <ToolButton icon={Sparkles} label={t("editor.sample")} onClick={insertSample} />
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" aria-label={t("editor.cleanup")} className="px-2.5" disabled={!text.trim()}>
                <Wand2 aria-hidden />
                <span className="hidden xl:inline">{t("editor.cleanup")}</span>
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent className="xl:hidden">{t("editor.cleanup")}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => cleanup("whitespace")}>{t("editor.cleanupWhitespace")}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => cleanup("joinLines")}>{t("editor.cleanupJoinLines")}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => cleanup("links")}>{t("editor.cleanupLinks")}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => cleanup("emoji")}>{t("editor.cleanupEmoji")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="destructive"
            size="sm"
            className="px-2.5"
            aria-label={t("editor.clear")}
            disabled={!text}
            onClick={() => {
              setFile(null);
              setTranslation(null);
              replaceText("", t("editor.cleared"));
            }}
          >
            <Trash2 aria-hidden />
            <span className="hidden xl:inline">{t("editor.clear")}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent className="xl:hidden">{t("editor.clear")}</TooltipContent>
      </Tooltip>
    </div>
  );

  return (
    <Panel aria-labelledby="text-title" className={cn("space-y-3 p-4 sm:p-5", className)}>
      <StepHeading step={1} id="text-title" aside={toolbar}>
        {t("steps.text")}
      </StepHeading>

      {file && (
        <div className="bg-muted flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg px-3 py-2 text-sm">
          <FileText className="text-muted-foreground size-4 shrink-0" aria-hidden />
          <span className="min-w-0 truncate font-medium" dir="auto">{file.name}</span>
          <span className="text-muted-foreground text-[13px]">
            {fmt.bytes(file.size)}
            {file.pagesLabel && ` · ${file.pagesLabel}`}
            {file.ocrPages ? ` · ${t("file.ocrBadge")}` : ""}
          </span>
          {file.kind === "txt" && file.buffer && text === file.importedText && (
            <label className="text-muted-foreground flex items-center gap-1.5 text-[13px]">
              {t("file.encoding")}
              <select
                value={file.encoding}
                onChange={(e) => changeEncoding(e.target.value as TextEncoding)}
                className="border-input bg-card text-foreground h-8 rounded-md border px-1.5 text-[13px] outline-none focus-visible:border-ring"
              >
                {TEXT_ENCODINGS.map((enc) => (
                  <option key={enc} value={enc}>
                    {enc.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Button variant="ghost" size="icon-sm" className="ms-auto" onClick={removeImport} aria-label={t("file.remove")} title={t("file.remove")}>
            <X aria-hidden />
          </Button>
        </div>
      )}

      {translation && (
        <div className="bg-primary-soft text-primary-soft-foreground flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg px-3 py-2 text-sm">
          <span className="font-medium">
            {t("translate.done", { from: translation.from ? languageLabel(translation.from, locale) : "—", to: languageLabel(translation.to, locale) })}
          </span>
          <div className="ms-auto flex flex-wrap gap-1">
            {showVoiceHint && (
              <Button size="sm" variant="outline" onClick={() => onFindVoice(baseLanguage(translation.to))}>
                {t("translate.chooseVoice", { language: languageLabel(baseLanguage(translation.to), locale) })}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={restoreOriginal}>
              {t("translate.restore")}
            </Button>
            <Button size="icon-sm" variant="ghost" onClick={() => setTranslation(null)} aria-label={t("generate.dismiss")}>
              <X aria-hidden />
            </Button>
          </div>
        </div>
      )}

      <div
        className="relative"
        onDragEnter={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            setDragging(true);
          }
        }}
        onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void importer.handleFile(e.dataTransfer.files?.[0]);
        }}
      >
        <label htmlFor="editor" className="sr-only">
          {t("editor.label")}
        </label>
        <Textarea
          id="editor"
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              onGenerate();
            }
          }}
          readOnly={Boolean(translating)}
          aria-busy={Boolean(translating)}
          aria-invalid={overLimit || undefined}
          aria-describedby="editor-stats editor-hint"
          placeholder={t("editor.placeholder")}
          // An empty field with dir="auto" resolves to LTR, which scrambles the
          // Arabic placeholder; follow the interface until there is content.
          dir={text ? "auto" : dir}
          spellCheck
          className="scroll-thin h-[clamp(13rem,42vh,28rem)] max-h-[75vh] min-h-40 resize-y overflow-y-auto text-[16px] leading-[1.8] break-words"
        />
        {dragging && (
          <div className="bg-primary-soft/95 text-primary-soft-foreground border-primary pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed text-sm font-medium">
            <FileUp className="size-6" aria-hidden />
            {t("editor.dropHere")}
            <span className="text-[13px] font-normal">{t("file.types", { txt: fmt.bytes(MAX_TXT_BYTES), pdf: fmt.bytes(MAX_PDF_BYTES) })}</span>
          </div>
        )}
        {translating && (
          <div role="status" className="bg-card/90 absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-lg px-6 text-sm">
            <p className="flex items-center gap-2 font-medium">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {t("translate.translating")}
              {translating.total > 1 && <span className="tabular-nums">{fmt.number(translating.done)}/{fmt.number(translating.total)}</span>}
            </p>
            <ProgressBar className="max-w-xs" value={translating.total > 1 ? (translating.done / translating.total) * 100 : null} label={t("translate.translating")} />
            <Button size="sm" variant="outline" onClick={() => translating.ctrl.abort()}>
              {t("translate.cancel")}
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p id="editor-stats" className={cn("text-[13px] tabular-nums", overLimit ? "text-destructive" : "text-muted-foreground")}>
          {t("editor.chars", { count: stats.chars })} · {t("editor.words", { count: stats.words })}
          {stats.seconds > 0 && <> · {t("editor.duration", { duration: fmt.duration(stats.seconds) })}</>}
          {stats.parts > 1 && <> · {t("editor.parts", { count: stats.parts })}</>}
        </p>
        <div className="flex items-center gap-3">
          {/* The Generate button shows the shortcut visually; this describes it for screen readers. */}
          <p id="editor-hint" className="sr-only">
            Ctrl + Enter {t("editor.shortcut")}
          </p>
          <TranslateControl text={text} disabled={!text.trim() || Boolean(translating)} voiceLang={voice.lang} onTranslate={(target, source) => void translate(target, source)} />
        </div>
      </div>

      {chapterCount >= 2 && !overLimit && (
        <div className={cn("flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px]", chosenChapters ? "font-medium" : "text-muted-foreground")}>
          <ListTree className="size-4 shrink-0" aria-hidden />
          <span>{chosenChapters ? t("chapters.selected", { count: chosenChapters.length, total: chapterCount }) : t("chapters.found", { count: chapterCount })}</span>
          <Button variant="link" size="sm" className="h-auto px-1 py-0.5" onClick={() => setPickerOpen(true)}>
            {chosenChapters ? t("chapters.change") : t("chapters.choose")}
          </Button>
          {chosenChapters && (
            <Button variant="link" size="sm" className="h-auto px-1 py-0.5" onClick={() => onChooseChapters(null)}>
              {t("chapters.useAll")}
            </Button>
          )}
        </div>
      )}
      <ChapterPicker open={pickerOpen} onOpenChange={setPickerOpen} text={text} chapters={pickerChapters} chosen={chosenChapters} speed={speed} onApply={onChooseChapters} />

      {overLimit && (
        <Notice tone="error" role="alert">
          {t("editor.overLimit", { count: text.length, max: MAX_TEXT_CHARS })}
        </Notice>
      )}
      {mismatch && !overLimit && (
        <Notice tone="warning" className="flex flex-wrap items-center justify-between gap-2">
          <span>{t("editor.mismatch", { language: voice.languageName[locale], voice: voiceName(voice, locale) })}</span>
          <Button size="sm" variant="outline" onClick={() => onFindVoice(stats.script ? (SCRIPT_LANG[stats.script] ?? null) : null)}>
            {t("editor.mismatchAction")}
          </Button>
        </Notice>
      )}

      {importer.elements}
    </Panel>
  );
}
