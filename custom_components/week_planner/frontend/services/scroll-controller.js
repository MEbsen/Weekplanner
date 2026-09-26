export const ScrollMode = Object.freeze({
  FOLLOW_NOW: "follow_now",
  FIXED: "fixed",
  NONE: "none",
});

export const ScrollState = Object.freeze({
  AUTO: "auto",
  MANUAL_OVERRIDE: "manual_override",
  MANUAL_STATIC: "manual_static",
});

const DEFAULT_OVERRIDE_MS = 5 * 60 * 1000;

/**
 * Shared Week Planner scroll state machine.
 *
 * Panel and Lovelace card must use the same controller. Rendering/data refresh
 * is deliberately transparent to the logical state: a rebuilt DOM restores
 * the current viewport instead of changing mode.
 */
export class WeekPlannerScrollController {
  constructor({
    getMode,
    getFixedHour,
    getNow,
    hourHeight,
    manualOverrideMs = DEFAULT_OVERRIDE_MS,
    onStateChange = null,
  }) {
    this.getMode = getMode;
    this.getFixedHour = getFixedHour;
    this.getNow = getNow;
    this.hourHeight = hourHeight;
    this.manualOverrideMs = manualOverrideMs;
    this.onStateChange = onStateChange;

    this.state = ScrollState.AUTO;
    this.savedTop = null;
    this.savedLeft = 0;
    this.manualUntil = 0;
    this.programmaticUntil = 0;
    this.requestId = 0;
    this.returnTimer = null;
  }

  destroy() {
    this.requestId++;
    if (this.returnTimer) clearTimeout(this.returnTimer);
    this.returnTimer = null;
  }

  mode() {
    return this.getMode?.() || ScrollMode.FIXED;
  }

  isProgrammatic() {
    return Date.now() <= this.programmaticUntil;
  }

  _notify(reason) {
    this.onStateChange?.({
      state: this.state,
      mode: this.mode(),
      savedTop: this.savedTop,
      savedLeft: this.savedLeft,
      manualUntil: this.manualUntil,
      reason,
    });
  }

  _clearReturnTimer() {
    if (this.returnTimer) clearTimeout(this.returnTimer);
    this.returnTimer = null;
  }

  _scheduleReturn() {
    this._clearReturnTimer();
    if (this.state !== ScrollState.MANUAL_OVERRIDE) return;

    const remaining = Math.max(0, this.manualUntil - Date.now());
    this.returnTimer = setTimeout(() => {
      this.returnTimer = null;
      if (this.state !== ScrollState.MANUAL_OVERRIDE) return;
      this.state = ScrollState.AUTO;
      this.manualUntil = 0;
      this.savedTop = null;
      this.requestId++;
      this._notify("manual-timeout");
      this.position("manual-timeout", true);
    }, remaining);
  }

  onManualScroll(scrollElement) {
    if (!scrollElement || this.isProgrammatic()) return;

    this.savedTop = scrollElement.scrollTop;
    this.savedLeft = scrollElement.scrollLeft || 0;
    this.requestId++;

    if (this.mode() === ScrollMode.NONE) {
      this.state = ScrollState.MANUAL_STATIC;
      this.manualUntil = 0;
      this._clearReturnTimer();
      this._notify("manual-static");
      return;
    }

    this.state = ScrollState.MANUAL_OVERRIDE;
    this.manualUntil = Date.now() + this.manualOverrideMs;
    this._scheduleReturn();
    this._notify("manual-override");
  }

  onConfigChanged() {
    this._clearReturnTimer();
    this.requestId++;
    this.savedTop = null;
    this.savedLeft = 0;
    this.manualUntil = 0;
    this.state = this.mode() === ScrollMode.NONE
      ? ScrollState.MANUAL_STATIC
      : ScrollState.AUTO;
    this._notify("config-changed");
  }

  onFocus() {
    // Focus itself does not cancel a user's five-minute override. It merely
    // makes sure the current logical state is represented by the current DOM.
    if (this.state === ScrollState.MANUAL_OVERRIDE && Date.now() >= this.manualUntil) {
      this.state = ScrollState.AUTO;
      this.manualUntil = 0;
      this.savedTop = null;
      this._clearReturnTimer();
    }
    this.position("focus", true);
  }

  onDayChange() {
    this.requestId++;

    // A new calendar day is an explicit lifecycle boundary for automatic
    // modes. Yesterday's viewport (including an active five-minute manual
    // override) must never leak into the new day. Re-evaluate FOLLOW_NOW or
    // FIXED immediately against the new day's DOM.
    if (this.mode() === ScrollMode.NONE) {
      // NONE means the user owns the viewport, so preserve it across midnight.
      this._notify("day-change-static");
      this.position("day-change-static", true);
      return;
    }

    this._clearReturnTimer();
    this.state = ScrollState.AUTO;
    this.manualUntil = 0;
    this.savedTop = null;
    this.savedLeft = 0;
    this._notify("day-change");
    this.position("day-change", true);
  }

  onRender() {
    // A HA/data/Lovelace render is NOT a state transition.
    this.position("render", true);
  }

  _target(scroll) {
    const mode = this.mode();
    if (mode === ScrollMode.NONE) return null;

    const maxScroll = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
    if (mode === ScrollMode.FOLLOW_NOW) {
      const now = this.getNow();
      const minutes = now.getHours() * 60 + now.getMinutes();
      const nowY = (minutes / 60) * this.hourHeight;
      return Math.max(0, Math.min(maxScroll, nowY - 8));
    }

    const fixedHour = Number(this.getFixedHour?.() ?? 6);
    return Math.max(0, Math.min(maxScroll, fixedHour * this.hourHeight - 8));
  }

  _restoreManual(scroll, header) {
    if (this.savedTop == null) return false;
    const maxScroll = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
    this.programmaticUntil = Date.now() + 300;
    scroll.scrollTop = Math.max(0, Math.min(maxScroll, this.savedTop));
    scroll.scrollLeft = this.savedLeft || 0;
    if (header) header.scrollLeft = scroll.scrollLeft;
    return true;
  }

  position(reason = "render", force = false) {
    const requestId = ++this.requestId;
    const delays = force ? [0, 60, 140, 280, 500, 900] : [0];

    const attempt = (index) => {
      if (requestId !== this.requestId) return;

      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (requestId !== this.requestId) return;

        const root = this.root;
        const scroll = root?.getElementById("scroll");
        const header = root?.getElementById("headerScroll");
        if (!scroll || scroll.clientHeight <= 0 || scroll.scrollHeight <= scroll.clientHeight) {
          if (index + 1 < delays.length) {
            setTimeout(() => attempt(index + 1), delays[index + 1]);
          }
          return;
        }

        if (this.state === ScrollState.MANUAL_OVERRIDE) {
          if (Date.now() < this.manualUntil) {
            this._restoreManual(scroll, header);
            this._scheduleReturn();
            return;
          }
          this.state = ScrollState.AUTO;
          this.manualUntil = 0;
          this.savedTop = null;
          this._clearReturnTimer();
        }

        if (this.state === ScrollState.MANUAL_STATIC || this.mode() === ScrollMode.NONE) {
          this._restoreManual(scroll, header);
          return;
        }

        const target = this._target(scroll);
        if (target == null) return;
        this.programmaticUntil = Date.now() + 300;
        scroll.scrollTop = target;
        this.savedTop = target;
        this.savedLeft = scroll.scrollLeft || 0;
        if (header) header.scrollLeft = scroll.scrollLeft;
        this._notify(reason);
      }));
    };

    attempt(0);
  }

  attach(root) {
    this.root = root;
    this.onRender();
  }
}
