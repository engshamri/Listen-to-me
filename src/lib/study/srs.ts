/*
 * Spaced repetition for flashcards (SM-2, as used by Anki and SuperMemo):
 * cards you know come back after longer and longer intervals, cards you
 * forget come back soon.
 */

export type Grade = "again" | "hard" | "medium" | "easy";
export const GRADES: readonly Grade[] = ["again", "hard", "medium", "easy"];

export interface Srs {
  /** When the card is next due (ms since epoch). */
  due: number;
  /** Current interval in days (0 while relearning). */
  interval: number;
  /** Ease factor (≥ 1.3). */
  ease: number;
  /** Successful reviews in a row. */
  reps: number;
  /** Times forgotten. */
  lapses: number;
  last: number | null;
}

const DAY = 86_400_000;
const MINUTE = 60_000;
const QUALITY: Record<Grade, number> = { again: 1, hard: 3, medium: 4, easy: 5 };

export function newSrs(now = Date.now()): Srs {
  return { due: now, interval: 0, ease: 2.5, reps: 0, lapses: 0, last: null };
}

export function schedule(srs: Srs, grade: Grade, now = Date.now()): Srs {
  const q = QUALITY[grade];
  const ease = Math.max(1.3, srs.ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
  if (grade === "again") {
    // Forgotten: see it again in 10 minutes and start over.
    return { due: now + 10 * MINUTE, interval: 0, ease, reps: 0, lapses: srs.lapses + 1, last: now };
  }
  let interval: number;
  if (srs.reps === 0) interval = grade === "easy" ? 3 : 1;
  else if (srs.reps === 1) interval = grade === "hard" ? 3 : grade === "medium" ? 6 : 8;
  else interval = Math.round(srs.interval * (grade === "hard" ? 1.2 : grade === "easy" ? ease * 1.3 : ease));
  interval = Math.max(1, Math.min(interval, 3650));
  return { due: now + interval * DAY, interval, ease, reps: srs.reps + 1, lapses: srs.lapses, last: now };
}

/** New cards (never reviewed) are always due. */
export const isDue = (srs: Srs, now = Date.now()) => srs.last === null || srs.due <= now;
