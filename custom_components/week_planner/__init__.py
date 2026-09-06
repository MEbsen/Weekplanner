"""Week Planner custom integration."""
from __future__ import annotations

from datetime import datetime, time, timedelta, timezone
import logging
from pathlib import Path

import voluptuous as vol
import ephem
import math

from homeassistant.components import websocket_api
from homeassistant.components.frontend import (
    async_panel_exists,
    async_register_built_in_panel,
    async_remove_panel,
)
from homeassistant.components.lovelace import dashboard as lovelace_dashboard
from homeassistant.components.lovelace.const import (
    CONF_ALLOW_SINGLE_WORD,
    CONF_REQUIRE_ADMIN as LOVELACE_CONF_REQUIRE_ADMIN,
    CONF_RESOURCE_TYPE_WS,
    CONF_SHOW_IN_SIDEBAR,
    CONF_TITLE as LOVELACE_CONF_TITLE,
    CONF_URL_PATH,
    LOVELACE_DATA,
    MODE_STORAGE,
)
from homeassistant.components.lovelace.resources import ResourceStorageCollection
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_ICON, CONF_TYPE, CONF_URL, SUN_EVENT_SUNRISE, SUN_EVENT_SUNSET
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.sun import get_astral_event_date
from homeassistant.util import dt as dt_util

from .const import (
    CONF_CALENDAR_COLORS,
    CONF_CALENDAR_AVATARS,
    CONF_HISTORY_SOURCES,
    CONF_CALENDAR_DISPLAY_MODES,
    CONF_CALENDAR_ENTITIES,
    CONF_DEFAULT_SCROLL_HOUR,
    CONF_ENERGY_ENTITY,
    CONF_SHOW_ENERGY_PRICES,
    CONF_ENLARGE_TODAY,
    CONF_SHOW_SUN_MARKERS,
    CONF_SHOW_MOON_MARKERS,
    CONF_SHOW_WEEK_NUMBER,
    CONF_SCROLL_MODE,
    CONF_WEATHER_DISPLAY,
    CONF_WEATHER_ENTITY,
    CONF_VIEW_MODE,
    DISPLAY_AUTO,
    DOMAIN,
    NAME,
    PANEL_ELEMENT,
    PANEL_URL,
    STATIC_URL,
    VERSION,
    WEATHER_DISPLAY_BOTH,
    VIEW_MODE_WEEK,
)

_FRONTEND_REGISTERED = False
_WS_REGISTERED = False

