"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  getDoc,
  getPages,
  listAnnotations,
  listCards,
  listCourses,
  listDocs,
  listGlossary,
  listQuizResults,
  subscribeStudy,
  type Annotation,
  type Card,
  type Course,
  type GlossaryEntry,
  type QuizResult,
  type StudyDoc,
  type StudyPage,
} from "@/lib/study/store";

/** Loads something from the study store and reloads it on every change (in this tab or another). */
function useStudyData<T>(load: () => Promise<T>, deps: unknown[]): { data: T | null; error: unknown } {
  const [state, setState] = useState<{ data: T | null; error: unknown }>({ data: null, error: null });
  useEffect(() => {
    let alive = true;
    const run = () =>
      load().then(
        (data) => alive && setState({ data, error: null }),
        (error: unknown) => alive && setState((s) => ({ data: s.data, error })),
      );
    void run();
    const off = subscribeStudy(() => void run());
    return () => {
      alive = false;
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

export function useLectures() {
  return useStudyData(async () => ({ docs: await listDocs(), courses: await listCourses() }), []) as { data: { docs: StudyDoc[]; courses: Course[] } | null; error: unknown };
}

export interface LectureData {
  doc: StudyDoc;
  pages: StudyPage[];
  annotations: Annotation[];
}

export function useLecture(id: string) {
  return useStudyData<LectureData | "missing">(async () => {
    const doc = await getDoc(id);
    if (!doc) return "missing";
    const [pages, annotations] = await Promise.all([getPages(id), listAnnotations(id)]);
    return { doc, pages, annotations };
  }, [id]);
}

export function useGlossary() {
  return useStudyData<GlossaryEntry[]>(listGlossary, []);
}

/** Flashcards of one lecture, or all of them. */
export function useCards(docId?: string) {
  return useStudyData<Card[]>(() => listCards(docId), [docId]);
}

/** Quiz results of one lecture, or all of them. */
export function useQuizResults(docId?: string) {
  return useStudyData<QuizResult[]>(() => listQuizResults(docId), [docId]);
}

/** The current time, refreshed every `everyMs` (for due dates and timers). */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}

// ---------------------------------------------------------------------------
// Study settings (this browser): consent per online service, translation
// language, text size and zoom.
// ---------------------------------------------------------------------------

export interface StudySettings {
  /** The student allowed sending text to the translation service. */
  consentTranslate: boolean;
  /** The student allowed sending text to the speech service. */
  consentSpeech: boolean;
  target: string;
  /** Text size step of the text and translation panels. */
  textSize: number;
  zoom: number;
}

export const TEXT_SIZES = [13, 14, 15, 16, 18, 20, 22] as const;
export const ZOOMS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 2.5, 3] as const;

const KEY = "asmani:study";
const DEFAULTS: StudySettings = { consentTranslate: false, consentSpeech: false, target: "ar", textSize: 3, zoom: 1 };

function load(): StudySettings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<StudySettings> | null;
    return {
      consentTranslate: saved?.consentTranslate === true,
      consentSpeech: saved?.consentSpeech === true,
      target: typeof saved?.target === "string" && /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(saved.target) ? saved.target : "ar",
      textSize: Number.isInteger(saved?.textSize) && saved!.textSize! >= 0 && saved!.textSize! < TEXT_SIZES.length ? saved!.textSize! : DEFAULTS.textSize,
      zoom: ZOOMS.includes(saved?.zoom as (typeof ZOOMS)[number]) ? saved!.zoom! : 1,
    };
  } catch {
    return DEFAULTS;
  }
}

let cache: StudySettings | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    cache = load();
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function getStudySettings(): StudySettings {
  cache ??= load();
  return cache;
}

export function setStudySettings(patch: Partial<StudySettings>) {
  cache = { ...getStudySettings(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // Storage blocked: settings last for this visit only.
  }
  listeners.forEach((l) => l());
}

export function useStudySettings() {
  const settings = useSyncExternalStore(subscribe, getStudySettings, () => DEFAULTS);
  return [settings, setStudySettings] as const;
}
