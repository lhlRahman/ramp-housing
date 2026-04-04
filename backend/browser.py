"""Shared Playwright browser pool — avoids launching 4+ Chromium processes per search."""

import asyncio
import logging
from contextlib import asynccontextmanager
from playwright.async_api import async_playwright, Browser, BrowserContext, Page

from config import BROWSER_HEADLESS, USER_AGENT

log = logging.getLogger(__name__)

_pw = None
_browser: Browser | None = None
_lock = asyncio.Lock()


async def _ensure_browser() -> Browser:
    global _pw, _browser
    if _browser and _browser.is_connected():
        return _browser
    async with _lock:
        # Double-check under lock
        if _browser and _browser.is_connected():
            return _browser
        pw = await async_playwright().start()
        br = await pw.chromium.launch(headless=BROWSER_HEADLESS)
        # Only assign globals after both succeed
        _pw = pw
        _browser = br
        log.info("Shared Chromium browser launched")
        return _browser


async def shutdown():
    global _pw, _browser
    async with _lock:
        if _browser:
            await _browser.close()
            _browser = None
        if _pw:
            await _pw.stop()
            _pw = None
    log.info("Shared browser shut down")


@asynccontextmanager
async def new_page():
    """Yields a fresh page in a new context. Context is closed on exit."""
    br = await _ensure_browser()
    ctx: BrowserContext = await br.new_context(
        user_agent=USER_AGENT,
        viewport={"width": 1280, "height": 900},
    )
    page: Page = await ctx.new_page()
    try:
        yield page
    finally:
        await ctx.close()