_LOGGER = logging.getLogger(__name__)

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)
_RESOURCE_BASE_URL = f"{STATIC_URL}/week-planner.js"
_DASHBOARD_CARD_TYPE = "custom:week-planner-dashboard-card"


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Set up the integration domain."""
    global _WS_REGISTERED

    if not _WS_REGISTERED:
        websocket_api.async_register_command(hass, websocket_get_config)
        websocket_api.async_register_command(hass, websocket_update_config)
        websocket_api.async_register_command(hass, websocket_get_sun_times)
        websocket_api.async_register_command(hass, websocket_get_moon_transitions)
        websocket_api.async_register_command(hass, websocket_get_daylight_extrema)
        _WS_REGISTERED = True

    return True



async def _async_ensure_lovelace_resource(hass: HomeAssistant) -> None:
    """Ensure the Week Planner frontend module is registered as a Lovelace resource."""
    lovelace_data = hass.data.get(LOVELACE_DATA)
    if lovelace_data is None:
        raise RuntimeError("Lovelace is not initialized")

    resources = lovelace_data.resources
    if not isinstance(resources, ResourceStorageCollection):
        _LOGGER.warning(
            "Week Planner cannot automatically manage its frontend resource because "
            "Lovelace resources are not in storage mode"
        )
        return

    await resources.async_get_info()
    current_url = f"{_RESOURCE_BASE_URL}?v={VERSION}"

    existing = None
    for item in resources.async_items():
        url = str(item.get(CONF_URL, ""))
        if url == _RESOURCE_BASE_URL or url.startswith(f"{_RESOURCE_BASE_URL}?"):
            existing = item
            break

    if existing is None:
        await resources.async_create_item(
            {
                CONF_RESOURCE_TYPE_WS: "module",
                CONF_URL: current_url,
            }
        )
        return

    if existing.get(CONF_URL) != current_url:
        await resources.async_update_item(
            existing["id"],
            {
                CONF_RESOURCE_TYPE_WS: "module",
                CONF_URL: current_url,
            },
        )


def _dashboard_config() -> dict:
    """Return the managed native Lovelace dashboard configuration."""
    return {
        "views": [
            {
                "title": NAME,
                "path": "planner",
                "panel": True,
                "cards": [
                    {
                        "type": _DASHBOARD_CARD_TYPE,
                    }
                ],
            }
        ]
    }


def _register_lovelace_panel(hass: HomeAssistant, dashboard_item: dict) -> None:
    """Register the native Lovelace dashboard panel for this runtime."""
    if async_panel_exists(hass, PANEL_URL):
        return

    async_register_built_in_panel(
        hass,
        component_name="lovelace",
        frontend_url_path=PANEL_URL,
        require_admin=dashboard_item.get(LOVELACE_CONF_REQUIRE_ADMIN, False),
        show_in_sidebar=dashboard_item.get(CONF_SHOW_IN_SIDEBAR, True),
        sidebar_title=dashboard_item.get(LOVELACE_CONF_TITLE, NAME),
        sidebar_icon=dashboard_item.get(CONF_ICON, "mdi:calendar-week"),
        config={"mode": MODE_STORAGE},
    )


async def _async_ensure_native_dashboard(hass: HomeAssistant) -> None:
    """Create or restore Week Planner as a real Home Assistant dashboard."""
    lovelace_data = hass.data.get(LOVELACE_DATA)
    if lovelace_data is None:
        raise RuntimeError("Lovelace is not initialized")

    existing_runtime = lovelace_data.dashboards.get(PANEL_URL)
    if existing_runtime is not None:
        _register_lovelace_panel(hass, existing_runtime.config or {})
        try:
            await existing_runtime.async_load(False)
        except Exception:
            await existing_runtime.async_save(_dashboard_config())
        return

    # Use Home Assistant's own dashboard storage collection instead of writing
    # .storage files directly.
    collection = lovelace_dashboard.DashboardsCollection(hass)
    await collection.async_load()

    dashboard_item = next(
        (
            item
            for item in collection.async_items()
            if item.get(CONF_URL_PATH) == PANEL_URL
        ),
        None,
    )

    if dashboard_item is None:
        dashboard_item = await collection.async_create_item(
            {
                CONF_ALLOW_SINGLE_WORD: True,
                LOVELACE_CONF_TITLE: NAME,
                CONF_ICON: "mdi:calendar-week",
                CONF_URL_PATH: PANEL_URL,
                LOVELACE_CONF_REQUIRE_ADMIN: False,
                CONF_SHOW_IN_SIDEBAR: True,
            }
        )

    storage_dashboard = lovelace_dashboard.LovelaceStorage(hass, dashboard_item)
    lovelace_data.dashboards[PANEL_URL] = storage_dashboard

    try:
        await storage_dashboard.async_load(False)
    except Exception:
        await storage_dashboard.async_save(_dashboard_config())

    _register_lovelace_panel(hass, dashboard_item)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Week Planner from a config entry."""
    global _FRONTEND_REGISTERED

    if not _FRONTEND_REGISTERED:
        frontend_dir = Path(__file__).parent / "frontend"
        await hass.http.async_register_static_paths(
            [StaticPathConfig(STATIC_URL, str(frontend_dir), False)]
        )
        _FRONTEND_REGISTERED = True

    await _async_ensure_lovelace_resource(hass)
    await _async_ensure_native_dashboard(hass)

    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = {**entry.data, **entry.options}
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a Week Planner config entry."""
    hass.data.get(DOMAIN, {}).pop(entry.entry_id, None)

    # Remove only the runtime panel. The native dashboard stays persisted so a
    # normal integration reload does not destroy user dashboard metadata.
    try:
        async_remove_panel(hass, PANEL_URL)
    except Exception:
        pass

    global _FRONTEND_REGISTERED
    _FRONTEND_REGISTERED = False
    return True



def _entry_settings(entry: ConfigEntry) -> dict:
    """Return the effective Week Planner settings for a config entry."""
    return {**entry.data, **entry.options}


def _frontend_settings(hass: HomeAssistant, entry: ConfigEntry) -> dict:
    """Serialize effective Week Planner settings for the frontend."""
    settings = _entry_settings(entry)
    return {
        "weather_entity": settings.get(CONF_WEATHER_ENTITY),
        "calendar_entities": settings.get(CONF_CALENDAR_ENTITIES, []),
        "calendar_colors": settings.get(CONF_CALENDAR_COLORS, {}),
        "calendar_display_modes": settings.get(CONF_CALENDAR_DISPLAY_MODES, {}),
        "calendar_avatars": settings.get(CONF_CALENDAR_AVATARS, {}),
        "history_sources": settings.get(CONF_HISTORY_SOURCES, []),
        "energy_entity": settings.get(CONF_ENERGY_ENTITY, ""),
        "show_energy_prices": settings.get(CONF_SHOW_ENERGY_PRICES, False),
        "weather_display": settings.get(CONF_WEATHER_DISPLAY, "none"),
        "show_week_number": settings.get(CONF_SHOW_WEEK_NUMBER, True),
        "default_scroll_hour": settings.get(CONF_DEFAULT_SCROLL_HOUR, 6),
        "scroll_mode": settings.get(CONF_SCROLL_MODE, "fixed"),
        "show_sun_markers": settings.get(CONF_SHOW_SUN_MARKERS, False),
        "show_moon_markers": settings.get(CONF_SHOW_MOON_MARKERS, False),
        "enlarge_today": settings.get(CONF_ENLARGE_TODAY, True),
        "view_mode": settings.get(CONF_VIEW_MODE, VIEW_MODE_WEEK),
        "entry_id": entry.entry_id,
        "language": hass.config.language,
        "time_zone": hass.config.time_zone,
        "server_time": dt_util.now().isoformat(),
        "version": VERSION,
        "frontend_resource_url": f"/week_planner_static/week-planner.js?v={VERSION}",
    }


@websocket_api.websocket_command(
    {
        vol.Required("type"): "week_planner/update_config",
        vol.Optional("weather_entity", default=""): str,
        vol.Optional("calendar_entities", default=[]): [str],
        vol.Optional("calendar_colors", default={}): dict,
        vol.Optional("calendar_display_modes", default={}): dict,
        vol.Optional("calendar_avatars", default={}): dict,
        vol.Optional("history_sources", default=[]): [dict],
        vol.Optional("energy_entity", default=""): str,
        vol.Optional("show_energy_prices", default=False): bool,
        vol.Optional("weather_display", default=WEATHER_DISPLAY_BOTH): vol.In(
            ["none", "hourly", "daily", "both"]
        ),
        vol.Optional("show_week_number", default=True): bool,
        vol.Optional("default_scroll_hour", default=6): vol.All(
            vol.Coerce(int), vol.Range(min=0, max=23)
        ),
        vol.Optional("scroll_mode", default="fixed"): vol.In(["none", "fixed", "follow_now"]),
        vol.Optional("show_sun_markers", default=True): bool,
        vol.Optional("show_moon_markers", default=False): bool,
        vol.Optional("enlarge_today", default=True): bool,
        vol.Optional("view_mode", default=VIEW_MODE_WEEK): vol.In(["week", "rolling"]),
    }
)
@websocket_api.async_response
async def websocket_update_config(hass: HomeAssistant, connection, msg) -> None:
    """Update Week Planner configuration from the panel."""
    entries = hass.config_entries.async_entries(DOMAIN)
    if not entries:
        connection.send_error(msg["id"], "not_configured", "Week Planner is not configured")
        return

    entry = entries[0]

    submitted = {
        CONF_WEATHER_ENTITY: msg.get("weather_entity", ""),
        CONF_CALENDAR_ENTITIES: list(msg.get("calendar_entities", [])),
        CONF_CALENDAR_COLORS: {
            str(k): str(v) for k, v in msg.get("calendar_colors", {}).items()
        },
        CONF_CALENDAR_DISPLAY_MODES: {
            str(k): str(v) for k, v in msg.get("calendar_display_modes", {}).items()
        },
        CONF_CALENDAR_AVATARS: {
            str(k): str(v) for k, v in msg.get("calendar_avatars", {}).items()
            if v
        },
        CONF_HISTORY_SOURCES: [
            {
                "entity_id": str(item.get("entity_id", "")),
                "color": str(item.get("color", "#7f858d")),
            }
            for item in msg.get("history_sources", [])
            if item.get("entity_id")
        ],
        CONF_ENERGY_ENTITY: str(msg.get("energy_entity", "")),
        CONF_SHOW_ENERGY_PRICES: msg.get("show_energy_prices", False),
        CONF_WEATHER_DISPLAY: msg.get("weather_display", WEATHER_DISPLAY_BOTH),
        CONF_SHOW_WEEK_NUMBER: msg.get("show_week_number", True),
        CONF_DEFAULT_SCROLL_HOUR: msg.get("default_scroll_hour", 6),
        CONF_SCROLL_MODE: msg.get("scroll_mode", "fixed"),
        CONF_SHOW_SUN_MARKERS: msg.get("show_sun_markers", True),
        CONF_SHOW_MOON_MARKERS: msg.get("show_moon_markers", False),
        CONF_ENLARGE_TODAY: msg.get("enlarge_today", True),
        CONF_VIEW_MODE: msg.get("view_mode", VIEW_MODE_WEEK),
    }

    # Mirror mutable planner settings into both config-entry data and options.
    # Effective settings still prefer options, but mirroring makes the panel
    # resilient to older entries and to any flow that rewrites one side only.
    new_data = dict(entry.data)
    new_data.update(submitted)

    new_options = dict(entry.options)
    new_options.update(submitted)

    hass.config_entries.async_update_entry(
        entry,
        data=new_data,
        options=new_options,
    )

    # Read back from the ConfigEntry object after Home Assistant accepted the
    # update and return the authoritative persisted/effective configuration.
    persisted = _frontend_settings(hass, entry)

    mismatches = {}
    for key, expected in submitted.items():
        actual = _entry_settings(entry).get(key)
        if actual != expected:
            mismatches[key] = {"expected": expected, "actual": actual}

    if mismatches:
        connection.send_error(
            msg["id"],
            "persistence_failed",
            f"Week Planner settings could not be verified: {mismatches}",
        )
        return

    connection.send_result(
        msg["id"],
        {
            "success": True,
            "config": persisted,
        },
    )



def _sun_events_for_local_date(hass: HomeAssistant, local_date):
    """Return local sunrise/sunset datetimes for one local date."""
    tz = dt_util.get_default_time_zone()
    local_noon = datetime.combine(local_date, time(12, 0), tzinfo=tz)
    reference_utc = dt_util.as_utc(local_noon)

    sunrise = get_astral_event_date(hass, SUN_EVENT_SUNRISE, reference_utc)
    sunset = get_astral_event_date(hass, SUN_EVENT_SUNSET, reference_utc)

    return (
        sunrise.astimezone(tz) if sunrise else None,
        sunset.astimezone(tz) if sunset else None,
    )


def _daylight_minutes_for_date(hass: HomeAssistant, local_date):
    """Return daylight length in whole minutes for one local date."""
    sunrise, sunset = _sun_events_for_local_date(hass, local_date)
    if not sunrise or not sunset:
        return None
    return round((sunset - sunrise).total_seconds() / 60)


def _year_daylight_extrema(hass: HomeAssistant, year: int):
    """Calculate and cache min/max daylight length for a year."""
    from datetime import date, timedelta

    cache = hass.data.setdefault(DOMAIN, {}).setdefault("_daylight_extrema", {})
    if year in cache:
        return cache[year]

    current = date(year, 1, 1)
    end = date(year + 1, 1, 1)
    minimum = maximum = None
    minimum_date = maximum_date = None

    while current < end:
        minutes = _daylight_minutes_for_date(hass, current)
        if minutes is not None:
            if minimum is None or minutes < minimum:
                minimum = minutes
                minimum_date = current
            if maximum is None or minutes > maximum:
                maximum = minutes
                maximum_date = current
        current += timedelta(days=1)

    result = {
        "min_minutes": minimum,
        "max_minutes": maximum,
        "min_date": minimum_date.isoformat() if minimum_date else None,
        "max_date": maximum_date.isoformat() if maximum_date else None,
    }
    cache[year] = result
    return result



_MOON_PHASES = [
    ("new_moon", "🌑", "Nymåne", "tiltagende"),
    ("waxing_crescent", "🌒", "Tiltagende månesegl", "tiltagende"),
    ("first_quarter", "🌓", "Første kvarter", "tiltagende"),
    ("waxing_gibbous", "🌔", "Tiltagende måne", "tiltagende"),
    ("full_moon", "🌕", "Fuldmåne", "aftagende"),
    ("waning_gibbous", "🌖", "Aftagende måne", "aftagende"),
    ("last_quarter", "🌗", "Sidste kvarter", "aftagende"),
    ("waning_crescent", "🌘", "Aftagende månesegl", "aftagende"),
]


def _moon_phase_angle(dt_utc: datetime) -> float:
    """Return signed lunar elongation normalized to 0..360 degrees."""
    moon = ephem.Moon()
    moon.compute(ephem.Date(dt_utc))
    degrees = math.degrees(float(moon.elong))
    return degrees % 360.0


def _moon_phase_index(dt_utc: datetime) -> int:
    """Map continuous lunar elongation to one of eight UI phase buckets."""
    angle = _moon_phase_angle(dt_utc)
    return int(((angle + 22.5) % 360.0) // 45.0)


def _find_phase_transition(start_utc: datetime, end_utc: datetime, old_index: int) -> datetime:
    """Binary search to about one minute for the phase-bucket transition."""
    low = start_utc
    high = end_utc

    while (high - low).total_seconds() > 60:
        mid = low + (high - low) / 2
        if _moon_phase_index(mid) == old_index:
            low = mid
        else:
            high = mid

    return high


def _moon_transitions(start_utc: datetime, end_utc: datetime):
    """Return eight-phase UI transitions inside an interval."""
    transitions = []
    probe = start_utc
    previous_index = _moon_phase_index(probe)
    step = timedelta(hours=3)

    while probe < end_utc:
        next_probe = min(probe + step, end_utc)
        next_index = _moon_phase_index(next_probe)

        if next_index != previous_index:
            transition = _find_phase_transition(probe, next_probe, previous_index)
            new_index = _moon_phase_index(transition)
            key, icon, name, trend = _MOON_PHASES[new_index]
            transitions.append(
                {
                    "datetime": transition.isoformat(),
                    "phase_key": key,
                    "icon": icon,
                    "name": name,
                    "trend": trend,
                }
            )
            previous_index = new_index
        else:
            previous_index = next_index

        probe = next_probe

    return transitions


@websocket_api.websocket_command(
    {
        vol.Required("type"): "week_planner/moon_transitions",
        vol.Required("start"): str,
        vol.Required("end"): str,
    }
)
@websocket_api.async_response
async def websocket_get_moon_transitions(hass: HomeAssistant, connection, msg) -> None:
    """Return precise-ish transition times for the eight planner moon phases."""
    try:
        start = datetime.fromisoformat(msg["start"])
        end = datetime.fromisoformat(msg["end"])

        if start.tzinfo is None:
            start = start.replace(tzinfo=dt_util.get_default_time_zone())
        if end.tzinfo is None:
            end = end.replace(tzinfo=dt_util.get_default_time_zone())

        start_utc = start.astimezone(timezone.utc)
        end_utc = end.astimezone(timezone.utc)

        result = _moon_transitions(start_utc, end_utc)
        connection.send_result(msg["id"], result)
    except (ValueError, TypeError) as err:
        connection.send_error(msg["id"], "invalid_range", str(err))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "week_planner/daylight_extrema",
        vol.Required("years"): [vol.Coerce(int)],
    }
)
@websocket_api.async_response
async def websocket_get_daylight_extrema(hass: HomeAssistant, connection, msg) -> None:
    """Return calculated shortest/longest daylight lengths for requested years."""
    result = {}
    for year in sorted(set(msg["years"])):
        if 1900 <= year <= 2200:
            result[str(year)] = _year_daylight_extrema(hass, year)
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command(
    {
        vol.Required("type"): "week_planner/sun_times",
        vol.Required("dates"): [str],
    }
)
@websocket_api.async_response
async def websocket_get_sun_times(hass: HomeAssistant, connection, msg) -> None:
    """Return sunrise and sunset for requested local dates."""
    tz = dt_util.get_default_time_zone()
    result: dict[str, dict[str, str | None]] = {}

    for raw_date in msg["dates"]:
        try:
            local_date = datetime.strptime(raw_date, "%Y-%m-%d").date()
            sunrise, sunset = _sun_events_for_local_date(hass, local_date)

            result[raw_date] = {
                "sunrise": sunrise.isoformat() if sunrise else None,
                "sunset": sunset.isoformat() if sunset else None,
            }
        except (ValueError, TypeError):
            result[raw_date] = {"sunrise": None, "sunset": None}

    connection.send_result(msg["id"], result)


@websocket_api.websocket_command({vol.Required("type"): "week_planner/config"})
@websocket_api.async_response
async def websocket_get_config(hass: HomeAssistant, connection, msg) -> None:
    """Return Week Planner configuration to the frontend."""
    entries = hass.config_entries.async_entries(DOMAIN)
    if not entries:
        connection.send_error(msg["id"], "not_configured", "Week Planner is not configured")
        return

    entry = entries[0]
    connection.send_result(msg["id"], _frontend_settings(hass, entry))

async def async_remove_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Remove Week Planner's managed dashboard and Lovelace resource."""
    try:
        async_remove_panel(hass, PANEL_URL)
    except Exception:
        pass

    lovelace_data = hass.data.get(LOVELACE_DATA)
    if lovelace_data is None:
        return

    dashboard = lovelace_data.dashboards.pop(PANEL_URL, None)
    if dashboard is not None:
        try:
            await dashboard.async_delete()
        except Exception:
            _LOGGER.debug("Could not remove Week Planner dashboard config", exc_info=True)

    collection = lovelace_dashboard.DashboardsCollection(hass)
    await collection.async_load()
    for item in list(collection.async_items()):
        if item.get(CONF_URL_PATH) == PANEL_URL:
            try:
                await collection.async_delete_item(item["id"])
            except Exception:
                _LOGGER.debug("Could not remove Week Planner dashboard entry", exc_info=True)
            break

    resources = lovelace_data.resources
    if isinstance(resources, ResourceStorageCollection):
        await resources.async_get_info()
        for item in list(resources.async_items()):
            url = str(item.get(CONF_URL, ""))
            if url == _RESOURCE_BASE_URL or url.startswith(f"{_RESOURCE_BASE_URL}?"):
                try:
                    await resources.async_delete_item(item["id"])
                except Exception:
                    _LOGGER.debug("Could not remove Week Planner resource", exc_info=True)
                break

