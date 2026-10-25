import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONTRAST_PAIRS, contrastRatio } from "@/lib/theme/contrast";
import { THEMES } from "@/lib/theme/themes";

const css = readFileSync(join(__dirname, "../../src/app/themes.css"), "utf8");

/** Collects the custom properties of every `[data-theme="x"]` block (including the dark `system` block). */
function parseThemes(): Map<string, Record<string, string>> {
  const result = new Map<string, Record<string, string>>();
  const blockRe = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(css))) {
    const selectors = m[1];
    const vars: Record<string, string> = {};
    for (const [, name, value] of m[2].matchAll(/--([\w-]+):\s*([^;]+);/g)) vars[name] = value.trim();
    if (!Object.keys(vars).length) continue;
    const insideDarkMedia = css.lastIndexOf("@media (prefers-color-scheme: dark)", m.index) > css.lastIndexOf("}\n}", m.index);
    for (const [, id] of selectors.matchAll(/\[data-theme="([\w-]+)"\]/g)) {
      result.set(insideDarkMedia ? `${id}:dark` : id, vars);
    }
  }
  return result;
}

const themes = parseThemes();

describe("themes", () => {
  it("defines every theme listed in the theme menu", () => {
    for (const t of THEMES) expect(themes.has(t.id), t.id).toBe(true);
    expect(themes.has("system:dark")).toBe(true);
    expect(THEMES.length).toBe(19); // 18 themes + System
    expect(THEMES.filter((t) => t.scheme === "light").length).toBe(10);
    expect(THEMES.filter((t) => t.scheme === "dark").length).toBe(8);
  });

  const tokenNames = Object.keys(themes.get("light")!);
  for (const [id, vars] of themes) {
    it(`${id}: defines the full token set`, () => {
      expect(Object.keys(vars).sort()).toEqual([...tokenNames].sort());
    });
    it(`${id}: meets WCAG contrast for every text/surface pair`, () => {
      const failures = CONTRAST_PAIRS.map(([fg, bg, min]) => ({ fg, bg, min, ratio: contrastRatio(vars[fg], vars[bg]) }))
        .filter((p) => p.ratio < p.min)
        .map((p) => `${p.fg} on ${p.bg}: ${p.ratio.toFixed(2)} < ${p.min}`);
      expect(failures).toEqual([]);
    });
  }
});
