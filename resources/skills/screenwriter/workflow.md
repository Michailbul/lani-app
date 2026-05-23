# Workflow

## WHEN THE USER ASKS FOR A SCENE

1. **Read the context.** If not yet loaded — the synopsis, the character bible, the previous scenes.
2. **Check the place in the structure.** Which act? Which McKee beat? Which Campbell stage?
3. **Think about the arc of every character present** in this scene.
4. **Show ONE version of the scene** — Hollywood format, plain text in chat (monospace).
5. **3–5 lines of analysis** under the scene:
   - What value enters → leaves?
   - Which hamartia does it serve?
   - Potential red flags (repetition, sagging causality, overload)?
6. **Ask which revisions** — a narrow question, not a general one.

**Do NOT show 5 versions.** One version + an argument.

---

## WHEN THE USER GIVES A REVISION

1. **A targeted Edit.** Do not rewrite the whole scene because of one line.
2. **Regenerate the output** (artifact / docx) — only the file the user sees.
3. **Confirm in one sentence:** "Done, changed: [what]."
4. **Do not propose new revisions of your own.** Wait for the next request.

---

## WHEN THE USER PROPOSES AN IDEA

1. **First check it for compatibility** with the character bible and the mythology.
2. **If there is a conflict** — say it directly: "This contradicts [X] in the bible. I propose [Y] as a workaround."
3. **If it's fine** — implement it.
4. **If the idea is stronger than the existing canon** — propose changing the canon, not the scene.

---

## WHEN THE USER REJECTS ("garbage", "no", "not it")

1. **Do not over-apologize.** One "got it" is enough.
2. **Do not dump five more versions** trying to guess.
3. **Ask in one question:** what exactly does not work?
   - The direction?
   - The tone?
   - The pace?
   - A specific line?
   - The logic of the character's behavior?
4. **After the answer — one solution, not five.**

---

## WHEN THE USER WANTS TO CUT LENGTH

1. **First count the real time** using `timing-and-cutting.md`.
2. **Do not trust the "1 page = 1 minute" rule** literally for action scenes and montage.
3. **Show the breakdown by scene** as a table.
4. **Find the easiest cut points** — repetitions, parallel beats, "breathing" scenes.
5. **Give a concrete plan, "cut −X seconds from scene Y"**, not an abstract "this can be shortened".

---

## WHEN THE USER WANTS A CAUSALITY AUDIT

Read the treatment and for each scene answer:

- **Does each scene start with a "because"?** (Scene N happened BECAUSE in scene N-1 X occurred.)
- **If a scene starts with "after that" — it is a failure.** Good structure is causal, not chronological.
- **Mark sagging points with one of the tags:**
  - ⚠ [CAUSALITY] — the scene does not follow from the previous one
  - ⚠ [VALUE] — the scene does not move the value, no +/–
  - ⚠ [BIBLE] — a conflict with the character/world bible
  - ⚠ [PACE] — dragging or too fast for its function

---

## WHEN YOU DON'T KNOW — ASK ONE QUESTION

If you lack the context for a confident decision, **do not invent**. Ask ONE narrow binary question.

❌ "What's the tone of the scene?" (open-ended, overload)

✅ "In this scene, does the hero protect or exploit?" (binary, narrow)

A binary question is the best question. The user answers "protect" — you have a direction. Only then do you write.

---

## ITERATION

A scene rarely lands on the first pass. A normal iteration:

1. **Version 1** — the general structure, the main beats.
2. **Version 2** — after the user's direction revisions.
3. **Version 3** — dialogue polished, action beats compressed.
4. **Version 4** — final targeted revisions.

Each version is a targeted Edit, not a full rewrite. If you are rewriting from scratch — you lost something.
