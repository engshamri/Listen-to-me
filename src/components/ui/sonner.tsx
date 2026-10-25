"use client"

import { Toaster as Sonner } from "sonner"
import { useI18n } from "@/lib/i18n/provider"
import { useTheme } from "@/lib/theme/provider"

/** Toasts follow the active theme and interface direction. */
function Toaster() {
  const { scheme } = useTheme()
  const { dir, t } = useI18n()

  return (
    <Sonner
      theme={scheme}
      dir={dir}
      position="top-center"
      closeButton
      containerAriaLabel={t("common.notifications")}
      toastOptions={{
        classNames: {
          toast: "!bg-popover !text-popover-foreground !border-border !rounded-xl !shadow-lg font-sans",
          description: "!text-muted-foreground",
          actionButton: "!bg-primary !text-primary-foreground !font-medium",
          cancelButton: "!bg-muted !text-foreground",
          error: "[&_[data-icon]]:!text-destructive",
          success: "[&_[data-icon]]:!text-success",
        },
      }}
    />
  )
}

export { Toaster }
