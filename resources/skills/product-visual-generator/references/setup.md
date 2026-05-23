# Setup

## Requirements

- Python 3.8+
- `fal-client` and `requests` packages

```bash
pip install fal-client requests
```

## FAL API Key

Get your key at https://fal.ai → Settings → API Keys

Add to `.env` in your project/brand folder:
```
FAL_KEY=your-fal-key-here
```

Or export directly:
```bash
export FAL_KEY=your-fal-key-here
```

## CLAUDE.md for your project

Copy this into `CLAUDE.md` at your project root so Claude Code knows about the pipeline:

```markdown
# Product Visual Generator

This project generates production-ready product photography using the pipeline in `skills/references/SKILL.md`.

## Auto-trigger rule
If the user provides a URL, immediately run Phase 1 (scrape) without asking. Only pause at Phase 2 for style references.

## Quick reference
- Script: `generate-visuals.py`
- Brands folder: `./brands/{brand-name}/`
- FAL API key: `.env` at project root
- Full instructions: `skills/references/SKILL.md`
```

## Cost Reference

| Resolution | Cost/image |
|-----------|-----------|
| 0.5K | $0.06 |
| 1K | $0.08 |
| 2K | $0.12 |
| 4K | $0.16 |

Example: 10 shots × 2 images × 2K = $2.40
