// Card configuration boundary for Week Planner.
//
// Data-source/provider configuration belongs exclusively to the integration's
// shared Week Planner config. The Lovelace card may only configure presentation
// concerns that are local to that card instance.

const Card = customElements.get("week-planner-card");
const Editor = customElements.get("week-planner-card-editor");

const PRESENTATION_KEYS = new Set([
  "type",
  "height",
  "show_toolbar",
  "hide_weather",
  "hide_sun",
  "hide_energy",
  "days_to_show",
  "default_scroll_hour",
  "scroll_mode",
]);

function presentationConfig(input = {}) {
  const clean = {};
  for (const [key, value] of Object.entries(input || {})) {
    if (PRESENTATION_KEYS.has(key)) clean[key] = value;
  }
  return clean;
}

if (Card) {
  const originalSetConfig = Card.prototype.setConfig;
  Card.prototype.setConfig = function setConfig(config) {
    // Never allow legacy Lovelace YAML/editor values for weather providers,
    // calendars, sun/moon, energy, history or shared view settings to reach
    // the card runtime.
    return originalSetConfig.call(this, presentationConfig(config));
  };

  // Card-local hide flags are presentation-only. Keep them as an additional
  // mask over the shared config, but do not replace the session visibility
  // state on every render (which previously broke the common topbar toggles).
  const panelWeatherVisible = Object.getPrototypeOf(Card.prototype)._weatherVisibleNow;
  const panelSunVisible = Object.getPrototypeOf(Card.prototype)._sunVisibleNow;
  const panelEnergyVisible = Object.getPrototypeOf(Card.prototype)._energyVisibleNow;

  Card.prototype._weatherVisibleNow = function weatherVisibleNow() {
    return !this._cardConfig?.hide_weather && panelWeatherVisible.call(this);
  };
  Card.prototype._sunVisibleNow = function sunVisibleNow() {
    return !this._cardConfig?.hide_sun && panelSunVisible.call(this);
  };
  Card.prototype._energyVisibleNow = function energyVisibleNow() {
    return !this._cardConfig?.hide_energy && panelEnergyVisible.call(this);
  };

  // Replace the old card render wrapper. It used to overwrite
  // _sessionVisibility before every render, making the card diverge from the
  // panel despite both using the same shared configuration/DataManager.
  const panelRender = Object.getPrototypeOf(Card.prototype)._render;
  Card.prototype._render = function render(allowScroll = true) {
    panelRender.call(this, allowScroll);
    requestAnimationFrame(() => {
      this._applyViewportHeight();
      this._applyCardPresentation();
    });
  };
}

