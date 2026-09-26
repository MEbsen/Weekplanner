import { WeekPlannerSourceHealth } from "./source-health.js";

const panel = customElements.get("week-planner-panel");
if (!panel) {
  console.warn("Week Planner source health integration: panel element unavailable");
} else {
  const proto = panel.prototype;

  function service(instance) {
    if (!instance.__weekPlannerSourceHealth) {
      instance.__weekPlannerSourceHealth = new WeekPlannerSourceHealth({
        getNow: () => instance._now(),
        getConfig: () => instance._config,
        escapeHtml: (value) => instance._escape(value),
      });
    }
    return instance.__weekPlannerSourceHealth;
  }

  proto._healthNowIso = function() {
    return service(this).nowIso();
  };

  proto._markSourceAttempt = function(key, label) {
    service(this).markAttempt(key, label);
  };

  proto._markSourceSuccess = function(key, label) {
    service(this).markSuccess(key, label);
  };

  proto._markSourceFailure = function(key, label, err) {
    service(this).markFailure(key, label, err);
  };

  proto._markRuntimeAttempt = function() {
    service(this).markRuntimeAttempt();
  };

  proto._markRuntimeSuccess = function() {
    service(this).markRuntimeSuccess();
  };

  proto._markRuntimeFailure = function(err) {
    service(this).markRuntimeFailure(err);
  };

  proto._activeHealthItems = function() {
    return service(this).activeItems();
  };

  proto._healthIconMarkup = function() {
    return service(this).iconMarkup();
  };
}
