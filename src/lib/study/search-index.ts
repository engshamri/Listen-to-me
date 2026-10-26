/*
 * Passage search for "Ask your lecture": BM25 ranking over paragraphs.
 * This is a search engine, not AI: results are the lecture's own paragraphs,
 * with their pages, and a question whose words mostly don't appear is
 * reported as not found rather than answered.
 */
import { normalizeForSearch } from "@/lib/text/search";
import type { Box } from "./layout";

export interface Passage {
  docId: string;
  page: number;
  /** Paragraph index on the page. */
  index: number;
  text: string;
  box: Box;
}

export interface SearchHit {
  passage: Passage;
  score: number;
  /** Query terms (stems) found in this passage. */
  matched: string[];
}

const STOP_EN = new Set(
  "a an the of in on at to for from by with and or not no is are was were be been being am do does did doing done have has had what which who whom whose when where why how this that these those it its into about as than then there their they them he she we you your our i me my can could should would will shall may might must also so such if but because while during before after above below between through over under again further once more most other some any each both few only own same too very just explain describe define tell give list name state show mean means meaning definition".split(" "),
);
const STOP_AR = new Set(
  "في من على الى إلى عن ما ماذا لماذا كيف هل هو هي هم هن ان أن إن كان كانت التي الذي الذين اللذان هذا هذه ذلك تلك مع او أو ثم قد لقد كل بعض اي أي عند بين حتى لا لم لن ليس انه انها اشرح عرف وضح اذكر معنى".split(" "),
);

/** Light stemming: English plural endings; Arabic article, attached prepositions and plural/feminine endings. */
export function stem(token: string): string {
  if (/^\p{Script=Arabic}/u.test(token)) {
    let t = token.replace(/^(?:وال|فال|بال|كال|لل|ال|و(?=..{3}))/u, "");
    t = t.replace(/(?:ات|ون|ين|ان|يه|ه|ة)$/u, (m) => (t.length - m.length >= 3 ? "" : m));
    return t;
  }
  if (token.length > 4 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 4 && /(?:ses|xes|zes|ches|shes)$/u.test(token)) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss") && !token.endsWith("us") && !token.endsWith("is")) return token.slice(0, -1);
  return token;
}

/** Search tokens of a text: normalized, stop words removed, stemmed. */
export function tokens(text: string): string[] {
  return normalizeForSearch(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2 && !STOP_EN.has(t) && !STOP_AR.has(t))
    .map(stem);
}

export interface PassageIndex {
  passages: Passage[];
  docTokens: Map<string, number>[];
  lengths: number[];
  avgLength: number;
  /** Number of passages containing each term. */
  df: Map<string, number>;
}

export function buildIndex(passages: Passage[]): PassageIndex {
  const docTokens = passages.map((p) => {
    const counts = new Map<string, number>();
    for (const t of tokens(p.text)) counts.set(t, (counts.get(t) ?? 0) + 1);
    return counts;
  });
  const lengths = docTokens.map((m) => [...m.values()].reduce((a, b) => a + b, 0));
  const df = new Map<string, number>();
  for (const m of docTokens) for (const t of m.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  return { passages, docTokens, lengths, avgLength: lengths.reduce((a, b) => a + b, 0) / Math.max(1, lengths.length), df };
}

const K1 = 1.2;
const B = 0.75;
/** A passage must contain at least this share of the question's terms to count as found. */
export const MIN_COVERAGE = 0.5;

export function searchIndex(index: PassageIndex, query: string, limit = 5): SearchHit[] {
  const q = [...new Set(tokens(query))];
  if (!q.length) return [];
  const n = index.passages.length;
  const hits: SearchHit[] = [];
  index.docTokens.forEach((counts, i) => {
    let score = 0;
    const matched: string[] = [];
    for (const term of q) {
      const tf = counts.get(term);
      if (!tf) continue;
      matched.push(term);
      const df = index.df.get(term) ?? 0;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      score += (idf * tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * index.lengths[i]) / (index.avgLength || 1)));
    }
    if (matched.length && matched.length / q.length >= MIN_COVERAGE) hits.push({ passage: index.passages[i], score, matched });
  });
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
