# Screenwriter Skill — Quick Start

A general-purpose tool-skill for a screenwriter. Not tied to a specific story. Works in Claude / Cowork / Claude Code as a skill folder.

---

## WHAT'S INSIDE

- **`SKILL.md`** — the main skill description (read first).
- **`methodology.md`** — McKee + Campbell + Aristotle.
- **`style-rules.md`** — Hollywood-format writing rules.
- **`workflow.md`** — how to work with the user.
- **`timing-and-cutting.md`** — screen time estimation and cutting length.
- **`templates/`** — empty templates for your story.
- **`tools/`** — .docx generators (screenplay, bilingual, treatment).

---

## HOW TO START

### Step 1. Install

Copy the `screenwriter-skill/` folder wherever it suits you: inside a Claude Code project, as a user-skill in Cowork (`~/.claude/skills/screenwriter/`), or just next to your working files.

### Step 2. Tell Claude

> "Load the screenwriter skill and let's start."

Claude reads SKILL.md, the methodology, the writing rules, and the workflow.

### Step 3. Bring material

One of these options:

**A. You already have a synopsis / treatment / draft scenes.**
Send the files — Claude reads them and asks where to start working.

**B. You only have an idea.**
Describe it in one or two paragraphs. Claude asks questions and first helps you pull together a synopsis, then a treatment, then scenes.

**C. You only have a title and a genre.**
Fill in `templates/synopsis.template.md` and `templates/characters.template.md`. From there — iteratively.

### Step 4. Work scene by scene

The standard cycle:
1. You ask for a scene from the treatment.
2. Claude gives ONE version + an argument.
3. You give revisions.
4. Claude edits surgically.
5. When the scene is final — you export it to .docx via `tools/build_screenplay.js`.

---

## EXPORT TOOLS

### Screenplay (Hollywood format)
```bash
cp tools/build_screenplay.js my_scene.js
# open my_scene.js, fill the `screenplay` array via slug/action/character/dial/trans
NODE_PATH=/usr/local/lib/node_modules_global/lib/node_modules node my_scene.js
# you get screenplay.docx
```

### Bilingual (dialogue + translation)
```bash
cp tools/build_bilingual.js my_bilingual.js
# fill via ...dialB("Main lang", "Translation")
node my_bilingual.js
# you get screenplay-bilingual.docx
```

### Treatment
```bash
cp tools/build_treatment.js my_treatment.js
# fill via scene("Title", "Body", "[opt.] audit-tag")
node my_treatment.js
# you get treatment.docx
```

---

## COMMON REQUESTS TO THE SKILL

| Request | What Claude does |
|---|---|
| "Write scene 5" | Reads the treatment → writes one version + an argument |
| "This doesn't work" | Asks one narrow binary question → a new version |
| "Make it bilingual" | Uses `tools/build_bilingual.js` |
| "Run a causality audit" | Walks the treatment with ⚠ tags |
| "How many minutes will this run?" | Counts by scene type (see `timing-and-cutting.md`) |
| "Fit it into X minutes" | Gives a cutting plan with concrete numbers |
| "Make character Y's voice distinct from X" | Compares lines, proposes changes |

---

## THREE THINGS CLAUDE DOES NOT DO

1. **Does not write 5 versions** — gives ONE + an argument.
2. **Does not "improve" neighboring lines** — changes only what was asked.
3. **Does not describe emotions** — only action verbs.

If Claude breaks a rule — say: "One version, not five" or "Change only X".

---

## PERSONALIZING THE SKILL

If you write many films in one genre — you can fork this skill and add:

- **`reference-films.md`** — a list of reference films with scene breakdowns.
- **`my-style.md`** — your personal style preferences (e.g. "I don't like flashbacks", "always end on silence").
- **`recurring-tropes.md`** — your recurring devices.

The skill becomes yours, not a generic one.
