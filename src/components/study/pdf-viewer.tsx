"use client";

import { Bookmark } from "lucide-react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist/types/src/display/api";
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { loadPdfJs } from "@/lib/files/pdf";
import type { Box } from "@/lib/study/layout";
import type { Annotation, HighlightColor } from "@/lib/study/store";
import { normalizeForSearch } from "@/lib/text/search";
import { cn } from "@/lib/utils";

/*
 * The original PDF, page by page. Only pages near the visible area are drawn
 * (canvas + pdf.js text layer for selection); the rest are empty boxes of the
 * right size, so lectures of hundreds of pages scroll smoothly and use little
 * memory.
 */

export interface PdfSelection {
  page: number;
  text: string;
  /** Selected areas on the page (fractions of the page). */
  rects: Box[];
  /** Where to show the selection toolbar, in viewport coordinates. */
  anchor: { x: number; y: number };
}

export interface PdfViewerHandle {
  /** Scrolls to a page, optionally to a spot on it. */
  goTo(page: number, box?: Box, smooth?: boolean): void;
}

interface PdfViewerProps {
  pdf: PDFDocumentProxy;
  pageCount: number;
  /** 1 = page width fits the viewer. */
  zoom: number;
  initialPage: number;
  annotations: Annotation[];
  /** A paragraph to frame on the page (from the text panel). */
  focus: { page: number; box: Box } | null;
  query: string;
  label: string;
  pageLabel: (n: number) => string;
  onPageChange: (page: number) => void;
  onSelection: (selection: PdfSelection | null) => void;
  className?: string;
}

const MAX_PAGE_WIDTH = 1100;
const PAGE_GAP = 16;
/** Pixel budget per page canvas (keeps memory bounded at high zoom). */
const MAX_CANVAS_PIXELS = 6_000_000;

export const HIGHLIGHT_BG: Record<HighlightColor, string> = {
  yellow: "rgb(250 204 21 / 0.38)",
  green: "rgb(74 222 128 / 0.35)",
  blue: "rgb(96 165 250 / 0.35)",
  pink: "rgb(244 114 182 / 0.35)",
};


