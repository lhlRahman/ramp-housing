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

# Geocoder
NOMINATIM_URL = os.getenv("NOMINATIM_URL", "https://nominatim.openstreetmap.org/search")
NOMINATIM_REVERSE_URL = os.getenv("NOMINATIM_REVERSE_URL", "https://nominatim.openstreetmap.org/reverse")
NOMINATIM_RATE_LIMIT = float(os.getenv("NOMINATIM_RATE_LIMIT", "1.0"))  # seconds between requests
NOMINATIM_USER_AGENT = os.getenv("NOMINATIM_USER_AGENT", "ramp-intern-housing/1.0 (hackathon project)")

# Scraper defaults
SCRAPER_TIMEOUT = int(os.getenv("SCRAPER_TIMEOUT", "40000"))  # ms for Playwright page loads
SCRAPER_MAX_PAGES = int(os.getenv("SCRAPER_MAX_PAGES", "5"))
BROWSER_HEADLESS = os.getenv("BROWSER_HEADLESS", "true").lower() == "true"
USER_AGENT = os.getenv(
    "USER_AGENT",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
)

# Logging
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