if (Editor) {
  Editor.prototype.setConfig = function setConfig(config) {
    const incoming = presentationConfig(config);
    this._config = {
      height: Number(incoming.height ?? 700),
      show_toolbar: incoming.show_toolbar !== false,
      hide_weather: Boolean(incoming.hide_weather),
      hide_sun: Boolean(incoming.hide_sun),
      hide_energy: Boolean(incoming.hide_energy),
      days_to_show: Number.isFinite(Number(incoming.days_to_show))
        ? Math.min(14, Math.max(1, Math.round(Number(incoming.days_to_show))))
        : 7,
      default_scroll_hour: Number.isFinite(Number(incoming.default_scroll_hour))
        ? Math.min(23, Math.max(0, Number(incoming.default_scroll_hour)))
        : 6,
      scroll_mode: ["none", "fixed", "follow_now"].includes(incoming.scroll_mode)
        ? incoming.scroll_mode
        : "fixed",
    };
    this._render();
  };

  Editor.prototype._render = function render() {
    if (!this.shadowRoot) return;
    const cfg = this._config || {};
    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; color:var(--primary-text-color); }
        .editor { display:grid; gap:14px; padding:8px 0; }
        .box { display:grid; gap:11px; padding:12px; border:1px solid var(--divider-color); border-radius:9px; }
        .field { display:grid; gap:5px; }
        .title, label { font-size:13px; font-weight:500; }
        .hint { color:var(--secondary-text-color); font-size:12px; line-height:1.4; }
        .toggle { display:flex; align-items:center; gap:8px; }
        input[type="number"], select {
          width:100%; box-sizing:border-box; padding:9px; border-radius:8px;
          border:1px solid var(--divider-color); color:var(--primary-text-color);
          background:var(--card-background-color); font:inherit;
        }
      </style>
      <div class="editor">
        <div class="hint">Datakilder, kalendere, vejr, sol/måne og elpris styres af Week Planners fælles konfiguration. Dette kort indeholder kun lokale visningsindstillinger.</div>
        <div class="field">
          <label for="height">Card-højde</label>
          <input id="height" type="number" min="320" max="1600" step="20" value="${Number(cfg.height || 700)}">
        </div>
        <label class="toggle"><input id="toolbar" type="checkbox" ${cfg.show_toolbar !== false ? "checked" : ""}><span>Vis Week Planner-toolbar</span></label>
        <div class="box">
          <div class="title">Lokale lag</div>
          <label class="toggle"><input id="hideWeather" type="checkbox" ${cfg.hide_weather ? "checked" : ""}><span>Skjul vejr i dette card</span></label>
          <label class="toggle"><input id="hideSun" type="checkbox" ${cfg.hide_sun ? "checked" : ""}><span>Skjul sol/dagslængde i dette card</span></label>
          <label class="toggle"><input id="hideEnergy" type="checkbox" ${cfg.hide_energy ? "checked" : ""}><span>Skjul elpris i dette card</span></label>
        </div>
        <div class="field">
          <label for="daysToShow">Antal dage</label>
          <input id="daysToShow" type="number" min="1" max="14" step="1" value="${Number(cfg.days_to_show ?? 7)}">
        </div>
        <div class="field">
          <label for="scrollMode">Auto-scroll</label>
          <select id="scrollMode">
            <option value="none" ${cfg.scroll_mode === "none" ? "selected" : ""}>Ingen auto-scroll</option>
            <option value="fixed" ${cfg.scroll_mode === "fixed" ? "selected" : ""}>Scroll til angivet time</option>
            <option value="follow_now" ${cfg.scroll_mode === "follow_now" ? "selected" : ""}>Følg NU</option>
          </select>
        </div>
        <div class="field" id="scrollHourRow" ${cfg.scroll_mode === "fixed" ? "" : "style=\"display:none\""}>
          <label for="scrollHour">Tidspunkt</label>
          <input id="scrollHour" type="number" min="0" max="23" step="1" value="${Number(cfg.default_scroll_hour ?? 6)}">
        </div>
      </div>`;

    const emit = () => this._emitConfig();
    const bindBool = (id, key) => this.shadowRoot.getElementById(id)?.addEventListener("change", (event) => {
      this._config[key] = Boolean(event.target.checked);
      emit();
    });
    bindBool("toolbar", "show_toolbar");
    bindBool("hideWeather", "hide_weather");
    bindBool("hideSun", "hide_sun");
    bindBool("hideEnergy", "hide_energy");

    this.shadowRoot.getElementById("height")?.addEventListener("change", (event) => {
      const value = Number(event.target.value);
      this._config.height = Number.isFinite(value) ? Math.min(1600, Math.max(320, value)) : 700;
      emit();
    });
    this.shadowRoot.getElementById("daysToShow")?.addEventListener("change", (event) => {
      this._config.days_to_show = Math.min(14, Math.max(1, Math.round(Number(event.target.value || 7))));
      emit();
    });
    this.shadowRoot.getElementById("scrollMode")?.addEventListener("change", (event) => {
      this._config.scroll_mode = ["none", "fixed", "follow_now"].includes(event.target.value)
        ? event.target.value : "fixed";
      emit();
      this._render();
    });
    this.shadowRoot.getElementById("scrollHour")?.addEventListener("change", (event) => {
      this._config.default_scroll_hour = Math.min(23, Math.max(0, Number(event.target.value || 6)));
      emit();
    });
  };
}
