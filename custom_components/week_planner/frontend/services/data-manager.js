// Shared data loading/orchestration for Week Planner.
//
// DataManager owns retrieval and last-known-good state for external data
// sources. Rendering and view-specific projection stay in the panel/card.

export class WeekPlannerDataManager {
  constructor({
    getHass,
    getConfig,
    getWeekStart,
    getDayCount,
    addDays,
    isoLocal,
    stableJson,
    weatherVisible,
    energyCompatibility,
    sourceHealth,
  }) {
    this.getHass = getHass;
    this.getConfig = getConfig;
    this.getWeekStart = getWeekStart;
    this.getDayCount = getDayCount;
    this.addDays = addDays;
    this.isoLocal = isoLocal;
    this.stableJson = stableJson;
    this.weatherVisible = weatherVisible;
    this.energyCompatibility = energyCompatibility;
    this.sourceHealth = sourceHealth;

    this.events = {};
    this.hourlyWeather = [];
    this.dailyWeather = [];
    this.sunTimes = {};
    this.daylightExtrema = {};
    this.moonTransitions = [];
    this.historyData = {};
  }

  snapshot() {
    return {
      events: this.events,
      hourlyWeather: this.hourlyWeather,
      dailyWeather: this.dailyWeather,
      sunTimes: this.sunTimes,
      daylightExtrema: this.daylightExtrema,
      moonTransitions: this.moonTransitions,
      historyData: this.historyData,
    };
  }

  changed(previous, next) {
    return this.stableJson(previous) !== this.stableJson(next);
  }

  range() {
    const start = new Date(this.getWeekStart());
    const end = this.addDays(start, this.getDayCount());
    return { start, end };
  }

  async fetchCalendars() {
    const hass = this.getHass();
    const config = this.getConfig();
    const calendars = config?.calendar_entities || [];
    if (!calendars.length) {
      const changed = Object.keys(this.events || {}).length > 0;
      this.events = {};
      return { changed, ok: true };
    }

    const { start, end } = this.range();
    this.sourceHealth.markAttempt("calendar", "Kalendere");
    try {
      const result = await hass.callWS({
        type: "call_service",
        domain: "calendar",
        service: "get_events",
        service_data: {
          start_date_time: this.isoLocal(start),
          end_date_time: this.isoLocal(end),
        },
        target: { entity_id: calendars },
        return_response: true,
      });
      const next = result?.response || {};
      const changed = this.changed(this.events || {}, next);
      this.events = next;
      this.sourceHealth.markSuccess("calendar", "Kalendere");
      return { changed, ok: true };
    } catch (error) {
      this.sourceHealth.markFailure("calendar", "Kalendere", error);
      return { changed: false, ok: false, error };
    }
  }

  async fetchForecast(type) {
    const hass = this.getHass();
    const weatherEntity = this.getConfig()?.weather_entity;
    if (!weatherEntity) return [];
    const result = await hass.callWS({
      type: "call_service",
      domain: "weather",
      service: "get_forecasts",
      service_data: { type },
      target: { entity_id: weatherEntity },
      return_response: true,
    });
    return result?.response?.[weatherEntity]?.forecast || [];
  }

  async loadWeather(warnings) {
    const config = this.getConfig();
    const mode = this.weatherVisible()
      ? (config?.weather_display || "both")
      : "none";
    let changed = false;

    const load = async (type, field, label) => {
      if (mode !== type && mode !== "both") {
        if ((this[field] || []).length) changed = true;
        this[field] = [];
        return;
      }
      try {
        this.sourceHealth.markAttempt("weather", "Vejr");
        const next = await this.fetchForecast(type);
        if (this.changed(this[field] || [], next || [])) changed = true;
        this[field] = next || [];
        this.sourceHealth.markSuccess("weather", "Vejr");
      } catch (error) {
        this.sourceHealth.markFailure("weather", "Vejr", error);
        warnings.push(`${label} kunne ikke hentes: ${error?.message || error}`);
      }
    };

    await load("hourly", "hourlyWeather", "Timevejr");
    await load("daily", "dailyWeather", "Dagsvejr");
    return changed;
  }

