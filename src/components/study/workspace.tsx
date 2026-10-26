"use client";

import { ArrowLeft, ChevronLeft, ChevronRight, FileUp, Languages, Loader2, Maximize, Minus, Plus, Search, Volume2, X } from "lucide-react";
import Link from "next/link";
import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AskPanel } from "./ask-panel";
import { ConsentProvider, PROVIDERS, useConsent } from "./consent";
import { GlossaryPanel } from "./glossary-panel";
import { NotesPanel } from "./notes-panel";
import { PageTextPanel } from "./page-text-panel";
import { PdfViewer, type PdfSelection, type PdfViewerHandle } from "./pdf-viewer";
import { PracticePanel } from "./practice-panel";
import { SelectionToolbar, type SelectionAction } from "./selection-toolbar";
import { TEXT_SIZES, ZOOMS, useLecture, useStudySettings } from "./study-hooks";
import { StudyPlayer, type ListenRequest } from "./study-player";
import { TranslationPanel } from "./translation-panel";
import { WorkspaceContext, type WorkspaceApi } from "./workspace-context";
import { Notice } from "@/components/studio/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MAX_OCR_PAGES, MAX_PDF_BYTES } from "@/lib/files/limits";
import { recognizePdfPages } from "@/lib/files/ocr";
import { classifyPdfError, destroyPdf, openPdf, type PdfErrorCode } from "@/lib/files/pdf";
import { PDF_ERROR_KEYS } from "@/lib/files/pdf-messages";
import { useI18n } from "@/lib/i18n/provider";
import { ocrParagraphs } from "@/lib/study/import";
import { UNTRANSLATED_KINDS, type Box } from "@/lib/study/layout";
import { addAnnotation, attachFile, getFile, listGlossary, recordVisit, updateDoc, updatePage, type StudyPage } from "@/lib/study/store";
import { translatePages, translateViaApi } from "@/lib/study/translate";
import { normalizeForSearch } from "@/lib/text/search";
import { cn } from "@/lib/utils";

type PanelTab = "text" | "translation" | "notes" | "glossary" | "ask" | "practice";
const PANEL_TABS: PanelTab[] = ["text", "translation", "notes", "glossary", "ask", "practice"];
/** Tabs that keep their state (questions asked, a quiz in progress) once opened. */
const KEPT_TABS: PanelTab[] = ["ask", "practice"];
/** Pages translated per request group (results are saved after each group). */
const TRANSLATE_GROUP = 8;
/** Pages recognized per OCR run (results are saved after each run). */
const OCR_GROUP = 5;

export function Workspace({ id, initialPage }: { id: string; initialPage?: number }) {
  return (
    <ConsentProvider>
      <WorkspaceInner key={id} id={id} initialPage={initialPage} />
    </ConsentProvider>
  );
}

