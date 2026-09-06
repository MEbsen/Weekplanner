"""Config flow for Week Planner."""
from __future__ import annotations

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.helpers import selector

from .const import (
    CONF_CALENDAR_ENTITIES,
    CONF_DEFAULT_SCROLL_HOUR,
    CONF_ENERGY_ENTITY,
    CONF_ENLARGE_TODAY,
    CONF_SCROLL_MODE,
    CONF_SHOW_ENERGY_PRICES,
    CONF_SHOW_MOON_MARKERS,
    CONF_SHOW_SUN_MARKERS,
    CONF_SHOW_WEEK_NUMBER,
    CONF_VIEW_MODE,
    CONF_WEATHER_DISPLAY,
    CONF_WEATHER_ENTITY,
    DOMAIN,
    NAME,
    SCROLL_MODE_NONE,
    SCROLL_MODE_FIXED,
    VIEW_MODE_WEEK,
    WEATHER_DISPLAY_BOTH,
)


def _settings_schema(defaults: dict) -> vol.Schema:
    """Build Week Planner settings schema."""
    return vol.Schema(
        {
            vol.Optional(
                CONF_WEATHER_ENTITY,
                default=defaults.get(CONF_WEATHER_ENTITY),
            ): selector.EntitySelector(
                selector.EntitySelectorConfig(domain="weather")
            ),
            vol.Optional(
                CONF_CALENDAR_ENTITIES,
                default=defaults.get(CONF_CALENDAR_ENTITIES, []),
            ): selector.EntitySelector(
                selector.EntitySelectorConfig(domain="calendar", multiple=True)
            ),
            vol.Required(
                CONF_WEATHER_DISPLAY,
                default=defaults.get(CONF_WEATHER_DISPLAY, "none"),
            ): selector.SelectSelector(
                selector.SelectSelectorConfig(
                    options=[
                        {"value": "none", "label": "None"},
                        {"value": "hourly", "label": "Hourly"},
                        {"value": "daily", "label": "Daily"},
                        {"value": "both", "label": "Both"},
                    ],
                    mode=selector.SelectSelectorMode.DROPDOWN,
                )
            ),
            vol.Required(
                CONF_SHOW_WEEK_NUMBER,
                default=defaults.get(CONF_SHOW_WEEK_NUMBER, True),
            ): selector.BooleanSelector(),
            vol.Required(
                CONF_DEFAULT_SCROLL_HOUR,
                default=defaults.get(CONF_DEFAULT_SCROLL_HOUR, 6),
            ): selector.NumberSelector(
                selector.NumberSelectorConfig(
                    min=0,
                    max=23,
                    step=1,
                    mode=selector.NumberSelectorMode.BOX,
                )
            ),
            vol.Required(
                CONF_SCROLL_MODE,
                default=defaults.get(CONF_SCROLL_MODE, SCROLL_MODE_FIXED),
            ): selector.SelectSelector(
                selector.SelectSelectorConfig(
                    options=[
                        {"value": "none", "label": "No automatic scroll"},
                        {"value": "fixed", "label": "Fixed start time"},
                        {"value": "follow_now", "label": "Follow current time"},
                    ],
                    mode=selector.SelectSelectorMode.DROPDOWN,
                )
            ),
            vol.Required(
                CONF_SHOW_SUN_MARKERS,
                default=defaults.get(CONF_SHOW_SUN_MARKERS, False),
            ): selector.BooleanSelector(),
            vol.Required(
                CONF_SHOW_MOON_MARKERS,
                default=defaults.get(CONF_SHOW_MOON_MARKERS, False),
            ): selector.BooleanSelector(),
            vol.Required(
                CONF_SHOW_ENERGY_PRICES,
                default=defaults.get(CONF_SHOW_ENERGY_PRICES, False),
            ): selector.BooleanSelector(),
            vol.Optional(
                CONF_ENERGY_ENTITY,
                default=defaults.get(CONF_ENERGY_ENTITY),
            ): selector.EntitySelector(
                selector.EntitySelectorConfig(domain="sensor")
            ),
            vol.Required(
                CONF_ENLARGE_TODAY,
                default=defaults.get(CONF_ENLARGE_TODAY, True),
            ): selector.BooleanSelector(),
            vol.Required(
                CONF_VIEW_MODE,
                default=defaults.get(CONF_VIEW_MODE, VIEW_MODE_WEEK),
            ): selector.SelectSelector(
                selector.SelectSelectorConfig(
                    options=[
                        {"value": "week", "label": "Calendar week"},
                        {"value": "rolling", "label": "Rolling 7 days from today"},
                    ],
                    mode=selector.SelectSelectorMode.DROPDOWN,
                )
            ),
        }
    )


class WeekPlannerConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input=None):
        if user_input is not None:
            return self.async_create_entry(title=NAME, data=user_input)
        return self.async_show_form(step_id="user", data_schema=_settings_schema({}))

    @staticmethod
    @callback
    def async_get_options_flow(config_entry):
        return WeekPlannerOptionsFlow()


class WeekPlannerOptionsFlow(config_entries.OptionsFlowWithReload):
    async def async_step_init(self, user_input=None):
        defaults = {**self.config_entry.data, **self.config_entry.options}

        if user_input is not None:
            for key in (
                "calendar_colors",
                "calendar_display_modes",
                "calendar_avatars",
                "history_sources",
            ):
                if key in self.config_entry.options:
                    user_input[key] = self.config_entry.options[key]
                elif key in self.config_entry.data:
                    user_input[key] = self.config_entry.data[key]
            return self.async_create_entry(title="", data=user_input)

        return self.async_show_form(step_id="init", data_schema=_settings_schema(defaults))
