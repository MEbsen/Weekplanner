import { WeekPlannerDataManager } from "./data-manager.js";

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

  function seed(instance, dataManager) {
    dataManager.events = instance._events || {};
    dataManager.hourlyWeather = instance._hourlyWeather || [];
    dataManager.dailyWeather = instance._dailyWeather || [];
    dataManager.sunTimes = instance._sunTimes || {};
    dataManager.daylightExtrema = instance._daylightExtrema || {};
    dataManager.moonTransitions = instance._moonTransitions || [];
    dataManager.historyData = instance._historyData || {};
  }

  function publish(instance, snapshot) {
    instance._events = snapshot.events;
    instance._hourlyWeather = snapshot.hourlyWeather;
    instance._dailyWeather = snapshot.dailyWeather;
    instance._sunTimes = snapshot.sunTimes;
    instance._daylightExtrema = snapshot.daylightExtrema;
    instance._moonTransitions = snapshot.moonTransitions;
    instance._historyData = snapshot.historyData;
  }

  proto._dataManager = function() {
    const dataManager = manager(this);
    seed(this, dataManager);
    return dataManager;
  };

  proto._loadDataManaged = async function() {
    const dataManager = this._dataManager();
    const result = await dataManager.loadAll();
    publish(this, result.snapshot);
    return result;
  };

  proto._refreshCalendarEventsManaged = async function() {
    const dataManager = this._dataManager();
    const result = await dataManager.fetchCalendars();
    publish(this, dataManager.snapshot());
    return result;
  };
}
