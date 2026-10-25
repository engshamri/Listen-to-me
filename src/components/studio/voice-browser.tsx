"use client";

import { Check, ChevronLeft, ChevronRight, Heart, Loader2, Play, Search, Square, X } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { Flag } from "./primitives";
import { usePreview } from "./preview-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n/provider";
import type { TKey } from "@/lib/i18n/translate";
import { languageLabel } from "@/lib/translate/languages";
import { cn } from "@/lib/utils";
import {
  EMPTY_FILTERS,
  PERSONALITIES,
  VOICES,
  filterVoices,
  getVoice,
  voiceName,
  type Gender,
  type Voice,
} from "@/lib/voices/catalog";
import { categoryOf, countriesIn, groupByRegion, summarizeCategories, type CountryEntry, type LanguageCategory } from "@/lib/voices/categories";
import { useFavorites } from "@/lib/voices/favorites";
import { clarityPercent, multilingualVerifiedFor } from "@/lib/voices/quality";

export type BrowserNav =
  | { level: "home" }
  | { level: "favorites" }
  | { level: "category"; category: LanguageCategory }
  | { level: "country"; category: LanguageCategory; country: string };

export interface BrowserFilters {
  query: string;
  gender: Gender | null;
  personality: string | null;
  multilingualOnly: boolean;
  /** Set when another part of the app asks for voices of one language. */
  lang: string | null;
}

export const EMPTY_BROWSER_FILTERS: BrowserFilters = { query: "", gender: null, personality: null, multilingualOnly: false, lang: null };

export function navForVoice(v: Voice): BrowserNav {
  return { level: "country", category: categoryOf(v), country: v.country };
}

/** "Arabic · Iraq accent", "Chinese · Cantonese", "English · United States". */
export function useVoiceDescriptor() {
  const { t, locale } = useI18n();
  return (v: Voice) => {
    const lang = v.languageName[locale];
    if (v.variant) return `${lang} · ${v.variant[locale]}`;
    if (v.lang === "ar" && v.countryName) return `${lang} · ${t("voices.accent", { country: v.countryName[locale] })}`;
    return v.countryName ? `${lang} · ${v.countryName[locale]}` : lang;
  };
}

