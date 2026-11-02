#!/usr/bin/env python3
"""Keep the StreamingCommunity extension on the current official domain.

The official Telegram channel @Streaming_community_sito publishes a
"Dominio Aggiornato" post whenever the site moves. This script reads the
latest post, validates the new domain against the live site and rewrites
`streamingcommunity.scext/manifest.json` and `provider.js` when needed.

Usage:
    python3 scripts/update_streamingcommunity_domain.py --dry-run
    python3 scripts/update_streamingcommunity_domain.py
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
BUNDLE = ROOT / "streamingcommunity.scext"
MANIFEST = BUNDLE / "manifest.json"
PROVIDER = BUNDLE / "provider.js"

CHANNEL = "Streaming_community_sito"
SOURCES = [
    ("telegram", f"https://t.me/s/{CHANNEL}", 12),
    ("jina", f"https://r.jina.ai/https://t.me/s/{CHANNEL}", 60),
    ("rss", f"https://tg.i-c-a.su/rss/{CHANNEL}", 30),
]

USER_AGENT = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
)

DOMAIN_RE = re.compile(
    r"(?i)\b(?:[a-z0-9-]+\.)*(?:streamingcommunity|streamingunity)[a-z0-9.-]*\.[a-z]{2,}\b"
)


def fetch(url: str, timeout: int) -> tuple[str, str]:
    """Return (body, final_url). Raises on network/HTTP errors."""
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml,text/plain,*/*",
            "Accept-Language": "it-IT,it;q=0.9,en;q=0.7",
            "Cache-Control": "no-cache",
            "X-No-Cache": "true",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        body = response.read().decode(charset, "replace")
        return body, response.geturl()


def strip_markup(value: str) -> str:
    value = re.sub(r"(?is)<(script|style)\b.*?</\1>", " ", value)
    value = re.sub(r"(?s)<[^>]+>", " ", value)
    return html.unescape(value)


def normalise(value: str) -> str:
    value = html.unescape(value)
    for char in ("\u200b", "\u200c", "\u200d", "\ufeff"):
        value = value.replace(char, "")
    value = re.sub(r"\[\s*\.\s*\]|\(\s*\.\s*\)|\[\s*dot\s*\]", ".", value, flags=re.I)
    value = value.replace("`", " ").replace("*", " ").replace("_", " ")
    return re.sub(r"\s+", " ", value)


def domains_in(text: str) -> list[str]:
    found: list[str] = []
    for match in DOMAIN_RE.finditer(text):
        domain = match.group(0).lower().strip(".-")
        if domain.startswith(("cdn.", "api.", "static.", "img.", "images.")):
            continue
        if domain and domain not in found:
            found.append(domain)
    return found


def domain_candidates(body: str) -> list[str]:
    text = normalise(strip_markup(body))
    lower = text.lower()

    # The newest "Nuovo ..." sentence is the authoritative one; the blocked
    # domains are listed before it, so they are not part of this chunk.
    positions = [match.start() for match in re.finditer(r"\bnuov[oa]\b", lower)]
    if positions:
        start = positions[-1]
        found = domains_in(text[start : start + 600])
        if found:
            return found

    # Fallback: messages are chronological, so the newest domain is the last
    # one mentioned. Skip CDN/API hosts and keep the candidates in reverse.
    return list(reversed(domains_in(text[-4000:])))


def canonical_domain(candidate: str) -> str | None:
    """Validate a candidate and return the canonical host used by the site."""
    for path in ("/it", "/"):
        url = f"https://{candidate}{path}"
        try:
            body, final_url = fetch(url, timeout=30)
        except (urllib.error.URLError, TimeoutError, OSError):
            continue

        lowered = body.lower()
        if "data-page" not in body:
            continue
        if any(marker in lowered for marker in ("just a moment", "cf-chl", "attention required")):
            continue

        match = re.search(r'data-page\s*=\s*"([^"]*)"', body)
        if not match:
            continue
        try:
            payload = json.loads(html.unescape(match.group(1)))
        except json.JSONDecodeError:
            continue

        props = payload.get("props") or {}
        app_url = props.get("app_url") or ""
        host = urlsplit(app_url).hostname or urlsplit(final_url).hostname
        if not host:
            continue
        if not re.search(r"streaming(?:community|unity)", host, re.I):
            continue
        return host.lower()
    return None


def update_files(current_host: str, new_host: str) -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    old_icon = manifest.get("iconUrl", "")

    manifest["baseUrl"] = f"https://{new_host}"
    if current_host and current_host in old_icon:
        manifest["iconUrl"] = old_icon.replace(current_host, new_host)
    else:
        manifest["iconUrl"] = f"https://{new_host}/apple-touch-icon.png?v=2"
    manifest["version"] = str(int(manifest.get("version", "0")) + 1)
    MANIFEST.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    provider = PROVIDER.read_text(encoding="utf-8")
    provider = re.sub(
        r'const BASE_URL = "[^"]*";',
        f'const BASE_URL = "https://{new_host}";',
        provider,
        count=1,
    )
    cdn_host = "cdn." + new_host.removeprefix("www.")
    provider = re.sub(
        r'const DEFAULT_CDN = "[^"]*";',
        f'const DEFAULT_CDN = "https://{cdn_host}";',
        provider,
        count=1,
    )
    provider = re.sub(
        r"\* Site: https?://\S+",
        f"* Site: https://{new_host}",
        provider,
        count=1,
    )
    PROVIDER.write_text(provider, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the resolved domain without changing files.",
    )
    args = parser.parse_args()

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    current_host = (urlsplit(manifest.get("baseUrl", "")).hostname or "").lower()

    body = None
    source_name = None
    errors: list[str] = []
    for name, url, timeout in SOURCES:
        try:
            body, _ = fetch(url, timeout=timeout)
            source_name = name
            break
        except Exception as error:  # noqa: BLE001 - try every source
            errors.append(f"{name}: {error}")

    if body is None:
        print("Could not read the Telegram channel from any source:", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        return 1

    candidates = domain_candidates(body)
    if not candidates:
        print(f"No StreamingCommunity domain found in {source_name} output.", file=sys.stderr)
        return 1

    resolved = None
    for candidate in candidates:
        resolved = canonical_domain(candidate)
        if resolved:
            break

    if not resolved:
        print(
            "No candidate passed live validation: " + ", ".join(candidates),
            file=sys.stderr,
        )
        return 1

    print(f"Source: {source_name}")
    print(f"Current: {current_host or '(none)'}")
    print(f"Resolved: {resolved}")

    if resolved == current_host:
        print("Already up to date.")
        return 0

    if args.dry_run:
        print("Dry run: files not modified.")
        return 0

    update_files(current_host, resolved)
    print(f"Updated {MANIFEST.relative_to(ROOT)} and {PROVIDER.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
