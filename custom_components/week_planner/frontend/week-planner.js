const HOUR_HEIGHT = 76;
const WEATHER_WIDTH = 54;
const DAYS = 7;
const DEFAULT_COLORS = [
  "#3f51b5", "#e91e63", "#009688", "#ff9800",
  "#9c27b0", "#2196f3", "#4caf50", "#795548",
  "#607d8b", "#f44336", "#673ab7", "#00bcd4"
];

class WeekPlannerPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._config = null;
    this._weekStart = this._startOfWeek(new Date());
    this._events = {};
    this._hourlyWeather = [];
    this._dailyWeather = [];
    this._sunTimes = {};
    this._daylightExtrema = {};
    this._moonTransitions = [];
    this._historyData = {};
    this._loading = true;
    this._error = "";
    this._warnings = [];
    this._refreshTimer = null;
    this._calendarRefreshTimer = null;
    this._calendarUnsubscribers = [];
    this._calendarSubscriptionKey = "";
    this._nowTimer = null;
    this._followNowTimer = null;
    this._lastFollowNowHourKey = "";
    this._isDashboardCard = false;
    this._sessionVisibility = { weather:true, sun:true, energy:true };
    this._initialScrolled = false;
    this._scrollPositioned = false;
    this._scrollRequestId = 0;
    this._savedScrollTop = null;
    this._savedScrollLeft = 0;
    this._lastFollowNowHourKey = "";
    this._scrollState = "auto";
    this._programmaticScrollUntil = 0;
    this._renderGeneration = 0;
    this._settingsOpen = false;
    this._renderPendingWhileSettingsOpen = false;
    this._serverTimeOffsetMs = 0;
    this._viewportHandler = () => this._applyViewportHeight();
    this._focusHandler = () => this._resumeAutoScroll("window-focus");
    this._visibilityHandler = () => {
      if (!document.hidden) this._resumeAutoScroll("visibility-focus");
    };
  }

  set hass(value) {
    this._hass = value;
    if (!this._config) this._initialize();
  }

  set panel(value) {
    this._panel = value;
  }

  connectedCallback() {
    window.addEventListener("resize", this._viewportHandler);
    window.addEventListener("focus", this._focusHandler);
    document.addEventListener("visibilitychange", this._visibilityHandler);

    // Returning to the panel/view is a new focus event by design:
    // discard a previous manual override and re-evaluate the day focus.
    this._scrollState = "auto";
    this._scrollPositioned = false;
    this._scrollRequestId++;
    this._savedScrollTop = null;

    requestAnimationFrame(() => {
      this._applyViewportHeight();
      if (this._config) this._positionScroll("connected", true);
    });

    if (this._hass && !this._config) this._initialize();
  }

  disconnectedCallback() {
    window.removeEventListener("resize", this._viewportHandler);
    window.removeEventListener("focus", this._focusHandler);
    document.removeEventListener("visibilitychange", this._visibilityHandler);
    if (this._refreshTimer) clearInterval(this._refreshTimer);
    if (this._calendarRefreshTimer) clearInterval(this._calendarRefreshTimer);
    this._clearCalendarSubscriptions();
    if (this._nowTimer) clearInterval(this._nowTimer);
    if (this._followNowTimer) clearTimeout(this._followNowTimer);
  }

  _applyViewportHeight() {
    const rect = this.getBoundingClientRect();
    const available = Math.max(320, window.innerHeight - Math.max(0, rect.top));
    this.style.height = `${available}px`;
    this.style.maxHeight = `${available}px`;
  }

  async _initialize() {
    if (!this._hass || this._initializing) return;
    this._initializing = true;
    this._initialScrolled = false;
    this._scrollState = "auto";
    this._scrollPositioned = false;
    this._scrollRequestId++;
    this._savedScrollTop = null;
    this._savedScrollLeft = 0;
    try {
      this._config = await this._hass.connection.sendMessagePromise({
        type: "week_planner/config",
      });
      ensureWeekPlannerLovelaceResource(
        this._hass,
        this._config?.frontend_resource_url
          || `/week_planner_static/week-planner.js?v=${this._config?.version || "0.5.0"}`
      );

      this._syncServerTime(this._config.server_time);
      this._config.calendar_colors ||= {};
      this._config.calendar_display_modes ||= {};
      this._config.calendar_avatars ||= {};
      this._config.history_sources ||= [];
      this._config.energy_entity ||= "";
      this._config.show_energy_prices ??= false;
      this._config.weather_display ||= "none";
      this._config.show_week_number ??= true;
      this._config.default_scroll_hour ??= 6;
      this._config.scroll_mode ||= "fixed";
      this._config.show_sun_markers ??= false;
      this._config.show_moon_markers ??= false;
      this._config.enlarge_today ??= true;
      this._config.view_mode ||= "week";
      if (this._config.view_mode === "rolling") {
        const today = this._now();
        today.setHours(0,0,0,0);
        this._weekStart = today;
      }
      await this._loadData();
      await this._setupCalendarSubscriptions();

      // Calendar-only fallback refresh. Push subscriptions should normally
      // update faster; this ensures Week Planner itself never adds more than
      // about one minute of delay once Home Assistant can see the event.
      this._calendarRefreshTimer = setInterval(
        () => this._refreshCalendarEvents(false),
        60 * 1000
      );

      this._refreshTimer = setInterval(async () => {
        try {
          const latestConfig = await this._hass.connection.sendMessagePromise({
            type: "week_planner/config",
          });
          this._syncServerTime(latestConfig.server_time);
        } catch (err) {
          console.debug("Week Planner server-time resync failed", err);
        }
        await this._loadData(false);
      }, 5 * 60 * 1000);
      this._nowTimer = setInterval(() => {
        this._updateNowIndicator();
        this._checkFollowNow();
      }, 60 * 1000);
      this._scheduleFollowNow();
    } catch (err) {
      this._error = `Kunne ikke initialisere Week Planner: ${err?.message || err}`;
      this._loading = false;
      this._render();
    }
  }

  _syncServerTime(serverTime) {
    if (!serverTime) return;
    const parsed = new Date(serverTime);
    if (Number.isNaN(parsed.getTime())) return;
    this._serverTimeOffsetMs = parsed.getTime() - Date.now();
  }

  _now() {
    return new Date(Date.now() + this._serverTimeOffsetMs);
  }

  _effectiveScrollMode() {
    if (this._isDashboardCard) {
      return this._cardConfig?.scroll_mode || "fixed";
    }
    return this._config?.scroll_mode || "fixed";
  }

  _effectiveScrollHour() {
    if (this._isDashboardCard) {
      return Number(this._cardConfig?.default_scroll_hour ?? 6);
    }
    return Number(this._config?.default_scroll_hour ?? 6);
  }

  _shouldFollowNow() {
    return this._effectiveScrollMode() === "follow_now";
  }

  _followNowHourKey(date = this._now()) {
    return `${date.getFullYear()}-${date.getMonth()+1}-${date.getDate()}-${date.getHours()}`;
  }

  _scrollTargetForMode(scroll) {
    const mode = this._effectiveScrollMode();
    if (mode === "none") return null;

    if (mode === "follow_now") {
      const now = this._now();
      const nowY = this._minutes(now) / 60 * HOUR_HEIGHT;

      // Desired behavior:
      // 1. Put NOW as high as possible to maximize future hours.
      // 2. Never scroll beyond the last viewport that still ends at 24:00.
      //    maxScroll is exactly "end of day - viewport height".
      const maxScroll = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
      return Math.max(0, Math.min(maxScroll, nowY - 8));
    }

    return Math.max(0, this._effectiveScrollHour() * HOUR_HEIGHT - 8);
  }

  _resumeAutoScroll(reason = "focus") {
    if (!this._config) return;
    this._scrollState = "auto";
    this._scrollPositioned = false;
    this._savedScrollTop = null;
    this._scrollRequestId++;
    this._positionScroll(reason, true);
  }

  _positionScroll(reason = "initial", force = false) {
    const mode = this._effectiveScrollMode();

    // Manual override wins until a deliberate focus/reload lifecycle event
    // resets the controller back to AUTO.
    if (this._scrollState === "manual" && reason !== "connected") return;

    const requestId = ++this._scrollRequestId;

    if (mode === "none") {
      this._scrollPositioned = true;
      this._initialScrolled = true;
      return;
    }

    const delays = force ? [0, 60, 140, 280, 500, 900] : [0];

    const attempt = (index) => {
      if (requestId !== this._scrollRequestId) return;

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (requestId !== this._scrollRequestId) return;

          const scroll = this.shadowRoot?.getElementById("scroll");
          if (!scroll) {
            if (index + 1 < delays.length) {
              setTimeout(() => attempt(index + 1), delays[index + 1]);
            }
            return;
          }

          const maxScroll = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
          if (scroll.scrollHeight <= 0 || scroll.clientHeight <= 0 || maxScroll <= 0) {
            if (index + 1 < delays.length) {
              setTimeout(() => attempt(index + 1), delays[index + 1]);
            }
            return;
          }

          const desired = this._scrollTargetForMode(scroll);
          if (desired === null) return;

          const target = Math.max(0, Math.min(maxScroll, desired));

          // Scroll events can arrive slightly after scrollTop assignment.
          // Use a short time guard so our own movement is never mistaken for
          // a user/manual override.
          this._programmaticScrollUntil = Date.now() + 250;
          scroll.scrollTop = target;
          this._savedScrollTop = target;
          this._savedScrollLeft = scroll.scrollLeft || 0;
          this._scrollPositioned = true;
          this._initialScrolled = true;

          if (mode === "follow_now") {
            this._lastFollowNowHourKey = this._followNowHourKey(this._now());
          }
        });
      });
    };

    attempt(0);
  }

  _scrollToCurrentTime(force = false) {
    if (!this._shouldFollowNow()) return;
    this._positionScroll("follow-now", force);
  }

  _updateNowIndicator() {
    const now = this._now();
    const nowY = this._minutes(now) / 60 * HOUR_HEIGHT;

    const line = this.shadowRoot?.getElementById("nowLine");
    if (line) line.style.top = `${nowY}px`;

    const label = this.shadowRoot?.getElementById("nowTime");
    if (label) {
      label.style.top = `${nowY}px`;
      label.textContent = now.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    }
  }

  _checkFollowNow() {
    if (!this._shouldFollowNow() || this._scrollState === "manual") return;

    const now = this._now();
    const hourKey = this._followNowHourKey(now);

    if (!this._scrollPositioned || this._lastFollowNowHourKey !== hourKey) {
      this._positionScroll("hour-change", true);
    }
  }

  _scheduleFollowNow() {
    if (this._followNowTimer) {
      clearTimeout(this._followNowTimer);
      this._followNowTimer = null;
    }

    if (!this._shouldFollowNow()) return;

    const now = this._now();
    const nextHour = new Date(now);
    nextHour.setHours(now.getHours() + 1, 0, 0, 0);
    const delay = Math.max(1000, nextHour.getTime() - now.getTime());

    this._followNowTimer = setTimeout(() => {
      if (this._scrollState === "auto") {
        this._positionScroll("hour-boundary", true);
      }
      this._scheduleFollowNow();
    }, delay);
  }

  _weatherVisibleNow() {
    return this._sessionVisibility?.weather !== false;
  }

  _sunVisibleNow() {
    return this._sessionVisibility?.sun !== false;
  }

  _energyVisibleNow() {
    return this._sessionVisibility?.energy !== false;
  }

  async _toggleSessionLayer(layer) {
    this._sessionVisibility ||= { weather:true, sun:true, energy:true };
    this._sessionVisibility[layer] = this._sessionVisibility[layer] === false;

    if (layer === "weather" && this._sessionVisibility.weather) {
      const configuredMode = this._config?.weather_display || "both";
      const needsHourly =
        (configuredMode === "hourly" || configuredMode === "both")
        && !(this._hourlyWeather || []).length;
      const needsDaily =
        (configuredMode === "daily" || configuredMode === "both")
        && !(this._dailyWeather || []).length;

      if (needsHourly || needsDaily) {
        await this._loadData(false);
        return;
      }
    }

    this._render(false);
  }

  _dayCount() {
    return DAYS;
  }

  _navigationStepDays() {
    return 7;
  }

  _startOfView(date = this._now()) {
    const d = new Date(date);
    d.setHours(0,0,0,0);
    return this._config?.view_mode === "rolling" ? d : this._startOfWeek(d);
  }

  _startOfWeek(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const day = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - day);
    return d;
  }

  _addDays(date, amount) {
    const d = new Date(date);
    d.setDate(d.getDate() + amount);
    return d;
  }

  _isoLocal(date) {
    const pad = (n) => String(n).padStart(2, "0");
    const off = -date.getTimezoneOffset();
    const sign = off >= 0 ? "+" : "-";
    const oh = pad(Math.floor(Math.abs(off) / 60));
    const om = pad(Math.abs(off) % 60);
    return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${oh}:${om}`;
  }

  async _refreshCalendarEvents(showError = true) {
    if (!this._hass || !this._config) return;

    const start = new Date(this._weekStart);
    const end = this._addDays(start, this._dayCount());
    const calendars = this._config.calendar_entities || [];

    if (!calendars.length) {
      this._events = {};
      this._render(false);
      return;
    }

    try {
      const calendarResult = await this._hass.callWS({
        type: "call_service",
        domain: "calendar",
        service: "get_events",
        service_data: {
          start_date_time: this._isoLocal(start),
          end_date_time: this._isoLocal(end),
        },
        target: { entity_id: calendars },
        return_response: true,
      });
      this._events = calendarResult?.response || {};
      if (showError && this._error?.startsWith("Kalenderdata")) this._error = "";
      this._render(false);
    } catch (err) {
      if (showError) {
        this._error = `Kalenderdata kunne ikke hentes: ${err?.message || err}`;
        this._render(false);
      }
    }
  }

  _clearCalendarSubscriptions() {
    for (const unsubscribe of this._calendarUnsubscribers || []) {
      try {
        unsubscribe?.();
      } catch (err) {
        console.debug("Week Planner calendar unsubscribe failed", err);
      }
    }
    this._calendarUnsubscribers = [];
    this._calendarSubscriptionKey = "";
  }

  async _setupCalendarSubscriptions() {
    if (!this._hass?.connection || !this._config) return;

    const calendars = this._config.calendar_entities || [];
    const start = new Date(this._weekStart);
    const end = this._addDays(start, this._dayCount());
    const key = JSON.stringify([
      calendars,
      this._isoLocal(start),
      this._isoLocal(end),
    ]);

    if (key === this._calendarSubscriptionKey) return;

    this._clearCalendarSubscriptions();
    this._calendarSubscriptionKey = key;

    if (!calendars.length || typeof this._hass.connection.subscribeMessage !== "function") {
      return;
    }

    for (const entityId of calendars) {
      try {
        const unsubscribe = await this._hass.connection.subscribeMessage(
          (payload) => {
            // HA's websocket client normally delivers the inner subscription
            // payload. Be tolerant of a wrapped event shape as well.
            const events = payload?.events ?? payload?.event?.events;
            if (!Array.isArray(events)) return;

            this._events = {
              ...(this._events || {}),
              [entityId]: { events },
            };
            this._render(false);
          },
          {
            type: "calendar/event/subscribe",
            entity_id: entityId,
            start: this._isoLocal(start),
            end: this._isoLocal(end),
          }
        );
        if (typeof unsubscribe === "function") {
          this._calendarUnsubscribers.push(unsubscribe);
        }
      } catch (err) {
        console.debug(`Week Planner subscription failed for ${entityId}`, err);
      }
    }
  }

  async _loadHistoryData() {
    const sources = this._config?.history_sources || [];
    if (!sources.length) {
      this._historyData = {};
      return;
    }

    const entityIds = [...new Set(sources.map((s) => s.entity_id).filter(Boolean))];
    if (!entityIds.length) {
      this._historyData = {};
      return;
    }

    const start = new Date(this._weekStart);
    const end = this._addDays(start, this._dayCount());
    const path =
      `history/period/${encodeURIComponent(this._isoLocal(start))}`
      + `?filter_entity_id=${encodeURIComponent(entityIds.join(","))}`
      + `&end_time=${encodeURIComponent(this._isoLocal(end))}`;

    try {
      const response = await this._hass.callApi("GET", path);
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

      this._historyData = mapped;
    } catch (err) {
      this._historyData = {};
      this._warnings.push(`Historik kunne ikke hentes: ${err?.message || err}`);
    }
  }

  _historyMarkersForDay(day) {
    const dayStart = new Date(day);
    dayStart.setHours(0,0,0,0);
    const dayEnd = this._addDays(dayStart, 1);
    const visibleStart = new Date(this._weekStart);
    const result = [];

    for (const source of this._config?.history_sources || []) {
      const entityId = source.entity_id;
      const color = source.color || "#7f858d";
      const currentState = this._hass?.states?.[entityId];
      const friendlyName = currentState?.attributes?.friendly_name || entityId;

      for (const item of this._historyData?.[entityId] || []) {
        const attributes = item.attributes || {};
        const previousAttributes = item.previous_attributes || {};
        const isAutomation = entityId.startsWith("automation.");

        // For normal entities a state change normally has last_changed == last_updated.
        // Automations usually stay "on" while last_triggered changes, so their
        // meaningful recorder timestamp is last_updated / last_triggered.
        let rawTime = item.last_updated || item.last_changed;
        let displayState = item.state;
        let triggerValue = null;

        if (isAutomation) {
          const currentTriggered = attributes.last_triggered || null;
          const previousTriggered = previousAttributes.last_triggered || null;

          // Only draw a recorder record as an automation trigger when
          // last_triggered actually changed. This avoids showing enable/disable
          // baseline records as if the automation had executed.
          if (!currentTriggered || currentTriggered === previousTriggered) continue;

          rawTime = currentTriggered || item.last_updated || item.last_changed;
          displayState = "triggered";
          triggerValue = currentTriggered;
        }

        if (!rawTime) continue;
        const dt = new Date(rawTime);
        if (Number.isNaN(dt.getTime())) continue;

        // First History API entry may be baseline context from before the query.
        if (dt < visibleStart || dt < dayStart || dt >= dayEnd) continue;

        result.push({
          entityId,
          friendlyName,
          color,
          state: displayState,
          rawState: item.state,
          previousState: item.previous_state,
          triggerValue,
          datetime: dt,
          attributes,
          previousAttributes,
          lastChanged: item.last_changed || "",
          lastUpdated: item.last_updated || "",
        });
      }
    }

    return result.sort((a,b) => a.datetime - b.datetime);
  }

  async _callForecast(type) {
    const weatherEntity = this._config.weather_entity;
    if (!weatherEntity) return [];
    const result = await this._hass.callWS({
      type: "call_service",
      domain: "weather",
      service: "get_forecasts",
      service_data: { type },
      target: { entity_id: weatherEntity },
      return_response: true,
    });
    return result?.response?.[weatherEntity]?.forecast || [];
  }

  async _loadData(showLoading = true) {
    if (!this._hass || !this._config) return;
    if (showLoading) {
      this._loading = true;
      this._render();
    }

    const start = new Date(this._weekStart);
    const end = this._addDays(start, this._dayCount());
    this._warnings = [];
    let calendarError = null;

    try {
      const calendars = this._config.calendar_entities || [];
      if (calendars.length) {
        try {
          const calendarResult = await this._hass.callWS({
            type: "call_service",
            domain: "calendar",
            service: "get_events",
            service_data: {
              start_date_time: this._isoLocal(start),
              end_date_time: this._isoLocal(end),
            },
            target: { entity_id: calendars },
            return_response: true,
          });
          this._events = calendarResult?.response || {};
        } catch (err) {
          calendarError = err;
          this._events = {};
        }
      } else {
        this._events = {};
      }

      const mode = this._weatherVisibleNow() ? (this._config.weather_display || "both") : "none";
      if (mode === "hourly" || mode === "both") {
        try {
          this._hourlyWeather = await this._callForecast("hourly");
        } catch (err) {
          this._hourlyWeather = [];
          this._warnings.push(`Timevejr kunne ikke hentes: ${err?.message || err}`);
        }
      } else {
        this._hourlyWeather = [];
      }

      if (mode === "daily" || mode === "both") {
        try {
          this._dailyWeather = await this._callForecast("daily");
        } catch (err) {
          this._dailyWeather = [];
          this._warnings.push(`Dagsvejr kunne ikke hentes: ${err?.message || err}`);
        }
      } else {
        this._dailyWeather = [];
      }

      if (this._config.show_sun_markers) {
        try {
          const dates = Array.from({ length: this._dayCount() + 1 }, (_, i) =>
            this._dateKey(this._addDays(start, i - 1))
          );
          this._sunTimes = await this._hass.callWS({
            type: "week_planner/sun_times",
            dates,
          }) || {};

          const years = [...new Set(
            dates.map((value) => Number(value.slice(0, 4)))
          )];
          this._daylightExtrema = await this._hass.callWS({
            type: "week_planner/daylight_extrema",
            years,
          }) || {};
        } catch (err) {
          this._sunTimes = {};
          this._daylightExtrema = {};
          this._warnings.push(`Soltider kunne ikke hentes: ${err?.message || err}`);
        }
      } else {
        this._sunTimes = {};
        this._daylightExtrema = {};
      }

      if (this._config.show_moon_markers) {
        try {
          this._moonTransitions = await this._hass.callWS({
            type: "week_planner/moon_transitions",
            start: this._isoLocal(start),
            end: this._isoLocal(end),
          }) || [];
        } catch (err) {
          this._moonTransitions = [];
          this._warnings.push(`Månefaseskift kunne ikke hentes: ${err?.message || err}`);
        }
      } else {
        this._moonTransitions = [];
      }

      await this._loadHistoryData();

      this._error = calendarError
        ? `Kalenderdata kunne ikke hentes: ${calendarError?.message || calendarError}`
        : "";
    } catch (err) {
      console.error("Week Planner data load failed", err);
      this._error = `Data kunne ikke hentes: ${err?.message || err}`;
    } finally {
      this._loading = false;
      this._render();
    }
  }

  _hourlyWeatherMap() {
    const map = new Map();
    for (const item of this._hourlyWeather || []) {
      if (!item.datetime) continue;
      const d = new Date(item.datetime);
      map.set(this._hourKey(d), item);
    }
    return map;
  }

  _dailyWeatherMap() {
    const map = new Map();
    for (const item of this._dailyWeather || []) {
      if (!item.datetime) continue;
      const d = new Date(item.datetime);
      map.set(this._dateKey(d), item);
    }
    return map;
  }

  _hourKey(d) {
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}`;
  }

  _dateKey(d) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  _weatherIcon(condition) {
    const icons = {
      "clear-night": "🌙",
      cloudy: "☁️",
      exceptional: "⚠️",
      fog: "🌫️",
      hail: "🌨️",
      lightning: "⛈️",
      "lightning-rainy": "⛈️",
      partlycloudy: "🌤️",
      pouring: "🌧️",
      rainy: "🌧️",
      snowy: "🌨️",
      "snowy-rainy": "🌨️",
      sunny: "☀️",
      windy: "💨",
      "windy-variant": "🌬️",
    };
    return icons[condition] || "🌡️";
  }

  _isAllDay(startRaw) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(startRaw));
  }

  _parseAllDayDate(raw) {
    const [y,m,d] = String(raw).split("-").map(Number);
    return new Date(y, m - 1, d, 0, 0, 0, 0);
  }

  _calendarDisplayMode(entityId) {
    return this._config?.calendar_display_modes?.[entityId] || "auto";
  }

  _eventWantsRibbon(entityId, event) {
    const mode = this._calendarDisplayMode(entityId);
    if (mode === "ribbon") return true;
    if (mode === "timeline") return false;
    return this._isAllDay(event.start);
  }

  _dayEvents(dayDate) {
    const dayStart = new Date(dayDate);
    dayStart.setHours(0,0,0,0);
    const dayEnd = this._addDays(dayStart, 1);
    const result = [];

    for (const [entityId, payload] of Object.entries(this._events || {})) {
      for (const event of payload?.events || []) {
        if (!event.start || !event.end) continue;
        if (this._eventWantsRibbon(entityId, event)) continue;
        if (this._isAllDay(event.start)) continue;

        const originalStart = new Date(event.start);
        const originalEnd = new Date(event.end);
        if (Number.isNaN(originalStart.getTime()) || Number.isNaN(originalEnd.getTime())) continue;

        if (originalStart < dayEnd && originalEnd > dayStart) {
          const clippedStart = originalStart > dayStart ? originalStart : dayStart;
          const clippedEnd = originalEnd < dayEnd ? originalEnd : dayEnd;
          const startMinute = Math.max(0, (clippedStart - dayStart) / 60000);
          const endMinute = Math.min(1440, (clippedEnd - dayStart) / 60000);

          if (endMinute > startMinute) {
            result.push({
              ...event,
              entityId,
              originalStart,
              originalEnd,
              clippedStart,
              clippedEnd,
              startMinute,
              endMinute,
              continuesFromPreviousDay: originalStart < dayStart,
              continuesToNextDay: originalEnd > dayEnd,
            });
          }
        }
      }
    }
    return this._layoutOverlaps(result);
  }

  _ribbonEvents(dayDate) {
    const dayStart = new Date(dayDate);
    dayStart.setHours(0,0,0,0);
    const dayEnd = this._addDays(dayStart, 1);
    const result = [];

    for (const [entityId, payload] of Object.entries(this._events || {})) {
      for (const event of payload?.events || []) {
        if (!event.start || !event.end || !this._eventWantsRibbon(entityId, event)) continue;

        let start, end, allDay = this._isAllDay(event.start);
        if (allDay) {
          start = this._parseAllDayDate(event.start);
          end = this._parseAllDayDate(event.end);
        } else {
          start = new Date(event.start);
          end = new Date(event.end);
        }

        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
        if (start < dayEnd && end > dayStart) {
          result.push({ ...event, entityId, allDay, parsedStart:start, parsedEnd:end });
        }
      }
    }
    return result;
  }

  _layoutOverlaps(events) {
    const sorted = [...events].sort(
      (a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute
    );
    const output = [];
    let group = [];
    let groupEnd = -1;

    const flush = () => {
      if (!group.length) return;
      const columnEnds = [];
      let maxColumns = 1;

      for (const ev of group) {
        let column = columnEnds.findIndex((end) => end <= ev.startMinute);
        if (column === -1) {
          column = columnEnds.length;
          columnEnds.push(ev.endMinute);
        } else {
          columnEnds[column] = ev.endMinute;
        }
        ev.column = column;
        maxColumns = Math.max(maxColumns, columnEnds.length);
      }

      for (const ev of group) {
        ev.columns = maxColumns;
        output.push(ev);
      }
      group = [];
      groupEnd = -1;
    };

    for (const ev of sorted) {
      if (group.length && ev.startMinute >= groupEnd) flush();
      group.push(ev);
      groupEnd = Math.max(groupEnd, ev.endMinute);
    }
    flush();
    return output;
  }

  _minutes(date) {
    return date.getHours() * 60 + date.getMinutes();
  }

  _formatTime(date) {
    const h = String(date.getHours()).padStart(2, "0");
    const m = String(date.getMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  }

  _formatDay(date) {
    const weekday = new Intl.DateTimeFormat("da-DK", { weekday: "short" }).format(date);
    return `${weekday.replace(".", "")} ${date.getDate()}.`;
  }

  _formatDateTime(date) {
    return new Intl.DateTimeFormat("da-DK", {
      weekday: "short",
      day: "numeric",
      month: "short",
    }).format(date).replace(".", "") + ` ${this._formatTime(date)}`;
  }

  _isWeekStart(date) {
    // JavaScript: Sunday=0, Monday=1.
    // Week Planner currently uses Monday as the calendar-week boundary.
    return date.getDay() === 1;
  }

  _showWeekBoundaryFor(day, index) {
    return this._config?.view_mode === "rolling"
      && index > 0
      && this._isWeekStart(day);
  }

  _sameDate(a, b) {
    return a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate();
  }

  _isoWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  }

  _weekLabel() {
    const end = this._addDays(this._weekStart, 6);
    const fmt = new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short" });
    const range = `${fmt.format(this._weekStart)} – ${fmt.format(end)}`;
    if (!this._config?.show_week_number) return range;

    const startWeek = this._isoWeekNumber(this._weekStart);
    const endWeek = this._isoWeekNumber(end);
    const weekText = startWeek === endWeek ? `${startWeek}` : `${startWeek}/${endWeek}`;
    return `Uge ${weekText} · ${range}`;
  }

  _calendarAvatarEntity(calendarEntityId) {
    return this._config?.calendar_avatars?.[calendarEntityId] || "";
  }

  _avatarInfo(calendarEntityId) {
    const avatarValue = this._calendarAvatarEntity(calendarEntityId);
    if (!avatarValue) return null;

    if (avatarValue.startsWith("mdi:")) {
      return {
        entityId: "",
        name: avatarValue,
        picture: "",
        icon: avatarValue,
      };
    }

    const state = this._hass?.states?.[avatarValue];
    if (!state) return null;

    const picture = state.attributes?.entity_picture || "";
    const icon = state.attributes?.icon || "";

    return {
      entityId: avatarValue,
      name: state.attributes?.friendly_name || avatarValue,
      picture,
      icon,
    };
  }

  _avatarHtml(calendarEntityId, compact = false) {
    const info = this._avatarInfo(calendarEntityId);
    if (!info) return "";

    const sizeClass = compact ? "event-avatar compact" : "event-avatar";

    if (info.picture) {
      return `<span class="${sizeClass}" title="${this._escape(info.name)}"><img src="${this._escape(info.picture)}" alt="${this._escape(info.name)}"></span>`;
    }

    if (info.icon) {
      return `<span class="${sizeClass}" title="${this._escape(info.name)}"><ha-icon icon="${this._escape(info.icon)}"></ha-icon></span>`;
    }

    return "";
  }

  _calendarColor(entityId) {
    const configured = this._config?.calendar_colors?.[entityId];
    if (/^#[0-9a-fA-F]{6}$/.test(configured || "")) return configured;
    const calendars = this._config?.calendar_entities || [];
    const idx = Math.max(0, calendars.indexOf(entityId));
    return DEFAULT_COLORS[idx % DEFAULT_COLORS.length];
  }

  _defaultColor(entityId) {
    const calendars = Object.values(this._hass?.states || {})
      .filter((s) => s.entity_id.startsWith("calendar."))
      .map((s) => s.entity_id)
      .sort();
    const idx = Math.max(0, calendars.indexOf(entityId));
    return DEFAULT_COLORS[idx % DEFAULT_COLORS.length];
  }

  _render(allowScroll = true) {
    if (!this.shadowRoot) return;

    // Rendering is never allowed to decide where the user should be.
    // Preserve the current timeline position before replacing DOM.
    const previousScroll = this.shadowRoot.getElementById("scroll");
    if (previousScroll && this._scrollPositioned && this._scrollState === "manual") {
      this._savedScrollTop = previousScroll.scrollTop;
      this._savedScrollLeft = previousScroll.scrollLeft || 0;
    }

    if (this._settingsOpen) {
      this._renderPendingWhileSettingsOpen = true;
      return;
    }
    if (!this._config && !this._error) {
      const existingScroll = this.shadowRoot.getElementById("scroll");
    if (existingScroll && this._initialScrolled) {
      this._savedScrollTop = existingScroll.scrollTop;
      this._savedScrollLeft = existingScroll.scrollLeft;
    }

    this.shadowRoot.innerHTML = `<div class="state">Indlæser Week Planner…</div>`;
      return;
    }

    const now = this._now();
    const hourlyMap = this._hourlyWeatherMap();
    const dailyMap = this._dailyWeatherMap();
    const energyMap = this._energyPriceMap();
    const mode = this._weatherVisibleNow()
      ? (this._config.weather_display || "both")
      : "none";
    const days = Array.from({ length: this._dayCount() }, (_, i) => this._addDays(this._weekStart, i));

    const todayVisible = days.some(d => this._sameDate(d, now));
    const columns = days.map(d =>
      (this._config.enlarge_today && this._sameDate(d, now))
        ? "minmax(225px,1.5fr)"
        : "minmax(150px,1fr)"
    ).join(" ");

    const styles = `
      :host {
        display:block;
        width:100%;
        height:100%;
        min-height:0;
        overflow:hidden;
        color:var(--primary-text-color);
        background:var(--primary-background-color);
        --wp-border:var(--divider-color, rgba(127,127,127,.25));
        --wp-muted:var(--secondary-text-color);
        --wp-card:var(--card-background-color);
        --wp-accent:var(--primary-color);
      }
      * { box-sizing:border-box; }
      .root {
        width:100%;
        height:100%;
        min-height:0;
        display:grid;
        grid-template-rows:auto minmax(0,1fr);
        overflow:hidden;
      }
      .toolbar {
        min-height:64px; display:flex; align-items:center; justify-content:space-between;
        gap:12px; padding:8px 16px; border-bottom:1px solid var(--wp-border);
        background:var(--app-header-background-color, var(--primary-background-color));
      }
      .toolbar h1 { margin:0; font-size:20px; font-weight:500; }
      .toolbar .sub { color:var(--wp-muted); font-size:13px; }
      button {
        font:inherit; color:inherit; background:transparent; border:1px solid var(--wp-border);
        border-radius:10px; padding:8px 12px; cursor:pointer;
      }
      button:hover { background:rgba(127,127,127,.10); }
      .nav { display:flex; gap:8px; }
      .nav .layer-toggle { min-width:34px; padding:6px 8px; }
      .nav .layer-toggle.off { opacity:.4; filter:grayscale(1); }
      .nav .layer-toggle.active { opacity:1; }
      .error { padding:8px 16px; color:var(--error-color); border-bottom:1px solid var(--wp-border); }
      .warning { padding:5px 16px; color:var(--wp-muted); font-size:12px; border-bottom:1px solid var(--wp-border); }
      .loading { padding:6px 16px; color:var(--wp-muted); font-size:12px; }
      .planner-frame {
        min-height:0;
        display:grid;
        grid-template-rows:auto minmax(0,1fr);
        overflow:hidden;
      }
      .header-scroll {
        min-width:0;
        overflow:hidden;
        border-bottom:1px solid var(--wp-border);
        background:var(--primary-background-color);
      }
      .timeline-scroll {
        min-width:0;
        min-height:0;
        overflow-x:scroll;
        overflow-y:scroll;
        position:relative;
        overscroll-behavior:contain;
        scrollbar-gutter:stable;
      }
      .header-grid {
        display:grid;
        grid-template-columns:var(--wp-columns);
        grid-template-rows:72px auto;
        min-width:1114px;
      }
      .timeline-grid {
        display:grid;
        grid-template-columns:var(--wp-columns);
        grid-template-rows:${24 * HOUR_HEIGHT}px;
        min-width:1114px;
      }
      .timeline-scroll::-webkit-scrollbar { width:12px; height:12px; }
      .timeline-scroll::-webkit-scrollbar-thumb {
        background:color-mix(in srgb,var(--wp-muted) 50%,transparent);
        border-radius:8px;
        border:3px solid transparent;
        background-clip:padding-box;
      }
      .timeline-scroll::-webkit-scrollbar-track { background:transparent; }
      .corner,.day-head {
        z-index:32; background:var(--primary-background-color);
        border-bottom:1px solid var(--wp-border);
      }
      .ribbon-corner,.ribbon-day {
        z-index:31;
        background:var(--primary-background-color);
        border-bottom:1px solid var(--wp-border);
      }
      .ribbon-corner { border-right:1px solid var(--wp-border); }
      .ribbon-day {
        min-height:38px; padding:4px; border-right:1px solid var(--wp-border);
        display:flex; flex-direction:column; gap:3px;
      }
      .ribbon-day.today { background:color-mix(in srgb,var(--wp-accent) 7%,var(--primary-background-color)); }
      .ribbon-event {
        width:100%; padding:4px 6px; min-height:28px; text-align:left;
        border:1px solid color-mix(in srgb,var(--event-color) 48%,var(--wp-border));
        border-left:4px solid var(--event-color);
        background:color-mix(in srgb,var(--event-color) 14%,var(--wp-card));
        border-radius:6px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
        font-size:11px;
      }
      .ribbon-event.past { opacity:.42; }
      .day-head {
        display:flex; align-items:center; justify-content:center; flex-direction:column;
        border-left:1px solid var(--wp-border); font-size:14px; gap:2px;
      }
      .day-head.today { background:color-mix(in srgb,var(--wp-accent) 12%,var(--primary-background-color)); }
      .week-boundary {
        border-left:4px solid var(--wp-accent) !important;
        box-shadow:-1px 0 0 color-mix(in srgb,var(--wp-accent) 35%,transparent);
      }
      .week-boundary.day-head {
        position:relative;
      }
      .week-boundary.day-head::before {
        content:"NY UGE";
        position:absolute;
        left:4px;
        top:3px;
        font-size:8px;
        font-weight:600;
        letter-spacing:.04em;
        color:var(--wp-accent);
        opacity:.85;
      }
      .today-dot { font-size:10px; color:var(--wp-accent); }
      .day-summary {
        display:flex;
        align-items:center;
        justify-content:center;
        gap:6px;
        min-width:0;
      }
      .daily-weather {
        display:flex; align-items:center; gap:5px; border:0; padding:1px 5px; border-radius:7px;
      }
      .daylight-info {
        display:flex;
        align-items:center;
        gap:4px;
        font-size:10px;
        color:var(--wp-muted);
        white-space:nowrap;
        cursor:help;
      }
      .daylight-icon {
        font-size:12px;
        line-height:1;
      }
      .daylight-info .gaining { color:#2e7d32; }
      .daylight-info .losing { color:#c62828; }
      .daily-weather .dw-icon { font-size:19px; line-height:1; }
      .daily-weather .dw-temp { font-size:10px; color:var(--wp-muted); }
      .time-col { position:relative; border-right:1px solid var(--wp-border); }
      .time-label {
        position:absolute; right:7px; transform:translateY(-8px);
        font-size:11px; color:var(--wp-muted);
      }
      .solar-line {
        position:absolute;
        left:0;
        right:0;
        height:2px;
        z-index:19;
        pointer-events:none;
        background:var(--solar-color);
      }
      .solar-line::before {
        content:"";
        position:absolute;
        left:2px;
        top:-4px;
        width:10px;
        height:10px;
        border-radius:50%;
        background:var(--solar-color);
      }
      .solar-label {
        position:absolute;
        right:4px;
        top:-11px;
        display:flex;
        align-items:center;
        gap:4px;
        padding:1px 5px;
        border-radius:8px;
        font-size:10px;
        line-height:16px;
        color:var(--primary-text-color);
        background:color-mix(in srgb,var(--solar-color) 20%,var(--card-background-color));
        border:1px solid color-mix(in srgb,var(--solar-color) 60%,var(--wp-border));
        white-space:nowrap;
      }
      .solar-line.sunrise { --solar-color:#f59e0b; }
      .solar-line.sunset { --solar-color:#d95c4f; }
      .moon-transition-line {
        position:absolute;
        left:0;
        right:0;
        height:2px;
        z-index:18;
        pointer-events:none;
        background:#7a7f87;
      }
      .moon-transition-line::before {
        content:"";
        position:absolute;
        left:2px;
        top:-4px;
        width:10px;
        height:10px;
        border-radius:50%;
        background:#7a7f87;
      }
      .history-line {
        position:absolute;
        left:0;
        right:0;
        height:2px;
        z-index:17;
        pointer-events:none;
        background:var(--history-color);
      }
      .history-line::before {
        content:"";
        position:absolute;
        left:2px;
        top:-4px;
        width:10px;
        height:10px;
        border-radius:50%;
        background:var(--history-color);
      }
      .history-label {
        position:absolute;
        right:4px;
        top:-11px;
        max-width:calc(100% - 16px);
        overflow:hidden;
        text-overflow:ellipsis;
        white-space:nowrap;
        padding:1px 6px;
        border-radius:8px;
        font-size:10px;
        line-height:16px;
        color:var(--primary-text-color);
        background:color-mix(in srgb,var(--history-color) 18%,var(--card-background-color));
        border:1px solid color-mix(in srgb,var(--history-color) 65%,var(--wp-border));
        pointer-events:auto;
        cursor:pointer;
      }
      .history-attributes {
        margin-top:12px;
        padding:10px;
        max-height:220px;
        overflow:auto;
        border:1px solid var(--wp-border);
        border-radius:8px;
        background:var(--primary-background-color);
        white-space:pre-wrap;
        font:11px/1.4 monospace;
      }
      .moon-transition-label {
        position:absolute;
        right:4px;
        top:-11px;
        display:flex;
        align-items:center;
        gap:4px;
        padding:1px 5px;
        border-radius:8px;
        font-size:10px;
        line-height:16px;
        color:var(--primary-text-color);
        background:color-mix(in srgb,#7a7f87 18%,var(--card-background-color));
        border:1px solid color-mix(in srgb,#7a7f87 65%,var(--wp-border));
        white-space:nowrap;
        cursor:help;
        pointer-events:auto;
      }
      .day { position:relative; border-right:1px solid var(--wp-border); }
      .day.today { background:color-mix(in srgb,var(--wp-accent) 5%,transparent); }
      .hour-line,.half-line { position:absolute; left:0; right:0; pointer-events:none; }
      .hour-line { border-top:1px solid var(--wp-border); }
      .half-line { border-top:1px dashed color-mix(in srgb,var(--wp-border) 58%,transparent); }
      .weather {
        position:absolute; left:5px; width:${WEATHER_WIDTH - 10}px; height:56px; padding:3px;
        border:none; display:flex; flex-direction:column; align-items:center; justify-content:center;
        z-index:8; border-radius:8px;
      }
      .weather .wi { font-size:21px; line-height:1; }
      .weather .wt { font-size:11px; margin-top:3px; }
      .weather.past { opacity:.52; }
      .energy-price {
        position:absolute;
        left:4px;
        width:46px;
        height:18px;
        padding:0 3px;
        border:1px solid color-mix(in srgb,var(--wp-accent) 28%,var(--wp-border));
        border-radius:6px;
        z-index:9;
        display:flex;
        align-items:center;
        justify-content:center;
        gap:2px;
        font-size:9px;
        line-height:16px;
        color:var(--primary-text-color);
        background:color-mix(in srgb,var(--wp-accent) 7%,var(--card-background-color));
        overflow:hidden;
        white-space:nowrap;
        cursor:pointer;
      }
      .energy-price.past { opacity:.52; }
      .energy-price .bolt { font-size:10px; }
      .events-layer {
        position:absolute; left:${WEATHER_WIDTH}px; right:4px; top:0; bottom:0; z-index:10;
        pointer-events:none;
      }
      .event {
        position:absolute; z-index:10; padding:5px 6px; pointer-events:auto;
        border:1px solid color-mix(in srgb,var(--event-color) 48%,var(--wp-border));
        border-left:4px solid var(--event-color); border-radius:7px;
        background:color-mix(in srgb,var(--event-color) 14%,var(--wp-card));
        overflow:hidden; cursor:pointer; text-align:left; min-height:25px;
      }
      .event.past { opacity:.38; }
      .event:hover { filter:brightness(1.05); }
      .event-main {
        display:flex;
        align-items:center;
        gap:5px;
        min-width:0;
      }
      .event-main .event-title {
        flex:1 1 auto;
        min-width:0;
      }
      .event-avatar {
        flex:0 0 auto;
        width:22px;
        height:22px;
        border-radius:50%;
        overflow:hidden;
        display:inline-flex;
        align-items:center;
        justify-content:center;
        background:color-mix(in srgb,var(--event-color) 15%,var(--wp-card));
      }
      .event-avatar.compact {
        width:18px;
        height:18px;
      }
      .event-avatar img {
        width:100%;
        height:100%;
        object-fit:cover;
        display:block;
      }
      .event-avatar ha-icon {
        --mdc-icon-size:16px;
        width:16px;
        height:16px;
        color:var(--event-color);
      }
      .event-title {
        font-size:12px; font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
      }
      .event-time { font-size:10px; color:var(--wp-muted); margin-top:2px; }
      .continuation { font-size:9px; color:var(--wp-muted); margin-top:2px; }
      .past-overlay {
        position:absolute; inset:0 0 auto 0; z-index:3; pointer-events:none;
        background:color-mix(in srgb,var(--primary-background-color) 18%,transparent);
      }
      .now-line {
        position:absolute; left:0; right:0; z-index:20; height:2px;
        background:var(--wp-accent); pointer-events:none;
      }
      .now-line::before {
        content:""; position:absolute; left:-5px; top:-4px; width:10px; height:10px;
        border-radius:50%; background:var(--wp-accent);
      }
      .now-label {
        position:absolute; right:3px; top:-10px; font-size:10px; color:white;
        background:var(--wp-accent); padding:1px 5px; border-radius:8px;
      }
      .settings-section { margin-top:18px; }
      .settings-label { display:block; font-size:13px; font-weight:500; margin-bottom:7px; }
      .settings-select {
        width:100%; color:var(--primary-text-color); background:var(--card-background-color);
        border:1px solid var(--wp-border); border-radius:9px; padding:9px 10px;
      }
      .settings-list {
        max-height:480px;
        overflow:auto;
        display:grid;
        gap:10px;
        border:none;
        border-radius:9px;
        padding:2px;
      }
      .settings-check {
        display:grid;
        grid-template-columns:auto minmax(180px,1.2fr) minmax(125px,.7fr) minmax(240px,1.4fr) auto;
        grid-template-areas:
          "enabled label display avatar color";
        align-items:center;
        gap:10px;
        padding:12px;
        border:1px solid var(--wp-border);
        border-radius:10px;
        background:color-mix(in srgb,var(--card-background-color) 94%,var(--wp-accent) 6%);
      }
      .settings-check .calendar-enabled { grid-area:enabled; }
      .settings-check .calendar-label {
        grid-area:label;
        display:flex;
        flex-direction:column;
        font-size:13px;
        cursor:pointer;
        min-width:0;
      }
      .settings-check .calendar-display-select { grid-area:display; }
      .settings-check .calendar-avatar-config { grid-area:avatar; }
      .settings-check .color-picker { grid-area:color; }
      .settings-check small {
        color:var(--wp-muted);
        margin-top:2px;
        overflow:hidden;
        text-overflow:ellipsis;
        white-space:nowrap;
      }
      .calendar-display-select {
        color:var(--primary-text-color); background:var(--card-background-color);
        border:1px solid var(--wp-border); border-radius:6px; padding:5px 6px; font-size:11px;
      }
      .calendar-avatar-config {
        display:grid;
        grid-template-columns:1fr;
        gap:5px;
        min-width:0;
      }
      .calendar-avatar-source,
      .calendar-avatar-entity,
      .calendar-icon-fallback {
        width:100%;
        min-width:0;
        color:var(--primary-text-color);
        background:var(--card-background-color);
        border:1px solid var(--wp-border);
        border-radius:6px;
        padding:5px 6px;
        font-size:11px;
      }
      .calendar-icon-picker-wrap {
        display:grid;
        gap:4px;
      }
      .calendar-icon-picker-wrap ha-icon-picker {
        width:100%;
      }
      .calendar-icon-fallback {
        display:none;
      }
      .calendar-icon-picker-wrap.no-native-picker .calendar-icon-fallback {
        display:block;
      }
      .hidden { display:none !important; }
      .color-picker { width:38px; height:30px; padding:0; border:1px solid var(--wp-border); border-radius:6px; background:none; }
      .weather-mode { display:flex; gap:12px; flex-wrap:wrap; }
      .option-row { display:flex; align-items:center; gap:7px; font-size:13px; margin:7px 0; }
      .settings-number {
        width:100%; color:var(--primary-text-color); background:var(--card-background-color);
        border:1px solid var(--wp-border); border-radius:9px; padding:9px 10px;
      }
      .weather-mode label { display:flex; gap:5px; align-items:center; font-size:13px; }
      .history-source-list {
        display:grid;
        gap:8px;
        margin-top:8px;
      }
      .history-source-row {
        display:grid;
        grid-template-columns:minmax(260px,1fr) auto auto;
        align-items:center;
        gap:8px;
        padding:9px;
        border:1px solid var(--wp-border);
        border-radius:9px;
      }
      .history-entity-picker {
        min-width:0;
      }
      .history-source-color {
        width:40px;
        height:32px;
        padding:0;
        border:1px solid var(--wp-border);
        border-radius:6px;
        background:none;
      }
      .history-remove {
        padding:6px 9px;
      }
      .settings-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:18px; }
      .primary-action { background:var(--wp-accent); color:white; border-color:var(--wp-accent); }
      dialog {
        color:var(--primary-text-color); background:var(--card-background-color);
        border:1px solid var(--wp-border); border-radius:14px; padding:0;
        max-width:980px; width:calc(100% - 32px); max-height:calc(100vh - 32px);
      }
      dialog::backdrop { background:rgba(0,0,0,.45); }
      .dialog-body { padding:18px; max-height:calc(100vh - 48px); overflow:auto; }
      .dialog-head { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; }
      .dialog-head h2 { margin:0 0 5px; font-size:19px; font-weight:500; }
      .settings-version {
        font-size:12px;
        font-weight:400;
        color:var(--wp-muted);
        white-space:nowrap;
      }
      .dialog-meta { color:var(--wp-muted); font-size:13px; margin-top:6px; white-space:pre-wrap; }
      .dialog-desc { margin-top:14px; white-space:pre-wrap; line-height:1.45; }
      .close { padding:5px 9px; }
      .calendar-chip {
        display:inline-flex; align-items:center; gap:6px; margin-top:8px;
        font-size:12px; color:var(--wp-muted);
      }
      .calendar-chip-dot { width:9px; height:9px; border-radius:50%; background:var(--calendar-color); }
      @media (max-width:900px) {
        .settings-check {
          grid-template-columns:auto minmax(0,1fr) auto;
          grid-template-areas:
            "enabled label color"
            ". display display"
            ". avatar avatar";
          align-items:start;
        }
      }
      @media (max-width:700px) {
        .toolbar { padding:7px 10px; }
        .toolbar h1 { font-size:17px; }
      }
    `;

    const hourLines = Array.from({ length:24 }, (_, h) => `
      <div class="hour-line" style="top:${h * HOUR_HEIGHT}px"></div>
      <div class="half-line" style="top:${h * HOUR_HEIGHT + HOUR_HEIGHT / 2}px"></div>
    `).join("");

    const timeLabels = Array.from({ length:24 }, (_, h) =>
      `<div class="time-label" style="top:${h * HOUR_HEIGHT}px">${String(h).padStart(2,"0")}:00</div>`
    ).join("");

    const dayHeaders = days.map((d, idx) => {
      const isToday = this._sameDate(d, now);
      const daily = dailyMap.get(this._dateKey(d));
      const daylight = this._daylightInfo(d);
      let dailyHtml = "";
      if ((mode === "daily" || mode === "both") && daily) {
        const high = daily.temperature != null ? `${Math.round(daily.temperature)}°` : "";
        const low = daily.templow != null ? `${Math.round(daily.templow)}°` : "";
        const daylightHtml = daylight
          ? `<span class="daylight-info" title="${this._escape(this._daylightTooltip(daylight))}"><span class="daylight-icon">☀️</span><span>${this._formatDaylightMinutes(daylight.daylightMinutes)}</span><span class="${daylight.increasing ? "gaining" : "losing"}">${this._formatDaylightDelta(daylight)}</span></span>`
          : "";
        dailyHtml = `
          <div class="day-summary">
            <button class="daily-weather" data-daily-weather="${encodeURIComponent(JSON.stringify(daily))}" data-day="${idx}" title="Dagsudsigt">
              <span class="dw-icon">${this._weatherIcon(daily.condition)}</span>
              <span class="dw-temp">${[high, low].filter(Boolean).join("/")}</span>
            </button>
            ${daylightHtml}
          </div>`;
      } else if (daylight) {
        dailyHtml = `
          <div class="day-summary">
            <span class="daylight-info" title="${this._escape(this._daylightTooltip(daylight))}"><span class="daylight-icon">☀️</span><span>${this._formatDaylightMinutes(daylight.daylightMinutes)}</span><span class="${daylight.increasing ? "gaining" : "losing"}">${this._formatDaylightDelta(daylight)}</span></span>
          </div>`;
      }
      const isWeekBoundary = this._showWeekBoundaryFor(d, idx);
      return `<div class="day-head ${isToday ? "today" : ""} ${isWeekBoundary ? "week-boundary" : ""}">
        <div>${this._formatDay(d)}</div>
        ${dailyHtml}
        ${isToday ? `<div class="today-dot">I DAG</div>` : ""}
      </div>`;
    }).join("");

    const ribbonDays = days.map((day, idx) => {
      const isToday = this._sameDate(day, now);
      const items = this._ribbonEvents(day).map(ev => {
        const color = this._calendarColor(ev.entityId);
        const isPast = ev.parsedEnd < now;
        const payload = encodeURIComponent(JSON.stringify({
          summary: ev.summary || "(uden titel)",
          start: ev.start,
          end: ev.end,
          description: ev.description || "",
          location: ev.location || "",
          entityId: ev.entityId,
          allDay: ev.allDay,
        }));
        return `<button class="ribbon-event ${isPast ? "past" : ""}" data-event="${payload}" style="--event-color:${color}" title="${this._escape(ev.summary || "")}">
          <span class="event-main">
            ${this._avatarHtml(ev.entityId, true)}
            <span class="event-title">${this._escape(ev.summary || "(uden titel)")}</span>
          </span>
        </button>`;
      }).join("");
      const isWeekBoundary = this._showWeekBoundaryFor(day, idx);
      return `<div class="ribbon-day ${isToday ? "today" : ""} ${isWeekBoundary ? "week-boundary" : ""}">${items}</div>`;
    }).join("");

    const dayBodies = days.map((day, idx) => {
      const isToday = this._sameDate(day, now);

      const solarLines = (() => {
        if (!this._config.show_sun_markers || !this._sunVisibleNow()) return "";
        const times = this._sunTimes?.[this._dateKey(day)];
        if (!times) return "";

        const lines = [];
        for (const [key, cssClass, icon, label] of [
          ["sunrise", "sunrise", "🌅", "Solopgang"],
          ["sunset", "sunset", "🌇", "Solnedgang"],
        ]) {
          if (!times[key]) continue;
          const dt = new Date(times[key]);
          if (Number.isNaN(dt.getTime())) continue;
          const y = this._minutes(dt) / 60 * HOUR_HEIGHT;
          lines.push(`
            <div class="solar-line ${cssClass}" style="top:${y}px">
              <span class="solar-label">${icon} ${label} ${this._formatTime(dt)}</span>
            </div>
          `);
        }
        return lines.join("");
      })();

      const moonTransitionLines = this._moonTransitionsForDay(day).map((item) => {
        const dt = new Date(item.datetime);
        const y = this._minutes(dt) / 60 * HOUR_HEIGHT;
        const tooltip = `Månefasen skifter til ${item.name} kl. ${this._formatTime(dt)}. Månen er herefter ${item.trend} frem mod næste faseskift.`;

        return `
          <div class="moon-transition-line" style="top:${y}px">
            <span class="moon-transition-label" title="${this._escape(tooltip)}">${item.icon} ${item.name} ${this._formatTime(dt)}</span>
          </div>
        `;
      }).join("");

      const historyLines = this._historyMarkersForDay(day).map((item) => {
        const y = this._minutes(item.datetime) / 60 * HOUR_HEIGHT;
        const payload = encodeURIComponent(JSON.stringify({
          entityId: item.entityId,
          friendlyName: item.friendlyName,
          state: item.state,
          rawState: item.rawState,
          previousState: item.previousState,
          triggerValue: item.triggerValue,
          datetime: item.datetime.toISOString(),
          attributes: item.attributes,
          previousAttributes: item.previousAttributes,
          lastChanged: item.lastChanged,
          lastUpdated: item.lastUpdated,
        }));

        return `
          <div class="history-line" style="top:${y}px;--history-color:${item.color}">
            <button class="history-label"
                    data-history-marker="${payload}"
                    style="--history-color:${item.color}"
                    title="${this._escape(`${item.friendlyName} · ${item.state}`)}">
              ${this._escape(item.friendlyName)} · ${this._escape(item.state)}
            </button>
          </div>
        `;
      }).join("");

      const weather = (mode === "hourly" || mode === "both")
        ? Array.from({ length:24 }, (_, h) => {
            const probe = new Date(day); probe.setHours(h,0,0,0);
            const w = hourlyMap.get(this._hourKey(probe));
            if (!w) return "";
            const isPast = isToday && probe < now;
            const temp = w.temperature == null ? "" : `${Math.round(w.temperature)}°`;
            return `<button class="weather ${isPast ? "past" : ""}" data-weather="${encodeURIComponent(JSON.stringify(w))}" data-hour="${h}" data-day="${idx}" style="top:${h * HOUR_HEIGHT + 3}px" title="${this._escape(`${this._formatDay(day)} ${String(h).padStart(2,"0")}:00 · ${w.condition || ""} · ${temp}`)}">
              <span class="wi">${this._weatherIcon(w.condition)}</span>
              <span class="wt">${temp}</span>
            </button>`;
          }).join("")
        : "";

      const energyPrices = (this._config.show_energy_prices && this._energyVisibleNow())
        ? Array.from({ length:24 }, (_, h) => {
            const probe = new Date(day);
            probe.setHours(h,0,0,0);
            const item = energyMap.get(this._hourKey(probe));
            if (!item) return "";

            const isPast = isToday && probe < now;
            const hasHourlyWeather = mode === "hourly" || mode === "both";
            const topOffset = hasHourlyWeather ? 57 : 28;
            const unit = this._energyUnitLabel();
            const payload = encodeURIComponent(JSON.stringify({
              datetime: item.datetime.toISOString(),
              price: item.price,
            }));
            const label = this._formatEnergyPrice(item.price);

            return `<button class="energy-price ${isPast ? "past" : ""}"
                      data-energy-price="${payload}"
                      style="top:${h * HOUR_HEIGHT + topOffset}px"
                      title="${this._escape(`${this._formatDay(day)} ${String(h).padStart(2,"0")}:00 · ${label}${unit ? ` ${unit}` : ""}`)}">
              <span class="bolt">⚡</span><span>${this._escape(label)}</span>
            </button>`;
          }).join("")
        : "";

      const events = this._dayEvents(day).map(ev => {
        const top = ev.startMinute / 60 * HOUR_HEIGHT;
        const height = Math.max(28, (ev.endMinute - ev.startMinute) / 60 * HOUR_HEIGHT - 3);
        const past = ev.originalEnd < now;
        const color = this._calendarColor(ev.entityId);
        const leftPct = (ev.column / ev.columns) * 100;
        const widthPct = 100 / ev.columns;
        const payload = encodeURIComponent(JSON.stringify({
          summary: ev.summary || "(uden titel)",
          start: ev.start,
          end: ev.end,
          description: ev.description || "",
          location: ev.location || "",
          entityId: ev.entityId,
        }));
        const displayStart = ev.continuesFromPreviousDay ? "00:00" : this._formatTime(ev.originalStart);
        const displayEnd = ev.continuesToNextDay ? "24:00" : this._formatTime(ev.originalEnd);
        const continuation = [
          ev.continuesFromPreviousDay ? "fortsætter fra dagen før" : "",
          ev.continuesToNextDay ? "fortsætter næste dag" : ""
        ].filter(Boolean).join(" · ");

        return `<button class="event ${past ? "past" : ""}" data-event="${payload}"
          style="top:${top}px;height:${height}px;left:calc(${leftPct}% + 2px);width:calc(${widthPct}% - 4px);--event-color:${color};">
          <div class="event-main">
            ${this._avatarHtml(ev.entityId)}
            <div class="event-title">${this._escape(ev.summary || "(uden titel)")}</div>
          </div>
          <div class="event-time">${displayStart}–${displayEnd}</div>
          ${continuation ? `<div class="continuation">${this._escape(continuation)}</div>` : ""}
        </button>`;
      }).join("");

      let nowBits = "";
      if (isToday) {
        const nowY = this._minutes(now) / 60 * HOUR_HEIGHT;
        nowBits = `
          <div class="past-overlay" style="height:${nowY}px"></div>
          <div class="now-line" style="top:${nowY}px"><span class="now-label">${this._formatTime(now)}</span></div>
        `;
      }

      const isWeekBoundary = this._showWeekBoundaryFor(day, idx);
      return `<div class="day ${isToday ? "today" : ""} ${isWeekBoundary ? "week-boundary" : ""}" data-day="${idx}">
        ${hourLines}${solarLines}${moonTransitionLines}${historyLines}${nowBits}${weather}${energyPrices}<div class="events-layer">${events}</div>
      </div>`;
    }).join("");

    this.shadowRoot.innerHTML = `
      <style>${styles}</style>
      <div class="root">
        <div>
          <div class="toolbar">
            <div>
              <h1>Week Planner</h1>
              <div class="sub">${this._weekLabel()}</div>
            </div>
            <div class="nav">
              <button id="configure" title="Skift vejr og kalendere">⚙ Konfigurer</button>
            ${this._config?.weather_display && this._config.weather_display !== "none"
              ? `<button id="toggleWeather" class="layer-toggle ${this._weatherVisibleNow() ? "active" : "off"}" title="Vis/skjul vejr">☁</button>`
              : ""}
            ${this._config?.show_sun_markers
              ? `<button id="toggleSun" class="layer-toggle ${this._sunVisibleNow() ? "active" : "off"}" title="Vis/skjul sol og dagslængde">☀</button>`
              : ""}
            ${this._config?.show_energy_prices && this._config?.energy_entity
              ? `<button id="toggleEnergy" class="layer-toggle ${this._energyVisibleNow() ? "active" : "off"}" title="Vis/skjul elpriser">⚡</button>`
              : ""}
              <button id="prev" aria-label="Forrige uge">‹</button>
              <button id="today">I dag</button>
              <button id="next" aria-label="Næste uge">›</button>
            </div>
          </div>
          ${this._error ? `<div class="error">${this._escape(this._error)}</div>` : ""}
          ${this._warnings.map(w => `<div class="warning">${this._escape(w)}</div>`).join("")}
          ${this._loading ? `<div class="loading">Opdaterer kalender og vejr…</div>` : ""}
        </div>
        <div class="planner-frame">
          <div class="header-scroll" id="headerScroll">
            <div class="header-grid" style="--wp-columns:64px ${columns}">
              <div class="corner"></div>
              ${dayHeaders}
              <div class="ribbon-corner"></div>
              ${ribbonDays}
            </div>
          </div>
          <div class="timeline-scroll" id="scroll">
            <div class="timeline-grid" style="--wp-columns:64px ${columns}">
              <div class="time-col">${hourLines}${timeLabels}</div>
              ${dayBodies}
            </div>
          </div>
        </div>
        <dialog id="detailDialog"><div class="dialog-body" id="dialogBody"></div></dialog>
      </div>
    `;

    this.shadowRoot.getElementById("configure")?.addEventListener("click", () => this._showSettings());
    this.shadowRoot.getElementById("toggleWeather")?.addEventListener("click", () => this._toggleSessionLayer("weather"));
    this.shadowRoot.getElementById("toggleSun")?.addEventListener("click", () => this._toggleSessionLayer("sun"));
    this.shadowRoot.getElementById("toggleEnergy")?.addEventListener("click", () => this._toggleSessionLayer("energy"));
    const headerScroll = this.shadowRoot.getElementById("headerScroll");
    const timelineScroll = this.shadowRoot.getElementById("scroll");
    if (headerScroll && timelineScroll) {
      timelineScroll.addEventListener("scroll", () => {
        if (this._scrollPositioned && Date.now() > this._programmaticScrollUntil) {
          this._savedScrollTop = timelineScroll.scrollTop;
          this._savedScrollLeft = timelineScroll.scrollLeft;
          this._scrollState = "manual";
          this._scrollRequestId++;
        }
        headerScroll.scrollLeft = timelineScroll.scrollLeft;
      }, { passive:true });
    }


    this.shadowRoot.getElementById("prev")?.addEventListener("click", async () => {
      this._weekStart = this._addDays(this._weekStart, -this._navigationStepDays());
      this._initialScrolled = true;
      await this._loadData();
      await this._setupCalendarSubscriptions();
    });
    this.shadowRoot.getElementById("next")?.addEventListener("click", async () => {
      this._weekStart = this._addDays(this._weekStart, this._navigationStepDays());
      this._initialScrolled = true;
      await this._loadData();
      await this._setupCalendarSubscriptions();
    });
    this.shadowRoot.getElementById("today")?.addEventListener("click", async () => {
      this._weekStart = this._startOfView(this._now());
      await this._loadData();
      await this._setupCalendarSubscriptions();
    });

    this.shadowRoot.querySelectorAll("[data-event]").forEach(el => {
      el.addEventListener("click", () => {
        try {
          this._showEvent(JSON.parse(decodeURIComponent(el.dataset.event)));
        } catch (err) {
          console.error("Week Planner event details failed", err);
          this._openDialog(`<div class="dialog-head"><div><h2>Event kunne ikke åbnes</h2><div class="dialog-meta">${this._escape(err?.message || err)}</div></div><button class="close" id="closeDialog">✕</button></div>`);
        }
      });
    });

    this.shadowRoot.querySelectorAll("[data-history-marker]").forEach((el) => {
      el.addEventListener("click", () => {
        try {
          const item = JSON.parse(decodeURIComponent(el.dataset.historyMarker));
          this._showHistoryMarker(item);
        } catch (err) {
          console.error("Week Planner history marker details failed", err);
        }
      });
    });

    this.shadowRoot.querySelectorAll("[data-energy-price]").forEach((el) => {
      el.addEventListener("click", () => {
        try {
          const item = JSON.parse(decodeURIComponent(el.dataset.energyPrice));
          this._showEnergyPrice(item);
        } catch (err) {
          console.error("Week Planner energy-price details failed", err);
        }
      });
    });

    this.shadowRoot.querySelectorAll("[data-weather]").forEach(el => {
      el.addEventListener("click", () => this._showWeather(JSON.parse(decodeURIComponent(el.dataset.weather)), el));
    });

    this.shadowRoot.querySelectorAll("[data-daily-weather]").forEach(el => {
      el.addEventListener("click", () => this._showDailyWeather(JSON.parse(decodeURIComponent(el.dataset.dailyWeather)), el));
    });

    const renderGeneration = ++this._renderGeneration;

    const settleAfterRender = (attempt = 0) => {
      const delays = [0, 50, 120, 240, 450, 800];

      setTimeout(() => {
        if (renderGeneration !== this._renderGeneration) return;

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (renderGeneration !== this._renderGeneration) return;

            this._applyViewportHeight();

            const scroll = this.shadowRoot.getElementById("scroll");
            const header = this.shadowRoot.getElementById("headerScroll");
            if (!scroll) return;

            const measurable =
              scroll.scrollHeight > 0 &&
              scroll.clientHeight > 0 &&
              scroll.scrollHeight > scroll.clientHeight;

            if (!measurable && attempt + 1 < delays.length) {
              settleAfterRender(attempt + 1);
              return;
            }

            if (this._scrollState === "manual") {
              // Manual means the user owns the viewport. Re-render only
              // restores that exact viewport and never recalculates it.
              if (this._savedScrollTop !== null) {
                this._programmaticScrollUntil = Date.now() + 300;
                scroll.scrollTop = Math.max(
                  0,
                  Math.min(
                    Math.max(0, scroll.scrollHeight - scroll.clientHeight),
                    this._savedScrollTop
                  )
                );
                scroll.scrollLeft = this._savedScrollLeft || 0;
                if (header) header.scrollLeft = scroll.scrollLeft;
              }
              return;
            }

            if (allowScroll && !this._loading) {
              // AUTO never restores an old browser scroll position after a
              // re-render. It re-evaluates the correct day focus from the
              // freshly laid-out timeline instead.
              this._scrollPositioned = false;
              this._savedScrollTop = null;
              this._positionScroll("post-render", true);
            }
          });
        });
      }, delays[Math.min(attempt, delays.length - 1)]);
    };

    settleAfterRender();
  }

  _scrollToConfiguredStart() {
    this._positionScroll("configured-start", true);
  }

  _showHistoryMarker(item) {
    const dt = new Date(item.datetime);
    const isAutomationTrigger = item.state === "triggered" && item.triggerValue;
    const stateText = isAutomationTrigger
      ? `<strong>Automation triggered</strong>`
      : item.previousState != null
        ? `${this._escape(item.previousState)} → <strong>${this._escape(item.state)}</strong>`
        : `<strong>${this._escape(item.state)}</strong>`;

    const triggerText = isAutomationTrigger
      ? `<div class="dialog-meta">last_triggered: ${this._escape(item.triggerValue)}</div>`
      : "";

    const attributesText = JSON.stringify(item.attributes || {}, null, 2);

    this._openDialog(`
      <div class="dialog-head">
        <div>
          <h2>${this._escape(item.friendlyName || item.entityId)}</h2>
          <div class="dialog-meta">${this._escape(item.entityId || "")}</div>
          <div class="dialog-meta">${this._escape(this._formatDateTime(dt))}</div>
        </div>
        <button class="close" id="closeDialog">✕</button>
      </div>
      <div class="dialog-desc">State: ${stateText}</div>${triggerText}
      ${item.lastChanged ? `<div class="dialog-meta">last_changed: ${this._escape(item.lastChanged)}</div>` : ""}
      ${item.lastUpdated ? `<div class="dialog-meta">last_updated: ${this._escape(item.lastUpdated)}</div>` : ""}
      <div class="settings-label" style="margin-top:14px">Attributes fra Home Assistant</div>
      <div class="history-attributes">${this._escape(attributesText)}</div>
    `);
  }

  _showEvent(ev) {
    const calendarName = this._hass?.states?.[ev.entityId]?.attributes?.friendly_name || ev.entityId;
    const color = this._calendarColor(ev.entityId);
    const allDay = ev.allDay || this._isAllDay(ev.start);

    let timeText;
    if (allDay) {
      const start = this._parseAllDayDate(ev.start);
      const exclusiveEnd = this._parseAllDayDate(ev.end);
      const lastDay = this._addDays(exclusiveEnd, -1);
      const fmt = new Intl.DateTimeFormat("da-DK", { weekday:"short", day:"numeric", month:"short" });
      timeText = this._sameDate(start, lastDay)
        ? `Hele dagen · ${fmt.format(start)}`
        : `Heldag · ${fmt.format(start)} – ${fmt.format(lastDay)}`;
    } else {
      const start = new Date(ev.start);
      const end = new Date(ev.end);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        throw new Error("Eventet indeholder en ugyldig start- eller sluttid.");
      }
      timeText = this._sameDate(start, end)
        ? `${this._formatDateTime(start)}–${this._formatTime(end)}`
        : `${this._formatDateTime(start)} → ${this._formatDateTime(end)}`;
    }

    this._openDialog(`
      <div class="dialog-head">
        <div>
          <h2>${this._escape(ev.summary)}</h2>
          <div class="dialog-meta">${this._escape(timeText)}</div>
          <div class="calendar-chip" style="--calendar-color:${color}">
            <span class="calendar-chip-dot"></span>
            <span>${this._escape(calendarName || "")}</span>
          </div>
        </div>
        <button class="close" id="closeDialog">✕</button>
      </div>
      ${ev.location ? `<div class="dialog-meta">📍 ${this._escape(ev.location)}</div>` : ""}
      ${ev.description ? `<div class="dialog-desc">${this._escape(ev.description)}</div>` : ""}
    `);
  }

  _daylightInfo(day) {
    if (!this._config?.show_sun_markers || !this._sunVisibleNow()) return null;

    const current = this._sunTimes?.[this._dateKey(day)];
    const previous = this._sunTimes?.[this._dateKey(this._addDays(day, -1))];
    const extrema = this._daylightExtrema?.[String(day.getFullYear())];

    if (!current?.sunrise || !current?.sunset || !extrema) return null;

    const sunrise = new Date(current.sunrise);
    const sunset = new Date(current.sunset);
    if (Number.isNaN(sunrise.getTime()) || Number.isNaN(sunset.getTime())) return null;

    const daylightMinutes = Math.round((sunset - sunrise) / 60000);

    let previousMinutes = null;
    if (previous?.sunrise && previous?.sunset) {
      const prevRise = new Date(previous.sunrise);
      const prevSet = new Date(previous.sunset);
      if (!Number.isNaN(prevRise.getTime()) && !Number.isNaN(prevSet.getTime())) {
        previousMinutes = Math.round((prevSet - prevRise) / 60000);
      }
    }

    // The previous day is used only to determine whether daylight is currently
    // increasing or decreasing. The displayed difference is relative to the
    // year's calculated shortest/longest day.
    const increasing = previousMinutes == null
      ? true
      : daylightMinutes >= previousMinutes;

    const referenceMinutes = increasing
      ? extrema.min_minutes
      : extrema.max_minutes;

    return {
      daylightMinutes,
      increasing,
      seasonalDeltaMinutes: referenceMinutes == null
        ? null
        : daylightMinutes - referenceMinutes,
    };
  }

  _formatDaylightMinutes(totalMinutes) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = Math.abs(totalMinutes % 60);
    return `${hours}:${String(minutes).padStart(2, "0")}`;
  }

  _daylightTooltip(info) {
    if (!info) return "";

    const length = this._formatDaylightMinutes(info.daylightMinutes);
    if (info.seasonalDeltaMinutes == null) {
      return `Dagens længde er ${length}.`;
    }

    const absolute = Math.abs(info.seasonalDeltaMinutes);
    const hours = Math.floor(absolute / 60);
    const minutes = absolute % 60;
    const deltaText = hours > 0
      ? `${hours}:${String(minutes).padStart(2, "0")} timer`
      : `${minutes} minutter`;

    if (absolute === 0) {
      return `Dagens længde er ${length}. Dagen er ved årets ${info.increasing ? "korteste" : "længste"} niveau.`;
    }

    return info.increasing
      ? `Dagens længde er ${length}. Dagen er tiltaget med ${deltaText} siden årets korteste dag.`
      : `Dagens længde er ${length}. Dagen er aftaget med ${deltaText} siden årets længste dag.`;
  }

  _formatDaylightDelta(info) {
    if (!info || info.seasonalDeltaMinutes == null) return "";

    const absolute = Math.abs(info.seasonalDeltaMinutes);
    const hours = Math.floor(absolute / 60);
    const minutes = absolute % 60;
    const amount = hours > 0
      ? `${hours}:${String(minutes).padStart(2, "0")}`
      : `${minutes} min`;

    if (absolute === 0) return "±0";
    return `${info.increasing ? "+" : "−"}${amount}`;
  }

  _moonTransitionsForDay(day) {
    const dayStart = new Date(day);
    dayStart.setHours(0,0,0,0);
    const dayEnd = this._addDays(dayStart, 1);

    return (this._moonTransitions || []).filter((item) => {
      const dt = new Date(item.datetime);
      return !Number.isNaN(dt.getTime()) && dt >= dayStart && dt < dayEnd;
    });
  }

  _energyState() {
    const entityId = this._config?.energy_entity || "";
    return entityId ? this._hass?.states?.[entityId] : null;
  }

  _energyUnitLabel() {
    const state = this._energyState();
    if (!state) return "";
    const attrs = state.attributes || {};
    const native = attrs.unit_of_measurement || "";
    if (native) return native;

    const currency = attrs.currency || "";
    const unit = attrs.unit || "";
    if (currency && unit) return `${currency}/${unit}`;
    return currency || unit || "";
  }

  _parseEnergyObject(entry) {
    if (!entry || typeof entry !== "object") return null;

    const rawTime =
      entry.hour
      ?? entry.time
      ?? entry.datetime
      ?? entry.start
      ?? entry.timestamp
      ?? entry.date;

    const rawPrice =
      entry.price
      ?? entry.value
      ?? entry.rate
      ?? entry.cost;

    if (rawTime == null || rawPrice == null) return null;

    const dt = new Date(rawTime);
    const price = Number(rawPrice);
    if (Number.isNaN(dt.getTime()) || !Number.isFinite(price)) return null;

    return { datetime: dt, price };
  }

  _energyPriceEntries() {
    if (!this._config?.show_energy_prices || !this._energyVisibleNow()) return [];
    const state = this._energyState();
    if (!state) return [];

    const attrs = state.attributes || {};
    const byHour = new Map();

    const addObjects = (items, overwrite = true) => {
      if (!Array.isArray(items)) return;
      for (const item of items) {
        const parsed = this._parseEnergyObject(item);
        if (!parsed) continue;
        const key = this._hourKey(parsed.datetime);
        if (overwrite || !byHour.has(key)) byHour.set(key, parsed);
      }
    };

    // Forecast first; real today/tomorrow data then overrides matching hours.
    addObjects(attrs.forecast, false);
    addObjects(attrs.prices, false);
    addObjects(attrs.raw_today, true);
    addObjects(attrs.raw_tomorrow, true);

    // Generic simple arrays: index 0 = 00:00–01:00.
    const addSimpleDay = (items, baseDate) => {
      if (!Array.isArray(items)) return;
      items.forEach((rawPrice, hour) => {
        const price = Number(rawPrice);
        if (!Number.isFinite(price)) return;
        const dt = new Date(baseDate);
        dt.setHours(hour, 0, 0, 0);
        const key = this._hourKey(dt);
        if (!byHour.has(key)) byHour.set(key, { datetime: dt, price });
      });
    };

    const today = this._now();
    today.setHours(0,0,0,0);
    addSimpleDay(attrs.today, today);
    addSimpleDay(attrs.tomorrow, this._addDays(today, 1));

    return [...byHour.values()].sort((a,b) => a.datetime - b.datetime);
  }

  _energyPriceMap() {
    const map = new Map();
    for (const item of this._energyPriceEntries()) {
      map.set(this._hourKey(item.datetime), item);
    }
    return map;
  }

  _energyCompatibility() {
    const entityId = this._config?.energy_entity || "";
    if (!entityId) return { ok:false, text:"Ingen sensor valgt." };

    const state = this._hass?.states?.[entityId];
    if (!state) return { ok:false, text:"Entity findes ikke i Home Assistant." };

    const attrs = state.attributes || {};
    const objectArrays = ["raw_today", "raw_tomorrow", "forecast", "prices"]
      .filter((key) => Array.isArray(attrs[key]) && attrs[key].some((x) => this._parseEnergyObject(x)));

    const simpleArrays = ["today", "tomorrow"]
      .filter((key) => Array.isArray(attrs[key]) && attrs[key].some((x) => Number.isFinite(Number(x))));

    if (objectArrays.length || simpleArrays.length) {
      return {
        ok:true,
        text:`Kompatibel · fundet ${[...objectArrays, ...simpleArrays].join(", ")}`,
      };
    }

    return {
      ok:false,
      text:"Ingen understøttet timepris-attribut fundet. Forventet fx raw_today/raw_tomorrow/forecast eller today/tomorrow.",
    };
  }

  _formatEnergyPrice(value) {
    if (!Number.isFinite(Number(value))) return "";
    const num = Number(value);
    const decimals = Math.abs(num) >= 10 ? 2 : 3;
    return num.toLocaleString("da-DK", {
      minimumFractionDigits: 0,
      maximumFractionDigits: decimals,
    });
  }

  _showEnergyPrice(item) {
    const state = this._energyState();
    const entityId = this._config?.energy_entity || "";
    const name = state?.attributes?.friendly_name || entityId;
    const unit = this._energyUnitLabel();
    const dt = new Date(item.datetime);

    this._openDialog(`
      <div class="dialog-head">
        <div>
          <h2>⚡ ${this._escape(name || "Elpris")}</h2>
          <div class="dialog-meta">${this._escape(this._formatDateTime(dt))}</div>
        </div>
        <button class="close" id="closeDialog">✕</button>
      </div>
      <div class="dialog-desc"><strong>${this._escape(this._formatEnergyPrice(item.price))}${unit ? ` ${this._escape(unit)}` : ""}</strong></div>
      <div class="dialog-meta">${this._escape(entityId)}</div>
    `);
  }

  _weatherDetails(w) {
    return [
      w.temperature != null ? `Temperatur: ${w.temperature}°` : "",
      w.templow != null ? `Laveste temperatur: ${w.templow}°` : "",
      w.precipitation_probability != null ? `Nedbør: ${w.precipitation_probability}%` : "",
      w.precipitation != null ? `Nedbørsmængde: ${w.precipitation}` : "",
      w.wind_speed != null ? `Vind: ${w.wind_speed}` : "",
      w.humidity != null ? `Luftfugtighed: ${w.humidity}%` : "",
    ].filter(Boolean).join("\n");
  }

  _showWeather(w, el) {
    const dayIdx = Number(el.dataset.day);
    const hour = Number(el.dataset.hour);
    const day = this._addDays(this._weekStart, dayIdx);
    const sourceName = this._hass?.states?.[this._config.weather_entity]?.attributes?.friendly_name || this._config.weather_entity;

    this._openDialog(`
      <div class="dialog-head">
        <div>
          <h2>${this._weatherIcon(w.condition)} ${this._escape(w.condition || "Vejr")}</h2>
          <div class="dialog-meta">${this._escape(this._formatDay(day))} kl. ${String(hour).padStart(2,"0")}:00\n${this._escape(sourceName || "")}</div>
        </div>
        <button class="close" id="closeDialog">✕</button>
      </div>
      <div class="dialog-desc">${this._escape(this._weatherDetails(w))}</div>
    `);
  }

  _showDailyWeather(w, el) {
    const dayIdx = Number(el.dataset.day);
    const day = this._addDays(this._weekStart, dayIdx);
    const sourceName = this._hass?.states?.[this._config.weather_entity]?.attributes?.friendly_name || this._config.weather_entity;

    this._openDialog(`
      <div class="dialog-head">
        <div>
          <h2>${this._weatherIcon(w.condition)} Dagsudsigt</h2>
          <div class="dialog-meta">${this._escape(this._formatDay(day))}\n${this._escape(sourceName || "")}</div>
        </div>
        <button class="close" id="closeDialog">✕</button>
      </div>
      <div class="dialog-desc">${this._escape(this._weatherDetails(w))}</div>
    `);
  }

  _closeSettingsDialog() {
    const dialog = this.shadowRoot.getElementById("detailDialog");
    if (dialog?.open) dialog.close();

    this._settingsOpen = false;

    if (this._renderPendingWhileSettingsOpen) {
      this._renderPendingWhileSettingsOpen = false;
      this._render(false);
    }
  }

  _showSettings() {
    this._settingsOpen = true;
    this._renderPendingWhileSettingsOpen = false;

    const weatherEntities = Object.values(this._hass?.states || {})
      .filter((s) => s.entity_id.startsWith("weather."))
      .sort((a,b) => (a.attributes?.friendly_name || a.entity_id).localeCompare(b.attributes?.friendly_name || b.entity_id));

    const calendarEntities = Object.values(this._hass?.states || {})
      .filter((s) => s.entity_id.startsWith("calendar."))
      .sort((a,b) => (a.attributes?.friendly_name || a.entity_id).localeCompare(b.attributes?.friendly_name || b.entity_id));

    const selectedCalendars = new Set(this._config.calendar_entities || []);
    const currentColors = this._config.calendar_colors || {};
    const currentDisplayModes = this._config.calendar_display_modes || {};
    const currentAvatars = this._config.calendar_avatars || {};
    const currentHistorySources = this._config.history_sources || [];
    const showEnergyPrices = this._config.show_energy_prices ?? false;
    const energyEntity = this._config.energy_entity || "";
    const currentMode = this._config.weather_display || "both";
    const showWeekNumber = this._config.show_week_number ?? true;
    const defaultScrollHour = Number(this._config.default_scroll_hour ?? 6);
    const scrollMode = this._config.scroll_mode || "fixed";
    const showSunMarkers = this._config.show_sun_markers ?? true;
    const showMoonMarkers = this._config.show_moon_markers ?? false;
    const enlargeToday = this._config.enlarge_today ?? true;
    const viewMode = this._config.view_mode || "week";

    const weatherOptions = weatherEntities.map((s) => {
      const selected = s.entity_id === this._config.weather_entity ? "selected" : "";
      const label = s.attributes?.friendly_name || s.entity_id;
      return `<option value="${this._escape(s.entity_id)}" ${selected}>${this._escape(label)} · ${this._escape(s.entity_id)}</option>`;
    }).join("");

    const avatarEntities = Object.values(this._hass?.states || {})
      .filter((s) =>
        s.entity_id.startsWith("person.")
        || Boolean(s.attributes?.entity_picture)
        || Boolean(s.attributes?.icon)
      )
      .sort((a, b) => {
        const aPerson = a.entity_id.startsWith("person.") ? 0 : 1;
        const bPerson = b.entity_id.startsWith("person.") ? 0 : 1;
        if (aPerson !== bPerson) return aPerson - bPerson;
        return (a.attributes?.friendly_name || a.entity_id)
          .localeCompare(b.attributes?.friendly_name || b.entity_id);
      });

    const avatarSourceFor = (calendarEntityId) => {
      const value = currentAvatars[calendarEntityId] || "";
      if (!value) return "none";
      return value.startsWith("mdi:") ? "icon" : "entity";
    };

    const avatarEntityOptionsFor = (calendarEntityId) => {
      const selected = currentAvatars[calendarEntityId] || "";
      return [
        `<option value="">Vælg HA-entity/avatar…</option>`,
        ...avatarEntities.map((entity) => {
          const label = entity.attributes?.friendly_name || entity.entity_id;
          const suffix = entity.attributes?.entity_picture
            ? " · billede"
            : entity.attributes?.icon
              ? ` · ${entity.attributes.icon}`
              : "";
          return `<option value="${this._escape(entity.entity_id)}" ${selected === entity.entity_id ? "selected" : ""}>${this._escape(label)}${this._escape(suffix)}</option>`;
        }),
      ].join("");
    };

    const calendarChecks = calendarEntities.map((s) => {
      const checked = selectedCalendars.has(s.entity_id) ? "checked" : "";
      const label = s.attributes?.friendly_name || s.entity_id;
      const color = /^#[0-9a-fA-F]{6}$/.test(currentColors[s.entity_id] || "")
        ? currentColors[s.entity_id]
        : this._defaultColor(s.entity_id);
      return `
        <div class="settings-check">
          <input class="calendar-enabled" id="cal-${this._escape(s.entity_id)}" type="checkbox" value="${this._escape(s.entity_id)}" ${checked}>
          <label class="calendar-label" for="cal-${this._escape(s.entity_id)}">
            <span>${this._escape(label)}</span>
            <small>${this._escape(s.entity_id)}</small>
          </label>
          <select class="calendar-display-select" data-display-entity="${this._escape(s.entity_id)}" title="Placering">
            <option value="auto" ${(currentDisplayModes[s.entity_id] || "auto") === "auto" ? "selected" : ""}>Auto</option>
            <option value="ribbon" ${currentDisplayModes[s.entity_id] === "ribbon" ? "selected" : ""}>Ribbon</option>
            <option value="timeline" ${currentDisplayModes[s.entity_id] === "timeline" ? "selected" : ""}>Tidsgrid</option>
          </select>
          <div class="calendar-avatar-config" data-avatar-config="${this._escape(s.entity_id)}">
            <select class="calendar-avatar-source" data-avatar-source="${this._escape(s.entity_id)}" title="Event-ikon/avatar type">
              <option value="none" ${avatarSourceFor(s.entity_id) === "none" ? "selected" : ""}>Intet</option>
              <option value="entity" ${avatarSourceFor(s.entity_id) === "entity" ? "selected" : ""}>HA-entity/avatar</option>
              <option value="icon" ${avatarSourceFor(s.entity_id) === "icon" ? "selected" : ""}>MDI-ikon</option>
            </select>

            <select class="calendar-avatar-entity ${avatarSourceFor(s.entity_id) === "entity" ? "" : "hidden"}"
                    data-avatar-entity="${this._escape(s.entity_id)}"
                    title="Vælg HA-entity/avatar">
              ${avatarEntityOptionsFor(s.entity_id)}
            </select>

            <div class="calendar-icon-picker-wrap ${avatarSourceFor(s.entity_id) === "icon" ? "" : "hidden"}"
                 data-icon-wrap="${this._escape(s.entity_id)}">
              <ha-icon-picker
                data-icon-picker="${this._escape(s.entity_id)}"
                value="${this._escape((currentAvatars[s.entity_id] || "").startsWith("mdi:") ? currentAvatars[s.entity_id] : "")}"
                label="Vælg MDI-ikon">
              </ha-icon-picker>
              <input class="calendar-icon-fallback"
                     data-icon-fallback="${this._escape(s.entity_id)}"
                     type="text"
                     value="${this._escape((currentAvatars[s.entity_id] || "").startsWith("mdi:") ? currentAvatars[s.entity_id] : "")}"
                     placeholder="mdi:account"
                     title="Fallback: skriv et MDI-ikon manuelt">
            </div>
          </div>
          <input class="color-picker" type="color" value="${color}" data-color-entity="${this._escape(s.entity_id)}" title="Kalenderfarve">
        </div>`;
    }).join("");

    this._openDialog(`
      <div class="dialog-head">
        <div>
          <h2>Konfigurer Week Planner <span class="settings-version">(v${this._escape(this._config?.version || "?")})</span></h2>
          <div class="dialog-meta">Vælg vejrvisning, vejrkilde, kalendere og farve for hver kalender.</div>
        </div>
        <button class="close" id="closeDialog">✕</button>
      </div>

      <div class="settings-section">
        <div class="settings-label">Vejrvisning</div>
        <div class="weather-mode">
          <label><input type="radio" name="weatherMode" value="none" ${currentMode === "none" ? "checked" : ""}> Ingen</label>
          <label><input type="radio" name="weatherMode" value="hourly" ${currentMode === "hourly" ? "checked" : ""}> Time</label>
          <label><input type="radio" name="weatherMode" value="daily" ${currentMode === "daily" ? "checked" : ""}> Dag</label>
          <label><input type="radio" name="weatherMode" value="both" ${currentMode === "both" ? "checked" : ""}> Begge</label>
        </div>
      </div>

      <div class="settings-section">
        <label class="settings-label" for="weatherSelect">Vejrkilde</label>
        <select id="weatherSelect" class="settings-select">${weatherOptions}</select>
      </div>

      <div class="settings-section">
        <div class="settings-label">Kalendere</div><div class="dialog-meta">Aktivér kalenderen og vælg visning, event-identitet og farve pr. kalender.</div>
        <div class="settings-list" id="calendarList">
          ${calendarChecks || `<div class="dialog-meta">Ingen calendar.* entities fundet.</div>`}
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-label">Kalenderperiode</div>
        <div class="weather-mode">
          <label><input type="radio" name="viewMode" value="week" ${viewMode === "week" ? "checked" : ""}> Kalenderuge (man–søn)</label>
          <label><input type="radio" name="viewMode" value="rolling" ${viewMode === "rolling" ? "checked" : ""}> I dag + 6 dage</label>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-label">Visning</div>
        <label class="option-row"><input id="showWeekNumber" type="checkbox" ${showWeekNumber ? "checked" : ""}> Vis ugenummer</label>
        <label class="option-row"><input id="showSunMarkers" type="checkbox" ${showSunMarkers ? "checked" : ""}> Vis solopgang/solnedgang i tidskolonnen</label>
        <label class="option-row"><input id="showMoonMarkers" type="checkbox" ${showMoonMarkers ? "checked" : ""}> Vis månefaseskift</label>
        <label class="option-row"><input id="enlargeToday" type="checkbox" ${enlargeToday ? "checked" : ""}> Gør dagens kolonne 50% bredere</label>
        <div class="settings-label" style="margin-top:12px">Tidsfokus</div>
        <div class="weather-mode">
          <label><input type="radio" name="scrollMode" value="none" ${scrollMode === "none" ? "checked" : ""}> Ingen auto-scroll</label>
          <label><input type="radio" name="scrollMode" value="fixed" ${scrollMode === "fixed" ? "checked" : ""}> Scroll til angivet time</label>
          <label><input type="radio" name="scrollMode" value="follow_now" ${scrollMode === "follow_now" ? "checked" : ""}> Følg NU</label>
        </div>
        <div id="fixedScrollHourRow">
          <label class="settings-label" for="defaultScrollHour" style="margin-top:12px">Første synlige time ved åbning</label>
          <input id="defaultScrollHour" class="settings-number" type="number" min="0" max="23" step="1" value="${defaultScrollHour}">
        </div>
        <div class="dialog-meta" style="margin-top:6px">Scroll til angivet time og Følg NU placerer måltidspunktet så højt i tidsgrid’et som muligt. Følg NU justerer igen ved hvert hele klokkeslæt. Ingen auto-scroll flytter aldrig tidsgrid’et automatisk.</div>
      </div>

      <div class="settings-section">
        <div class="settings-label">Elpris</div>
        <div class="dialog-meta">Valgfri datakilde. Vælg en Home Assistant sensor med timepriser. Week Planner understøtter timestamp/pris-data som fx raw_today, raw_tomorrow og forecast samt simple today/tomorrow-arrays.</div>
        <label class="option-row"><input id="showEnergyPrices" type="checkbox" ${showEnergyPrices ? "checked" : ""}> Vis elpris pr. time</label>
        <ha-entity-picker id="energyEntityPicker"></ha-entity-picker>
        <div id="energyCompatibility" class="dialog-meta" style="margin-top:6px"></div>
      </div>

      <div class="settings-section">
        <div class="settings-label">Historikmarkører</div>
        <div class="dialog-meta">Valgfri datakilde. Tom liste = ingen historik hentes. Data læses direkte fra Home Assistants Recorder/history for de viste 7 dage.</div>
        <div id="historySourceList" class="history-source-list"></div>
        <button id="addHistorySource" type="button" style="margin-top:8px">＋ Tilføj entity</button>
      </div>

      <div class="settings-actions">
        <button id="cancelSettings">Annuller</button>
        <button id="saveSettings" class="primary-action">Gem</button>
      </div>
      <div id="settingsStatus" class="dialog-meta" aria-live="polite"></div>
    `);

    const dialog = this.shadowRoot.getElementById("detailDialog");
    const body = this.shadowRoot.getElementById("dialogBody");
    body?.querySelector("#cancelSettings")?.addEventListener("click", () => this._closeSettingsDialog());

    const updateScrollModeVisibility = () => {
      const mode = body?.querySelector('input[name="scrollMode"]:checked')?.value || "fixed";
      body?.querySelector("#fixedScrollHourRow")?.classList.toggle("hidden", mode !== "fixed");
    };
    body?.querySelectorAll('input[name="scrollMode"]').forEach((el) => {
      el.addEventListener("change", updateScrollModeVisibility);
    });
    updateScrollModeVisibility();

    // Configure avatar type controls.
    body?.querySelectorAll("[data-avatar-source]").forEach((sourceEl) => {
      const calendarId = sourceEl.dataset.avatarSource;
      const updateVisibility = () => {
        const source = sourceEl.value;
        body.querySelector(`[data-avatar-entity="${calendarId}"]`)?.classList.toggle("hidden", source !== "entity");
        body.querySelector(`[data-icon-wrap="${calendarId}"]`)?.classList.toggle("hidden", source !== "icon");
      };
      sourceEl.addEventListener("change", updateVisibility);
      updateVisibility();
    });

    // Use Home Assistant's native icon picker when it is registered by the frontend.
    // It searches the complete MDI icon set known by this HA frontend.
    body?.querySelectorAll("[data-icon-picker]").forEach((picker) => {
      const calendarId = picker.dataset.iconPicker;
      const current = currentAvatars[calendarId] || "";
      picker.value = current.startsWith("mdi:") ? current : "";
      picker.configValue = "icon";

      const wrap = body.querySelector(`[data-icon-wrap="${calendarId}"]`);
      if (!customElements.get("ha-icon-picker")) {
        wrap?.classList.add("no-native-picker");
      }

      picker.addEventListener("value-changed", (ev) => {
        const value = ev.detail?.value ?? picker.value ?? "";
        picker.value = value;
        const fallback = body.querySelector(`[data-icon-fallback="${calendarId}"]`);
        if (fallback) fallback.value = value;
      });
    });

    const energyPicker = body?.querySelector("#energyEntityPicker");
    const energyCompatibility = body?.querySelector("#energyCompatibility");
    let selectedEnergyEntity = energyEntity;

    const updateEnergyCompatibility = () => {
      const oldEntity = this._config.energy_entity;
      this._config.energy_entity = selectedEnergyEntity;
      const info = this._energyCompatibility();
      this._config.energy_entity = oldEntity;

      if (energyCompatibility) {
        energyCompatibility.textContent = selectedEnergyEntity ? info.text : "Ingen sensor valgt.";
        energyCompatibility.style.color = info.ok ? "var(--success-color, #2e7d32)" : "var(--wp-muted)";
      }
    };

    if (energyPicker) {
      energyPicker.hass = this._hass;
      energyPicker.value = energyEntity || undefined;
      energyPicker.includeDomains = ["sensor"];
      energyPicker.allowCustomEntity = false;

      const rememberEnergyEntity = (event) => {
        selectedEnergyEntity = String(
          event?.detail?.value
          ?? event?.target?.value
          ?? energyPicker.value
          ?? ""
        ).trim();
        energyPicker.value = selectedEnergyEntity || undefined;
        updateEnergyCompatibility();
      };

      energyPicker.addEventListener("value-changed", rememberEnergyEntity);
      energyPicker.addEventListener("change", rememberEnergyEntity);
      energyPicker.addEventListener("input", rememberEnergyEntity);
    }
    updateEnergyCompatibility();

    const historyList = body?.querySelector("#historySourceList");
    const makeHistoryRow = (source = { entity_id:"", color:"#7f858d" }) => {
      const row = document.createElement("div");
      row.className = "history-source-row";
      row.innerHTML = `
        <ha-entity-picker class="history-entity-picker"></ha-entity-picker>
        <input class="history-source-color" type="color" value="${this._escape(source.color || "#7f858d")}" title="Farve">
        <button class="history-remove" type="button" title="Fjern">✕</button>
      `;

      const picker = row.querySelector("ha-entity-picker");
      if (picker) {
        picker.hass = this._hass;
        picker.value = source.entity_id || "";
        picker.allowCustomEntity = false;
        row.dataset.entityId = source.entity_id || "";

        const rememberEntity = (event) => {
          const selected =
            event?.detail?.value
            ?? event?.target?.value
            ?? picker.value
            ?? "";
          picker.value = selected || undefined;
          row.dataset.entityId = selected || "";
        };

        picker.addEventListener("value-changed", rememberEntity);
        picker.addEventListener("change", rememberEntity);
        picker.addEventListener("input", rememberEntity);
      }

      row.querySelector(".history-remove")?.addEventListener("click", () => row.remove());
      return row;
    };

    if (historyList) {
      for (const source of currentHistorySources) {
        historyList.appendChild(makeHistoryRow(source));
      }
    }

    body?.querySelector("#addHistorySource")?.addEventListener("click", () => {
      historyList?.appendChild(makeHistoryRow());
    });

    body?.querySelector("#saveSettings")?.addEventListener("click", async () => {
      const weather = body.querySelector("#weatherSelect")?.value;
      const calendars = [...body.querySelectorAll(".calendar-enabled:checked")].map(el => el.value);
      const weatherDisplay = body.querySelector('input[name="weatherMode"]:checked')?.value || "both";
      const calendarColors = {};
      body.querySelectorAll("[data-color-entity]").forEach((el) => {
        calendarColors[el.dataset.colorEntity] = el.value;
      });
      const calendarDisplayModes = {};
      body.querySelectorAll("[data-display-entity]").forEach((el) => {
        calendarDisplayModes[el.dataset.displayEntity] = el.value;
      });
      const calendarAvatars = {};
      body.querySelectorAll("[data-avatar-source]").forEach((sourceEl) => {
        const calendarId = sourceEl.dataset.avatarSource;
        const source = sourceEl.value;

        if (source === "entity") {
          const entityValue = body.querySelector(`[data-avatar-entity="${calendarId}"]`)?.value || "";
          if (entityValue) calendarAvatars[calendarId] = entityValue;
          return;
        }

        if (source === "icon") {
          const picker = body.querySelector(`[data-icon-picker="${calendarId}"]`);
          const fallback = body.querySelector(`[data-icon-fallback="${calendarId}"]`);
          let iconValue = picker?.value || fallback?.value || "";
          iconValue = String(iconValue).trim();

          if (iconValue && !iconValue.startsWith("mdi:")) {
            iconValue = `mdi:${iconValue}`;
          }
          if (iconValue) calendarAvatars[calendarId] = iconValue;
        }
      });
      const historySources = [];
      let invalidHistoryRow = false;
      body.querySelectorAll(".history-source-row").forEach((row) => {
        const picker = row.querySelector("ha-entity-picker");
        const entityId = String(
          row.dataset.entityId
          || picker?.value
          || picker?.getAttribute?.("value")
          || ""
        ).trim();
        const color = row.querySelector(".history-source-color")?.value || "#7f858d";

        if (entityId) {
          historySources.push({ entity_id: entityId, color });
        } else if (picker) {
          invalidHistoryRow = true;
        }
      });

      const newShowEnergyPrices = body.querySelector("#showEnergyPrices")?.checked ?? false;
      const newEnergyEntity = String(
        selectedEnergyEntity
        || body.querySelector("#energyEntityPicker")?.value
        || ""
      ).trim();

      const newShowWeekNumber = body.querySelector("#showWeekNumber")?.checked ?? true;
      const newShowSunMarkers = body.querySelector("#showSunMarkers")?.checked ?? true;
      const newShowMoonMarkers = body.querySelector("#showMoonMarkers")?.checked ?? false;
      const newEnlargeToday = body.querySelector("#enlargeToday")?.checked ?? true;
      const newViewMode = body.querySelector('input[name="viewMode"]:checked')?.value || "week";
      const newDefaultScrollHour = Math.min(23, Math.max(0, Number(body.querySelector("#defaultScrollHour")?.value ?? 6)));
      const newScrollMode = body.querySelector('input[name="scrollMode"]:checked')?.value || "fixed";
      const status = body.querySelector("#settingsStatus");

      if (invalidHistoryRow) {
        if (status) status.textContent = "En historikrække mangler en læsbar entity. Vælg entity igen eller fjern rækken.";
        return;
      }

      if (newShowEnergyPrices && !newEnergyEntity) {
        if (status) status.textContent = "Vælg en elpris-sensor eller slå elprisvisning fra.";
        return;
      }

      if (!weather && weatherDisplay !== "none") {
        if (status) status.textContent = "Vælg en vejrkilde eller sæt vejrvisning til Ingen.";
        return;
      }

      if (status) status.textContent = "Gemmer…";
      try {
        const saveResult = await this._hass.callWS({
          type: "week_planner/update_config",
          weather_entity: weather,
          calendar_entities: calendars,
          calendar_colors: calendarColors,
          calendar_display_modes: calendarDisplayModes,
          calendar_avatars: calendarAvatars,
          history_sources: historySources,
          energy_entity: newEnergyEntity,
          show_energy_prices: newShowEnergyPrices,
          weather_display: weatherDisplay,
          show_week_number: newShowWeekNumber,
          default_scroll_hour: newDefaultScrollHour,
          scroll_mode: newScrollMode,
          show_sun_markers: newShowSunMarkers,
          show_moon_markers: newShowMoonMarkers,
          enlarge_today: newEnlargeToday,
          view_mode: newViewMode,
        });

        if (!saveResult?.success || !saveResult?.config) {
          throw new Error("Home Assistant bekræftede ikke den gemte konfiguration.");
        }

        const persistedConfig = saveResult.config;
        const modeChanged = this._config.view_mode !== persistedConfig.view_mode;
        const scrollModeChanged = (this._config.scroll_mode || "fixed") !== (persistedConfig.scroll_mode || "fixed");

        // Use the configuration read back from Home Assistant, not the local
        // form values. This makes the panel reflect only confirmed persistence.
        this._config = {
          ...this._config,
          ...persistedConfig,
          calendar_colors: persistedConfig.calendar_colors || {},
          calendar_display_modes: persistedConfig.calendar_display_modes || {},
          calendar_avatars: persistedConfig.calendar_avatars || {},
          history_sources: persistedConfig.history_sources || [],
          energy_entity: persistedConfig.energy_entity || "",
          show_energy_prices: persistedConfig.show_energy_prices ?? false,
        };
        this._syncServerTime(persistedConfig.server_time);
        if (modeChanged) {
          this._weekStart = this._startOfView(this._now());
        }
        const verifiedConfig = await this._hass.connection.sendMessagePromise({
          type: "week_planner/config",
        });

        this._config = {
          ...this._config,
          ...verifiedConfig,
          calendar_colors: verifiedConfig.calendar_colors || {},
          calendar_display_modes: verifiedConfig.calendar_display_modes || {},
          calendar_avatars: verifiedConfig.calendar_avatars || {},
          history_sources: verifiedConfig.history_sources || [],
          energy_entity: verifiedConfig.energy_entity || "",
          show_energy_prices: verifiedConfig.show_energy_prices ?? false,
        };
        this._syncServerTime(verifiedConfig.server_time);

        if (scrollModeChanged) {
          this._initialScrolled = false;
          this._scrollState = "auto";
          this._scrollPositioned = false;
          this._scrollRequestId++;
          this._savedScrollTop = null;
          this._lastFollowNowHourKey = "";
        }
        this._scheduleFollowNow();
        this._checkFollowNow();

        const expectedHistory = JSON.stringify(historySources);
        const actualHistory = JSON.stringify(verifiedConfig.history_sources || []);
        const energyMatches =
          (verifiedConfig.energy_entity || "") === newEnergyEntity
          && Boolean(verifiedConfig.show_energy_prices) === Boolean(newShowEnergyPrices);

        if (expectedHistory !== actualHistory || !energyMatches) {
          throw new Error(
            `Konfigurationen blev ikke gemt korrekt i Home Assistant. `
            + `Historik: ${actualHistory}; Elpris: ${verifiedConfig.energy_entity || "(ingen)"} / `
            + `${Boolean(verifiedConfig.show_energy_prices)}`
          );
        }

        if (status) status.textContent = "Gemt og verificeret.";
        await this._loadData(false);
        await this._setupCalendarSubscriptions();
        setTimeout(() => this._closeSettingsDialog(), 250);
      } catch (err) {
        if (status) status.textContent = `Kunne ikke gemme: ${err?.message || err}`;
      }
    });
  }

  _openDialog(html) {
    const dialog = this.shadowRoot.getElementById("detailDialog");
    const body = this.shadowRoot.getElementById("dialogBody");
    if (!dialog || !body) return;
    if (dialog.open) dialog.close();
    body.innerHTML = html;
    body.querySelector("#closeDialog")?.addEventListener("click", () => {
      if (this._settingsOpen) {
        this._closeSettingsDialog();
      } else {
        dialog.close();
      }
    });
    dialog.addEventListener("cancel", (event) => {
      if (this._settingsOpen) {
        event.preventDefault();
        this._closeSettingsDialog();
      }
    }, { once:true });

    dialog.showModal();
  }

  _escape(value) {
    return String(value ?? "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }
}

if (!customElements.get("week-planner-panel")) {
  customElements.define("week-planner-panel", WeekPlannerPanel);
}


/**
 * Lovelace dashboard card wrapper.
 *
 * The card reuses WeekPlannerPanel's complete data/config/rendering engine.
 * Only dashboard-specific presentation is configured on the card itself.
 */

async function ensureWeekPlannerLovelaceResource(hass, resourceUrl) {
  if (!hass || !resourceUrl) return;

  // Home Assistant exposes Lovelace resources through its WebSocket API.
  // If unavailable (e.g. storage mode differences), fail silently; the panel
  // itself still works and manual resource registration remains a fallback.
  try {
    const resources = await hass.connection.sendMessagePromise({
      type: "lovelace/resources",
    });

    const list = Array.isArray(resources) ? resources : (resources?.resources || []);
    const basePath = "/week_planner_static/week-planner.js";

    const existing = list.find((item) => {
      const url = item?.url || "";
      return url === basePath || url.startsWith(basePath + "?");
    });

    if (!existing) {
      await hass.connection.sendMessagePromise({
        type: "lovelace/resources/create",
        res_type: "module",
        url: resourceUrl,
      });
      return;
    }

    if (existing.url !== resourceUrl && existing.id) {
      await hass.connection.sendMessagePromise({
        type: "lovelace/resources/update",
        resource_id: existing.id,
        res_type: existing.type || "module",
        url: resourceUrl,
      });
    }
  } catch (err) {
    console.debug("Week Planner: Lovelace resource auto-registration unavailable", err);
  }
}



/**
 * Native Week Planner dashboard host.
 *
 * This element is intentionally separate from WeekPlannerCard:
 * - It uses the integration's central/full-screen Week Planner configuration.
 * - It keeps the panel's 7-day navigation semantics and all panel features.
 * - The normal WeekPlannerCard remains independently configurable for other dashboards.
 */
class WeekPlannerDashboardCard extends WeekPlannerPanel {
  constructor() {
    super();
    this._isDashboardCard = false;
  }

  setConfig(_config) {
    // The native dashboard host uses the integration's central configuration.
    // Lovelace still requires custom cards to accept setConfig().
  }

  getCardSize() {
    return 12;
  }

  _applyViewportHeight() {
    const rect = this.getBoundingClientRect();
    const available = Math.max(320, window.innerHeight - Math.max(0, rect.top));
    this.style.display = "block";
    this.style.width = "100%";
    this.style.height = `${available}px`;
    this.style.maxHeight = `${available}px`;
    this.style.minHeight = `${available}px`;

    // Only an unpositioned planner may request automatic positioning here.
    // Normal resizes and data refreshes preserve the existing scrollTop.
    if (this._scrollState === "auto" && !this._scrollPositioned) {
      this._positionScroll("viewport-ready", true);
    }
  }
}

if (!customElements.get("week-planner-dashboard-card")) {
  customElements.define("week-planner-dashboard-card", WeekPlannerDashboardCard);
}

class WeekPlannerCard extends WeekPlannerPanel {
  constructor() {
    super();
    this._isDashboardCard = true;
    this._cardConfig = {
      height: 700,
      show_toolbar: true,
      adopt_panel: true,
      hide_weather: false,
      hide_sun: false,
      hide_energy: false,
      calendar_entities: [],
      days_to_show: 7,
      weather_entity: "",
      weather_display: "none",
      show_sun_markers: false,
      show_moon_markers: false,
      energy_entity: "",
      show_energy_prices: false,
      show_week_number: true,
      enlarge_today: true,
      view_mode: "week",
      default_scroll_hour: 6,
      scroll_mode: "fixed",
    };
  }

  static getConfigElement() {
    return document.createElement("week-planner-card-editor");
  }

  static getStubConfig() {
    return {
      height: 700,
      show_toolbar: true,
      adopt_panel: true,
      hide_weather: false,
      hide_sun: false,
      hide_energy: false,
      calendar_entities: [],
      calendar_avatars: {},
      calendar_colors: {},
      days_to_show: 7,
      weather_entity: "",
      weather_display: "none",
      show_sun_markers: false,
      show_moon_markers: false,
      energy_entity: "",
      show_energy_prices: false,
      show_week_number: true,
      enlarge_today: true,
      view_mode: "week",
      default_scroll_hour: 6,
      scroll_mode: "fixed",
    };
  }

  setConfig(config) {
    const incoming = config || {};
    const height = Number(incoming.height ?? 700);

    this._cardConfig = {
      ...incoming,
      height: Number.isFinite(height) ? Math.min(1600, Math.max(320, height)) : 700,
      show_toolbar: incoming.show_toolbar !== false,
      adopt_panel: incoming.adopt_panel !== false,
      hide_weather: Boolean(incoming.hide_weather),
      hide_sun: Boolean(incoming.hide_sun),
      hide_energy: Boolean(incoming.hide_energy),
      calendar_entities: Array.isArray(incoming.calendar_entities) ? incoming.calendar_entities : [],
      calendar_colors: incoming.calendar_colors && typeof incoming.calendar_colors === "object"
        ? incoming.calendar_colors
        : {},
      calendar_avatars: incoming.calendar_avatars && typeof incoming.calendar_avatars === "object"
        ? incoming.calendar_avatars
        : {},
      days_to_show: Number.isFinite(Number(incoming.days_to_show))
        ? Math.min(14, Math.max(1, Math.round(Number(incoming.days_to_show))))
        : 7,
      weather_entity: incoming.weather_entity || "",
      weather_display: incoming.weather_display || "none",
      show_sun_markers: Boolean(incoming.show_sun_markers),
      show_moon_markers: Boolean(incoming.show_moon_markers),
      energy_entity: incoming.energy_entity || "",
      show_energy_prices: Boolean(incoming.show_energy_prices),
      show_week_number: incoming.show_week_number !== false,
      enlarge_today: incoming.enlarge_today !== false,
      view_mode: incoming.view_mode === "rolling" ? "rolling" : "week",
      default_scroll_hour: Number.isFinite(Number(incoming.default_scroll_hour))
        ? Math.min(23, Math.max(0, Number(incoming.default_scroll_hour)))
        : 6,
      scroll_mode: ["none", "fixed", "follow_now"].includes(incoming.scroll_mode)
        ? incoming.scroll_mode
        : "fixed",
    };

    this._initialScrolled = false;
    this._scrollState = "auto";
    this._scrollPositioned = false;
    this._scrollRequestId++;
    this._savedScrollTop = null;
    this._lastFollowNowHourKey = "";
    this._scheduleFollowNow();

    this._applyViewportHeight();

    if (this._config) {
      if (this._cardConfig.adopt_panel === false) {
        this._clearCalendarSubscriptions();
        const today = this._now();
        today.setHours(0,0,0,0);
        this._weekStart = today;
        this._loadData(false).then(() => this._setupCalendarSubscriptions());
      } else {
        this._render(false);
      }
    }
  }

  _dayCount() {
    return Math.min(14, Math.max(1, Number(this._cardConfig?.days_to_show ?? 7)));
  }

  _navigationStepDays() {
    return this._dayCount();
  }


  _startOfView(date = this._now()) {
    const d = new Date(date);
    d.setHours(0,0,0,0);
    return d;
  }

  _cardRuntimeOverlay() {
    if (this._cardConfig?.adopt_panel !== false) return null;
    return {
      weather_entity: this._cardConfig.weather_entity || "",
      weather_display: this._cardConfig.weather_display || "none",
      calendar_entities: [...(this._cardConfig.calendar_entities || [])],
      calendar_colors: this._cardConfig.calendar_colors || {},
      calendar_display_modes: this._cardConfig.calendar_display_modes || {},
      calendar_avatars: this._cardConfig.calendar_avatars || {},
      history_sources: this._cardConfig.history_sources || [],
      energy_entity: this._cardConfig.energy_entity || "",
      show_energy_prices: Boolean(this._cardConfig.show_energy_prices),
      show_sun_markers: Boolean(this._cardConfig.show_sun_markers),
      show_moon_markers: Boolean(this._cardConfig.show_moon_markers),
      show_week_number: this._cardConfig.show_week_number !== false,
      enlarge_today: this._cardConfig.enlarge_today !== false,
      view_mode: "rolling",
      default_scroll_hour: Number(this._cardConfig.default_scroll_hour ?? 6),
      scroll_mode: "fixed",
    };
  }

  async _withCardRuntimeConfig(callback) {
    const overlay = this._cardRuntimeOverlay();
    if (!overlay || !this._config) return callback();

    const original = this._config;
    this._config = { ...original, ...overlay };
    try {
      return await callback();
    } finally {
      this._config = original;
    }
  }

  async _loadData(showLoading = true) {
    return this._withCardRuntimeConfig(() => super._loadData(showLoading));
  }

  async _setupCalendarSubscriptions() {
    return this._withCardRuntimeConfig(() => super._setupCalendarSubscriptions());
  }

  async _refreshCalendarEvents(showError = true) {
    return this._withCardRuntimeConfig(() => super._refreshCalendarEvents(showError));
  }

  getCardSize() {
    return Math.max(4, Math.ceil((this._cardConfig?.height || 700) / 50));
  }

  _applyViewportHeight() {
    const height = Number(this._cardConfig?.height || 700);
    const resolved = Number.isFinite(height)
      ? Math.min(1600, Math.max(320, height))
      : 700;

    this.style.display = "block";
    this.style.width = "100%";
    this.style.height = `${resolved}px`;
    this.style.maxHeight = `${resolved}px`;
    this.style.minHeight = `${resolved}px`;
  }

  _render(allowScroll = true) {
    const oldVisibility = {
      ...(this._sessionVisibility || { weather:true, sun:true, energy:true }),
    };
    const oldConfig = this._config;

    if (this._cardConfig?.adopt_panel === false && this._config) {
      this._config = {
        ...this._config,
        ...this._cardRuntimeOverlay(),
      };
    }

    this._sessionVisibility = {
      weather: !this._cardConfig.hide_weather,
      sun: !this._cardConfig.hide_sun,
      energy: !this._cardConfig.hide_energy,
    };

    super._render(allowScroll);

    this._config = oldConfig;
    this._sessionVisibility = oldVisibility;

    requestAnimationFrame(() => {
      this._applyViewportHeight();
      this._applyCardPresentation();
    });
  }

  _applyCardPresentation() {
    if (!this.shadowRoot) return;

    let style = this.shadowRoot.getElementById("weekPlannerCardStyle");
    if (!style) {
      style = document.createElement("style");
      style.id = "weekPlannerCardStyle";
      this.shadowRoot.appendChild(style);
    }

    style.textContent = `
      :host {
        border-radius: var(--ha-card-border-radius, 12px);
        background: var(--ha-card-background, var(--card-background-color));
        box-shadow: var(--ha-card-box-shadow, none);
        border: var(--ha-card-border-width, 0) solid var(--ha-card-border-color, var(--divider-color));
      }
      .root {
        border-radius: inherit;
      }
      .toolbar {
        ${this._cardConfig?.show_toolbar === false ? "display:none !important;" : ""}
      }
      ${this._cardConfig?.adopt_panel === false ? `
        #configure, #toggleWeather, #toggleSun, #toggleEnergy {
          display:none !important;
        }
      ` : ""}
    `;
  }
}

class WeekPlannerCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._config = {
      height: 700,
      show_toolbar: true,
      adopt_panel: true,
      hide_weather: false,
      hide_sun: false,
      hide_energy: false,
      calendar_entities: [],
      calendar_avatars: {},
      calendar_colors: {},
      days_to_show: 7,
      weather_entity: "",
      weather_display: "none",
      show_sun_markers: false,
      show_moon_markers: false,
      energy_entity: "",
      show_energy_prices: false,
      show_week_number: true,
      enlarge_today: true,
      view_mode: "week",
      default_scroll_hour: 6,
      scroll_mode: "fixed",
    };
  }

  set hass(value) {
    this._hass = value;
    this._render();
  }

  connectedCallback() {
    if (!this._config) {
      this._config = WeekPlannerCard.getStubConfig();
    }
    this._render();
  }

  setConfig(config) {
    const incoming = config || {};
    this._config = {
      ...incoming,
      height: Number(incoming.height ?? 700),
      show_toolbar: incoming.show_toolbar !== false,
      adopt_panel: incoming.adopt_panel !== false,
      hide_weather: Boolean(incoming.hide_weather),
      hide_sun: Boolean(incoming.hide_sun),
      hide_energy: Boolean(incoming.hide_energy),
      calendar_entities: Array.isArray(incoming.calendar_entities) ? incoming.calendar_entities : [],
      calendar_colors: incoming.calendar_colors && typeof incoming.calendar_colors === "object"
        ? incoming.calendar_colors
        : {},
      calendar_avatars: incoming.calendar_avatars && typeof incoming.calendar_avatars === "object"
        ? incoming.calendar_avatars
        : {},
      days_to_show: Number.isFinite(Number(incoming.days_to_show))
        ? Math.min(14, Math.max(1, Math.round(Number(incoming.days_to_show))))
        : 7,
      weather_entity: incoming.weather_entity || "",
      weather_display: incoming.weather_display || "none",
      show_sun_markers: Boolean(incoming.show_sun_markers),
      show_moon_markers: Boolean(incoming.show_moon_markers),
      energy_entity: incoming.energy_entity || "",
      show_energy_prices: Boolean(incoming.show_energy_prices),
      show_week_number: incoming.show_week_number !== false,
      enlarge_today: incoming.enlarge_today !== false,
      view_mode: incoming.view_mode === "rolling" ? "rolling" : "week",
      default_scroll_hour: Number(incoming.default_scroll_hour ?? 6),
      scroll_mode: ["none", "fixed", "follow_now"].includes(incoming.scroll_mode) ? incoming.scroll_mode : "fixed",
    };
    this._render();
  }

  _emitConfig() {
    this.dispatchEvent(new CustomEvent("config-changed", {
      detail: { config: { ...this._config } },
      bubbles: true,
      composed: true,
    }));
  }

  _render() {
    if (!this.shadowRoot) return;

    const states = Object.values(this._hass?.states || {});
    const label = (s) => s.attributes?.friendly_name || s.entity_id;
    const esc = (v) => String(v ?? "")
      .replaceAll("&","&amp;").replaceAll("<","&lt;")
      .replaceAll(">","&gt;").replaceAll('"',"&quot;");

    const weatherEntities = states.filter((s) => s.entity_id.startsWith("weather.")).sort((a,b) => label(a).localeCompare(label(b)));
    const calendarEntities = states.filter((s) => s.entity_id.startsWith("calendar.")).sort((a,b) => label(a).localeCompare(label(b)));
    const sensorEntities = states.filter((s) => s.entity_id.startsWith("sensor.")).sort((a,b) => label(a).localeCompare(label(b)));

    const selectedCalendars = new Set(this._config.calendar_entities || []);
    const weatherOptions = weatherEntities.map((s) =>
      `<option value="${esc(s.entity_id)}" ${s.entity_id === this._config.weather_entity ? "selected" : ""}>${esc(label(s))}</option>`
    ).join("");
    const calendarOptions = calendarEntities.map((s) =>
      `<option value="${esc(s.entity_id)}" ${selectedCalendars.has(s.entity_id) ? "selected" : ""}>${esc(label(s))}</option>`
    ).join("");
    const energyOptions = sensorEntities.map((s) =>
      `<option value="${esc(s.entity_id)}" ${s.entity_id === this._config.energy_entity ? "selected" : ""}>${esc(label(s))}</option>`
    ).join("");

    const calendarStyleRows = (this._config.calendar_entities || []).map((entityId) => {
      const entity = this._hass?.states?.[entityId];
      const friendly = entity?.attributes?.friendly_name || entityId;
      const color = this._config.calendar_colors?.[entityId] || "#4f8cff";
      const avatar = this._config.calendar_avatars?.[entityId] || "";
      const type = avatar.startsWith("mdi:") ? "mdi" : (avatar ? "entity" : "none");

      return `
        <div class="calendar-style-row" data-calendar-style-row="${esc(entityId)}">
          <div class="calendar-style-name">
            <strong>${esc(friendly)}</strong>
            <span>${esc(entityId)}</span>
          </div>

          <input type="color"
                 class="calendar-style-color"
                 data-calendar-color="${esc(entityId)}"
                 value="${esc(color)}"
                 title="Kalenderfarve">

          <select data-calendar-icon-type="${esc(entityId)}">
            <option value="none" ${type === "none" ? "selected" : ""}>Intet ikon</option>
            <option value="mdi" ${type === "mdi" ? "selected" : ""}>MDI-ikon</option>
            <option value="entity" ${type === "entity" ? "selected" : ""}>HA-entity/avatar</option>
          </select>

          <ha-icon-picker
            data-calendar-mdi="${esc(entityId)}"
            class="${type === "mdi" ? "" : "hidden"}">
          </ha-icon-picker>

          <ha-entity-picker
            data-calendar-avatar="${esc(entityId)}"
            class="${type === "entity" ? "" : "hidden"}">
          </ha-entity-picker>
        </div>
      `;
    }).join("");

    const independent = this._config.adopt_panel === false;

    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; color:var(--primary-text-color); }
        .editor { display:grid; gap:14px; padding:8px 0; }
        .box { display:grid; gap:11px; padding:12px; border:1px solid var(--divider-color); border-radius:9px; }
        .field { display:grid; gap:5px; }
        .title, label { font-size:13px; font-weight:500; }
        .hint { color:var(--secondary-text-color); font-size:12px; line-height:1.4; }
        .toggle { display:flex; align-items:center; gap:8px; }
        input[type="number"], select {
          width:100%; box-sizing:border-box; padding:9px; border-radius:8px;
          border:1px solid var(--divider-color); color:var(--primary-text-color);
          background:var(--card-background-color); font:inherit;
        }
        select[multiple] { min-height:120px; }
        .calendar-style-list { display:grid; gap:8px; }
        .calendar-style-row {
          display:grid;
          grid-template-columns:minmax(150px,1fr) 44px minmax(130px,160px);
          gap:8px;
          align-items:center;
          padding:9px;
          border:1px solid var(--divider-color);
          border-radius:8px;
        }
        .calendar-style-name {
          min-width:0;
          display:grid;
          gap:2px;
        }
        .calendar-style-name span {
          font-size:11px;
          color:var(--secondary-text-color);
          white-space:nowrap;
          overflow:hidden;
          text-overflow:ellipsis;
        }
        .calendar-style-color {
          width:42px;
          height:32px;
          border:0;
          padding:0;
          background:none;
        }
        .calendar-style-row ha-icon-picker,
        .calendar-style-row ha-entity-picker {
          grid-column:1 / -1;
        }
        .hidden { display:none !important; }
      </style>

      <div class="editor">
        <div class="field">
          <label for="height">Card-højde</label>
          <input id="height" type="number" min="320" max="1600" step="20" value="${Number(this._config.height || 700)}">
        </div>

        <label class="toggle"><input id="toolbar" type="checkbox" ${this._config.show_toolbar ? "checked" : ""}><span>Vis Week Planner-toolbar</span></label>
        <label class="toggle"><input id="adoptPanel" type="checkbox" ${this._config.adopt_panel ? "checked" : ""}><span>Adoptér/gengiv main panelet</span></label>
        <div class="hint">Slå adoption fra for at bruge dette cards egen konfiguration. Alle datakilder er valgfrie.</div>

        <div class="box ${independent ? "hidden" : ""}">
          <div class="title">Visning af main panelet</div>
          <label class="toggle"><input id="hideWeather" type="checkbox" ${this._config.hide_weather ? "checked" : ""}><span>Skjul vejr</span></label>
          <label class="toggle"><input id="hideSun" type="checkbox" ${this._config.hide_sun ? "checked" : ""}><span>Skjul sol/dagslængde</span></label>
          <label class="toggle"><input id="hideEnergy" type="checkbox" ${this._config.hide_energy ? "checked" : ""}><span>Skjul elpris</span></label>
        </div>

        <div class="box ${independent ? "" : "hidden"}">
          <div class="title">Dette cards egen konfiguration</div>

          <div class="field">
            <label for="cardCalendars">Kalendere</label>
            <select id="cardCalendars" multiple>${calendarOptions}</select>
            <div class="hint">Ingen valg = tom planner. Ctrl/Cmd + klik vælger flere.</div>
          </div>
          <div class="field">
            <label>Farve og event-ikon pr. kalender</label>
            <div class="calendar-style-list">
              ${calendarStyleRows || '<div class="hint">Vælg en eller flere kalendere ovenfor.</div>'}
            </div>
          </div>

          <div class="field">
            <label for="cardWeather">Vejrkilde</label>
            <select id="cardWeather"><option value="">Ingen</option>${weatherOptions}</select>
          </div>
          <div class="field">
            <label for="cardWeatherMode">Vejrvisning</label>
            <select id="cardWeatherMode">
              <option value="none" ${this._config.weather_display === "none" ? "selected" : ""}>Ingen</option>
              <option value="hourly" ${this._config.weather_display === "hourly" ? "selected" : ""}>Timer</option>
              <option value="daily" ${this._config.weather_display === "daily" ? "selected" : ""}>Dage</option>
              <option value="both" ${this._config.weather_display === "both" ? "selected" : ""}>Begge</option>
            </select>
          </div>

          <label class="toggle"><input id="cardSun" type="checkbox" ${this._config.show_sun_markers ? "checked" : ""}><span>Vis sol/dagslængde</span></label>
          <label class="toggle"><input id="cardMoon" type="checkbox" ${this._config.show_moon_markers ? "checked" : ""}><span>Vis månefaseskift</span></label>

          <div class="field">
            <label for="cardEnergy">Elpris-sensor</label>
            <select id="cardEnergy"><option value="">Ingen</option>${energyOptions}</select>
          </div>
          <label class="toggle"><input id="cardEnergyShow" type="checkbox" ${this._config.show_energy_prices ? "checked" : ""}><span>Vis elpriser</span></label>

          <label class="toggle"><input id="cardWeekNumber" type="checkbox" ${this._config.show_week_number ? "checked" : ""}><span>Vis ugenummer</span></label>
          <label class="toggle"><input id="cardEnlargeToday" type="checkbox" ${this._config.enlarge_today ? "checked" : ""}><span>Fremhæv i dag</span></label>

          <div class="field">
            <label for="cardViewMode">Periode</label>
            <select id="cardViewMode">
              <option value="week" ${this._config.view_mode === "week" ? "selected" : ""}>Kalenderuge</option>
              <option value="rolling" ${this._config.view_mode === "rolling" ? "selected" : ""}>I dag + 6 dage</option>
            </select>
          </div>

          <div class="field">
            <label for="cardDaysToShow">Antal dage</label>
            <input id="cardDaysToShow" type="number" min="1" max="14" step="1"
                   value="${Number(this._config.days_to_show ?? 7)}">
            <div class="hint">Card’et viser altid i dag + det valgte antal dage i alt.</div>
          </div>

          <div class="field">
            <label for="cardScrollMode">Auto-scroll</label>
            <select id="cardScrollMode">
              <option value="none" ${this._config.scroll_mode === "none" ? "selected" : ""}>Ingen auto-scroll</option>
              <option value="fixed" ${this._config.scroll_mode === "fixed" ? "selected" : ""}>Scroll til angivet time</option>
              <option value="follow_now" ${this._config.scroll_mode === "follow_now" ? "selected" : ""}>Følg NU</option>
            </select>
          </div>

          <div class="field ${this._config.scroll_mode === "fixed" ? "" : "hidden"}" id="cardScrollHourRow">
            <label for="cardScrollHour">Tidspunkt</label>
            <input id="cardScrollHour" type="number" min="0" max="23" step="1" value="${Number(this._config.default_scroll_hour ?? 6)}">
          </div>

          <div class="hint">Scroll til angivet time og Følg NU holder måltidspunktet så højt i viewet som muligt, så mest muligt af resten af dagen er synligt.</div>
        </div>
      </div>
    `;

    const emit = () => this._emitConfig();
    const bindCheck = (id, key) => this.shadowRoot.getElementById(id)?.addEventListener("change", (e) => {
      this._config[key] = Boolean(e.target.checked);
      emit();
    });

    this.shadowRoot.getElementById("height")?.addEventListener("change", (e) => {
      const value = Number(e.target.value);
      this._config.height = Number.isFinite(value) ? Math.min(1600, Math.max(320, value)) : 700;
      emit();
    });
    bindCheck("toolbar", "show_toolbar");
    bindCheck("hideWeather", "hide_weather");
    bindCheck("hideSun", "hide_sun");
    bindCheck("hideEnergy", "hide_energy");
    bindCheck("cardSun", "show_sun_markers");
    bindCheck("cardMoon", "show_moon_markers");
    bindCheck("cardEnergyShow", "show_energy_prices");
    bindCheck("cardWeekNumber", "show_week_number");
    bindCheck("cardEnlargeToday", "enlarge_today");

    this.shadowRoot.getElementById("adoptPanel")?.addEventListener("change", (e) => {
      this._config.adopt_panel = Boolean(e.target.checked);
      emit();
      this._render();
    });
    this.shadowRoot.getElementById("cardCalendars")?.addEventListener("change", (e) => {
      this._config.calendar_entities = [...e.target.selectedOptions].map((o) => o.value);
      emit();
      this._render();
    });
    this.shadowRoot.getElementById("cardWeather")?.addEventListener("change", (e) => {
      this._config.weather_entity = e.target.value || "";
      emit();
    });
    this.shadowRoot.getElementById("cardWeatherMode")?.addEventListener("change", (e) => {
      this._config.weather_display = e.target.value || "none";
      emit();
    });
    this.shadowRoot.getElementById("cardEnergy")?.addEventListener("change", (e) => {
      this._config.energy_entity = e.target.value || "";
      emit();
    });
    this.shadowRoot.getElementById("cardViewMode")?.addEventListener("change", (e) => {
      this._config.view_mode = e.target.value === "rolling" ? "rolling" : "week";
      emit();
    });
    this.shadowRoot.getElementById("cardDaysToShow")?.addEventListener("change", (e) => {
      this._config.days_to_show = Math.min(
        14,
        Math.max(1, Math.round(Number(e.target.value || 7)))
      );
      emit();
    });

    this.shadowRoot.getElementById("cardScrollMode")?.addEventListener("change", (e) => {
      this._config.scroll_mode = ["none", "fixed", "follow_now"].includes(e.target.value)
        ? e.target.value
        : "fixed";
      emit();
      this._render();
    });

    this.shadowRoot.getElementById("cardScrollHour")?.addEventListener("change", (e) => {
      this._config.default_scroll_hour = Math.min(23, Math.max(0, Number(e.target.value || 6)));
      emit();
    });

    this.shadowRoot.querySelectorAll("[data-calendar-color]").forEach((el) => {
      el.addEventListener("change", (e) => {
        const entityId = e.target.dataset.calendarColor;
        this._config.calendar_colors = { ...(this._config.calendar_colors || {}) };
        this._config.calendar_colors[entityId] = e.target.value;
        emit();
      });
    });

    this.shadowRoot.querySelectorAll("[data-calendar-icon-type]").forEach((typeEl) => {
      const entityId = typeEl.dataset.calendarIconType;
      const mdiPicker = this.shadowRoot.querySelector(`[data-calendar-mdi="${entityId}"]`);
      const avatarPicker = this.shadowRoot.querySelector(`[data-calendar-avatar="${entityId}"]`);

      const current = this._config.calendar_avatars?.[entityId] || "";
      if (mdiPicker) {
        mdiPicker.value = current.startsWith("mdi:") ? current : "";
      }
      if (avatarPicker) {
        avatarPicker.hass = this._hass;
        avatarPicker.value = current && !current.startsWith("mdi:") ? current : undefined;
      }

      const updateVisibility = () => {
        mdiPicker?.classList.toggle("hidden", typeEl.value !== "mdi");
        avatarPicker?.classList.toggle("hidden", typeEl.value !== "entity");
      };

      typeEl.addEventListener("change", () => {
        this._config.calendar_avatars = { ...(this._config.calendar_avatars || {}) };

        if (typeEl.value === "none") {
          delete this._config.calendar_avatars[entityId];
        } else if (typeEl.value === "mdi") {
          const value = mdiPicker?.value || "mdi:calendar";
          this._config.calendar_avatars[entityId] = value;
        } else {
          const value = avatarPicker?.value || "";
          if (value) this._config.calendar_avatars[entityId] = value;
          else delete this._config.calendar_avatars[entityId];
        }

        updateVisibility();
        emit();
      });

      mdiPicker?.addEventListener("value-changed", (e) => {
        const value = e.detail?.value ?? mdiPicker.value ?? "";
        this._config.calendar_avatars = { ...(this._config.calendar_avatars || {}) };
        if (value) this._config.calendar_avatars[entityId] = value;
        else delete this._config.calendar_avatars[entityId];
        emit();
      });

      avatarPicker?.addEventListener("value-changed", (e) => {
        const value = e.detail?.value ?? avatarPicker.value ?? "";
        this._config.calendar_avatars = { ...(this._config.calendar_avatars || {}) };
        if (value) this._config.calendar_avatars[entityId] = value;
        else delete this._config.calendar_avatars[entityId];
        emit();
      });

      updateVisibility();
    });
  }

}

if (!customElements.get("week-planner-card-editor")) {
  customElements.define("week-planner-card-editor", WeekPlannerCardEditor);
}

if (!customElements.get("week-planner-card")) {
  customElements.define("week-planner-card", WeekPlannerCard);
}

window.weekPlannerFrontendVersion = "0.5.3-dev.3";
window.customCards = window.customCards || [];

if (!window.customCards.some((card) => card.type === "week-planner-card")) {
  window.customCards.push({
    type: "week-planner-card",
    name: "Week Planner Card",
    description: "Week Planner dashboard card · frontend v0.5.3-dev.3",
    preview: false,
  });
}
