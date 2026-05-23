#!/usr/bin/env python3
"""
generate-visuals.py — Product Photography Generator pipeline.
Usage:
  # Phase 1 — scrape product images from the brand's website:
  python generate-visuals.py --scrape https://brand.com
  # Phase 3 — generate product images from prompts.json:
  python generate-visuals.py                       # generate all shots
  python generate-visuals.py --shots 1,3,5         # generate specific shot numbers
  python generate-visuals.py --resolution 1K       # override resolution (0.5K, 1K, 2K, 4K)
  python generate-visuals.py --num-images 2        # images per shot (default: 1, max: 4)
  python generate-visuals.py --safety 6            # safety tolerance 1-6 (default: 4)
  python generate-visuals.py --thinking minimal    # enable model thinking (minimal or high)
  python generate-visuals.py --dry-run             # print what would run, no API calls
Endpoints:
  Text-to-image : fal-ai/nano-banana-2
  Image-ref edit: fal-ai/nano-banana-2/edit  (used when needs_product_images=true)
Pricing:  $0.08/image @ 1K · $0.12 @ 2K · $0.16 @ 4K · $0.06 @ 0.5K
"""
import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import List, Optional
from urllib.parse import urljoin, urlparse
import fal_client
import requests

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
def _load_env_file() -> None:
    if os.environ.get("FAL_KEY"):
        return
    search = Path.cwd()
    for _ in range(5):
        env_file = search / ".env"
        if env_file.exists():
            for line in env_file.read_text().splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, _, val = line.partition("=")
                    key = key.strip()
                    val = val.strip().strip('"').strip("'")
                    if key not in os.environ:
                        os.environ[key] = val
            return
        parent = search.parent
        if parent == search:
            break
        search = parent

_load_env_file()
FAL_KEY = os.environ.get("FAL_KEY", "")
TXT2IMG_MODEL = "fal-ai/nano-banana-2"
EDIT_MODEL    = "fal-ai/nano-banana-2/edit"
VALID_ASPECT_RATIOS = {
    "auto", "21:9", "16:9", "3:2", "4:3", "5:4",
    "1:1", "4:5", "3:4", "2:3", "9:16",
    "4:1", "1:4", "8:1", "1:8",
}
VALID_RESOLUTIONS = {"0.5K", "1K", "2K", "4K"}
VALID_SAFETY     = {"1", "2", "3", "4", "5", "6"}
VALID_THINKING   = {"minimal", "high"}
DEFAULT_RESOLUTION  = "2K"
DEFAULT_NUM_IMAGES  = 1
DEFAULT_SAFETY      = "4"
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
SCRAPE_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

# ---------------------------------------------------------------------------
# FAL helpers
# ---------------------------------------------------------------------------
def check_fal_key() -> None:
    if not FAL_KEY:
        sys.exit("Error: FAL_KEY environment variable is not set.\nRun: export FAL_KEY='your-key-here'")
    os.environ["FAL_KEY"] = FAL_KEY

def upload_product_images(image_dir: Path) -> List[str]:
    images = sorted(p for p in image_dir.iterdir() if p.suffix.lower() in IMAGE_EXTENSIONS)
    if not images:
        return []
    urls = []
    print(f"Uploading {len(images)} product image(s) to FAL storage...")
    for img in images[:14]:
        print(f"  Uploading {img.name}...", end=" ", flush=True)
        url = fal_client.upload_file(str(img))
        urls.append(url)
        print("✓")
    return urls

def _base_payload(prompt, aspect_ratio, num_images, resolution, safety_tolerance, thinking_level):
    if aspect_ratio not in VALID_ASPECT_RATIOS:
        print(f"  Warning: unknown aspect_ratio '{aspect_ratio}', defaulting to '1:1'")
        aspect_ratio = "1:1"
    payload = {
        "prompt": prompt,
        "num_images": min(max(num_images, 1), 4),
        "aspect_ratio": aspect_ratio,
        "output_format": "png",
        "resolution": resolution,
        "safety_tolerance": safety_tolerance,
        "limit_generations": True,
    }
    if thinking_level in VALID_THINKING:
        payload["thinking_level"] = thinking_level
    return payload

