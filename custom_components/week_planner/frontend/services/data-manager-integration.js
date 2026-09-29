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
      result.changed = ensureDailyWeather(dataManager) || result.changed;
      result.snapshot = dataManager.snapshot();
    }
    return result;
  };

  proto._refreshCalendarEventsManaged = async function() {
    return manager(this).fetchCalendars();
  };
}