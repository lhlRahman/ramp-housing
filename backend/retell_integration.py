import asyncio
import hashlib
import json
import logging
import uuid
from typing import Any

import httpx
from fastapi import HTTPException
from pydantic import BaseModel, Field

import config
import geocoder
from cities import resolve_location
from db import create_retell_escalation, upsert_retell_conversation
from db import get_cached_scrape, cache_scrape, get_retell_escalation
from models import Listing, ALL_SOURCES
from scrapers import blueground as bg_scraper
from scrapers import june_homes, alohause, furnished_finder, leasebreak, renthop, zumper, craigslist
from utils import deduplicate

log = logging.getLogger(__name__)


class RetellSearchRequest(BaseModel):
    location: str = Field(description="US city or neighborhood, e.g. 'Boston, MA'")
    check_in: str | None = None
    check_out: str | None = None
    min_price: int = Field(default=0, ge=0)
    max_price: int = Field(default=50000, ge=0)
    bedrooms: list[int] = Field(default_factory=lambda: [0, 1, 2, 3])
    furnished: bool = False
    no_fee: bool = False
    sources: list[str] = Field(default_factory=lambda: list(ALL_SOURCES))
    limit: int = Field(default=10, ge=1, le=50)


class RetellEscalationRequest(BaseModel):
    question: str
    conversation_id: str | None = None
    renter_phone: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class RetellEscalationReplyRequest(BaseModel):
    answer: str


class RetellFunctionEnvelope(BaseModel):
    name: str | None = None
    args: dict[str, Any] = Field(default_factory=dict)
    call: dict[str, Any] | None = None
    chat: dict[str, Any] | None = None


class RetellOutboundSMSRequest(BaseModel):
    to_number: str
    from_number: str | None = None
    override_agent_id: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    retell_llm_dynamic_variables: dict[str, str] = Field(default_factory=dict)


class RetellOutboundCallRequest(BaseModel):
    to_number: str
    from_number: str | None = None
    override_agent_id: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    retell_llm_dynamic_variables: dict[str, str] = Field(default_factory=dict)


def _build_scraper_tasks(
    city_slugs: dict[str, Any],
    check_in: str | None,
    check_out: str | None,
    min_price: int,
    max_price: int,
    bed_list: list[int],
    source_list: list[str],
    furnished: bool,
    no_fee: bool,
) -> list[tuple[str, Any]]:
    tasks = []

    if "june_homes" in source_list and "june_homes" in city_slugs:
        slug = city_slugs["june_homes"] if isinstance(city_slugs["june_homes"], str) else None
        tasks.append(("june_homes", june_homes.scrape(slug, check_in, min_price, max_price, bed_list)))

    if "alohause" in source_list and "alohause" in city_slugs:
        tasks.append(("alohause", alohause.scrape(check_in, check_out, min_price, max_price, bed_list)))

    if "blueground" in source_list and "blueground" in city_slugs:
        slug = city_slugs["blueground"] if isinstance(city_slugs["blueground"], str) else None
        tasks.append(("blueground", bg_scraper.scrape(slug, check_in, check_out, min_price, max_price, bed_list)))

    if "furnished_finder" in source_list and "furnished_finder" in city_slugs:
        slug = city_slugs["furnished_finder"] if isinstance(city_slugs["furnished_finder"], str) else None
        tasks.append(("furnished_finder", furnished_finder.scrape(slug, check_in, min_price, max_price, bed_list)))

    if "leasebreak" in source_list and "leasebreak" in city_slugs:
        tasks.append(("leasebreak", leasebreak.scrape(min_price, max_price, bed_list, furnished)))

    if "renthop" in source_list and "renthop" in city_slugs:
        slug = city_slugs["renthop"] if isinstance(city_slugs["renthop"], str) else None
        tasks.append(("renthop", renthop.scrape(slug, min_price, max_price, bed_list, no_fee)))

    if "zumper" in source_list and "zumper" in city_slugs:
        slug = city_slugs["zumper"] if isinstance(city_slugs["zumper"], str) else None
        tasks.append(("zumper", zumper.scrape(slug, min_price, max_price, bed_list)))

    if "craigslist" in source_list and "craigslist" in city_slugs:
        cl_data = city_slugs["craigslist"]
        if isinstance(cl_data, dict):
            tasks.append(("craigslist", craigslist.scrape(cl_data["city"], cl_data["state"], min_price, max_price, bed_list)))

    return tasks


async def resolve_search_location(location_query: str) -> dict[str, Any] | None:
    coords = await geocoder.geocode(f"{location_query}, USA")
    if not coords:
        return None

    location = await geocoder.reverse_geocode(coords[0], coords[1])
    if not location:
        return None

    return resolve_location(location)


