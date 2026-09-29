import { WeekPlannerDataManager } from "./data-manager.js";
import { ensureDailyWeather } from "./weather-data.js";

const panel = customElements.get("week-planner-panel");
if (!panel) {
  console.warn("Week Planner DataManager integration: panel element unavailable");
} else {
  const proto = panel.prototype;

  function manager(instance) {
    if (!instance.__weekPlannerDataManager) {
      instance.__weekPlannerDataManager = new WeekPlannerDataManager({
        getHass: () => instance._hass,
        getConfig: () => instance._config,
        getWeekStart: () => instance._weekStart,
        getDayCount: () => instance._dayCount(),
        addDays: (date, amount) => instance._addDays(date, amount),
        isoLocal: (date) => instance._isoLocal(date),
        stableJson: (value) => instance._stableJson(value),
        weatherVisible: () => instance._weatherVisibleNow(),
        energyCompatibility: () => instance._energyCompatibility(),
        sourceHealth: {
          markAttempt: (key, label) => instance._markSourceAttempt(key, label),
          markSuccess: (key, label) => instance._markSourceSuccess(key, label),
          markFailure: (key, label, error) => instance._markSourceFailure(key, label, error),
        },
      });
    }
    return instance.__weekPlannerDataManager;
  }

  proto._dataManager = function() {
    return manager(this);
  };

  proto._dataSnapshot = function() {
    return manager(this).snapshot();
  };

  proto._loadDataManaged = async function() {
    const dataManager = manager(this);
    const result = await dataManager.loadAll();
    const mode = this._config?.weather_display || "both";

    if (this._weatherVisibleNow() && (mode === "daily" || mode === "both")) {
      // Some HA weather providers expose hourly forecasts but reject/omit daily.
      // Fetch hourly only as a data fallback when no daily payload arrived.
      if (!(dataManager.dailyWeather || []).length && !(dataManager.hourlyWeather || []).length) {
        try {
          dataManager.hourlyWeather = await dataManager.fetchForecast("hourly");
        } catch (_error) {
          // Keep the original weather health/error from loadAll; there is no
          // additional useful state to report if the fallback also fails.
        }
      }

      const recovered = ensureDailyWeather(dataManager);
      if ((dataManager.dailyWeather || []).length) {
        // A valid native or derived daily dataset means Week Planner can serve
        // the configured daily view even when the provider lacks native daily.
        this._markSourceSuccess("weather", "Vejr");
        result.warnings = (result.warnings || []).filter(
          (warning) => !String(warning).startsWith("Dagsvejr kunne ikke hentes:")
        );
      }
      result.changed = recovered || result.changed;
      result.snapshot = dataManager.snapshot();
    }
    return result;
  };

  proto._refreshCalendarEventsManaged = async function() {
    return manager(this).fetchCalendars();
  };
}