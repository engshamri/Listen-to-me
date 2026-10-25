import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Fixed-size textarea: height never follows the content (no `field-sizing:
 * content`), so pasting long text scrolls inside the field instead of pushing
 * the rest of the page down.
 */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "border-input placeholder:text-muted-foreground bg-card text-card-foreground block w-full rounded-lg border px-3.5 py-3 text-base [field-sizing:fixed] transition-colors outline-none focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
