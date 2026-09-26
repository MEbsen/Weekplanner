import { WeekPlannerSourceHealth } from "./source-health.js";

const panel = customElements.get("week-planner-panel");
if (!panel) {
  console.warn("Week Planner source health integration: panel element unavailable");
} else {
  const proto = panel.prototype;

  function service(instance) {
    if (!instance.__weekPlannerSourceHealth) {
      const health = new WeekPlannerSourceHealth({
        getNow: () => instance._now(),
        getConfig: () => instance._config,
        escapeHtml: (value) => instance._escape(value),
      });

      // Preserve any health state produced before the integration was loaded.
      health.sources = instance._sourceHealth || {};
      health.runtime = instance._runtimeHealth || health.runtime;
      instance.__weekPlannerSourceHealth = health;
    }
    return instance.__weekPlannerSourceHealth;
  }

  proto._healthNowIso = function() {
    return service(this).nowIso();
  };

  proto._markSourceAttempt = function(key, label) {
    const health = service(this);
    health.markAttempt(key, label);
    this._sourceHealth = health.sources;
  };

  proto._markSourceSuccess = function(key, label) {
    const health = service(this);
    health.markSuccess(key, label);
    this._sourceHealth = health.sources;
  };

  proto._markSourceFailure = function(key, label, err) {
    const health = service(this);
    health.markFailure(key, label, err);
    this._sourceHealth = health.sources;
  };

  proto._activeHealthItems = function() {
    const health = service(this);
    // Runtime health is still assigned directly in a few lifecycle paths in
    // the core. Sync that state into the service until runtime recovery moves
    // into its own service in a later extraction.
    health.runtime = this._runtimeHealth || health.runtime;
    health.sources = this._sourceHealth || health.sources;
    return health.activeItems();
  };

  proto._healthIconMarkup = function() {
    const health = service(this);
    health.runtime = this._runtimeHealth || health.runtime;
    health.sources = this._sourceHealth || health.sources;
    return health.iconMarkup();
  };
}