  async loadSun(warnings) {
    const hass = this.getHass();
    const config = this.getConfig();
    if (!config?.show_sun_markers) {
      const changed = Object.keys(this.sunTimes || {}).length > 0
        || Object.keys(this.daylightExtrema || {}).length > 0;
      this.sunTimes = {};
      this.daylightExtrema = {};
      return changed;
    }

    const { start } = this.range();
    try {
      this.sourceHealth.markAttempt("sun", "Sol/dagslængde");
      const dates = Array.from({ length: this.getDayCount() + 1 }, (_, i) => {
        const date = this.addDays(start, i - 1);
        const pad = (n) => String(n).padStart(2, "0");
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
      });
      const nextSunTimes = await hass.callWS({ type: "week_planner/sun_times", dates }) || {};
      const years = [...new Set(dates.map((value) => Number(value.slice(0, 4))))];
      const nextExtrema = await hass.callWS({
        type: "week_planner/daylight_extrema",
        years,
      }) || {};
      const changed = this.changed(this.sunTimes || {}, nextSunTimes)
        || this.changed(this.daylightExtrema || {}, nextExtrema);
      this.sunTimes = nextSunTimes;
      this.daylightExtrema = nextExtrema;
      this.sourceHealth.markSuccess("sun", "Sol/dagslængde");
      return changed;
    } catch (error) {
      this.sourceHealth.markFailure("sun", "Sol/dagslængde", error);
      warnings.push(`Soltider kunne ikke hentes: ${error?.message || error}`);
      return false;
    }
  }

  async loadMoon(warnings) {
    const hass = this.getHass();
    const config = this.getConfig();
    if (!config?.show_moon_markers) {
      const changed = (this.moonTransitions || []).length > 0;
      this.moonTransitions = [];
      return changed;
    }

    const { start, end } = this.range();
    try {
      this.sourceHealth.markAttempt("moon", "Månefaser");
      const next = await hass.callWS({
        type: "week_planner/moon_transitions",
        start: this.isoLocal(start),
        end: this.isoLocal(end),
      }) || [];
      const changed = this.changed(this.moonTransitions || [], next);
      this.moonTransitions = next;
      this.sourceHealth.markSuccess("moon", "Månefaser");
      return changed;
    } catch (error) {
      this.sourceHealth.markFailure("moon", "Månefaser", error);
      warnings.push(`Månefaseskift kunne ikke hentes: ${error?.message || error}`);
      return false;
    }
  }

  async loadHistory(warnings) {
    const hass = this.getHass();
    const sources = this.getConfig()?.history_sources || [];
    const entityIds = [...new Set(sources.map((source) => source.entity_id).filter(Boolean))];
    if (!entityIds.length) {
      const changed = Object.keys(this.historyData || {}).length > 0;
      this.historyData = {};
      return { changed, ok: true };
    }

    const { start, end } = this.range();
    const path = `history/period/${encodeURIComponent(this.isoLocal(start))}`
      + `?filter_entity_id=${encodeURIComponent(entityIds.join(","))}`
      + `&end_time=${encodeURIComponent(this.isoLocal(end))}`;
    try {
      this.sourceHealth.markAttempt("history", "Historik");
      const response = await hass.callApi("GET", path);
      const mapped = {};
      for (const series of response || []) {
        if (!Array.isArray(series) || !series.length) continue;
        const fallbackEntityId = series.find((item) => item?.entity_id)?.entity_id;
        if (!fallbackEntityId) continue;
        mapped[fallbackEntityId] = series.map((item, index) => ({
          ...item,
          entity_id: item.entity_id || fallbackEntityId,
          previous_state: index > 0 ? series[index - 1]?.state : null,
          previous_attributes: index > 0 ? (series[index - 1]?.attributes || {}) : {},
          _history_index: index,
        }));
      }
      const changed = this.changed(this.historyData || {}, mapped);
      this.historyData = mapped;
      this.sourceHealth.markSuccess("history", "Historik");
      return { changed, ok: true };
    } catch (error) {
      this.sourceHealth.markFailure("history", "Historik", error);
      warnings.push(`Historik kunne ikke hentes: ${error?.message || error}`);
      return { changed: false, ok: false };
    }
  }

  checkEnergy() {
    const hass = this.getHass();
    const config = this.getConfig();
    if (!config?.show_energy_prices || !config?.energy_entity) return;
    this.sourceHealth.markAttempt("energy", "Elpriser");
    const entityId = config.energy_entity;
    const state = hass?.states?.[entityId];
    const compatibility = this.energyCompatibility();
    if (!state || state.state === "unknown" || state.state === "unavailable" || !compatibility.ok) {
      this.sourceHealth.markFailure(
        "energy",
        "Elpriser",
        compatibility.text || `Entity ${entityId} er ikke tilgængelig`
      );
    } else {
      this.sourceHealth.markSuccess("energy", "Elpriser");
    }
  }

  async loadAll() {
    const warnings = [];
    let error = "";
    let changed = false;

    const calendars = await this.fetchCalendars();
    changed ||= calendars.changed;
    if (!calendars.ok) {
      error = `Kalenderdata kunne ikke hentes: ${calendars.error?.message || calendars.error}`;
    }

    changed ||= await this.loadWeather(warnings);
    changed ||= await this.loadSun(warnings);
    changed ||= await this.loadMoon(warnings);
    const history = await this.loadHistory(warnings);
    changed ||= history.changed;
    this.checkEnergy();

    return { changed, warnings, error, snapshot: this.snapshot() };
  }
}
