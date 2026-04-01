import logging
import re

import browser as shared_browser

log = logging.getLogger(__name__)

# Domains/patterns that are never listing photos
PHOTO_BLOCKLIST = [
    "logo", "icon", "avatar", "sprite", "tracking", "pixel", "1x1",
    "badge", "google", "facebook", "bing.com", "doubleclick", "analytics",
    "loader", "ajax-loader", "spinner", "placeholder", "blank",
    "twitter", "linkedin", "pinterest", "instagram", "tiktok",
    "ad-", "ads.", "adserver", "cdn-cgi", "cloudflare",
    "gravatar", "recaptcha", "captcha",
]

# Phone number patterns
PHONE_PATTERNS = [
    r"\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}",          # (212) 555-1234, 212-555-1234, 212.555.1234
    r"\+1[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}", # +1 (212) 555-1234
]


def _clean_photos(raw_photos: list[str]) -> list[str]:
    """Filter out junk images — tracking pixels, logos, loaders, etc."""
    seen = set()
    clean = []
    for url in raw_photos:
        if not url or url in seen:
            continue
        url_lower = url.lower()

        # Skip non-image extensions
        if url_lower.endswith(".gif") or url_lower.endswith(".svg"):
            continue

        # Skip blocklisted domains/patterns
        if any(blocked in url_lower for blocked in PHOTO_BLOCKLIST):
            continue

        # Must look like a real image URL
        has_image_ext = any(ext in url_lower for ext in [".jpg", ".jpeg", ".png", ".webp"])
        has_image_path = any(kw in url_lower for kw in [
            "photo", "image", "upload", "property", "listing",
            "apartment", "room", "media", "picture", "gallery",
            "cdn", "storage", "static", "assets",
        ])
        if not has_image_ext and not has_image_path:
            continue

        seen.add(url)
        clean.append(url)

    return clean


def _extract_phones(text: str) -> list[str]:
    """Extract unique phone numbers from page text."""
    phones = set()
    for pattern in PHONE_PATTERNS:
        for match in re.finditer(pattern, text):
            raw = match.group(0)
            # Normalize: strip to digits only
            digits = re.sub(r"\D", "", raw)
            # Must be 10 or 11 digits (US number)
            if len(digits) == 10 or (len(digits) == 11 and digits.startswith("1")):
                # Format consistently
                if len(digits) == 11:
                    digits = digits[1:]  # drop leading 1
                formatted = f"({digits[:3]}) {digits[3:6]}-{digits[6:]}"
                phones.add(formatted)
    return list(phones)


