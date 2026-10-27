/*
 * The pages this tab has shown, so the Back button can go back only when the
 * previous page was one of ours (otherwise it opens a safe parent page instead
 * of leaving the app). Kept in sessionStorage: per tab, survives reloads.
 */

const KEY = "asmani:nav";
const MAX = 50;

function read(): string[] {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function write(stack: string[]) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(stack.slice(-MAX)));
  } catch {
    // Storage blocked: Back falls back to the parent page.
  }
}

/** Records the page now shown: returning to the page before it is a step back (pop); anything else is a step forward (push). */
export function recordPage(path: string): void {
  const stack = read();
  if (stack.at(-1) === path) return;
  if (stack.at(-2) === path) stack.pop();
  else stack.push(path);
  write(stack);
}

/** True when this tab showed another page of the app just before this one. */
export function hasPreviousPage(): boolean {
  return read().length >= 2;
}