export const PdfViewer = forwardRef<PdfViewerHandle, PdfViewerProps>(function PdfViewer(
  { pdf, pageCount, zoom, initialPage, annotations, focus, query, label, pageLabel, onPageChange, onSelection, className },
  ref,
) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [containerWidth, setContainerWidth] = useState(0);
  // Width/height of each page; page 1's ratio is assumed until a page is measured.
  const [aspects, setAspects] = useState<Record<number, number>>({});
  const [defaultAspect, setDefaultAspect] = useState(1.294);
  const latest = useRef({ onPageChange, onSelection });
  useEffect(() => {
    latest.current = { onPageChange, onSelection };
  });

  const [measured, setMeasured] = useState(false);
  useEffect(() => {
    let alive = true;
    void pdf.getPage(1).then((p) => {
      const v = p.getViewport({ scale: 1 });
      if (!alive) return;
      setDefaultAspect(v.height / v.width);
      setMeasured(true);
    });
    return () => {
      alive = false;
    };
  }, [pdf]);

  // Where the reader is: a page and how far down it (at the reading line, a third of the way down
  // the viewer). When page sizes change (measured, zoom, window width) the view stays on that spot.
  const anchor = useRef<{ page: number; fraction: number } | null>(null);
  const readingLine = (el: HTMLElement) => el.clientHeight * 0.35;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContainerWidth(el.clientWidth));
    ro.observe(el);
    setContainerWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const pageWidth = Math.max(200, Math.min(containerWidth - 32, MAX_PAGE_WIDTH) * zoom);

  const goTo = useCallback((page: number, box?: Box, smooth = false) => {
    const el = scrollRef.current;
    const target = pageRefs.current[page - 1];
    if (!el || !target) return;
    const offset = box ? box[1] * target.offsetHeight - 80 : -8;
    const top = Math.max(0, target.offsetTop + offset);
    // Far jumps are instant: a long smooth scroll is slow and can be interrupted while pages render.
    const glide = smooth && Math.abs(top - el.scrollTop) < el.clientHeight && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top, behavior: glide ? "smooth" : "auto" });
  }, []);
  useImperativeHandle(ref, () => ({ goTo }), [goTo]);

  // Open on the page the student was on, once the page size is known. Until then the viewer
  // reports no page (its scroll position means nothing yet).
  const opened = useRef(false);
  const [startPage] = useState(initialPage);
  useEffect(() => {
    if (opened.current || !containerWidth || !measured) return;
    requestAnimationFrame(() => {
      opened.current = true;
      goTo(startPage);
    });
  }, [containerWidth, measured, startPage, goTo]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const a = anchor.current;
    const target = a && pageRefs.current[a.page - 1];
    if (!el || !opened.current || !target) return;
    el.scrollTop = Math.max(0, target.offsetTop + a.fraction * target.offsetHeight - readingLine(el));
  }, [pageWidth, defaultAspect, aspects]);

  // The current page: the one under the upper third of the viewer.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let frame = 0;
    let last = 0;
    const update = () => {
      frame = 0;
      if (!opened.current) return;
      const line = el.scrollTop + readingLine(el);
      const pages = pageRefs.current;
      let lo = 0;
      let hi = pages.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if ((pages[mid]?.offsetTop ?? 0) <= line) lo = mid;
        else hi = mid - 1;
      }
      const page = lo + 1;
      const box = pages[lo];
      if (box) anchor.current = { page, fraction: Math.min(1, Math.max(0, (line - box.offsetTop) / Math.max(1, box.offsetHeight))) };
      if (page !== last) {
        last = page;
        latest.current.onPageChange(page);
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [pageCount]);

  // Text selection inside a page's text layer.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let timer = 0;
    const read = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return latest.current.onSelection(null);
      const range = sel.getRangeAt(0);
      const anchor = (range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement)?.closest<HTMLElement>("[data-page]");
      if (!anchor || !el.contains(anchor)) return latest.current.onSelection(null);
      const text = sel.toString().replace(/\s+/gu, " ").trim();
      if (!text) return latest.current.onSelection(null);
      const page = Number(anchor.dataset.page);
      const pr = anchor.getBoundingClientRect();
      const rects = mergeRects(
        [...range.getClientRects()]
          .filter((r) => r.width > 1 && r.height > 1 && r.bottom > pr.top && r.top < pr.bottom)
          .map((r) => [(r.left - pr.left) / pr.width, (r.top - pr.top) / pr.height, r.width / pr.width, r.height / pr.height] as Box),
      );
      const end = range.getBoundingClientRect();
      latest.current.onSelection({ page, text, rects, anchor: { x: end.left + end.width / 2, y: end.top } });
    };
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(read, 120);
    };
    document.addEventListener("selectionchange", schedule);
    return () => {
      document.removeEventListener("selectionchange", schedule);
      window.clearTimeout(timer);
    };
  }, []);

  const onAspect = useCallback((page: number, aspect: number) => setAspects((a) => (Math.abs((a[page] ?? 0) - aspect) < 0.001 ? a : { ...a, [page]: aspect })), []);

  return (
    <div
      ref={scrollRef}
      role="region"
      aria-label={label}
      tabIndex={0}
      className={cn("scroll-thin bg-muted/60 relative overflow-auto outline-none", className)}
    >
      <div className="mx-auto flex w-max min-w-full flex-col items-center px-4 py-4" style={{ gap: PAGE_GAP }}>
        {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
          <PageView
            key={n}
            ref={(el) => {
              pageRefs.current[n - 1] = el;
            }}
            pdf={pdf}
            n={n}
            width={pageWidth}
            aspect={aspects[n] ?? defaultAspect}
            root={scrollRef}
            annotations={annotations}
            focus={focus?.page === n ? focus.box : null}
            query={query}
            label={pageLabel(n)}
            onAspect={onAspect}
          />
        ))}
      </div>
    </div>
  );
});

/** Merges selection rectangles that sit on the same line and touch. */
export function mergeRects(rects: Box[]): Box[] {
  const sorted = rects.slice().sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const out: Box[] = [];
  for (const r of sorted) {
    const last = out.at(-1);
    if (last && Math.abs(last[1] - r[1]) < 0.004 && Math.abs(last[3] - r[3]) < 0.006 && r[0] <= last[0] + last[2] + 0.01) {
      const right = Math.max(last[0] + last[2], r[0] + r[2]);
      last[2] = right - last[0];
    } else {
      out.push([...r] as Box);
    }
  }
  return out;
}

interface PageViewProps {
  pdf: PDFDocumentProxy;
  n: number;
  width: number;
  aspect: number;
  root: React.RefObject<HTMLDivElement | null>;
  annotations: Annotation[];
  focus: Box | null;
  query: string;
  label: string;
  onAspect: (page: number, aspect: number) => void;
}