def generate_text_to_image(prompt, aspect_ratio, num_images, resolution,
                            safety_tolerance=DEFAULT_SAFETY, thinking_level=None):
    payload = _base_payload(prompt, aspect_ratio, num_images, resolution, safety_tolerance, thinking_level)
    result = fal_client.run(TXT2IMG_MODEL, arguments=payload)
    return result.get("images", [])

def generate_with_reference(prompt, aspect_ratio, num_images, resolution, image_urls,
                             safety_tolerance=DEFAULT_SAFETY, thinking_level=None):
    payload = _base_payload(prompt, aspect_ratio, num_images, resolution, safety_tolerance, thinking_level)
    payload["image_urls"] = image_urls[:14]
    result = fal_client.run(EDIT_MODEL, arguments=payload)
    return result.get("images", [])

def download_image(url: str, dest: Path) -> None:
    resp = requests.get(url, timeout=120)
    resp.raise_for_status()
    dest.write_bytes(resp.content)

# ---------------------------------------------------------------------------
# Product image scraper
# ---------------------------------------------------------------------------
def _slugify(text: str, max_len: int = 60) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:max_len]

def _get_image_ext(url: str) -> str:
    ext = Path(urlparse(url).path).suffix.lower()
    return ext if ext in IMAGE_EXTENSIONS else ".jpg"

def _download_image_file(url: str, dest: Path, headers: dict) -> bool:
    try:
        resp = requests.get(url, timeout=30, headers=headers)
        resp.raise_for_status()
        dest.write_bytes(resp.content)
        return True
    except Exception as e:
        print(f"    Download failed: {e}")
        return False

def _try_shopify_api(base_url: str, max_products: int) -> List[dict]:
    api_url = f"{base_url}/products.json?sort_by=best-selling&limit={max_products}"
    try:
        resp = requests.get(api_url, timeout=15, headers=SCRAPE_HEADERS)
        if not resp.ok:
            return []
        data = resp.json()
        products = []
        for p in data.get("products", [])[:max_products]:
            images = p.get("images", [])
            if not images:
                continue
            img_url = re.sub(r"\?.*$", "", images[0]["src"])
            products.append({
                "name": p["title"],
                "handle": p["handle"],
                "image_url": img_url,
                "product_url": f"{base_url}/products/{p['handle']}",
            })
        return products
    except Exception:
        return []

def _try_html_scrape(base_url: str, site_url: str, max_products: int) -> List[dict]:
    candidate_pages = [
        f"{base_url}/collections/best-sellers",
        f"{base_url}/collections/bestsellers",
        f"{base_url}/best-sellers",
        f"{site_url}/collections/all?sort_by=best-selling",
        f"{base_url}/shop",
        f"{base_url}/products",
        site_url,
    ]
    product_urls = []
    for page_url in candidate_pages:
        try:
            resp = requests.get(page_url, timeout=10, headers=SCRAPE_HEADERS)
            if not resp.ok:
                continue
            found = re.findall(r'href="(/(?:products|shop|store)/[^"?#\s]+)"', resp.text)
            seen = set()
            for link in found:
                full = f"{base_url}{link}"
                if full not in seen:
                    seen.add(full)
                    product_urls.append(full)
            if product_urls:
                break
        except Exception:
            continue

    products = []
    for product_url in product_urls[:max_products * 2]:
        try:
            resp = requests.get(product_url, timeout=10, headers=SCRAPE_HEADERS)
            if not resp.ok:
                continue
            name_match = re.search(
                r'<meta[^>]+property=["\'']og:title["\'][^>]+content=["\'](.*?)["\']',
                resp.text, re.IGNORECASE
            )
            name = name_match.group(1).strip() if name_match else product_url.rstrip("/").split("/")[-1]
            img_match = re.search(
                r'<meta[^>]+property=["\'']og:image["\'][^>]+content=["\'](.*?)["\']',
                resp.text, re.IGNORECASE
            )
            if not img_match:
                continue
            img_url = img_match.group(1).strip()
            if img_url.startswith("//"):
                img_url = f"https:{img_url}"
            elif img_url.startswith("/"):
                img_url = f"{base_url}{img_url}"
            img_url = re.sub(r"\?.*$", "", img_url)
            products.append({
                "name": name,
                "handle": product_url.rstrip("/").split("/")[-1],
                "image_url": img_url,
                "product_url": product_url,
            })
            if len(products) >= max_products:
                break
        except Exception:
            continue
    return products

