import os
from dotenv import load_dotenv

load_dotenv()

# Server
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8000"))
RELOAD = os.getenv("RELOAD", "false").lower() == "true"

# CORS
CORS_ORIGINS = [
    o.strip()
    for o in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001",
    ).split(",")
]

# Database
DB_PATH = os.getenv("DB_PATH", os.path.join(os.path.dirname(__file__), "geocache.db"))

# Geocoder (Photon — free, no rate limits, OSM-based)
NOMINATIM_USER_AGENT = os.getenv("GEOCODER_USER_AGENT", "ramp-intern-housing/1.0 (hackathon project)")
GEOCODER_CONCURRENCY = int(os.getenv("GEOCODER_CONCURRENCY", "6"))

# Scraper defaults
SCRAPER_TIMEOUT = int(os.getenv("SCRAPER_TIMEOUT", "40000"))  # ms for Playwright page loads
SCRAPER_MAX_PAGES = int(os.getenv("SCRAPER_MAX_PAGES", "5"))
BROWSER_HEADLESS = os.getenv("BROWSER_HEADLESS", "true").lower() == "true"
ZUMPER_PAGE_CONCURRENCY = int(os.getenv("ZUMPER_PAGE_CONCURRENCY", "4"))
USER_AGENT = os.getenv(
    "USER_AGENT",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
)

# xAI / Grok
XAI_API_KEY = os.getenv("XAI_API_KEY", "")

# Retell
RETELL_API_KEY = os.getenv("RETELL_API_KEY", "")
RETELL_API_BASE = os.getenv("RETELL_API_BASE", "https://api.retellai.com").rstrip("/")
RETELL_DEFAULT_VOICE_AGENT_ID = os.getenv("RETELL_DEFAULT_VOICE_AGENT_ID", "")
RETELL_DEFAULT_CHAT_AGENT_ID = os.getenv("RETELL_DEFAULT_CHAT_AGENT_ID", "")
RETELL_DEFAULT_FROM_NUMBER = os.getenv("RETELL_DEFAULT_FROM_NUMBER", "")

# Twilio (direct SMS — bypasses Retell SMS which needs A2P on their side)
TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")
TWILIO_FROM_NUMBER = os.getenv("TWILIO_FROM_NUMBER", "")

# Internal escalation notifications
INTERNAL_ESCALATION_WEBHOOK_URL = os.getenv("INTERNAL_ESCALATION_WEBHOOK_URL", "")
INTERNAL_ESCALATION_WEBHOOK_BEARER_TOKEN = os.getenv("INTERNAL_ESCALATION_WEBHOOK_BEARER_TOKEN", "")

# Logging
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