const PageView = memo(
  forwardRef<HTMLDivElement, PageViewProps>(function PageView({ pdf, n, width, aspect, root, annotations, focus, query, label, onAspect }, ref) {
    const boxRef = useRef<HTMLDivElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const textRef = useRef<HTMLDivElement>(null);
    const [near, setNear] = useState(false);
    const [rendered, setRendered] = useState(0);
    // PDF units → CSS pixels; the text layer sizes its spans from it.
    const [scale, setScale] = useState(1);
    const height = Math.round(width * aspect);

    const setRefs = useCallback(
      (el: HTMLDivElement | null) => {
        boxRef.current = el;
        if (typeof ref === "function") ref(el);
        else if (ref) ref.current = el;
      },
      [ref],
    );

    // Draw only when within about one screen of the visible area.
    useEffect(() => {
      const el = boxRef.current;
      if (!el) return;
      const io = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), { root: root.current, rootMargin: "100% 0px" });
      io.observe(el);
      return () => io.disconnect();
    }, [root]);

    useEffect(() => {
      const canvas = canvasRef.current;
      const textDiv = textRef.current;
      if (!near || !canvas || !textDiv || width < 50) return;
      let cancelled = false;
      let task: RenderTask | null = null;
      let textLayer: { cancel(): void } | null = null;
      void (async () => {
        try {
          const [pdfjs, page] = await Promise.all([loadPdfJs(), pdf.getPage(n)]);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          onAspect(n, base.height / base.width);
          const viewport = page.getViewport({ scale: width / base.width });
          setScale(viewport.scale);
          const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(MAX_CANVAS_PIXELS / (viewport.width * viewport.height)));
          drawInto(canvas, viewport.width, viewport.height, ratio);
          task = page.render({ canvas, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined, background: "#ffffff" });
          await task.promise;
          if (cancelled) return;
          textDiv.replaceChildren();
          const layer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: textDiv, viewport });
          textLayer = layer;
          await layer.render();
          if (!cancelled) setRendered((r) => r + 1);
        } catch {
          // Cancelled or a damaged page: the page stays blank, the rest of the lecture works.
        }
      })();
      return () => {
        cancelled = true;
        task?.cancel();
        textLayer?.cancel();
        releaseCanvas(canvas);
        textDiv.replaceChildren();
      };
    }, [near, width, pdf, n, onAspect]);

    // Mark search matches in the text layer.
    useEffect(() => {
      const textDiv = textRef.current;
      if (!textDiv) return;
      const q = normalizeForSearch(query);
      for (const span of textDiv.querySelectorAll<HTMLSpanElement>("span")) {
        span.classList.toggle("search-hit", q.length >= 2 && normalizeForSearch(span.textContent ?? "").includes(q));
      }
    }, [query, rendered]);

    const mine = annotations.filter((a) => a.page === n);
    const bookmarked = mine.some((a) => a.kind === "bookmark");

    return (
      <div
        ref={setRefs}
        data-page={n}
        role="group"
        aria-label={label}
        className="relative shrink-0 bg-white shadow-md"
        style={
          {
            width,
            height,
            "--total-scale-factor": scale,
            "--scale-round-x": "1px",
            "--scale-round-y": "1px",
          } as React.CSSProperties
        }
      >
        <canvas ref={canvasRef} aria-hidden className="absolute inset-0 block h-full w-full" />
        {/* Highlights sit under the transparent text, so selection still works over them. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 z-[1]">
          {mine.flatMap((a) =>
            a.rects.map((r, i) => (
              <div
                key={`${a.id}-${i}`}
                className="absolute rounded-[2px] mix-blend-multiply"
                style={{ left: `${r[0] * 100}%`, top: `${r[1] * 100}%`, width: `${r[2] * 100}%`, height: `${r[3] * 100}%`, background: HIGHLIGHT_BG[a.color] }}
              />
            )),
          )}
          {focus && (
            <div
              data-testid="paragraph-focus"
              className="ring-primary absolute rounded-md ring-2"
              style={{ left: `calc(${focus[0] * 100}% - 4px)`, top: `calc(${focus[1] * 100}% - 4px)`, width: `calc(${focus[2] * 100}% + 8px)`, height: `calc(${focus[3] * 100}% + 8px)` }}
            />
          )}
        </div>
        <div ref={textRef} className="textLayer" />
        {bookmarked && <Bookmark aria-hidden className="text-primary fill-primary absolute end-2 -top-1 z-[3] size-6" />}
      </div>
    );
  }),
);

function drawInto(canvas: HTMLCanvasElement, w: number, h: number, ratio: number) {
  canvas.width = Math.max(1, Math.floor(w * ratio));
  canvas.height = Math.max(1, Math.floor(h * ratio));
}

function releaseCanvas(canvas: HTMLCanvasElement) {
  // Frees the bitmap now instead of waiting for garbage collection.
  canvas.width = 0;
  canvas.height = 0;
}