def scrape_product_images(site_url: str, max_products: int = 20) -> List[dict]:
    site_url = site_url.rstrip("/")
    parsed = urlparse(site_url)
    if not parsed.scheme:
        site_url = f"https://{site_url}"
        parsed = urlparse(site_url)
    base_url = f"{parsed.scheme}://{parsed.netloc}"
    images_dir = Path("product-images")
    images_dir.mkdir(exist_ok=True)
    print(f"\nScraping best-selling products from {base_url}...\n")
    products_raw = _try_shopify_api(base_url, max_products)
    if products_raw:
        print(f"  Shopify API found {len(products_raw)} products.")
    else:
        print("  Shopify API not available — trying HTML scrape...")
        products_raw = _try_html_scrape(base_url, site_url, max_products)
        if products_raw:
            print(f"  HTML scrape found {len(products_raw)} products.")
        else:
            print("  Could not find products automatically.")
            print("  Tip: manually drop product images into ./product-images/ and create ./products.json")
            return []
    print(f"\nDownloading product images to ./product-images/...\n")
    manifest = []
    seen_slugs = {}
    for p in products_raw[:max_products]:
        base_slug = _slugify(p["name"])
        if base_slug in seen_slugs:
            seen_slugs[base_slug] += 1
            slug = f"{base_slug}-{seen_slugs[base_slug]}"
        else:
            seen_slugs[base_slug] = 0
            slug = base_slug
        ext = _get_image_ext(p["image_url"])
        filename = f"{slug}{ext}"
        dest = images_dir / filename
        if dest.exists():
            print(f"  → {filename} (already exists, skipping)")
        else:
            print(f"  Downloading: {p['name']}...", end=" ", flush=True)
            ok = _download_image_file(p["image_url"], dest, SCRAPE_HEADERS)
            if not ok:
                continue
            print("✓")
        manifest.append({"name": p["name"], "filename": filename, "product_url": p["product_url"]})
    if not manifest:
        print("\n  Warning: no product images were saved.")
        return []
    with open("products.json", "w") as f:
        json.dump({"products": manifest}, f, indent=2)
    print(f"\n  {len(manifest)} product(s) saved to ./product-images/")
    print(f"  Manifest → ./products.json\n")
    return manifest

# ---------------------------------------------------------------------------
# Cost estimator
# ---------------------------------------------------------------------------
COST_PER_IMAGE = {"0.5K": 0.06, "1K": 0.08, "2K": 0.12, "4K": 0.16}

def estimate_cost(num_prompts, num_images, resolution):
    return num_prompts * num_images * COST_PER_IMAGE.get(resolution, 0.08)

# ---------------------------------------------------------------------------
# Gallery builder
# ---------------------------------------------------------------------------
GALLERY_CSS = """
* { box-sizing: border-box; }
body { font-family: system-ui, sans-serif; background: #0f0f0f; color: #eee; margin: 0; padding: 32px 24px; }
h1 { font-size: 1.5rem; margin-bottom: 4px; }
p.meta { color: #666; font-size: 0.85rem; margin-bottom: 40px; }
.section { margin-bottom: 56px; }
.section h2 { font-size: 0.78rem; text-transform: uppercase; letter-spacing: .12em; color: #555;
            border-bottom: 1px solid #222; padding-bottom: 8px; margin-bottom: 16px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; }
.card { background: #1a1a1a; border-radius: 6px; overflow: hidden; }
.card img { width: 100%; display: block; }
.card .label { padding: 7px 10px; font-size: 0.72rem; color: #555; }
"""

def build_gallery(outputs_dir: Path, brand: str, product: str) -> None:
    sections = []
    for template_dir in sorted(outputs_dir.iterdir()):
        if not template_dir.is_dir():
            continue
        images = sorted(template_dir.glob("*.png"))
        if not images:
            continue
        cards = "".join(
            f'<div class="card"><img src="{img.relative_to(outputs_dir.parent)}" loading="lazy">'
            f'<div class="label">{img.stem}</div></div>'
            for img in images
        )
        sections.append(
            f'<div class="section"><h2>{template_dir.name}</h2>'
            f'<div class="grid">{cards}</div></div>'
        )
    html = (
        f'<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">'
        f'<title>{brand} — Ad Gallery</title><style>{GALLERY_CSS}</style></head>'
        f'<body><h1>{brand}</h1>'
        f'<p class="meta">{product} &nbsp;·&nbsp; {len(sections)} templates</p>'
        f'{"".join(sections)}</body></html>'
    )
    gallery_path = outputs_dir.parent / "index.html"
    gallery_path.write_text(html)
    print(f"\nGallery → {gallery_path}")

