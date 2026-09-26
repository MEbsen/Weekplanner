import { WeekPlannerScrollController } from "./scroll-controller.js";

const HOUR_HEIGHT = 76;
const MANUAL_OVERRIDE_MS = 5 * 60 * 1000;

function scrollSignature(host) {
  return JSON.stringify({
    mode: host._effectiveScrollMode?.() || "fixed",
    hour: Number(host._effectiveScrollHour?.() ?? 6),
  });
}

function ensureController(host) {
  if (!host._weekPlannerScrollController) {
    host._weekPlannerScrollController = new WeekPlannerScrollController({
      getMode: () => host._effectiveScrollMode?.() || "fixed",
      getFixedHour: () => Number(host._effectiveScrollHour?.() ?? 6),
      getNow: () => host._now?.() || new Date(),
      hourHeight: HOUR_HEIGHT,
      manualOverrideMs: MANUAL_OVERRIDE_MS,
    });
    host._weekPlannerScrollSignature = scrollSignature(host);
  }

  const nextSignature = scrollSignature(host);
  if (host._weekPlannerScrollSignature !== nextSignature) {
    host._weekPlannerScrollSignature = nextSignature;
    host._weekPlannerScrollController.onConfigChanged();
  }

  return host._weekPlannerScrollController;
}

function attachToCurrentDom(host) {
  const controller = ensureController(host);
  controller.attach(host.shadowRoot);

  // Disable the legacy scroll-state branches. The old fields stay in the
  // core temporarily for compatibility, but the service is authoritative.
  host._scrollState = "service";
  host._scrollPositioned = false;

  const scroll = host.shadowRoot?.getElementById("scroll");
  const header = host.shadowRoot?.getElementById("headerScroll");
  if (!scroll || scroll.dataset.weekPlannerScrollService === "1") return;

  scroll.dataset.weekPlannerScrollService = "1";
  scroll.addEventListener("scroll", () => {
    if (header) header.scrollLeft = scroll.scrollLeft;
    controller.onManualScroll(scroll);
  }, { passive: true });
}

function patchPlannerPrototype(proto) {
  if (!proto || proto.__weekPlannerScrollServicePatched) return;
  proto.__weekPlannerScrollServicePatched = true;

  const originalRender = proto._render;
  proto._render = function(...args) {
    const result = originalRender.apply(this, args);
    this._scrollState = "service";
    this._scrollPositioned = false;
    requestAnimationFrame(() => attachToCurrentDom(this));
    return result;
  };

  proto._positionScroll = function(reason = "render", force = false) {
    this._scrollState = "service";
    this._scrollPositioned = false;
    ensureController(this).attach(this.shadowRoot);
    ensureController(this).position(reason, force);
  };

  proto._resumeAutoScroll = function(_reason = "focus") {
    this._scrollState = "service";
    this._scrollPositioned = false;
    ensureController(this).attach(this.shadowRoot);
    ensureController(this).onFocus();
  };

  proto._shouldAutoRepositionAfterRender = function() {
    return false;
  };

  const originalDayRollover = proto._handleDayRollover;
  proto._handleDayRollover = async function(...args) {
    const rolled = await originalDayRollover.apply(this, args);
    this._scrollState = "service";
    this._scrollPositioned = false;
    if (rolled) ensureController(this).onDayChange();
    return rolled;
  };

  const originalDisconnected = proto.disconnectedCallback;
  proto.disconnectedCallback = function(...args) {
    this._weekPlannerScrollController?.destroy();
    this._weekPlannerScrollController = null;
    return originalDisconnected?.apply(this, args);
  };
}

const PanelClass = customElements.get("week-planner-panel");
if (!PanelClass) {
  throw new Error("Week Planner scroll integration loaded before week-planner core");
}

patchPlannerPrototype(PanelClass.prototype);

// Card and managed dashboard card inherit the patched panel prototype. Their
// own render/config methods may run additional presentation logic, but scroll
// semantics remain identical because all positioning routes through the same
// service.
window.weekPlannerScrollServiceVersion = "0.5.3-dev.13";
