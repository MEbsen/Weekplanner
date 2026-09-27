// Shared source/runtime health tracking for Week Planner.
//
// The service owns health state and presentation-neutral status calculation.
// Panel/card integrations can provide configuration and escaping without
// duplicating the health rules.

export class WeekPlannerSourceHealth {
  constructor({ getNow, getConfig, escapeHtml }) {
    this.getNow = getNow;
    this.getConfig = getConfig;
    this.escapeHtml = escapeHtml || ((value) => String(value ?? ""));
    this.sources = {};
    this.runtime = {
      status: "unknown",
      last_success: null,
      last_attempt: null,
      last_error: "",
    };
  }

  nowIso() {
    try {
      return this.getNow?.().toISOString() || new Date().toISOString();
    } catch {
      return new Date().toISOString();
    }
  }

  markAttempt(key, label) {
    const previous = this.sources[key] || {};
    this.sources[key] = {
      ...previous,
      key,
      label,
      status: previous.status || "unknown",
      last_attempt: this.nowIso(),
    };
  }

  markSuccess(key, label) {
    const now = this.nowIso();
    this.sources[key] = {
      ...(this.sources[key] || {}),
      key,
      label,
      status: "fresh",
      last_attempt: now,
      last_success: now,
      last_error: "",
    };
  }

  markFailure(key, label, err) {
    const previous = this.sources[key] || {};
    this.sources[key] = {
      ...previous,
      key,
      label,
      status: previous.last_success ? "stale" : "error",
      last_attempt: this.nowIso(),
      last_error: String(err?.message || err || "Ukendt fejl"),
    };
  }

  markRuntimeAttempt() {
    this.runtime.last_attempt = this.nowIso();
  }

  markRuntimeSuccess() {
    const now = this.nowIso();
    this.runtime = {
      status: "fresh",
      last_success: now,
      last_attempt: now,
      last_error: "",
    };
  }

  markRuntimeFailure(err) {
    this.runtime = {
      ...(this.runtime || {}),
      status: this.runtime?.last_success ? "stale" : "error",
      last_attempt: this.nowIso(),
      last_error: String(err?.message || err || "Ukendt fejl"),
    };
  }

  snapshot() {
    return {
      runtime: { ...(this.runtime || {}) },
      sources: Object.fromEntries(
        Object.entries(this.sources || {}).map(([key, value]) => [key, { ...(value || {}) }])
      ),
    };
  }

  activeItems() {
    const config = this.getConfig?.() || {};
    const configured = [];
    const calendars = config.calendar_entities || [];
    if (calendars.length) configured.push(["calendar", "Kalendere"]);
    if (config.weather_entity && config.weather_display !== "none") configured.push(["weather", "Vejr"]);
    if (config.show_sun_markers) configured.push(["sun", "Sol/dagslængde"]);
    if (config.show_moon_markers) configured.push(["moon", "Månefaser"]);
    if ((config.history_sources || []).length) configured.push(["history", "Historik"]);
    if (config.show_energy_prices && config.energy_entity) configured.push(["energy", "Elpriser"]);

    return [
      {
        key: "runtime",
        label: "Home Assistant / Week Planner",
        ...(this.runtime || {}),
      },
      ...configured.map(([key, label]) => ({
        key,
        label,
        status: "unknown",
        ...(this.sources[key] || {}),
      })),
    ];
  }

  iconMarkup() {
    const problematic = this.activeItems().filter(
      (item) => item.status === "stale" || item.status === "error"
    );
    if (!problematic.length) return "";

    return problematic.map((item) => {
      const lastSuccess = item.last_success
        ? new Date(item.last_success).toLocaleString("da-DK")
        : "aldrig";
      const lastAttempt = item.last_attempt
        ? new Date(item.last_attempt).toLocaleString("da-DK")
        : "ukendt";
      const state = item.status === "error" ? "Fejl" : "Ikke synkroniseret";
      const title =
        `${item.label}: ${state}. Sidst OK: ${lastSuccess}. `
        + `Seneste forsøg: ${lastAttempt}`
        + (item.last_error ? `. Fejl: ${item.last_error}` : "");
      const safe = this.escapeHtml(title);
      return `<span class="health-indicator ${item.status}" title="${safe}" aria-label="${safe}">⚠</span>`;
    }).join("");
  }
}