export function FavoriteButton({ voice, className }: { voice: Voice; className?: string }) {
  const { t, locale } = useI18n();
  const { isFavorite, toggle } = useFavorites();
  const fav = isFavorite(voice.id);
  const name = voiceName(voice, locale);
  return (
    <button
      type="button"
      aria-pressed={fav}
      aria-label={fav ? t("voices.removeFavorite", { name }) : t("voices.addFavorite", { name })}
      title={fav ? t("voices.removeFavorite", { name }) : t("voices.addFavorite", { name })}
      onClick={(e) => {
        e.stopPropagation();
        const added = toggle(voice.id);
        toast(added ? t("voices.favoriteAdded", { name }) : t("voices.favoriteRemoved", { name }), { duration: 2500 });
      }}
      className={cn(
        "hover:bg-accent inline-flex size-9 items-center justify-center rounded-full transition-colors",
        fav ? "text-primary" : "text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      <Heart className={cn("size-[18px] transition-transform", fav && "scale-110 fill-current")} aria-hidden />
    </button>
  );
}

export function PreviewToggle({ voice, className, variant = "ghost" }: { voice: Voice; className?: string; variant?: "ghost" | "outline" }) {
  const { t, locale } = useI18n();
  const { voiceId, status, toggle } = usePreview();
  const mine = voiceId === voice.id && status !== "idle";
  const name = voiceName(voice, locale);
  return (
    <Button
      type="button"
      variant={variant}
      size="icon-sm"
      onClick={(e) => {
        e.stopPropagation();
        toggle(voice.id);
      }}
      aria-label={mine ? t("voices.stopNamed", { name }) : t("voices.previewNamed", { name })}
      title={mine ? t("voices.stopPreview") : t("voices.preview")}
      className={cn("rounded-full", mine && "text-primary", className)}
    >
      {mine && status === "loading" ? <Loader2 className="animate-spin" aria-hidden /> : mine ? <Square className="size-3.5 fill-current" aria-hidden /> : <Play aria-hidden />}
    </Button>
  );
}

export function Chip({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "primary" }) {
  return (
    <span className={cn("inline-flex h-6 items-center gap-1 rounded-full px-2 text-[12px] font-medium", tone === "primary" ? "bg-primary-soft text-primary-soft-foreground" : "bg-muted text-muted-foreground")}>
      {children}
    </span>
  );
}

function VoiceCard({ voice, selected, onSelect }: { voice: Voice; selected: boolean; onSelect: (id: string) => void }) {
  const { t, locale } = useI18n();
  const describe = useVoiceDescriptor();
  const name = voiceName(voice, locale);
  const clarity = clarityPercent(voice.id);
  return (
    <li
      className={cn(
        "bg-card relative flex flex-col rounded-xl border p-3.5 transition-[border-color,box-shadow] duration-200",
        selected ? "border-primary ring-primary shadow-card ring-1" : "hover:border-input hover:shadow-elevated",
      )}
    >
      {/* The whole card selects the voice; the preview and heart buttons sit above it. */}
      <button
        type="button"
        onClick={() => onSelect(voice.id)}
        aria-pressed={selected}
        aria-label={`${t("voices.use", { name })}. ${describe(voice)}`}
        className="absolute inset-0 rounded-xl"
      />
      <div className="flex items-start gap-3">
        <Flag country={voice.country} className="pointer-events-none mt-0.5 h-[18px] w-6" />
        <div className="pointer-events-none min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold" dir="auto">
              {name}
            </span>
            {selected && (
              <span className="bg-primary text-primary-foreground inline-flex h-5 shrink-0 items-center gap-0.5 rounded-full px-1.5 text-[11px] font-semibold">
                <Check className="size-3" aria-hidden />
                {t("voices.selected")}
              </span>
            )}
          </div>
          <p className="text-muted-foreground truncate text-[13px]">{describe(voice)}</p>
        </div>
        <div className="relative z-10 -me-1.5 -mt-1 flex shrink-0 items-center">
          <PreviewToggle voice={voice} />
          <FavoriteButton voice={voice} />
        </div>
      </div>
      <div className="pointer-events-none mt-2.5 flex flex-wrap gap-1 ps-9">
        <Chip>{voice.gender === "Female" ? t("voices.female") : t("voices.male")}</Chip>
        {voice.personalities.slice(0, 2).map((p) => (
          <Chip key={p}>{t(`voices.personalities.${p}` as TKey)}</Chip>
        ))}
        {voice.multilingual && <Chip tone="primary">{t("voices.multilingual")}</Chip>}
        {voice.categories.includes("Dialect") && <Chip tone="primary">{t("voices.dialect")}</Chip>}
        {clarity !== null && (
          <Chip tone="primary">
            <Check className="size-3" aria-hidden />
            {t("voices.verified")}
          </Chip>
        )}
      </div>
    </li>
  );
}

function VoiceGrid({ voices, selectedId, onSelect }: { voices: Voice[]; selectedId: string; onSelect: (id: string) => void }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {voices.map((v) => (
        <VoiceCard key={v.id} voice={v} selected={v.id === selectedId} onSelect={onSelect} />
      ))}
    </ul>
  );
}

function CountryCard({ country, category, onOpen }: { country: CountryEntry; category: LanguageCategory; onOpen: () => void }) {
  const { t, locale } = useI18n();
  const showLanguages = category !== "arabic" && category !== "english";
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="bg-card hover:border-input hover:shadow-elevated group flex w-full items-center gap-3 rounded-xl border p-3 text-start transition-[border-color,box-shadow] duration-200"
      >
        <img
          src={`/flags/${country.code.toLowerCase()}.svg`}
          alt=""
          width={44}
          height={33}
          loading="lazy"
          className="h-[33px] w-11 shrink-0 rounded-md object-cover shadow-[0_0_0_1px_rgb(0_0_0/0.12)]"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{country.name[locale]}</span>
          <span className="text-muted-foreground block truncate text-[13px]">
            {showLanguages ? `${country.languages.map((l) => l[locale]).join(locale === "ar" ? "، " : ", ")} · ` : ""}
            {t("voices.count", { count: country.voices.length })}
          </span>
        </span>
        <ChevronRight className="text-muted-foreground size-4 shrink-0 transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" aria-hidden />
      </button>
    </li>
  );
}