function WorkspaceInner({ id, initialPage }: { id: string; initialPage?: number }) {
  const { t, fmt } = useI18n();
  const { data, error } = useLecture(id);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  /** "missing": the lecture was restored from a backup without its PDF. */
  const [pdfFailed, setPdfFailed] = useState<false | PdfErrorCode | "missing">(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    let opened: PDFDocumentProxy | null = null;
    getFile(id)
      .then((blob) => blob.arrayBuffer())
      .then((buffer) => openPdf(buffer))
      .then((doc) => {
        if (!alive) return destroyPdf(doc);
        opened = doc;
        setPdf(doc);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        if ((e as { code?: string })?.code === "NOT_FOUND") return setPdfFailed("missing");
        console.warn("[pdf] lecture open failed:", classifyPdfError(e), (e as Error)?.message);
        setPdfFailed(classifyPdfError(e));
      });
    return () => {
      alive = false;
      if (opened) destroyPdf(opened);
    };
  }, [id, attempt]);

  /** Reattaches the lecture's PDF after a restore without PDFs; it must have the same number of pages. */
  async function reattach(file: File) {
    if (!data || data === "missing") return;
    try {
      const buffer = await file.arrayBuffer();
      const doc = await openPdf(buffer.slice(0));
      const found = doc.numPages;
      destroyPdf(doc);
      if (found !== data.doc.pageCount) return void toast.error(t("study.wrongPdf", { found, expected: data.doc.pageCount }));
      await attachFile(id, new Blob([buffer], { type: "application/pdf" }));
      setPdfFailed(false);
      setAttempt((n) => n + 1);
    } catch (e) {
      toast.error(t(PDF_ERROR_KEYS[classifyPdfError(e)], { max: fmt.bytes(MAX_PDF_BYTES) }));
    }
  }

  if (data === "missing" || (error && !data)) {
    return (
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 outline-none">
        <Notice tone="error" role="alert">
          <p>{t("study.notFound")}</p>
        </Notice>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/study">{t("study.back")}</Link>
        </Button>
      </main>
    );
  }
  if (!data || (!pdf && !pdfFailed)) {
    return (
      <main id="main" tabIndex={-1} className="flex flex-1 items-center justify-center py-20 outline-none">
        <p role="status" className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {t("study.loading")}
        </p>
      </main>
    );
  }
  return <Loaded key={data.doc.id} data={data} pdf={pdf} initialPage={initialPage} missingPdf={pdfFailed === "missing" ? (file) => void reattach(file) : null} pdfError={pdfFailed && pdfFailed !== "missing" ? pdfFailed : null} />;
}

