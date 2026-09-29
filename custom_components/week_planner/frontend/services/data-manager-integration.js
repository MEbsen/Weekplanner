import { WeekPlannerDataManager } from "./data-manager.js";

// Rendering was cut over to DataManager in dev.19, but the weather projection
// helpers were left behind with the removed compatibility state. Keep these
// projections on DataManager so panel and card use the same owned data.
WeekPlannerDataManager.prototype.hourlyWeatherMap = function() {
  const map = new Map();
  for (const item of this.hourlyWeather || []) {
    if (!item?.datetime) continue;
    const d = new Date(item.datetime);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}`;
    map.set(key, item);
  }
  return map;
};

WeekPlannerDataManager.prototype.dailyWeatherMap = function() {
  const map = new Map();
  const pad = (n) => String(n).padStart(2, "0");
  for (const item of this.dailyWeather || []) {
    if (!item?.datetime) continue;
    const d = new Date(item.datetime);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    map.set(key, item);
  }
  return map;
};

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
    return manager(this).loadAll();
  };

  proto._refreshCalendarEventsManaged = async function() {
    return manager(this).fetchCalendars();
  };
}
