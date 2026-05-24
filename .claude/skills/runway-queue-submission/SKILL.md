---
name: runway-queue-submission
description: Use this skill whenever the user wants to submit Backlot's project submission queue to Runway, submit queued Multishot or Shotlist prompts, reuse settings from the latest Runway generation, translate Chinese prompt text into precise English for review, or update queue status after submitting. This is the operating procedure for reading `queue.backlot.json`, browser automation, prompt selection, project-specific overrides, and writing submission results back to the queue.
---

# Runway Queue Submission

This skill drains Backlot's project submission queue into Runway video generations while keeping the queue's audit trail accurate.

The workflow has four jobs:

1. Read the submission queue and find the items to submit.
2. Ensure each prompt is precise and generation-ready (translate Chinese to English when review needs it).
3. Submit the generation in Runway by reusing the latest generation settings.
4. Mark the submitted item as `submitted` and bump its `submissionCount` — patching only what was submitted.

## Queue Source Of Truth

The canonical submission target is one file per project:

```text
<project-root>/
  queue.backlot.json        the submission queue
  queue-media/<id>/         reference images for each queued item
```

`queue.backlot.json` always sits at the project (or worktree) root. Prompts drafted in both the Multishot and Shotlist surfaces are pushed into it, so this one file is the target regardless of which mode a prompt came from.

It is a plain JSON file with no MCP layer. You `Read` it and `Edit` it directly; the in-app Queue surface polls the file, so your writes show up live.

Do not add items to the queue yourself — that is the writer's action from the Multishot and Shotlist surfaces. This skill reads the queue, submits it, and records the result.

### Queue schema

```json
{
  "schemaVersion": 1,
  "items": [
    {
      "id": "q-abc123",
      "prompt": "the generation prompt to submit",
      "zh": "optional Chinese translation of the prompt",
      "referenceImages": ["queue-media/q-abc123/still.jpg"],
      "status": "pending",
      "submissionCount": 0,
      "source": {
        "mode": "multishot",
        "sceneId": "01-cafe-talk",
        "label": "Scene 1 — INT. CAFE — DAY"
      },
      "addedAt": "ISO-8601 timestamp",
      "updatedAt": "ISO-8601 timestamp"
    }
  ],
  "updatedAt": "ISO-8601 timestamp"
}
```

- `prompt` — the generation-ready text. This is what gets submitted to Runway.
- `zh` — optional Chinese translation of the prompt. Present when the project keeps a bilingual record.
- `referenceImages` — project-relative paths under `queue-media/<id>/`. The images were copied there when the item was queued, so the item is self-contained. Never repoint these at a scene's `references/` folder.
- `status` — `pending` until the prompt has been submitted, then `submitted`. Only those two values.
- `submissionCount` — the iterator: how many times this prompt has been submitted. It only ever goes up; it persists even if `status` is reset to `pending` for a re-run.
- `source` — provenance only (which mode, scene, and Part the prompt came from). Do not use it to look anything up; the `prompt` and `referenceImages` on the item are everything a submission needs.

## Default Runway Target

Start from this URL unless the user or project instructions provide another:

```text
https://app.runwayml.com/video-tools/teams/mbuloichykai4/ai-tools/generate?tool=video&mode=tools&sessionId=b9d082ef-225c-49f7-bd63-0c715a54dd9a
```

The `sessionId` may expire. If Runway redirects to the video generation tool or a team workspace, continue from the equivalent video generation page. If Runway requires login, stop and tell the user what is needed.

## Project Instructions

Before touching Runway, look for project-specific instructions at the project root:

```text
queue.instructions.md
runway.instructions.md
generation.instructions.md
brief.md
world.md
characters/
locations/
```

Apply those instructions before submission. They may specify a style suffix, a duration, a reference image policy, a prompt modification rule, or whether to submit the English `prompt` or a translated form.

If project instructions conflict with the user's direct request, follow the user's latest request unless the conflict would submit the wrong item, the wrong prompt, or spend credits unexpectedly. In those cases, ask one short question.

