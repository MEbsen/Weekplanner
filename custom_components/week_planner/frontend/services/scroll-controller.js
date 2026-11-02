export const ScrollMode = Object.freeze({
  FOLLOW_NOW: "follow_now", FIXED: "fixed", NONE: "none",
});
export const ScrollState = Object.freeze({
  AUTO: "auto", MANUAL_OVERRIDE: "manual_override", MANUAL_STATIC: "manual_static",
});
const DEFAULT_OVERRIDE_MS = 5 * 60 * 1000;
const SCROLL_KEYS = new Set(["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","PageUp","PageDown","Home","End"," "]);

/**
 * Per-view scroll state over the shared data layer.
 * Geometry observers, rather than a startup deadline, determine when a view
 * can be positioned. Only actual input can enter manual override.
 */
export class WeekPlannerScrollController {
  constructor({ getMode, getFixedHour, getNow, hourHeight,
    manualOverrideMs = DEFAULT_OVERRIDE_MS, onStateChange = null }) {
    Object.assign(this, {getMode,getFixedHour,getNow,hourHeight,manualOverrideMs,onStateChange});
    this.state = ScrollState.AUTO;
    this.savedTop = null;
    this.savedLeft = 0;
    this.manualUntil = 0;
    this.returnTimer = null;
    this.root = null;
    this.scroll = null;
    this.frame = null;
    this.retryTimer = null;
    this.listeners = [];
    this.destroyed = false;
    this.pendingRestore = false;
    this.expectedTop = null;
    this.inputUntil = 0;
    this.dragging = false;
    this.reason = "initial";
  }

  destroy() {
    this.destroyed = true;
    this._clearReturnTimer();
    this._cancelFrame();
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.resizeObserver?.disconnect();
    this.mutationObserver?.disconnect();
    this._unbind();
    this.root = null;
  }

  mode() { return this.getMode?.() || ScrollMode.FIXED; }

  _notify(reason) {
    this.onStateChange?.({
      state:this.state, mode:this.mode(), savedTop:this.savedTop,
      savedLeft:this.savedLeft, manualUntil:this.manualUntil, reason,
    });
  }

