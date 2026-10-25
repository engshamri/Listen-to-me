"use client";

import { Check, Heart, LayoutGrid } from "lucide-react";
import { Flag, Panel, StepHeading } from "./primitives";
import { Chip, FavoriteButton, PreviewToggle, useVoiceDescriptor } from "./voice-browser";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { getVoice, voiceName, type Voice } from "@/lib/voices/catalog";
import { useFavorites } from "@/lib/voices/favorites";
import { clarityPercent } from "@/lib/voices/quality";

interface VoicePanelProps {
  voice: Voice;
  onSelect: (id: string) => void;
  onBrowse: () => void;
  onBrowseFavorites: () => void;
  className?: string;
}

const QUICK_FAVORITES = 6;

/**
 * Step 2 on the main page: the selected voice, one-click favorites, and the
 * entry point to the full voice browser.
 */
export function VoicePanel({ voice, onSelect, onBrowse, onBrowseFavorites, className }: VoicePanelProps) {
  const { t, locale } = useI18n();
  const describe = useVoiceDescriptor();
  const { ids } = useFavorites();
  const favorites = ids.map((id) => getVoice(id)).filter((v): v is Voice => Boolean(v));
  const clarity = clarityPercent(voice.id);

  return (
    <Panel aria-labelledby="voice-title" className={cn("space-y-4 p-4 sm:p-5", className)}>
      <StepHeading step={2} id="voice-title">
        {t("voices.title")}
      </StepHeading>

      <div className="bg-muted/70 rounded-xl border p-3.5" aria-label={t("voices.current")} role="group">
        <div className="flex items-start gap-3">
          <Flag country={voice.country} className="mt-1 h-[21px] w-7" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold" dir="auto">
              {voiceName(voice, locale)}
            </p>
            <p className="text-muted-foreground truncate text-[13px]">{describe(voice)}</p>
            {/* Same chips as the voice cards; they wrap between traits, never inside one. */}
            <div className="mt-2 flex flex-wrap gap-1">
              <Chip>{voice.gender === "Female" ? t("voices.female") : t("voices.male")}</Chip>
              {voice.multilingual && <Chip tone="primary">{t("voices.multilingual")}</Chip>}
              {clarity !== null && (
                <Chip tone="primary">
                  <Check className="size-3" aria-hidden />
                  {t("voices.verified")}
                </Chip>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center">
            <PreviewToggle voice={voice} variant="outline" />
            <FavoriteButton voice={voice} />
          </div>
        </div>
        {clarity !== null && <p className="text-muted-foreground mt-2.5 border-t pt-2 text-[12px] leading-relaxed">{t("voices.verifiedHint", { pct: clarity })}</p>}
      </div>

      <Button variant="outline" className="w-full" onClick={onBrowse}>
        <LayoutGrid aria-hidden />
        {t("voices.browse")}
      </Button>

      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-[13px] font-semibold">
            <Heart className="text-primary size-3.5 fill-current" aria-hidden />
            {t("voices.favoritesTitle")}
          </h3>
          {favorites.length > QUICK_FAVORITES && (
            <button type="button" onClick={onBrowseFavorites} className="text-primary text-[13px] font-medium underline-offset-4 hover:underline">
              {t("voices.seeAll")}
            </button>
          )}
        </div>
        {favorites.length === 0 ? (
          <p className="text-muted-foreground text-[13px] leading-relaxed">{t("voices.favoritesHint")}</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {favorites.slice(0, QUICK_FAVORITES).map((v) => {
              const selected = v.id === voice.id;
              return (
                <li key={v.id}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onSelect(v.id)}
                    title={describe(v)}
                    className={cn(
                      "inline-flex h-9 max-w-[12rem] items-center gap-2 rounded-full border px-3 text-[13px] font-medium transition-colors",
                      selected ? "border-primary bg-primary-soft text-primary-soft-foreground" : "bg-card hover:bg-accent",
                    )}
                  >
                    <Flag country={v.country} className="h-3 w-4" />
                    <span className="truncate" dir="auto">
                      {voiceName(v, locale)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Panel>
  );
}