function Loaded({
  data,
  pdf,
  initialPage,
  missingPdf,
  pdfError,
}: {
  data: Exclude<ReturnType<typeof useLecture>["data"], "missing" | null>;
  pdf: PDFDocumentProxy | null;
  initialPage?: number;
  /** Set when the PDF is not on this device: lets the student choose it again. */
  missingPdf: ((file: File) => void) | null;
  /** Why the PDF could not be opened (the text panels still work). */
  pdfError: PdfErrorCode | null;
}) {
  const { t, fmt } = useI18n();
  const ask = useConsent();
  const [settings, setSettings] = useStudySettings();
  const { doc, pages, annotations } = data;
  const viewer = useRef<PdfViewerHandle>(null);
  const [page, setPage] = useState(Math.max(1, Math.min(initialPage ?? doc.lastPage, doc.pageCount)));
  const [focus, setFocus] = useState<{ page: number; box: Box } | null>(null);
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<PdfSelection | null>(null);
  const [selectionCard, setSelectionCard] = useState<{ text: string; translation: string | "loading" } | null>(null);
  const [tab, setTabState] = useState<PanelTab>("text");
  const [kept, setKept] = useState<PanelTab[]>([]);
  const setTab = useCallback((key: PanelTab) => {
    setTabState(key);
    if (KEPT_TABS.includes(key)) setKept((k) => (k.includes(key) ? k : [...k, key]));
  }, []);
  const pdfInput = useRef<HTMLInputElement>(null);
  const [mobileView, setMobileView] = useState<"pdf" | "panel">("pdf");
  const [glossaryDraft, setGlossaryDraft] = useState("");
  const [focusNoteId, setFocusNoteId] = useState<string | null>(null);
  const [listening, setListening] = useState<ListenRequest | null>(null);
  const [ocrRunning, setOcrRunning] = useState<WorkspaceApi["ocr"]["running"]>(null);
  const [trRunning, setTrRunning] = useState<WorkspaceApi["translation"]["running"]>(null);
  const ocrCtrl = useRef<AbortController | null>(null);
  const trCtrl = useRef<AbortController | null>(null);
  const pagesRef = useRef(pages);
  useEffect(() => {
    pagesRef.current = pages;
  });

  // Remember where the student is (quietly, a moment after the page settles).
  useEffect(() => {
    const timer = setTimeout(() => void recordVisit(doc.id, page).catch(() => {}), 800);
    return () => clearTimeout(timer);
  }, [doc.id, page]);

  // Stop background work when leaving the lecture.
  useEffect(
    () => () => {
      ocrCtrl.current?.abort();
      trCtrl.current?.abort();
    },
    [],
  );

  const goTo = useCallback((n: number, box?: Box) => {
    viewer.current?.goTo(n, box, true);
    setMobileView("pdf");
  }, []);

  const focusParagraph = useCallback((n: number, box: Box) => {
    setFocus({ page: n, box });
    viewer.current?.goTo(n, box, true);
  }, []);

  const translateText = useCallback(
    async (text: string) => {
      if (!(await ask("translate"))) return null;
      const glossary = await listGlossary().catch(() => []);
      const [[out]] = await translatePages([[{ text, kind: "text", box: [0, 0, 0, 0] }]], { target: settings.target, glossary, translate: translateViaApi });
      return out ?? "";
    },
    [ask, settings.target],
  );

  const listen = useCallback(
    (text: string, label: string) => {
      void ask("speech").then((ok) => ok && setListening({ text, label, key: Date.now() }));
    },
    [ask],
  );

  const highlight = useCallback<WorkspaceApi["highlight"]>(
    (n, rects, quote, color, note = "") =>
      addAnnotation({ docId: doc.id, page: n, kind: "highlight", color, quote: quote.slice(0, 2000), rects, note }).catch(() => {
        toast.error(t("library.errors.FAILED"));
        return null;
      }),
    [doc.id, t],
  );

  const translateMany = useCallback(
    async (list: number[]) => {
      if (trCtrl.current || !(await ask("translate"))) return;
      const target = settings.target;
      const single = list.length === 1;
      const todo = list.filter((n) => {
        const p = pagesRef.current.find((x) => x.page === n);
        return p && p.source !== "none" && (single || !p.translations?.[target]);
      });
      if (!todo.length) return;
      const ctrl = new AbortController();
      trCtrl.current = ctrl;
      setTrRunning({ done: 0, total: todo.length });
      try {
        const glossary = await listGlossary().catch(() => []);
        for (let i = 0; i < todo.length; i += TRANSLATE_GROUP) {
          const group = todo.slice(i, i + TRANSLATE_GROUP);
          const groupPages = group.map((n) => pagesRef.current.find((x) => x.page === n)!);
          const results = await translatePages(
            groupPages.map((p) => p.paragraphs),
            { target, glossary, translate: translateViaApi, signal: ctrl.signal },
          );
          for (let k = 0; k < group.length; k++) {
            await updatePage(doc.id, group[k], (p) => ({ translations: { ...p.translations, [target]: { paragraphs: results[k], provider: PROVIDERS.translate, at: Date.now() } } }));
          }
          setTrRunning({ done: Math.min(todo.length, i + group.length), total: todo.length });
        }
      } catch {
        if (!ctrl.signal.aborted) toast.error(t("study.translateFailed"));
      } finally {
        trCtrl.current = null;
        setTrRunning(null);
      }
    },
    [ask, settings.target, doc.id, t],
  );

  const recognize = useCallback(
    async (list: number[]) => {
      if (!pdf || ocrCtrl.current) return;
      const todo = list.slice(0, MAX_OCR_PAGES);
      if (list.length > MAX_OCR_PAGES) toast.info(t("ocr.tooManyPages", { count: list.length, max: MAX_OCR_PAGES }));
      const ctrl = new AbortController();
      ocrCtrl.current = ctrl;
      setOcrRunning({ page: todo[0], done: 0, total: todo.length });
      try {
        for (let i = 0; i < todo.length; i += OCR_GROUP) {
          const group = todo.slice(i, i + OCR_GROUP);
          const result = await recognizePdfPages(pdf, group, {
            lang: "ara+eng",
            paragraphs: true,
            signal: ctrl.signal,
            onProgress: (p) => setOcrRunning({ page: group[Math.min(p.done, group.length - 1)], done: i + p.done, total: todo.length }),
          });
          for (const n of group) {
            const found = result.paragraphs?.get(n);
            const paragraphs = found ? ocrParagraphs(found.paragraphs) : [];
            await updatePage(doc.id, n, () => ({ paragraphs, source: paragraphs.length ? "ocr" : "none", confidence: found?.confidence }));
          }
          await updateDoc(doc.id, (d) => ({ scannedPages: d.scannedPages.filter((n) => !group.includes(n)) }));
        }
      } catch {
        if (!ctrl.signal.aborted) toast.error(t("ocr.failed"));
      } finally {
        ocrCtrl.current = null;
        setOcrRunning(null);
      }
    },
    [pdf, doc.id, t],
  );

  const api = useMemo<WorkspaceApi>(
    () => ({
      doc,
      pages,
      annotations,
      page,
      textSize: TEXT_SIZES[settings.textSize] ?? 15,
      target: settings.target,
      goTo,
      focusParagraph,
      translateText,
      listen,
      highlight,
      ocr: { running: ocrRunning, start: (list) => void recognize(list), stop: () => ocrCtrl.current?.abort() },
      translation: { running: trRunning, translatePages: (list) => void translateMany(list), stop: () => trCtrl.current?.abort() },
    }),
    [doc, pages, annotations, page, settings.textSize, settings.target, goTo, focusParagraph, translateText, listen, highlight, ocrRunning, recognize, trRunning, translateMany],
  );

  async function onSelectionAction(action: SelectionAction) {
    const sel = selection;
    if (!sel) return;
    const clear = () => {
      window.getSelection()?.removeAllRanges();
      setSelection(null);
    };
    switch (action.type) {
      case "translate":
        setSelectionCard({ text: sel.text, translation: "loading" });
        try {
          const out = await translateText(sel.text);
          setSelectionCard(out === null ? null : { text: sel.text, translation: out });
        } catch {
          setSelectionCard(null);
          toast.error(t("study.translateFailed"));
        }
        break;
      case "listen":
        listen(sel.text, t("study.selectionPage", { page: sel.page }));
        break;
      case "highlight":
        await highlight(sel.page, sel.rects, sel.text, action.color);
        clear();
        break;
      case "note": {
        const a = await highlight(sel.page, sel.rects, sel.text, "yellow");
        clear();
        if (a) {
          setFocusNoteId(a.id);
          setTab("notes");
          setMobileView("panel");
        }
        break;
      }
      case "glossary":
        setGlossaryDraft(sel.text.slice(0, 120));
        setTab("glossary");
        setMobileView("panel");
        clear();
        break;
      case "copy":
        void navigator.clipboard.writeText(sel.text).then(() => toast.success(t("study.copied")), () => {});
        break;
    }
  }

  const pageText = (p: StudyPage | undefined) =>
    (p?.paragraphs ?? [])
      .filter((x) => !UNTRANSLATED_KINDS.has(x.kind))
      .map((x) => x.text)
      .join("\n\n");
  const current = pages.find((p) => p.page === page);
  const currentTranslation = current?.translations?.[settings.target];

  return (
    <WorkspaceContext.Provider value={api}>
      <main id="main" tabIndex={-1} className="flex h-[calc(100dvh-3.5rem)] min-h-[480px] flex-col outline-none">
        <h1 className="sr-only">{doc.title}</h1>
        <WorkspaceToolbar
          viewer={viewer}
          query={query}
          onQuery={setQuery}
          onFocus={setFocus}
          page={page}
          pageCount={doc.pageCount}
          title={doc.title}
          pages={pages}
          zoom={settings.zoom}
          onZoom={(z) => setSettings({ zoom: z })}
        />

        {/* Phones and small tablets: one view at a time. */}
        <div role="tablist" aria-label={t("study.panel")} className="bg-background flex gap-1 overflow-x-auto border-b px-2 py-1.5 lg:hidden">
          {(["pdf", ...PANEL_TABS] as const).map((key) => {
            const selected = key === "pdf" ? mobileView === "pdf" : mobileView === "panel" && tab === key;
            return (
              <button
                key={key}
                role="tab"
                aria-selected={selected}
                className={cn("shrink-0 rounded-md px-3 py-1.5 text-[13px] font-medium", selected ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
                onClick={() => {
                  if (key === "pdf") setMobileView("pdf");
                  else {
                    setTab(key);
                    setMobileView("panel");
                  }
                }}
              >
                {t(`study.tabs.${key}`)}
              </button>
            );
          })}
        </div>

        <div className="flex min-h-0 flex-1">
          {pdf ? (
            <PdfViewer
              ref={viewer}
              pdf={pdf}
              pageCount={doc.pageCount}
              zoom={settings.zoom}
              initialPage={page}
              annotations={annotations}
              focus={focus}
              query={query}
              label={t("study.viewer")}
              pageLabel={(n) => t("study.pageLabel", { n })}
              onPageChange={setPage}
              onSelection={setSelection}
              className={cn("min-w-0 flex-1", mobileView === "panel" && "max-lg:hidden")}
            />
          ) : (
            <div className={cn("flex min-w-0 flex-1 items-center justify-center p-6", mobileView === "panel" && "max-lg:hidden")}>
              {missingPdf ? (
                <Notice tone="info" className="max-w-md">
                  <p>{t("study.missingPdf")}</p>
                  <input
                    ref={pdfInput}
                    type="file"
                    accept=".pdf,application/pdf"
                    className="hidden"
                    aria-hidden
                    tabIndex={-1}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) missingPdf(file);
                    }}
                  />
                  <Button size="sm" className="mt-3" onClick={() => pdfInput.current?.click()}>
                    <FileUp aria-hidden />
                    {t("study.choosePdf")}
                  </Button>
                </Notice>
              ) : (
                <Notice tone="error">
                  <p>{t(PDF_ERROR_KEYS[pdfError ?? "UNEXPECTED"], { max: fmt.bytes(MAX_PDF_BYTES) })}</p>
                </Notice>
              )}
            </div>
          )}

          <aside aria-label={t("study.panel")} className={cn("bg-background flex min-h-0 flex-col border-s lg:w-[min(46%,580px)]", mobileView === "pdf" ? "max-lg:hidden" : "max-lg:flex-1")}>
            <div className={cn("flex flex-wrap items-center gap-1 border-b px-2 py-1.5", !((tab === "text" && current && current.source !== "none") || (tab === "translation" && currentTranslation)) && "max-lg:hidden")}>
              <div role="tablist" aria-label={t("study.panel")} className="hidden gap-1 lg:flex">
              {PANEL_TABS.map((key) => (
                <button
                  key={key}
                  role="tab"
                  id={`tab-${key}`}
                  aria-selected={tab === key}
                  aria-controls="study-tabpanel"
                  className={cn("rounded-md px-3 py-1.5 text-[13px] font-medium", tab === key ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
                  onClick={() => setTab(key)}
                >
                  {t(`study.tabs.${key}`)}
                </button>
              ))}
              </div>
              <span className="ms-auto flex items-center">
                {tab === "text" && current && current.source !== "none" && (
                  <Button size="sm" variant="ghost" onClick={() => listen(pageText(current), t("study.pageText", { page }))}>
                    <Volume2 aria-hidden />
                    {t("study.listenPage")}
                  </Button>
                )}
                {tab === "translation" && currentTranslation && (
                  <Button size="sm" variant="ghost" onClick={() => listen(currentTranslation.paragraphs.filter(Boolean).join("\n\n"), t("study.pageText", { page }))}>
                    <Volume2 aria-hidden />
                    {t("study.listenTranslation")}
                  </Button>
                )}
              </span>
            </div>
            <div id="study-tabpanel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4">
              {selectionCard && (
                <div className="bg-primary-soft mb-4 space-y-2 rounded-lg p-3" aria-live="polite">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[13px] font-semibold">{t("study.selection")}</p>
                    <Button size="icon-sm" variant="ghost" aria-label={t("study.close")} onClick={() => setSelectionCard(null)}>
                      <X aria-hidden />
                    </Button>
                  </div>
                  <p dir="auto" className="text-sm leading-relaxed">
                    {selectionCard.text}
                  </p>
                  {selectionCard.translation === "loading" ? (
                    <Loader2 className="text-primary size-4 animate-spin" aria-label={t("study.translate")} />
                  ) : (
                    <>
                      <p dir="auto" lang={settings.target} className="border-primary/30 border-t pt-2 text-[15px] leading-relaxed">
                        {selectionCard.translation}
                      </p>
                      <div className="flex flex-wrap gap-1">
                        <Button size="sm" variant="ghost" onClick={() => listen(selectionCard.translation as string, t("study.selection"))}>
                          <Volume2 aria-hidden />
                          {t("study.listen")}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setGlossaryDraft(selectionCard.text.slice(0, 120));
                            setTab("glossary");
                          }}
                        >
                          <Languages aria-hidden />
                          {t("study.addToGlossary")}
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              )}
              {tab === "text" && <PageTextPanel />}
              {tab === "translation" && <TranslationPanel />}
              {tab === "notes" && <NotesPanel focusNoteId={focusNoteId} />}
              {tab === "glossary" && <GlossaryPanel key={glossaryDraft} draft={glossaryDraft} />}
              {kept.includes("ask") && (
                <div hidden={tab !== "ask"}>
                  <AskPanel />
                </div>
              )}
              {kept.includes("practice") && (
                <div hidden={tab !== "practice"}>
                  <PracticePanel />
                </div>
              )}
            </div>
          </aside>
        </div>

        {listening && (
          <StudyPlayer
            key={listening.key}
            request={listening}
            onClose={() => setListening(null)}
            onBookmark={(sentence) => void addAnnotation({ docId: doc.id, page, kind: "bookmark", color: "blue", quote: sentence, rects: [], note: "" }).catch(() => {})}
          />
        )}
      </main>
      {selection && <SelectionToolbar selection={selection} onAction={(a) => void onSelectionAction(a)} />}
    </WorkspaceContext.Provider>
  );
}

function WorkspaceToolbar({
  viewer,
  query,
  onQuery,
  onFocus,
  page,
  pageCount,
  title,
  pages,
  zoom,
  onZoom,
}: {
  viewer: React.RefObject<PdfViewerHandle | null>;
  query: string;
  onQuery: (q: string) => void;
  onFocus: (f: { page: number; box: Box } | null) => void;
  page: number;
  pageCount: number;
  title: string;
  pages: StudyPage[];
  zoom: number;
  onZoom: (z: number) => void;
}) {
  const { t, fmt } = useI18n();
  const [pageInput, setPageInput] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const results = useSearch(pages, query);
  const zi = ZOOMS.indexOf(zoom as (typeof ZOOMS)[number]);
  const go = (n: number) => viewer.current?.goTo(Math.min(pageCount, Math.max(1, n)));

  return (
    <div className="bg-background flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b px-2 py-1.5 sm:px-3">
      <Button asChild size="sm" variant="ghost" className="px-2">
        <Link href="/study">
          <ArrowLeft className="rtl:rotate-180" aria-hidden />
          <span className="hidden sm:inline">{t("study.back")}</span>
        </Link>
      </Button>
      <p className="hidden min-w-0 max-w-[30ch] truncate text-sm font-semibold md:block" dir="auto" title={title}>
        {title}
      </p>
      <div className="flex items-center gap-0.5" dir="ltr">
        <Button size="icon-sm" variant="ghost" aria-label={t("study.previousPage")} disabled={page <= 1} onClick={() => go(page - 1)}>
          <ChevronLeft aria-hidden />
        </Button>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(pageInput);
            if (Number.isInteger(n)) go(n);
            setPageInput(null);
          }}
          className="flex items-center gap-1 text-[13px]"
        >
          <label htmlFor="study-page" className="sr-only">
            {t("study.goToPage")}
          </label>
          <Input
            id="study-page"
            inputMode="numeric"
            value={pageInput ?? String(page)}
            onFocus={(e) => e.target.select()}
            onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ""))}
            onBlur={() => setPageInput(null)}
            className="h-8 w-12 px-1 text-center text-[13px]"
          />
          <span className="text-muted-foreground tabular-nums">/ {fmt.number(pageCount)}</span>
        </form>
        <Button size="icon-sm" variant="ghost" aria-label={t("study.nextPage")} disabled={page >= pageCount} onClick={() => go(page + 1)}>
          <ChevronRight aria-hidden />
        </Button>
      </div>
      <div className="hidden items-center gap-0.5 sm:flex" dir="ltr">
        <Button size="icon-sm" variant="ghost" aria-label={t("study.zoomOut")} disabled={zi <= 0} onClick={() => onZoom(ZOOMS[Math.max(0, zi - 1)])}>
          <Minus aria-hidden />
        </Button>
        <span className="w-11 text-center text-[13px] tabular-nums">{Math.round(zoom * 100)}%</span>
        <Button size="icon-sm" variant="ghost" aria-label={t("study.zoomIn")} disabled={zi >= ZOOMS.length - 1} onClick={() => onZoom(ZOOMS[Math.min(ZOOMS.length - 1, zi + 1)])}>
          <Plus aria-hidden />
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label={t("study.fitWidth")} title={t("study.fitWidth")} onClick={() => onZoom(1)}>
          <Maximize aria-hidden />
        </Button>
      </div>
      <div className="relative ms-auto w-full min-w-0 sm:w-64">
        <Search className="text-muted-foreground pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2" aria-hidden />
        <label htmlFor="study-search" className="sr-only">
          {t("study.search")}
        </label>
        <Input
          id="study-search"
          type="search"
          role="combobox"
          aria-expanded={searchOpen && query.trim().length >= 2}
          aria-controls="study-search-results"
          aria-autocomplete="list"
          value={query}
          placeholder={t("study.search")}
          onChange={(e) => {
            onQuery(e.target.value);
            setSearchOpen(true);
          }}
          onFocus={() => setSearchOpen(true)}
          onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setSearchOpen(false);
            if (e.key === "Enter" && results.length) {
              const next = results.find((r) => r.page > page) ?? results[0];
              onFocus({ page: next.page, box: next.box });
              viewer.current?.goTo(next.page, next.box, true);
            }
          }}
          className="h-8 ps-8 text-[13px]"
        />
        {searchOpen && query.trim().length >= 2 && (
          <div id="study-search-results" role="listbox" aria-label={t("study.searchResults", { count: results.length })} className="bg-popover scroll-thin absolute end-0 top-9 z-40 max-h-80 w-[min(24rem,calc(100vw-1rem))] overflow-y-auto rounded-lg border p-1 shadow-lg">
            <p className="text-muted-foreground px-2 py-1 text-[12px]" role="status">
              {results.length ? t("study.searchResults", { count: results.length }) : t("study.searchNone")}
            </p>
            {results.slice(0, 100).map((r, i) => (
              <button
                key={i}
                type="button"
                role="option"
                aria-selected={false}
                className="hover:bg-accent block w-full rounded-md px-2 py-1.5 text-start"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onFocus({ page: r.page, box: r.box });
                  viewer.current?.goTo(r.page, r.box, true);
                  setSearchOpen(false);
                }}
              >
                <span className="text-primary block text-[12px] font-semibold">{t("study.searchPage", { page: r.page })}</span>
                <span className="line-clamp-2 text-[13px]" dir="auto">
                  {r.snippet}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Paragraphs containing every word of the query (tolerant of Arabic spelling and case). */
function useSearch(pages: StudyPage[], query: string) {
  return useMemo(() => {
    const q = normalizeForSearch(query);
    if (q.length < 2) return [];
    const out: { page: number; box: Box; snippet: string }[] = [];
    for (const p of pages) {
      for (const para of p.paragraphs) {
        if (!normalizeForSearch(para.text).includes(q)) continue;
        const at = para.text.toLowerCase().indexOf(query.trim().toLowerCase());
        const start = Math.max(0, (at < 0 ? 0 : at) - 40);
        out.push({ page: p.page, box: para.box, snippet: `${start > 0 ? "…" : ""}${para.text.slice(start, start + 160)}` });
      }
    }
    return out;
  }, [pages, query]);
}
