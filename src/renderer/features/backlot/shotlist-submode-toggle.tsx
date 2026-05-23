"use client"

/**
 * ShotlistSubmodeToggle — the Shotlist ⇄ Multishot switch.
 *
 * The Shotlist dock mode holds two distinct surfaces: the Shotlist (a
 * scene cut into many Parts, each with its own prompt) and the Multishot
 * (the scene kept whole, one multi-shot prompt). This segmented control
 * lives in each surface's masthead — the writer toggles between them
 * without leaving the mode. State is `shotlistSubmodeAtom`.
 */

import { useAtom } from "jotai"
import { Clapperboard, Sparkles } from "lucide-react"
import { shotlistSubmodeAtom, type ShotlistSubmode } from "./atoms"
import { cn } from "../../lib/utils"

const SUBMODES: {
  id: ShotlistSubmode
  label: string
  Icon: typeof Clapperboard
}[] = [
  { id: "shotlist", label: "Shotlist", Icon: Clapperboard },
  { id: "multishot", label: "Multishot", Icon: Sparkles },
]

export function ShotlistSubmodeToggle() {
  const [submode, setSubmode] = useAtom(shotlistSubmodeAtom)
  return (
    <div className="flex h-7 shrink-0 items-center gap-0.5 rounded-lg bg-foreground/[0.06] p-0.5">
      {SUBMODES.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => setSubmode(id)}
          aria-pressed={submode === id}
          className={cn(
            "press inline-flex h-6 items-center gap-1.5 rounded-md px-2",
            "font-mono text-[10px] font-semibold uppercase tracking-[0.1em] transition-colors",
            submode === id
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground/55 hover:text-foreground",
          )}
        >
          <Icon className="h-3 w-3" />
          {label}
        </button>
      ))}
    </div>
  )
}
