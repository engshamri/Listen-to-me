/** CLDR plural categories. English uses one/other; Arabic uses all six. */
export interface PluralForms {
  zero?: string;
  one: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

export function plural(forms: PluralForms): PluralForms {
  return forms;
}

export function isPlural(v: unknown): v is PluralForms {
  return typeof v === "object" && v !== null && typeof (v as PluralForms).other === "string";
}

/** Same shape as the source dictionary, with any string allowed at each leaf. */
export type Widen<T> = {
  [K in keyof T]: T[K] extends string ? string : T[K] extends PluralForms ? PluralForms : Widen<T[K]>;
};

/** Dot-separated paths to every translatable leaf, e.g. "editor.placeholder". */
export type MessageKey<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string | PluralForms ? `${P}${K}` : MessageKey<T[K], `${P}${K}.`>;
}[keyof T & string];