async def scrape_detail(url: str) -> dict:
    """Scrape a listing detail page for photos, description, contract info, and contact."""
    result = {
        "photos": [],
        "description": None,
        "lease_term": None,
        "deposit": None,
        "amenities": [],
        "sqft": None,
        "phone_numbers": [],
    }

    async with shared_browser.new_page() as page:
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            # Wait longer for JS-heavy sites to render content
            await page.wait_for_timeout(5000)

            data = await page.evaluate(r"""
                () => {
                    const body = document.body.innerText || '';

                    // Collect all image sources
                    const imgs = [...document.querySelectorAll('img')];
                    const photos = [];

                    for (const img of imgs) {
                        // Check actual rendered size — skip tiny images
                        if (img.naturalWidth > 0 && img.naturalWidth < 50) continue;
                        if (img.naturalHeight > 0 && img.naturalHeight < 50) continue;

                        const src = img.src || img.dataset.src || img.dataset.lazySrc || '';
                        if (src && src.startsWith('http')) photos.push(src);
                    }

                    // CSS background images
                    const bgEls = document.querySelectorAll('[style*="background-image"]');
                    for (const el of bgEls) {
                        const match = el.style.backgroundImage.match(/url\(["']?(https?[^"')]+)["']?\)/);
                        if (match) photos.push(match[1]);
                    }

                    // srcset images (pick the largest)
                    const srcsetImgs = document.querySelectorAll('img[srcset], source[srcset]');
                    for (const img of srcsetImgs) {
                        const srcset = img.getAttribute('srcset') || '';
                        const entries = srcset.split(',').map(s => s.trim()).filter(Boolean);
                        if (entries.length > 0) {
                            // Pick last entry (usually highest res)
                            const best = entries[entries.length - 1].split(' ')[0];
                            if (best && best.startsWith('http')) photos.push(best);
                        }
                    }

                    // Description: look for common description containers
                    let description = '';
                    const descSelectors = [
                        '[class*="description"]', '[class*="about"]',
                        '[class*="detail"]', '[class*="overview"]',
                        '[id*="description"]', '[id*="about"]',
                        '[data-testid*="description"]',
                        // Leasebreak-specific
                        '.listing-detail', '#listing-detail',
                        // Generic article content
                        'article', '[role="main"]',
                    ];
                    const descEls = document.querySelectorAll(descSelectors.join(', '));
                    for (const el of descEls) {
                        const text = el.innerText.trim();
                        // Skip very short or very long text, and skip feedback forms
                        if (text.length > 50 && text.length < 5000 &&
                            !text.includes('FEEDBACK') && !text.includes('What can we do better')) {
                            if (text.length > description.length) {
                                description = text;
                            }
                        }
                    }

                    // Fallback: meta description
                    if (!description) {
                        const meta = document.querySelector('meta[name="description"]');
                        if (meta) {
                            const content = meta.getAttribute('content') || '';
                            if (content.length > 20) description = content;
                        }
                    }

                    // Extract tel: links for phone numbers
                    const telLinks = document.querySelectorAll('a[href^="tel:"]');
                    const telNumbers = [...telLinks].map(a => a.href.replace('tel:', '').trim()).filter(Boolean);

                    return { photos: [...new Set(photos)], description, body, telNumbers };
                }
            """)

            result["photos"] = _clean_photos(data.get("photos", []))[:20]
            result["description"] = data.get("description") or None

            body = data.get("body", "")

            # Phone numbers: from tel: links + regex on page text
            tel_numbers = data.get("telNumbers", [])
            phones = _extract_phones(body)
            # Also parse tel: link numbers
            for t in tel_numbers:
                parsed = _extract_phones(t)
                phones.extend(parsed)
            result["phone_numbers"] = list(set(phones))

            # Lease term
            lease_patterns = [
                r"(\d+)\s*month\s*min(?:imum)?",
                r"min(?:imum)?\s*(?:lease|term|stay)[:\s]*(\d+)\s*month",
                r"lease\s*(?:term|length|duration)[:\s]*(\d+[-–]\d+)\s*month",
                r"(\d+[-–]\d+)\s*month\s*(?:lease|term)",
                r"min(?:imum)?\s*(\d+)\s*month",
            ]
            for pat in lease_patterns:
                m = re.search(pat, body, re.IGNORECASE)
                if m:
                    result["lease_term"] = m.group(0).strip()
                    break

            # Deposit
            deposit_patterns = [
                r"(?:security\s*)?deposit[:\s]*\$?([\d,]+)",
                r"\$?([\d,]+)\s*(?:security\s*)?deposit",
                r"deposit[:\s]*(\d+)\s*month",
            ]
            for pat in deposit_patterns:
                m = re.search(pat, body, re.IGNORECASE)
                if m:
                    result["deposit"] = m.group(0).strip()
                    break

            # Square footage
            sqft_match = re.search(r"([\d,]+)\s*(?:sq\.?\s*ft|sqft|square\s*feet|ft²)", body, re.IGNORECASE)
            if sqft_match:
                result["sqft"] = int(sqft_match.group(1).replace(",", ""))

            # Amenities
            amenity_keywords = [
                "wifi", "wi-fi", "internet", "laundry", "washer", "dryer",
                "dishwasher", "gym", "fitness", "pool", "doorman", "elevator",
                "parking", "storage", "rooftop", "terrace", "balcony", "patio",
                "ac", "a/c", "air condition", "heating", "central air",
                "pet friendly", "pets allowed", "cat friendly", "dog friendly",
                "utilities included", "all utilities", "electric included",
                "gas included", "water included", "cable", "tv",
            ]
            body_lower = body.lower()
            for kw in amenity_keywords:
                if kw in body_lower:
                    result["amenities"].append(kw.title())
            result["amenities"] = list(set(result["amenities"]))

        except Exception as e:
            log.error("Error scraping %s: %s", url, e)

    return result