  _cancelFrame() {
    if (this.frame != null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  _clearReturnTimer() {
    clearTimeout(this.returnTimer);
    this.returnTimer = null;
  }

  _scheduleReturn() {
    this._clearReturnTimer();
    if (this.state !== ScrollState.MANUAL_OVERRIDE) return;
    this.returnTimer = setTimeout(() => {
      this.returnTimer = null;
      if (this.destroyed || this.state !== ScrollState.MANUAL_OVERRIDE) return;
      this.state = ScrollState.AUTO;
      this.manualUntil = 0;
      this.savedTop = null;
      this._notify("manual-timeout");
      this.position("manual-timeout");
    }, Math.max(0, this.manualUntil - Date.now()));
  }

  onManualScroll(scroll = this.scroll) {
    if (!scroll || this.destroyed) return;
    // Called from input handlers, never from an unclassified scroll event.
    this._cancelFrame();
    this.pendingRestore = false;
    this.inputUntil = Date.now() + 1500;
    this.savedTop = scroll.scrollTop;
    this.savedLeft = scroll.scrollLeft || 0;
    this.state = this.mode() === ScrollMode.NONE
      ? ScrollState.MANUAL_STATIC : ScrollState.MANUAL_OVERRIDE;
    this.manualUntil = this.state === ScrollState.MANUAL_OVERRIDE
      ? Date.now() + this.manualOverrideMs : 0;
    this._scheduleReturn();
    this._notify("user-input");
  }

  _onScroll() {
    const scroll = this.scroll;
    if (!scroll) return;
    const header = this.root?.getElementById("headerScroll");
    if (header) header.scrollLeft = scroll.scrollLeft;
    // Native scroll events can arrive long after a write on a busy machine.
    // Matching the actual position is reliable; a 300ms suppression window isn't.
    if (this.pendingRestore || (this.expectedTop != null
      && Math.abs(scroll.scrollTop - this.expectedTop) < 1
      && Math.abs(scroll.scrollLeft - this.savedLeft) < 1)) return;
    if ((this.dragging || Date.now() <= this.inputUntil) && this.state !== ScrollState.AUTO) {
      this.savedTop = scroll.scrollTop;
      this.savedLeft = scroll.scrollLeft || 0;
      this.inputUntil = Date.now() + 1500; // touch/wheel momentum
      if (this.state === ScrollState.MANUAL_OVERRIDE) {
        this.manualUntil = Date.now() + this.manualOverrideMs;
        this._scheduleReturn();
      }
    } else if (this.state === ScrollState.AUTO) {
      // Browser anchoring, layout changes and DOM restoration are not user input.
      this.position("browser-scroll");
    }
  }

  onConfigChanged() {
    this._clearReturnTimer();
    this.savedTop = null;
    this.savedLeft = 0;
    this.manualUntil = 0;
    this.inputUntil = 0;
    this.state = this.mode() === ScrollMode.NONE ? ScrollState.MANUAL_STATIC : ScrollState.AUTO;
    this._notify("config-changed");
    this.position("config-changed");
  }

  onFocus() { this.position("focus"); }

  onDayChange() {
    if (this.mode() !== ScrollMode.NONE) {
      this._clearReturnTimer();
      this.state = ScrollState.AUTO;
      this.manualUntil = 0;
      this.inputUntil = 0;
      this.savedTop = null;
      this.savedLeft = 0;
    }
    this.position("day-change");
  }

  onRender() { this.position("render"); }

  _target(scroll) {
    if (this.mode() === ScrollMode.NONE) return null;
    const max = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
    const now = this.getNow();
    const hour = this.mode() === ScrollMode.FOLLOW_NOW
      ? now.getHours() + now.getMinutes() / 60 : Number(this.getFixedHour?.() ?? 6);
    return Math.max(0, Math.min(max, hour * this.hourHeight - 8));
  }

  _listen(target, event, callback, options = {passive:true}) {
    target?.addEventListener(event, callback, options);
    this.listeners.push(() => target?.removeEventListener(event, callback, options));
  }

  _unbind() {
    for (const remove of this.listeners.splice(0)) remove();
    this.scroll = null;
    this.dragging = false;
  }

  _bindDom() {
    const scroll = this.root?.getElementById("scroll");
    if (scroll === this.scroll) return;
    this.resizeObserver?.disconnect();
    this._unbind();
    this.scroll = scroll;
    this.expectedTop = null;
    this.pendingRestore = true;
    if (!scroll) return;
    this._listen(scroll, "scroll", () => this._onScroll());
    this._listen(scroll, "wheel", event => {
      if (event.deltaX || event.deltaY) this.onManualScroll();
    });
    this._listen(scroll, "touchmove", () => this.onManualScroll());
    this._listen(scroll, "pointerdown", event => {
      // Scrollbar/empty viewport; a click on an event/button isn't a scroll.
      if (event.target === scroll) {
        this.dragging = true;
        this.onManualScroll();
      }
    });
    this._listen(scroll.ownerDocument?.defaultView, "pointerup", () => { this.dragging = false; });
    this._listen(scroll, "pointermove", event => {
      if (event.buttons && this.state !== ScrollState.AUTO) this.inputUntil = Date.now() + 1500;
    });
    this._listen(scroll, "keydown", event => {
      const target = event.target;
      if (!SCROLL_KEYS.has(event.key) || target?.isContentEditable
        || ["INPUT","TEXTAREA","SELECT","BUTTON"].includes(target?.tagName)) return;
      this.onManualScroll();
    });
    this.resizeObserver?.observe(scroll);
    // The viewport and its content may become measurable in different frames.
    if (scroll.firstElementChild) this.resizeObserver?.observe(scroll.firstElementChild);
  }

  _apply() {
    this._bindDom();
    const scroll = this.scroll;
    if (!scroll || scroll.clientHeight <= 0 || scroll.scrollHeight <= 0) {
      this._fallbackRetry();
      return;
    }
    if (this.state === ScrollState.MANUAL_OVERRIDE && Date.now() >= this.manualUntil) {
      this.state = ScrollState.AUTO;
      this.manualUntil = 0;
      this.savedTop = null;
      this._clearReturnTimer();
    }
    const manual = this.state !== ScrollState.AUTO || this.mode() === ScrollMode.NONE;
    const desired = manual ? this.savedTop : this._target(scroll);
    this.pendingRestore = false;
    if (desired == null) return;
    const top = Math.max(0, Math.min(scroll.scrollHeight - scroll.clientHeight, desired));
    const left = this.savedLeft || 0;
    // Explicit instant behavior also overrides inherited smooth scrolling.
    if (typeof scroll.scrollTo === "function") scroll.scrollTo({top,left,behavior:"instant"});
    else { scroll.scrollTop = top; scroll.scrollLeft = left; }
    this.expectedTop = scroll.scrollTop;
    if (!manual) this.savedTop = this.expectedTop;
    const header = this.root?.getElementById("headerScroll");
    if (header) header.scrollLeft = scroll.scrollLeft;
    this._notify(this.reason);
  }

  _fallbackRetry() {
    // Modern browsers wake via ResizeObserver/MutationObserver, including after
    // an arbitrarily long hidden/loading period. Fallback has no startup cutoff.
    if ((this.resizeObserver && this.mutationObserver) || this.retryTimer != null) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.position("layout-retry");
    }, 500);
  }

  position(reason = "render", _force = false) {
    if (this.destroyed) return;
    this.reason = reason;
    // Coalescing avoids a stream of renders cancelling all pending writes on
    // slow CPUs. One frame always reconciles the latest DOM and state.
    if (this.frame != null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      if (!this.destroyed) this._apply();
    });
  }

  attach(root) {
    if (this.destroyed) return;
    if (root !== this.root) {
      this.mutationObserver?.disconnect();
      this.root = root;
      if (typeof MutationObserver === "function" && root) {
        this.mutationObserver = new MutationObserver(() => {
          if (this.root?.getElementById("scroll") !== this.scroll) {
            this._bindDom();
            this.position("dom-ready");
          }
        });
        this.mutationObserver.observe(root, {childList:true,subtree:true});
      }
    }
    if (!this.resizeObserver && typeof ResizeObserver === "function") {
      this.resizeObserver = new ResizeObserver(() => this.position("layout-ready"));
    }
    this._bindDom();
    this.position("attach");
  }
}