## Translation Policy

`prompt` is the generation-ready field and is what Runway receives. `zh` holds the Chinese translation when the project keeps one.

When a prompt's text needs a precise English form for human review — or when project instructions ask you to translate Chinese source text into the `prompt` field before submission — translate as follows:

- Preserve every handle, for example `@image1`, `@image2`, and their identity mappings.
- Preserve all shot blocks, shot numbers, lens choices, camera movement, timing, spatial blocking, lighting rules, warnings, dialogue, duration, and aspect ratio.
- Translate precisely. Do not summarize, soften, rewrite, or improve the prompt.
- Keep the same structure where possible: handles, spatial rules, dialogue rules, shot blocks, performance details, lighting, color, style, world, negative constraints.
- Keep quoted dialogue in English if it is already English in the source text.
- Translate warnings with their force intact. `⚠️⚠️⚠️` remains critical.
- Do not add translator notes inside a generation prompt.

If `prompt` is empty or unusable and only `zh` exists, and there is no time to translate, ask whether to submit the Chinese text or translate first.

Do not paste bilingual text into Runway. Submit only the generation-ready prompt.

## Browser Workflow

Use the available browser automation tool. Run this once per item being submitted.

1. Open the Runway target URL.
2. Locate the latest completed generation in the current Runway session or team generation list.
3. Open the latest generation's reuse action. The UI may label this as `Reuse settings`, or show an icon/tooltip with that meaning.
4. Confirm the generation tool opens with settings carried over from the latest generation.
5. Attach the item's `referenceImages` if the project flow or Runway tool uses reference images.
6. Focus the prompt input.
7. Select all existing prompt text.
8. Paste the item's `prompt`.
9. Apply any project-specific modifications after paste if the instruction is phrased as a UI edit, or before paste if it is phrased as a prompt transform.
10. Submit the generation only when the user explicitly asked to submit or generate.
11. Wait until Runway acknowledges the submission or a new generation appears in the queue.

If the `Reuse settings` icon is ambiguous, multiple latest generations are plausible, or the submit action would trigger a credit purchase/payment confirmation, stop and ask the user.

## Submitting From The Queue

When the user asks you to submit the queue (or submit to Runway):

1. `Read` `queue.backlot.json`.
2. For each item with `status: "pending"`, run the Browser Workflow to submit its `prompt` and `referenceImages`.
3. After Runway accepts a submission, `Edit` that item:
   - Set `status` to `"submitted"`.
   - Increment `submissionCount` by 1.
   - Set the item's `updatedAt` to the current ISO-8601 timestamp.
   - Set the top-level `updatedAt` to the current ISO-8601 timestamp.
4. Leave `prompt`, `zh`, `referenceImages`, `source`, `id`, and `addedAt` byte-identical.
5. Patch only the items you submitted. Every other item — and every other byte of the file — stays unchanged. Use a minimal `Edit` per submitted item rather than rewriting the whole file. Write valid JSON back.

If a submission fails before Runway accepts it, do not change that item — leave `status: "pending"` and do not increment `submissionCount`.

If the user names a specific scene, mode, or item id, submit only the matching `pending` items.

## Final Response

Report only the useful operational facts:

- Which items were submitted — id and `source.label`.
- New `submissionCount` for each.
- Submission timestamp.
- Any project-specific modification applied.
- Any items skipped and why (already `submitted`, failed, ambiguous).

Do not paste full prompts into chat unless the user asks.

## Do Not

- Do not add or remove queue items — the writer owns that from Multishot and Shotlist.
- Do not edit items you did not submit, or rewrite the file in a way that changes untouched items.
- Do not repoint `referenceImages` away from `queue-media/<id>/`.
- Do not overwrite `prompt` with translated text unless project instructions explicitly ask for it.
- Do not silently change handle mappings.
- Do not submit the wrong item because the latest Runway generation or the target item is ambiguous.
- Do not increment `submissionCount` when a submission fails.
- Do not edit `AGENTS.md` or `CLAUDE.md` as part of this workflow.
