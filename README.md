# Ramp Housing

Aggregates US housing listings from 8 sources into one map-based search. AI agent handles landlord outreach via voice calls and SMS on your behalf.

## Quick Start (Docker)

```bash
cp .env.example .env
# Fill in API keys in .env (see below)
docker compose up --build
```

- Frontend: http://localhost:3000
- Backend: http://localhost:8000

## Quick Start (Local Dev)

### Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
playwright install chromium
cp ../.env.example .env   # then fill in API keys
uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Opens at http://localhost:3000

## Required API Keys

Copy `.env.example` to `.env` and fill in:

| Key | Required | What it does |
|-----|----------|-------------|
| `XAI_API_KEY` | Yes | Grok AI for filter parsing + SMS generation |
| `RETELL_API_KEY` | For voice calls | Retell AI voice agent |
| `RETELL_DEFAULT_VOICE_AGENT_ID` | For voice calls | Voice agent ID from Retell dashboard |
| `RETELL_DEFAULT_FROM_NUMBER` | For voice calls | Retell phone number |
| `TWILIO_ACCOUNT_SID` | For SMS | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | For SMS | Twilio auth token |
| `TWILIO_FROM_NUMBER` | For SMS | Twilio phone number (must match Retell if shared) |

**Without any keys:** Search and scraping still work. You just can't use AI filter parsing or outreach features.

**With only `XAI_API_KEY`:** Search + AI filter parsing work. No outreach.

**With Twilio keys:** SMS outreach works (AI texts landlords, analyzes replies, notifies you).

**With Retell keys:** Voice call outreach works (AI calls landlords).

## Twilio Webhook Setup

For inbound SMS (landlord replies), configure your Twilio number's webhook:

1. Go to Twilio Console > Phone Numbers > your number
2. Set "A message comes in" webhook to: `https://YOUR_DOMAIN/api/twilio/sms-webhook` (POST)
3. For local dev, use ngrok: `ngrok http 8000` then use the ngrok URL

## How It Works

1. **Draw an area** on the map to search
2. **8 scrapers** run in parallel (June Homes, Blueground, Alohause, Furnished Finder, Leasebreak, RentHop, Zumper, Craigslist)
3. Results are **geocoded, deduplicated, and filtered** to your polygon
4. **Click a listing** to see details, photos, amenities
5. **Set up your renter profile** (budget, move-in date, pets, dealbreakers)
6. **Hit "Agent Text" or "Agent Call"** on any listing with a phone number
7. The AI agent contacts the landlord, negotiates, detects scams, and **texts you updates**
8. **Check /dashboard** for conversation threads and status

## Tech Stack

- **Backend:** FastAPI, SQLite, Playwright (scraping), httpx
- **Frontend:** Next.js 14, Leaflet maps, Tailwind CSS
- **AI:** Grok (xAI) for SMS/filter parsing, Retell for voice
- **SMS:** Twilio REST API
