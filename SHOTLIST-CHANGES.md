# Shotlist surface — Split Desk redesign

Session changelog for integrating the Shotlist redesign into `main`.

- **Date:** 2026-05-16
- **Branch worked on:** `main`
- **Spec:** Split Desk layout (Layout Lab II, concept 02)
- **State:** uncommitted working changes, typecheck clean for all three files

---

## What changed and why

The old Shotlist surface treated each shot as a table row / card in a rail.
A generation prompt is long (a Seedance prompt runs past 1,000 characters) and
only makes sense next to the screenplay and its other draft versions. The card
framing fought that. The redesign rebuilds the surface as **Split Desk**: a
flat, cardless layout where the prompt is the hero document.

Three files changed. Two are small additive changes; the surface is a rewrite.

### 1. `src/shared/shotlist-types.ts` — prompt versions (additive, no migration)

Added two optional fields to `ShotPrompt`:

- `promptVersions?: string[]` — every drafted version of the shot's prompt, v1 at index 0.
- `activeVersion?: number` — index of the active version.

`text` stays as the active prompt and now mirrors `promptVersions[activeVersion]`,
so any external reader (the agent, an export) is unaffected. When both new
fields are absent, the shot behaves as a single-version shot equal to `text`.
Backward compatible — no schema-version bump, no migration. The write router
uses `z.custom<SceneShotlist>()`, so the new fields pass through without strict
validation.

### 2. `src/main/lib/trpc/routers/shotlists.ts` — `readScript` procedure

Added one read-only query, `shotlists.readScript`, that returns a scene's
`.fountain` text for the side-by-side Screenplay column. It reuses the existing
`resolveRoot` / `resolveInside` path-safety helpers. The shotlist surface never
writes the screenplay.

### 3. `src/renderer/features/lani/shotlist-surface.tsx` — Split Desk rewrite

Rebuilt the surface into three stacked, cardless regions:

- **Scene bar** (44px) — `SHOTLIST` eyebrow + lime tick, a borderless scene
  picker, and on the right: a quiet save indicator, an auto-derived time tag
  parsed from the slugline (`INT. CAFE — DAY` → `DAY`), and the part count.
- **Parts strip** — a transparent horizontal strip of `P{n}` chips on the bare
  canvas, divided from the work area by a single hairline. Each chip carries an
  inline-editable title and a status dot. The active Part is a raised lime
  liquid-glass chip (the workflow ModeDock's switch shadow); inactive chips are
  bare text with a faint hover tint. Selecting is one click; the active chip
  scrolls into view.
- **Work area** — two boxless columns split by a draggable lime divider.
  - **Prompt column** (hero, default 60%, floored at 45%): `PROMPT` eyebrow,
    `v1 v2 v3` version tabs with a lime underline on the active one, quiet
    add / delete-version controls, and one lime `Copy` button (liquid-glass
    treatment, inline checkmark confirmation). The prompt text is capped to a
    64-character readable measure, centered, 15px / 1.85 line-height — editable
    straight on the canvas.
  - **Screenplay column** (read-only): the scene `.fountain` in Courier Prime,
    scrollable, with a soft lime band over the lines the active Part's
    `scriptRef` covers (best-effort substring match).

Autosave behavior is unchanged — a 600ms debounce to `shotlist.lani.json`,
which settles as a creative checkpoint via the existing write router.

The split fraction persists to `localStorage` under
`lani:shotlist:prompt-fraction:v1`.

---

## Design notes

- **Boxless / cardless.** No cards, panels, or shadows on content. Structure
  comes from whitespace, one hairline, type hierarchy, and the lime accent.
- **Liquid glass.** The only glass elements are the active Part chip and the
  `Copy` button — both reuse the ModeDock's raised kiwi-thumb shadow. The
  earlier frosted backdrop band behind the Parts strip was removed; the strip
  is now fully transparent.
- **No animation on navigation.** Switching Part or Version is instant — these
  are frequently-used keyboard/click actions (Emil Kowalski's framework).

---

## Integration notes

- No new dependencies. No database migration. No router registration change
  (`readScript` is added to the existing `shotlistsRouter`).
- `ShotPrompt.text` must keep mirroring the active version. Any code that
  writes `promptVersions` should also write `text` — the renderer's
  `versionPatch()` helper does this; mirror it elsewhere if needed.
- Shotlist JSON files written before this change load unchanged (single
  version derived from `text`).

## Test plan

- Open Shotlist mode on a scene with an existing `shotlist.lani.json` —
  shots load, single version each.
- Add a Part, edit its title and status from the strip chip.
- Add `v2` / `v3` versions, switch between them, confirm `text` follows the
  active version after a reload.
- Drag the divider to both extremes — prompt text never wraps past the
  readable measure; the split persists across a scene switch and app restart.
- Confirm the Screenplay column loads the scene `.fountain` read-only.

## Files

```
src/shared/shotlist-types.ts                       +14 / -2
src/main/lib/trpc/routers/shotlists.ts             +19
src/renderer/features/lani/shotlist-surface.tsx  rewrite
```