function groupByCountry(voices: Voice[], locale: "en" | "ar") {
  const map = new Map<string, Voice[]>();
  for (const v of voices) {
    const key = `${v.country}|${v.lang}`;
    map.set(key, [...(map.get(key) ?? []), v]);
  }
  const collator = new Intl.Collator(locale);
  return [...map.entries()]
    .map(([key, list]) => ({ key, list, label: `${list[0].countryName?.[locale] ?? ""} · ${list[0].languageName[locale]}` }))
    .sort((a, b) => collator.compare(a.label, b.label));
}

interface VoiceBrowserProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedId: string;
  onSelect: (id: string) => void;
  nav: BrowserNav;
  onNavChange: (nav: BrowserNav) => void;
  filters: BrowserFilters;
  onFiltersChange: (f: BrowserFilters) => void;
}

export function VoiceBrowser({ open, onOpenChange, selectedId, onSelect, nav, onNavChange, filters, onFiltersChange }: VoiceBrowserProps) {
  const { t, locale, dir } = useI18n();
  const { ids: favoriteIds } = useFavorites();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const set = (patch: Partial<BrowserFilters>) => onFiltersChange({ ...filters, ...patch });

  // Voices allowed by the attribute filters (gender, style, multilingual).
  const pool = useMemo(
    () => filterVoices({ ...EMPTY_FILTERS, gender: filters.gender, personality: filters.personality, multilingualOnly: filters.multilingualOnly }),
    [filters.gender, filters.personality, filters.multilingualOnly],
  );
  const searching = Boolean(filters.query.trim() || filters.lang);
  const results = useMemo(
    () => (searching ? filterVoices({ ...EMPTY_FILTERS, query: filters.query, lang: filters.lang, gender: filters.gender, personality: filters.personality, multilingualOnly: filters.multilingualOnly }) : []),
    [searching, filters],
  );

  // Move focus to the new view's heading and scroll to its top on navigation.
  const viewKey = searching ? "search" : JSON.stringify(nav);
  useEffect(() => {
    if (!open) return;
    bodyRef.current?.scrollTo({ top: 0 });
    if (!searching) headingRef.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey]);

  const select = (id: string) => {
    onSelect(id);
    onOpenChange(false);
  };

  const categoryLabel = (c: LanguageCategory) => t(`voices.categories.${c}`);
  const crumbs: { label: string; go?: () => void }[] = [{ label: t("voices.allVoices"), go: () => onNavChange({ level: "home" }) }];
  if (nav.level === "favorites") crumbs.push({ label: t("voices.favorites") });
  if (nav.level === "category" || nav.level === "country") crumbs.push({ label: categoryLabel(nav.category), go: nav.level === "country" ? () => onNavChange({ level: "category", category: nav.category }) : undefined });
  if (nav.level === "country") crumbs.push({ label: getCountryName(nav.country, locale) });
  if (crumbs.length > 0) crumbs[crumbs.length - 1].go = undefined;

  const back = () => {
    if (nav.level === "country") onNavChange({ level: "category", category: nav.category });
    else onNavChange({ level: "home" });
  };

  let title = t("voices.allVoices");
  let body: React.ReactNode = null;

  if (searching) {
    title = t("voices.results");
    const groups = groupByCountry(results, locale);
    body = results.length ? (
      <div className="space-y-6">
        {groups.map((g) => (
          <section key={g.key} aria-label={g.label}>
            <h4 className="text-muted-foreground mb-2 flex items-center gap-2 text-[13px] font-semibold">
              <Flag country={g.list[0].country} />
              {g.label}
            </h4>
            <VoiceGrid voices={g.list} selectedId={selectedId} onSelect={select} />
          </section>
        ))}
      </div>
    ) : (
      <Empty message={t("voices.noResults")} action={<Button variant="outline" size="sm" onClick={() => onFiltersChange(EMPTY_BROWSER_FILTERS)}>{t("voices.clearFilters")}</Button>} />
    );
  } else if (nav.level === "home") {
    const cats = summarizeCategories(pool);
    body = (
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <li>
          <button type="button" onClick={() => onNavChange({ level: "favorites" })} className="bg-card hover:border-input hover:shadow-elevated flex h-full w-full items-center gap-4 rounded-xl border p-4 text-start transition-[border-color,box-shadow] duration-200">
            <span className="bg-primary-soft text-primary-soft-foreground flex size-12 shrink-0 items-center justify-center rounded-xl">
              <Heart className="size-5 fill-current" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block font-semibold">{t("voices.favorites")}</span>
              <span className="text-muted-foreground block text-[13px]">{t("voices.count", { count: favoriteIds.length })}</span>
            </span>
          </button>
        </li>
        {cats.map((c) => (
          <li key={c.id}>
            <button type="button" onClick={() => onNavChange({ level: "category", category: c.id })} className="bg-card hover:border-input hover:shadow-elevated flex h-full w-full items-center gap-4 rounded-xl border p-4 text-start transition-[border-color,box-shadow] duration-200">
              <span className="relative flex h-12 w-14 shrink-0 items-center" aria-hidden>
                {c.sampleFlags.slice(0, 3).map((code, i) => (
                  <img key={code} src={`/flags/${code.toLowerCase()}.svg`} alt="" width={30} height={22} className="border-card absolute h-[22px] w-[30px] rounded-[4px] border-2 object-cover shadow-card" style={{ insetInlineStart: i * 12, top: i % 2 ? 18 : 6 }} />
                ))}
              </span>
              <span className="min-w-0">
                <span className="block font-semibold">{categoryLabel(c.id)}</span>
                <span className="text-muted-foreground block text-[13px]">
                  {c.languages > 1 && `${t("voices.languages", { count: c.languages })} · `}
                  {t("voices.countries", { count: c.countries })} · {t("voices.count", { count: c.voices })}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  } else if (nav.level === "favorites") {
    title = t("voices.favoritesTitle");
    const favs = favoriteIds.map((id) => getVoice(id)).filter((v): v is Voice => Boolean(v) && pool.includes(v!));
    body = favs.length ? <VoiceGrid voices={favs} selectedId={selectedId} onSelect={select} /> : <Empty message={t("voices.favoritesEmpty")} icon={<Heart className="size-6" aria-hidden />} />;
  } else if (nav.level === "category") {
    title = categoryLabel(nav.category);
    const countries = countriesIn(nav.category, pool, locale);
    const grid = (list: CountryEntry[]) => (
      <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((c) => (
          <CountryCard key={c.code} country={c} category={nav.category} onOpen={() => onNavChange({ level: "country", category: nav.category, country: c.code })} />
        ))}
      </ul>
    );
    const multilingual = nav.category === "arabic" ? multilingualVerifiedFor("ar").map((id) => getVoice(id)).filter((v): v is Voice => Boolean(v) && pool.includes(v!)) : [];
    body = (
      <div className="space-y-6">
        {nav.category === "arabic" && <p className="text-muted-foreground max-w-3xl text-[13px] leading-relaxed">{t("voices.arabicNote")}</p>}
        {countries.length === 0 && <Empty message={t("voices.noResultsFiltered")} />}
        {nav.category === "arabic"
          ? groupByRegion(countries).map((g) => (
              <section key={g.region} aria-label={t(`voices.regions.${g.region}`)}>
                <h4 className="text-muted-foreground mb-2 text-[12px] font-semibold tracking-wide uppercase">{t(`voices.regions.${g.region}`)}</h4>
                {grid(g.countries)}
              </section>
            ))
          : grid(countries)}
        {multilingual.length > 0 && (
          <section aria-label={t("voices.multilingualFor", { language: languageLabel("ar", locale) })} className="border-t pt-5">
            <h4 className="font-semibold">{t("voices.multilingualFor", { language: languageLabel("ar", locale) })}</h4>
            <p className="text-muted-foreground mb-3 text-[13px]">{t("voices.multilingualTested", { language: languageLabel("ar", locale) })}</p>
            <VoiceGrid voices={multilingual} selectedId={selectedId} onSelect={select} />
          </section>
        )}
      </div>
    );
  } else if (nav.level === "country") {
    title = getCountryName(nav.country, locale);
    const voices = pool.filter((v) => categoryOf(v) === nav.category && v.country === nav.country);
    const byLang = new Map<string, Voice[]>();
    for (const v of voices) byLang.set(v.locale, [...(byLang.get(v.locale) ?? []), v]);
    body = voices.length ? (
      <div className="space-y-6">
        {[...byLang.values()].map((list) => (
          <section key={list[0].locale} aria-label={list[0].variant?.[locale] ?? list[0].languageName[locale]}>
            {byLang.size > 1 && <h4 className="text-muted-foreground mb-2 text-[13px] font-semibold">{list[0].variant ? `${list[0].languageName[locale]} · ${list[0].variant[locale]}` : list[0].languageName[locale]}</h4>}
            <VoiceGrid voices={list} selectedId={selectedId} onSelect={select} />
          </section>
        ))}
      </div>
    ) : (
      <Empty message={t("voices.noResultsFiltered")} action={<Button variant="outline" size="sm" onClick={() => onFiltersChange(EMPTY_BROWSER_FILTERS)}>{t("voices.clearFilters")}</Button>} />
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeLabel={t("common.close")}
        // Focus the current view's heading rather than the search box: it announces
        // where the user is and doesn't pop up the on-screen keyboard on phones.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          headingRef.current?.focus({ preventScroll: true });
        }}
        className="flex h-[min(48rem,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-h-dvh max-sm:max-w-full max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:border-0"
      >
        <div className="space-y-3 border-b px-4 pt-4 pb-3 sm:px-6 sm:pt-5">
          <div className="pe-10">
            <DialogTitle>{t("voices.browserTitle")}</DialogTitle>
            <DialogDescription className="mt-0.5">{t("voices.browserDescription")}</DialogDescription>
          </div>
          <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2" aria-hidden />
            <Input
              type="search"
              value={filters.query}
              onChange={(e) => set({ query: e.target.value })}
              placeholder={t("voices.search")}
              aria-label={t("voices.search")}
              className="ps-9 pe-9 [&::-webkit-search-cancel-button]:hidden"
              dir={filters.query ? "auto" : dir}
            />
            {filters.query && (
              <button type="button" onClick={() => set({ query: "" })} className="text-muted-foreground hover:text-foreground absolute end-1.5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md" aria-label={t("voices.clearFilters")}>
                <X className="size-4" aria-hidden />
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label={t("voices.gender")} className="bg-muted inline-flex gap-0.5 rounded-lg p-0.5">
              {([null, "Female", "Male"] as (Gender | null)[]).map((g) => (
                <button
                  key={g ?? "all"}
                  type="button"
                  aria-pressed={filters.gender === g}
                  onClick={() => set({ gender: g })}
                  className={cn("h-8 rounded-md px-3 text-[13px] font-medium transition-colors", filters.gender === g ? "bg-card text-foreground shadow-card" : "text-muted-foreground hover:text-foreground")}
                >
                  {g === null ? t("voices.all") : g === "Female" ? t("voices.female") : t("voices.male")}
                </button>
              ))}
            </div>
            <select
              value={filters.personality ?? ""}
              onChange={(e) => set({ personality: e.target.value || null })}
              aria-label={t("voices.style")}
              className="border-input bg-card h-9 rounded-lg border px-2.5 text-[13px] outline-none focus-visible:border-ring"
            >
              <option value="">{t("voices.anyStyle")}</option>
              {PERSONALITIES.map((p) => (
                <option key={p} value={p}>
                  {t(`voices.personalities.${p}` as TKey)}
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-pressed={filters.multilingualOnly}
              onClick={() => set({ multilingualOnly: !filters.multilingualOnly })}
              className={cn("h-9 rounded-lg border px-3 text-[13px] font-medium transition-colors", filters.multilingualOnly ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-accent")}
            >
              {t("voices.multilingual")}
            </button>
            {filters.lang && (
              <button
                type="button"
                onClick={() => set({ lang: null })}
                aria-label={t("voices.removeChip", { filter: t("voices.languageChip", { language: languageLabel(filters.lang, locale) }) })}
                className="bg-primary-soft text-primary-soft-foreground inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium"
              >
                {t("voices.languageChip", { language: languageLabel(filters.lang, locale) })}
                <X className="size-3.5" aria-hidden />
              </button>
            )}
          </div>
        </div>

        {!searching && (
          <div className="flex min-h-12 items-center gap-2 border-b px-4 py-2 sm:px-6">
            {nav.level !== "home" && (
              <Button variant="ghost" size="sm" onClick={back} className="-ms-2 px-2">
                <ChevronLeft className="rtl:rotate-180" aria-hidden />
                {t("voices.back")}
              </Button>
            )}
            <nav aria-label={t("voices.breadcrumb")} className="min-w-0">
              <ol className="flex flex-wrap items-center gap-1 text-[13px]">
                {crumbs.map((c, i) => (
                  <li key={i} className="flex items-center gap-1">
                    {i > 0 && <ChevronRight className="text-muted-foreground size-3.5 rtl:rotate-180" aria-hidden />}
                    {c.go ? (
                      <button type="button" onClick={c.go} className="text-muted-foreground hover:text-foreground rounded px-1 underline-offset-4 hover:underline">
                        {c.label}
                      </button>
                    ) : (
                      <span aria-current="page" className="px-1 font-medium">
                        {c.label}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </nav>
          </div>
        )}

        <div ref={bodyRef} className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
          {filters.multilingualOnly && <p className="text-muted-foreground mb-3 max-w-3xl text-[13px] leading-relaxed">{t("voices.multilingualNote")}</p>}
          <div className="mb-4 flex items-center justify-between gap-2">
            <h3 ref={headingRef} tabIndex={-1} className="flex items-center gap-2 text-lg font-semibold outline-none">
              {nav.level === "country" && !searching && <Flag country={nav.country} className="h-[18px] w-6" />}
              {title}
            </h3>
            {searching && (
              <p className="text-muted-foreground text-[13px]" aria-live="polite">
                {t("voices.count", { count: results.length })}
              </p>
            )}
          </div>
          {body}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function getCountryName(code: string, locale: "en" | "ar"): string {
  return VOICES.find((v) => v.country === code)?.countryName?.[locale] ?? code;
}

function Empty({ message, action, icon }: { message: string; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-14 text-center">
      {icon && <span className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-full">{icon}</span>}
      <p className="text-muted-foreground max-w-sm text-sm leading-relaxed">{message}</p>
      {action}
    </div>
  );
}