async def search_city_listings(body: RetellSearchRequest) -> dict[str, Any]:
    resolved = await resolve_search_location(body.location.strip())
    if not resolved:
        return {
            "detected_location": body.location,
            "available_sources": [],
            "count": 0,
            "summary": f"I couldn't resolve '{body.location}' to a supported US city yet.",
            "listings": [],
        }

    bed_list = sorted({bed for bed in body.bedrooms if isinstance(bed, int) and bed >= 0}) or [0, 1, 2, 3]
    available_sources = list(resolved["slugs"].keys())
    source_list = [s for s in body.sources if s in available_sources] or available_sources

    if not source_list:
        return {
            "detected_location": resolved["name"],
            "available_sources": available_sources,
            "count": 0,
            "summary": f"No listing sources are available for {resolved['name']}.",
            "listings": [],
        }

    params_hash = hashlib.md5(
        json.dumps(
            {
                "ci": body.check_in,
                "co": body.check_out,
                "min": body.min_price,
                "max": body.max_price,
                "beds": bed_list,
                "furn": body.furnished,
                "nofee": body.no_fee,
            },
            sort_keys=True,
        ).encode()
    ).hexdigest()[:12]
    city_key = f"{resolved['city']}:{resolved['state']}"

    all_listings: list[Listing] = []
    uncached_sources: list[str] = []

    for src in source_list:
        cached = get_cached_scrape(src, city_key, params_hash)
        if cached is not None:
            all_listings.extend(Listing(**listing) for listing in cached)
        else:
            uncached_sources.append(src)

    if uncached_sources:
        named_tasks = _build_scraper_tasks(
            resolved["slugs"],
            body.check_in,
            body.check_out,
            body.min_price,
            body.max_price,
            bed_list,
            uncached_sources,
            body.furnished,
            body.no_fee,
        )
        results = await asyncio.gather(
            *[task for _, task in named_tasks],
            return_exceptions=True,
        )
        for (src_name, _), result in zip(named_tasks, results):
            if isinstance(result, Exception):
                log.error("Retell search scraper %s failed: %s", src_name, result)
                continue
            cache_scrape(src_name, city_key, params_hash, [listing.model_dump() for listing in result])
            all_listings.extend(result)

    if body.furnished:
        all_listings = [listing for listing in all_listings if listing.furnished]

    final = deduplicate(all_listings)
    final.sort(key=lambda listing: (listing.price_min, listing.bedrooms, listing.source, listing.title))
    limited = final[: body.limit]

    summary = (
        f"Found {len(final)} listings in {resolved['name']} "
        f"across {len(source_list)} sources. Returning the cheapest {len(limited)}."
    )

    return {
        "detected_location": resolved["name"],
        "available_sources": available_sources,
        "count": len(final),
        "summary": summary,
        "listings": [
            {
                "id": listing.id,
                "title": listing.title,
                "source": listing.source,
                "address": listing.address,
                "neighborhood": listing.neighborhood,
                "price_min": listing.price_min,
                "price_max": listing.price_max,
                "bedrooms": listing.bedrooms,
                "bathrooms": listing.bathrooms,
                "furnished": listing.furnished,
                "no_fee": listing.no_fee,
                "available_from": listing.available_from,
                "url": listing.url,
            }
            for listing in limited
        ],
    }


async def notify_internal_escalation(escalation: dict[str, Any]) -> None:
    if not config.INTERNAL_ESCALATION_WEBHOOK_URL:
        return

    headers: dict[str, str] = {}
    if config.INTERNAL_ESCALATION_WEBHOOK_BEARER_TOKEN:
        headers["Authorization"] = f"Bearer {config.INTERNAL_ESCALATION_WEBHOOK_BEARER_TOKEN}"

    async with httpx.AsyncClient(timeout=10) as client:
        try:
            await client.post(config.INTERNAL_ESCALATION_WEBHOOK_URL, json=escalation, headers=headers)
        except Exception as exc:
            log.warning("Failed to notify internal escalation webhook: %s", exc)


async def create_escalation(body: RetellEscalationRequest) -> dict[str, Any]:
    escalation_id = f"esc_{uuid.uuid4().hex[:16]}"
    create_retell_escalation(
        escalation_id=escalation_id,
        conversation_id=body.conversation_id,
        renter_phone=body.renter_phone,
        question=body.question.strip(),
        metadata=body.metadata,
    )
    record = get_retell_escalation(escalation_id)
    if record is None:
        raise RuntimeError(f"Failed to retrieve escalation {escalation_id} after creation")
    await notify_internal_escalation(record)
    return {
        "escalation_id": escalation_id,
        "status": "pending",
        "message": "A human reviewer has been notified. Ask the renter for a little time or promise a follow-up text/call.",
    }


