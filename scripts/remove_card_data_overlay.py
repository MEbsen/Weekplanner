from pathlib import Path

p = Path('custom_components/week_planner/frontend/week-planner-core.js')
s = p.read_text()

# Card config is presentation/navigation only. Data-source configuration belongs
# exclusively to the integration config consumed by the shared DataManager.
for fragment in [
'''      adopt_panel: true,\n      hide_weather: false,\n      hide_sun: false,\n      hide_energy: false,\n      calendar_entities: [],\n      days_to_show: 7,\n      weather_entity: "",\n      weather_display: "none",\n      show_sun_markers: false,\n      show_moon_markers: false,\n      energy_entity: "",\n      show_energy_prices: false,\n      show_week_number: true,\n      enlarge_today: true,\n      view_mode: "week",\n''',
'''      adopt_panel: true,\n      hide_weather: false,\n      hide_sun: false,\n      hide_energy: false,\n      calendar_entities: [],\n      calendar_avatars: {},\n      calendar_colors: {},\n      days_to_show: 7,\n      weather_entity: "",\n      weather_display: "none",\n      show_sun_markers: false,\n      show_moon_markers: false,\n      energy_entity: "",\n      show_energy_prices: false,\n      show_week_number: true,\n      enlarge_today: true,\n      view_mode: "week",\n''']:
    s = s.replace(fragment, '''      hide_weather: false,\n      hide_sun: false,\n      hide_energy: false,\n      days_to_show: 7,\n''', 1)

old = '''      adopt_panel: incoming.adopt_panel !== false,\n      hide_weather: Boolean(incoming.hide_weather),\n      hide_sun: Boolean(incoming.hide_sun),\n      hide_energy: Boolean(incoming.hide_energy),\n      calendar_entities: Array.isArray(incoming.calendar_entities) ? incoming.calendar_entities : [],\n      calendar_colors: incoming.calendar_colors && typeof incoming.calendar_colors === "object"\n        ? incoming.calendar_colors\n        : {},\n      calendar_avatars: incoming.calendar_avatars && typeof incoming.calendar_avatars === "object"\n        ? incoming.calendar_avatars\n        : {},\n      days_to_show: Number.isFinite(Number(incoming.days_to_show))\n        ? Math.min(14, Math.max(1, Math.round(Number(incoming.days_to_show))))\n        : 7,\n      weather_entity: incoming.weather_entity || "",\n      weather_display: incoming.weather_display || "none",\n      show_sun_markers: Boolean(incoming.show_sun_markers),\n      show_moon_markers: Boolean(incoming.show_moon_markers),\n      energy_entity: incoming.energy_entity || "",\n      show_energy_prices: Boolean(incoming.show_energy_prices),\n      show_week_number: incoming.show_week_number !== false,\n      enlarge_today: incoming.enlarge_today !== false,\n      view_mode: incoming.view_mode === "rolling" ? "rolling" : "week",\n'''
new = '''      hide_weather: Boolean(incoming.hide_weather),\n      hide_sun: Boolean(incoming.hide_sun),\n      hide_energy: Boolean(incoming.hide_energy),\n      days_to_show: Number.isFinite(Number(incoming.days_to_show))\n        ? Math.min(14, Math.max(1, Math.round(Number(incoming.days_to_show))))\n        : 7,\n'''
if old not in s: raise SystemExit('setConfig data overlay block not found')
s = s.replace(old, new, 1)

s = s.replace('''      height: this._cardConfig.height,\n      adopt_panel: this._cardConfig.adopt_panel,\n''', '''      height: this._cardConfig.height,\n''', 1)

old = '''    if (this._config) {\n      if (this._cardConfig.adopt_panel === false) {\n        this._clearCalendarSubscriptions();\n        const today = this._now();\n        today.setHours(0,0,0,0);\n        this._weekStart = today;\n        this._loadData(false).then(() => this._setupCalendarSubscriptions());\n      } else {\n        this._render(false);\n      }\n    }\n'''
new = '''    if (this._config) {\n      this._render(false);\n    }\n'''
if old not in s: raise SystemExit('setConfig lifecycle block not found')
s = s.replace(old, new, 1)

start = s.index('  _cardRuntimeOverlay() {')
end = s.index('  getCardSize() {', start)
s = s[:start] + s[end:]

old = '''    const oldConfig = this._config;\n\n    if (this._cardConfig?.adopt_panel === false && this._config) {\n      this._config = {\n        ...this._config,\n        ...this._cardRuntimeOverlay(),\n      };\n    }\n\n'''
if old not in s: raise SystemExit('render overlay block not found')
s = s.replace(old, '', 1)
s = s.replace('''    this._config = oldConfig;\n    this._sessionVisibility = oldVisibility;\n''', '''    this._sessionVisibility = oldVisibility;\n''', 1)

s = s.replace('''      ${this._cardConfig?.adopt_panel === false ? `\n        #configure, #toggleWeather, #toggleSun, #toggleEnergy {\n          display:none !important;\n        }\n      ` : ""}\n''', '', 1)

# Remove data-source controls from card editor defaults as well. Any stale YAML
# keys remain harmless because WeekPlannerCard.setConfig ignores them.
for key in ['adopt_panel','calendar_entities','calendar_avatars','calendar_colors','weather_entity','weather_display','show_sun_markers','show_moon_markers','energy_entity','show_energy_prices','show_week_number','enlarge_today','view_mode']:
    import re
    s = re.sub(rf'^\s{{6}}{key}:.*\n', '', s, count=1, flags=re.M)

p.write_text(s)
