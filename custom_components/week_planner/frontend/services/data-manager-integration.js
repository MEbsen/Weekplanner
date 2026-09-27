import { WeekPlannerDataManager } from "./data-manager.js";

const panel = customElements.get("week-planner-panel");
if (!panel) {
  console.warn("Week Planner DataManager integration: panel element unavailable");
} else {
  const proto = panel.prototype;
  const fields = {
    _events: "events",
    _hourlyWeather: "hourlyWeather",
    _dailyWeather: "dailyWeather",
    _sunTimes: "sunTimes",
    _daylightExtrema: "daylightExtrema",
    _moonTransitions: "moonTransitions",
    _historyData: "historyData",
  };

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

  // Compatibility accessors keep rendering/projection code unchanged while
  // DataManager becomes the single owner of fetched data. Existing core code
  // may read/write _events etc., but those operations now target DataManager.
  for (const [legacyField, managerField] of Object.entries(fields)) {
    Object.defineProperty(proto, legacyField, {
      configurable: true,
      get() {
        return manager(this)[managerField];
      },
      set(value) {
        manager(this)[managerField] = value;
      },
    });
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