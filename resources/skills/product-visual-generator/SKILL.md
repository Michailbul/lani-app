---
name: product-visual-generator
description: >
  Generate production-ready AI product photography for any brand using Claude Code + Fal.ai (Nano Banana 2).
  Three-phase pipeline: scrape product images from a brand's website → analyze style references → generate
  styled product shots at 0.5K–4K resolution. Use when asked to create product visuals, ad creatives,
  product photography, or styled product images for a brand. Triggers on: "generate product visuals",
  "create product photography", "make product images for [brand/URL]", "style these product images",
  or when a brand website URL is provided in a visual/creative context.
---

# Product Visual Generator

Three-phase pipeline for AI product photography using Nano Banana 2 (fal-ai) via Claude Code.
Generates production-ready product shots from any brand's website URL + style references.

**Requires:** `FAL_KEY` env var. See `references/setup.md`.

## Pipeline Overview

| Phase | What happens | Input | Output |
|-------|-------------|-------|--------|
| 1 | Scrape best-selling product images from brand site | Brand URL | `product-images/` + `products.json` |
| 2 | Analyze style references, write prompts | Style ref images + user selections | `prompts.json` |
| 3 | Generate product visuals via Nano Banana 2 | `prompts.json` | `outputs/` + `index.html` gallery |

## Quick Start

```bash
# Phase 1 — scrape products from brand site
cd brands/brand-name/
python generate-visuals.py --scrape https://brand.com

# Phase 3 — generate images (after Phase 2 prompts)
python generate-visuals.py
python generate-visuals.py --shots 1,3,5          # specific shots
python generate-visuals.py --resolution 2K        # 0.5K / 1K / 2K / 4K
python generate-visuals.py --num-images 3         # up to 4 per prompt
python generate-visuals.py --dry-run              # cost preview only
```

**Pricing:** $0.06/img @ 0.5K · $0.08 @ 1K · $0.12 @ 2K · $0.16 @ 4K

## Claude Code Workflow

### Phase 1 — Scrape
Run the script. It tries Shopify API first, then HTML scrape fallback. Saves images to `./product-images/` and writes `products.json` manifest.

### Phase 2 — Prompts (Claude's job)
1. Read `products.json` to know available products
2. Ask user to share style reference images (competitor ads, mood board, etc.)
3. Analyze each reference: scene, lighting, composition, color, product placement
4. Ask: which products to shoot, how many shots per product, any specific angles/moods
5. Write `prompts.json` — one entry per shot with full Nano Banana prompt + aspect ratio + `needs_product_images` flag

**`prompts.json` schema:**
```json
{
  "brand": "Brand Name",
  "product": "Product Line",
  "style_reference": "Description of visual style",
  "prompts": [
    {
      "shot_number": 1,
      "template": "template-name",
      "product_name": "Product X",
      "prompt": "Full detailed prompt...",
      "aspect_ratio": "1:1",
      "needs_product_images": true
    }
  ]
}
```

When `needs_product_images: true`, the script uses `fal-ai/nano-banana-2/edit` with product images uploaded as references. When `false`, uses text-to-image only.

### Phase 3 — Generate
Script uploads product images to Fal storage, runs each prompt, downloads outputs to `outputs/{template}/`, builds an `index.html` gallery.

## Folder Structure

```
brands/
  {brand-name}/
    .env                  ← FAL_KEY=your-key
    products.json         ← auto-generated in Phase 1
    product-images/       ← scraped product photos
    prompts.json          ← written by Claude in Phase 2
    outputs/
      {template}/         ← generated images
    index.html            ← gallery viewer
generate-visuals.py       ← the script (copy from scripts/)
```

## Key Rules

- If user provides a brand URL → immediately start Phase 1, no confirmation needed
- Pause only at Phase 2 to get style references and product selections from user
- Always run `--dry-run` first when cost is unclear
- Default resolution: 2K — good balance of quality vs cost
- `needs_product_images: true` when the product itself must appear in the shot
- Max 14 product images can be uploaded per generation call
