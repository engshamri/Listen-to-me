/** WCAG 2.x relative luminance and contrast ratio for #rrggbb colors. */
export function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Not a #rrggbb color: ${hex}`);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Pairs every theme must satisfy: [foreground token, background token, minimum ratio]. */
export const CONTRAST_PAIRS: [string, string, number][] = [
  ["foreground", "background", 7],
  ["card-foreground", "card", 4.5],
  ["popover-foreground", "popover", 4.5],
  ["muted-foreground", "background", 4.5],
  ["muted-foreground", "card", 4.5],
  ["muted-foreground", "muted", 4.5],
  ["accent-foreground", "accent", 4.5],
  ["primary-foreground", "primary", 4.5],
  ["primary", "card", 4.5],
  ["primary", "background", 4.5],
  ["primary-soft-foreground", "primary-soft", 4.5],
  // Read-along: the current sentence sits on primary-soft, with words already read
  // in foreground and words still to come in muted-foreground.
  ["foreground", "primary-soft", 4.5],
  ["muted-foreground", "primary-soft", 4.5],
  ["destructive", "card", 4.5],
  ["destructive", "destructive-soft", 4.5],
  ["destructive-foreground", "destructive", 4.5],
  ["success", "card", 4.5],
  ["warning-foreground", "warning-soft", 4.5],
  ["input", "card", 3],
  ["input", "background", 3],
  ["ring", "background", 3],
  ["ring", "card", 3],
];