def check_escalation(escalation_id: str) -> dict[str, Any]:
    record = get_retell_escalation(escalation_id)
    if not record:
        raise HTTPException(status_code=404, detail="Escalation not found")

    if record["status"] == "answered" and record.get("answer"):
        return {
            "escalation_id": escalation_id,
            "status": "answered",
            "answer": record["answer"],
            "message": "A human answer is ready.",
        }

    return {
        "escalation_id": escalation_id,
        "status": record["status"],
        "message": "No human answer yet.",
    }


def infer_conversation_fields(payload: dict[str, Any]) -> dict[str, Any]:
    event_type = payload.get("event") or payload.get("event_type")
    detail = payload.get("call") if isinstance(payload.get("call"), dict) else payload.get("chat")
    source = detail if isinstance(detail, dict) else payload

    conversation_id = source.get("call_id") or source.get("chat_id") or source.get("conversation_id")
    if not conversation_id:
        raise HTTPException(status_code=400, detail="Could not infer conversation id from payload")

    channel = "call" if source.get("call_id") else "sms" if source.get("chat_id") else "unknown"
    status = source.get("call_status") or source.get("chat_status") or source.get("status")
    recording_url = source.get("recording_url")
    if not recording_url and isinstance(source.get("recording"), dict):
        recording_url = source["recording"].get("url")

    return {
        "conversation_id": conversation_id,
        "channel": channel,
        "event_type": event_type,
        "from_number": source.get("from_number"),
        "to_number": source.get("to_number"),
        "agent_id": source.get("agent_id"),
        "status": status,
        "transcript": source.get("transcript"),
        "recording_url": recording_url,
    }


def persist_retell_event(payload: dict[str, Any]) -> dict[str, Any]:
    fields = infer_conversation_fields(payload)
    upsert_retell_conversation(
        conversation_id=fields["conversation_id"],
        channel=fields["channel"],
        payload=payload,
        event_type=fields["event_type"],
        from_number=fields["from_number"],
        to_number=fields["to_number"],
        agent_id=fields["agent_id"],
        status=fields["status"],
        transcript=fields["transcript"],
        recording_url=fields["recording_url"],
    )
    return fields


def unwrap_function_args(payload: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any] | None]:
    if isinstance(payload.get("args"), dict):
        context = None
        if isinstance(payload.get("call"), dict):
            context = payload["call"]
        elif isinstance(payload.get("chat"), dict):
            context = payload["chat"]
        return payload["args"], context
    return payload, None


class RetellClient:
    def __init__(self) -> None:
        if not config.RETELL_API_KEY:
            raise RuntimeError("RETELL_API_KEY not configured")
        self._headers = {"Authorization": f"Bearer {config.RETELL_API_KEY}"}

    async def create_phone_call(self, body: RetellOutboundCallRequest) -> dict[str, Any]:
        from_number = body.from_number or config.RETELL_DEFAULT_FROM_NUMBER
        if not from_number:
            raise HTTPException(status_code=400, detail="from_number is required")
        payload = {
            "from_number": from_number,
            "to_number": body.to_number,
            "metadata": body.metadata,
            "retell_llm_dynamic_variables": body.retell_llm_dynamic_variables,
        }
        agent_id = body.override_agent_id or config.RETELL_DEFAULT_VOICE_AGENT_ID
        if agent_id:
            payload["override_agent_id"] = agent_id
        return await self._post("/v2/create-phone-call", payload)

    async def create_sms_chat(self, body: RetellOutboundSMSRequest) -> dict[str, Any]:
        from_number = body.from_number or config.RETELL_DEFAULT_FROM_NUMBER
        if not from_number:
            raise HTTPException(status_code=400, detail="from_number is required")
        payload = {
            "from_number": from_number,
            "to_number": body.to_number,
            "metadata": body.metadata,
            "retell_llm_dynamic_variables": body.retell_llm_dynamic_variables,
        }
        agent_id = body.override_agent_id or config.RETELL_DEFAULT_CHAT_AGENT_ID
        if agent_id:
            payload["override_agent_id"] = agent_id
        return await self._post("/create-sms-chat", payload)

    async def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(
                f"{config.RETELL_API_BASE}{path}",
                headers=self._headers,
                json=payload,
            )
        if resp.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Retell API error: {resp.text}")
        return resp.json()