# ---------------------------------------------------------------------------
# CLI + Main
# ---------------------------------------------------------------------------
def parse_args():
    parser = argparse.ArgumentParser(description="Product Photography Generator")
    parser.add_argument("--scrape", type=str, default=None, metavar="URL",
                        help="Phase 1: scrape product images from brand URL")
    parser.add_argument("--shots", type=str, default=None,
                        help="Comma-separated shot numbers, e.g. 1,3,5")
    parser.add_argument("--resolution", type=str, default=DEFAULT_RESOLUTION,
                        choices=sorted(VALID_RESOLUTIONS))
    parser.add_argument("--num-images", type=int, default=DEFAULT_NUM_IMAGES, dest="num_images")
    parser.add_argument("--safety", type=str, default=DEFAULT_SAFETY, dest="safety",
                        choices=sorted(VALID_SAFETY))
    parser.add_argument("--thinking", type=str, default=None, dest="thinking",
                        choices=sorted(VALID_THINKING))
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()

def main():
    args = parse_args()

    if args.scrape:
        scrape_product_images(args.scrape)
        return

    check_fal_key()
    prompts_path = Path("prompts.json")
    if not prompts_path.exists():
        sys.exit("Error: prompts.json not found. Run Phase 2 in Claude first.")

    with open(prompts_path) as f:
        data = json.load(f)

    brand   = data.get("brand", "Brand")
    product = data.get("product", "Product")
    prompts = data.get("prompts", [])

    if not prompts:
        sys.exit("Error: prompts.json contains no prompts.")

    # Filter shots if specified
    if args.shots:
        shot_nums = {int(s.strip()) for s in args.shots.split(",")}
        prompts = [p for p in prompts if p.get("shot_number") in shot_nums]
        if not prompts:
            sys.exit(f"No prompts matched shot numbers: {args.shots}")

    # Cost estimate
    est = estimate_cost(len(prompts), args.num_images, args.resolution)
    print(f"\n{brand} — {product}")
    print(f"Shots: {len(prompts)} · Images/shot: {args.num_images} · Resolution: {args.resolution}")
    print(f"Estimated cost: ${est:.2f}\n")

    if args.dry_run:
        for p in prompts:
            print(f"  Shot {p.get('shot_number')}: {p.get('template')} — {p.get('product_name', '')}")
            print(f"    {p.get('prompt', '')[:80]}...")
        return

    # Check for product images
    product_image_urls = []
    images_dir = Path("product-images")
    needs_refs = any(p.get("needs_product_images") for p in prompts)
    if needs_refs and images_dir.exists():
        product_image_urls = upload_product_images(images_dir)

    # Generate
    outputs_dir = Path("outputs")
    outputs_dir.mkdir(exist_ok=True)

    for entry in prompts:
        shot_num   = entry.get("shot_number", 0)
        template   = entry.get("template", f"shot-{shot_num}")
        prompt     = entry.get("prompt", "")
        aspect     = entry.get("aspect_ratio", "1:1")
        needs_refs = entry.get("needs_product_images", False)

        shot_dir = outputs_dir / template
        shot_dir.mkdir(exist_ok=True)

        print(f"Generating shot {shot_num}: {template}...")
        try:
            if needs_refs and product_image_urls:
                images = generate_with_reference(
                    prompt, aspect, args.num_images, args.resolution,
                    product_image_urls, args.safety, args.thinking
                )
            else:
                images = generate_text_to_image(
                    prompt, aspect, args.num_images, args.resolution,
                    args.safety, args.thinking
                )
            for i, img in enumerate(images):
                url = img.get("url", "")
                if not url:
                    continue
                dest = shot_dir / f"shot-{shot_num:02d}-v{i+1}.png"
                download_image(url, dest)
                print(f"  ✓ {dest}")
        except Exception as e:
            print(f"  ✗ Error: {e}")

    build_gallery(outputs_dir, brand, product)
    print("\nDone!")

if __name__ == "__main__":
    main()
