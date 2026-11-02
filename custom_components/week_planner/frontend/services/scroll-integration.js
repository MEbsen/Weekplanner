import { WeekPlannerScrollController } from "./scroll-controller.js";

function scrollSignature(host) {
  return JSON.stringify({
    mode:host._effectiveScrollMode?.() || "fixed",
    hour:Number(host._effectiveScrollHour?.() ?? 6),
  });
}

function ensureController(host) {
  if (!host._weekPlannerScrollController) {
    host._weekPlannerScrollController = new WeekPlannerScrollController({
      getMode:() => host._effectiveScrollMode?.() || "fixed",
      getFixedHour:() => Number(host._effectiveScrollHour?.() ?? 6),
      getNow:() => host._now?.() || new Date(),
      hourHeight:76,
    });
    host._weekPlannerScrollSignature = scrollSignature(host);
  }
  const signature = scrollSignature(host);
  if (host._weekPlannerScrollSignature !== signature) {
    host._weekPlannerScrollSignature = signature;
    host._weekPlannerScrollController.onConfigChanged();
  }
  return host._weekPlannerScrollController;
}

function patchPlannerPrototype(proto) {
  const render = proto._render;
  proto._render = function(...args) {
    const result = render.apply(this, args);
    // Observe the current DOM immediately. The controller waits for geometry,
    // including viewport/card sizing applied in a later frame.
    if (this.isConnected) ensureController(this).attach(this.shadowRoot);
    return result;
  };

  const resize = proto._applyViewportHeight;
  proto._applyViewportHeight = function(...args) {
    const result = resize.apply(this, args);
    this._weekPlannerScrollController?.position("viewport-resize");
    return result;
  };

  proto._positionScroll = function(reason = "render", force = false) {
    if (!this.isConnected) return;
    const controller = ensureController(this);
    controller.attach(this.shadowRoot);
    controller.position(reason, force);
  };

  proto._resumeAutoScroll = function() {
    if (!this.isConnected) return;
    const controller = ensureController(this);
    controller.attach(this.shadowRoot);
    controller.onFocus();
  };

  proto._shouldAutoRepositionAfterRender = () => false;
  const rollover = proto._handleDayRollover;
  proto._handleDayRollover = async function(...args) {
    const rolled = await rollover.apply(this, args);
    if (rolled && this.isConnected) {
      const controller = ensureController(this);
      controller.attach(this.shadowRoot);
      controller.onDayChange();
    }
    return rolled;
  };

  const disconnect = proto.disconnectedCallback;
  proto.disconnectedCallback = function(...args) {
    this._weekPlannerScrollController?.destroy();
    this._weekPlannerScrollController = null;
    return disconnect?.apply(this, args);
  };
}

const Panel = customElements.get("week-planner-panel");
if (!Panel) throw new Error("Week Planner scroll integration loaded before core");
patchPlannerPrototype(Panel.prototype);
window.weekPlannerScrollServiceVersion = "0.5.3-dev.29";
