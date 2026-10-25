"use client";

import { RotateCcw } from "lucide-react";
import { useId } from "react";
import { Panel, StepHeading } from "./primitives";
import type { SpeechSettings } from "./hooks";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

interface SettingsPanelProps {
  settings: SpeechSettings;
  onChange: (patch: Partial<SpeechSettings>) => void;
  className?: string;
}

function SettingRow({
  label,
  valueLabel,
  isDefault,
  onReset,
  resetLabel,
  children,
  ends,
}: {
  label: string;
  valueLabel: string;
  isDefault: boolean;
  onReset: () => void;
  resetLabel: string;
  children: React.ReactNode;
  ends: [string, string];
}) {
  return (
    <div>
      <div className="flex min-h-8 items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <span className="flex items-center gap-1">
          <span className="text-muted-foreground text-sm tabular-nums" dir="ltr">
            {valueLabel}
          </span>
          <Button variant="ghost" size="icon-sm" onClick={onReset} disabled={isDefault} aria-label={resetLabel} title={resetLabel} className={cn(isDefault && "invisible")}>
            <RotateCcw aria-hidden />
          </Button>
        </span>
      </div>
      {children}
      <div className="text-muted-foreground mt-0.5 flex justify-between text-[12px]" aria-hidden>
        <span>{ends[0]}</span>
        <span>{ends[1]}</span>
      </div>
    </div>
  );
}

export function SettingsPanel({ settings, onChange, className }: SettingsPanelProps) {
  const { t, fmt } = useI18n();
  const pausesId = useId();
  const speedText = t("units.speed", { n: fmt.number(settings.speed, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) });
  const pitchText = settings.pitch === 0 ? t("settings.normal") : t("units.pitch", { n: `${settings.pitch > 0 ? "+" : "−"}${fmt.number(Math.abs(settings.pitch))}` });

  return (
    <Panel aria-labelledby="settings-title" className={cn("space-y-5 p-4 sm:p-5", className)}>
      <StepHeading step={3} id="settings-title">
        {t("settings.title")}
      </StepHeading>
      <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
        <SettingRow
          label={t("settings.speed")}
          valueLabel={speedText}
          isDefault={settings.speed === 1}
          onReset={() => onChange({ speed: 1 })}
          resetLabel={t("settings.reset", { setting: t("settings.speed") })}
          ends={[t("settings.slower"), t("settings.faster")]}
        >
          <Slider value={[settings.speed]} min={0.5} max={2} step={0.05} onValueChange={([v]) => onChange({ speed: Math.round(v * 100) / 100 })} thumbLabel={t("settings.speed")} valueText={speedText} />
        </SettingRow>
        <SettingRow
          label={t("settings.pitch")}
          valueLabel={pitchText}
          isDefault={settings.pitch === 0}
          onReset={() => onChange({ pitch: 0 })}
          resetLabel={t("settings.reset", { setting: t("settings.pitch") })}
          ends={[t("settings.lower"), t("settings.higher")]}
        >
          <Slider value={[settings.pitch]} min={-20} max={20} step={1} onValueChange={([v]) => onChange({ pitch: v })} thumbLabel={t("settings.pitch")} valueText={pitchText} />
        </SettingRow>
      </div>
      <div className="flex items-start justify-between gap-4 border-t pt-4">
        <div>
          <label htmlFor={pausesId} className="text-sm font-medium">
            {t("settings.pauses")}
          </label>
          <p id={`${pausesId}-hint`} className="text-muted-foreground mt-0.5 text-[13px] leading-relaxed">
            {t("settings.pausesHint")}
          </p>
        </div>
        <Switch id={pausesId} checked={settings.pauses} onCheckedChange={(v) => onChange({ pauses: v })} aria-describedby={`${pausesId}-hint`} />
      </div>
    </Panel>
  );
}
