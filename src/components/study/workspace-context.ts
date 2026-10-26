"use client";

import { createContext, useContext } from "react";
import type { Box } from "@/lib/study/layout";
import type { Annotation, HighlightColor, StudyDoc, StudyPage } from "@/lib/study/store";

/** What the study panels share: the lecture, where the student is, and the actions on it. */
export interface WorkspaceApi {
  doc: StudyDoc;
  pages: StudyPage[];
  annotations: Annotation[];
  /** Current page (1-based), following the PDF. */
  page: number;
  /** Text size of the text panels, in pixels. */
  textSize: number;
  target: string;
  goTo(page: number, box?: Box): void;
  /** Frames a paragraph on the PDF and scrolls to it. */
  focusParagraph(page: number, box: Box): void;
  /** Translates any text (after consent), applying the glossary; null when cancelled. */
  translateText(text: string): Promise<string | null>;
  /** Reads text aloud in the listening bar (after consent). */
  listen(text: string, label: string): void;
  highlight(page: number, rects: Box[], quote: string, color: HighlightColor, note?: string): Promise<Annotation | null>;
  /** Text recognition of scanned pages. */
  ocr: { running: { page: number; done: number; total: number } | null; start(pages: number[]): void; stop(): void };
  /** Translation of whole pages, saved with the lecture. */
  translation: { running: { done: number; total: number } | null; translatePages(pages: number[]): void; stop(): void };
}

export const WorkspaceContext = createContext<WorkspaceApi | null>(null);

export function useWorkspace(): WorkspaceApi {
  const api = useContext(WorkspaceContext);
  if (!api) throw new Error("useWorkspace must be used inside the study workspace");
  return api;
}
