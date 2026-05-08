import * as React from "react"
import * as SwitchPrimitives from "@radix-ui/react-switch"

import { cn } from "../../lib/utils"

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    data-slot="switch"
    className={cn(
      // Root crossfades background color only — `transition-all` was
      // animating layout properties unnecessarily.
      "peer inline-flex h-5 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-[background-color] duration-200 [transition-timing-function:var(--ease-in-out)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-muted-foreground/20 group",
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      data-slot="switch-thumb"
      className={cn(
        // Thumb animates transform (slide), width (active-state stretch),
        // and background-color (white-on-checked). `--ease-in-out` for
        // movement (per Emil's framework: on-screen movement uses
        // ease-in-out, not ease-out).
        "pointer-events-none block h-4 w-[26px] rounded-full bg-background shadow-md ring-0 transition-[transform,width,background-color] duration-200 [transition-timing-function:var(--ease-in-out)]",
        "data-[state=checked]:bg-white data-[state=checked]:translate-x-[14px] data-[state=unchecked]:translate-x-0",
        // Active stretch — width grows during press for tactile feedback.
        "group-active:w-[32px] group-active:duration-150",
        "group-active:data-[state=unchecked]:translate-x-0",
        "group-active:data-[state=checked]:translate-x-[8px]",
      )}
    />
  </SwitchPrimitives.Root>
))
Switch.displayName = SwitchPrimitives.Root.displayName

export { Switch }
