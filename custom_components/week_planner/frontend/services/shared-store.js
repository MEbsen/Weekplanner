import { WeekPlannerDataManager } from "./data-manager.js";
import { WeekPlannerSourceHealth } from "./source-health.js";

// One store per authenticated HA connection in this browser realm. Different
// tabs/devices have independent JS runtimes; their config converges by polling.
const stores = new WeakMap();
const stable = value => JSON.stringify(value, (_key, item) =>
  item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const addDays = (date, n) => { const d = new Date(date); d.setDate(d.getDate() + n); return d; };
const iso = date => date.toISOString();
const signature = config => stable(Object.fromEntries(Object.entries(config || {})
  .filter(([key]) => !["server_time", "version", "frontend_resource_url"].includes(key))));
const dataSignature = config => stable([
  "calendar_entities", "weather_entity", "weather_display", "show_sun_markers",
  "show_moon_markers", "history_sources", "energy_entity", "show_energy_prices",
].map(key => config?.[key]));
const withTimeout = promise => {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("Home Assistant request timed out")), 30000);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

export class WeekPlannerStore {
  constructor(hass) {
    this.hass = hass;
    this.config = null;
    this.generation = 0;
    this.clients = new Set();
    this.ranges = new Map();
    this.requests = new Map();
    this.configPending = null;
    this.lastConfigSync = 0;
    this.configRevision = 0;
    this.timer = null;
    this.tickCount = 0;
    this.ticking = false;
    this.runtime = { status:"unknown", last_success:null, last_attempt:null, last_error:"" };
  }

  attach(host) {
    this.clients.add(host);
    if (!this.timer) this.timer = setInterval(() => this.tick(), 60000);
  }

  detach(host) {
    this.clients.delete(host);
    if (!this.clients.size) {
      clearInterval(this.timer);
      this.timer = null;
      for (const entry of this.ranges.values()) this.stopSubscriptions(entry);
    } else this.releaseUnusedRanges();
  }

  activeKeys() {
    return new Set([...this.clients].filter(host => host._config)
      .map(host => this.rangeKey(host._weekStart, host._dayCount())));
  }

  releaseUnusedRanges() {
    const active = this.activeKeys();
    for (const [key, entry] of this.ranges) {
      if (!active.has(key)) this.stopSubscriptions(entry);
    }
    // Bound memory while retaining a few recently visited ranges.
    for (const [key] of this.ranges) {
      if (this.ranges.size <= 12) break;
      if (!active.has(key)) this.ranges.delete(key);
    }
    while (this.requests.size > 128) {
      const key = [...this.requests].find(([, entry]) => !entry.pending)?.[0];
      if (key === undefined) break;
      this.requests.delete(key);
    }
  }

  async getConfig(force = false) {
    if (this.configPending) return this.configPending;
    if (!force && this.config && Date.now() - this.lastConfigSync < 60000) return this.config;
    const revision = this.configRevision;
    const pending = withTimeout(this.hass.connection.sendMessagePromise({ type:"week_planner/config" }))
      .then(config => {
        // A read begun before a save must not undo that save.
        if (revision === this.configRevision) this.applyConfig(config);
        this.lastConfigSync = Date.now();
        return this.config;
      }).finally(() => { if (this.configPending === pending) this.configPending = null; });
    this.configPending = pending;
    return pending;
  }

  applyConfig(config) {
    const changed = signature(this.config) !== signature(config);
    const dataChanged = dataSignature(this.config) !== dataSignature(config);
    this.config = structuredClone(config);
    this.configRevision++;
    if (dataChanged) {
      this.generation++;
      for (const entry of this.ranges.values()) this.stopSubscriptions(entry);
      this.ranges.clear();
      this.requests.clear();
    }
    for (const host of this.clients) {
      const previous = host._config;
      host._syncServerTime?.(config.server_time);
      if (!previous) continue;
      host._config = this.config;
      if (changed) {
        if (previous.view_mode !== config.view_mode) host._weekStart = host._startOfView();
        // Existing view-local scroll and layer visibility remain independent.
        Promise.resolve().then(() => {
          if (!this.clients.has(host)) return;
          return host._loadData(false).then(() => {
            if (!this.clients.has(host)) return;
            host._render(false);
            return host._setupCalendarSubscriptions();
          });
        }).catch(error => console.warn("Week Planner config refresh failed", error));
      }
    }
    return this.config;
  }

  // Cache successes only; rejected requests remain retryable. Pending work is
  // deduplicated even when several views hit the refresh timer simultaneously.
  request(kind, args, run, ttl) {
    const key = stable([this.generation, kind, args]);
    const cached = this.requests.get(key);
    if (cached?.pending) return cached.pending;
    if (cached && Date.now() - cached.time < ttl) return Promise.resolve(cached.value);
    const entry = {};
    entry.pending = withTimeout(Promise.resolve().then(run)).then(value => {
      entry.value = value;
      entry.time = Date.now();
      entry.pending = null;
      return value;
    }, error => { if (this.requests.get(key) === entry) this.requests.delete(key); throw error; });
    this.requests.set(key, entry);
    return entry.pending;
  }

  transport() {
    return {
      get states() { return this.store.hass.states; },
      store: this,
      callWS: args => this.request("ws", args, () => this.hass.callWS(args),
        args.domain === "calendar" ? 55000 : 290000),
      callApi: (method, path) => this.request("api", [method,path],
        () => this.hass.callApi(method,path), 290000),
    };
  }

  rangeKey(start, count) { return stable([this.generation, iso(new Date(start)), count]); }

  manager(host) {
    const start = new Date(host._weekStart);
    const count = host._dayCount();
    const key = this.rangeKey(start, count);
    let entry = this.ranges.get(key);
    if (!entry) {
      const config = structuredClone(this.config || host._config || {});
      const health = new WeekPlannerSourceHealth({
        getNow: () => new Date(), getConfig: () => config,
        escapeHtml: value => String(value ?? "").replaceAll("&","&amp;")
          .replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;"),
      });
      // Runtime connection state is shared across range-specific health.
      Object.defineProperty(health, "runtime", { get:() => this.runtime, set:value => { this.runtime=value; } });
      const manager = new WeekPlannerDataManager({
        getHass: () => this.transport(), getConfig: () => config,
        getWeekStart: () => start, getDayCount: () => count, addDays, isoLocal:iso,
        stableJson:stable, sourceHealth:health,
        energyCompatibility: () => {
          const attrs = this.hass.states?.[config.energy_entity]?.attributes || {};
          return { ok:["raw_today","raw_tomorrow","forecast","prices","today","tomorrow"]
            .some(name => Array.isArray(attrs[name]) && attrs[name].length),
            text:"Ingen understøttet timepris-attribut fundet." };
        },
      });
      entry = { manager, health, key, unsubscribers:[], subscriptionToken:0, subscribed:false };
      this.ranges.set(key, entry);
    }
    this.releaseUnusedRanges();
    return entry.manager;
  }

  health(host) {
    this.manager(host);
    return this.ranges.get(this.rangeKey(host._weekStart, host._dayCount())).health;
  }

  notify(manager, result = null, except = null) {
    for (const host of this.clients) {
      if (host !== except && this.manager(host) === manager) {
        if (result) {
          host._warnings = result.warnings || [];
          host._error = result.error || "";
        }
        host._render(false);
      }
    }
  }

  stopSubscriptions(entry) {
    entry.subscriptionToken++;
    entry.subscribed = false;
    for (const unsubscribe of entry.unsubscribers.splice(0)) {
      Promise.resolve().then(unsubscribe).catch(error => console.debug("Calendar unsubscribe failed", error));
    }
  }

  async subscribe(host) {
    if (!this.clients.has(host)) return;
    this.manager(host);
    const entry = this.ranges.get(this.rangeKey(host._weekStart, host._dayCount()));
    if (entry.subscribed || !this.hass.connection.subscribeMessage) return;
    entry.subscribed = true;
    const token = ++entry.subscriptionToken;
    const config = entry.manager.getConfig();
    const { start, end } = entry.manager.range();
    for (const entityId of config.calendar_entities || []) {
      if (entry.subscriptionToken !== token) return;
      try {
        const unsubscribe = await this.hass.connection.subscribeMessage(payload => {
          if (entry.subscriptionToken !== token) return;
          const events = payload?.events ?? payload?.event?.events;
          if (!Array.isArray(events)) return;
          // A push invalidates older poll results, including transport cache.
          for (const key of this.requests.keys()) {
            if (key.includes('"domain":"calendar"')) this.requests.delete(key);
          }
          const next = { ...entry.manager.events, [entityId]:{events} };
          entry.manager.invalidateCalendar();
          const healthBefore = entry.health.renderSignature();
          entry.health.markSuccess("calendar", "Kalendere");
          if (entry.manager.changed(entry.manager.events, next) || healthBefore !== entry.health.renderSignature()) {
            entry.manager.events = next;
            this.notify(entry.manager);
          }
        }, { type:"calendar/event/subscribe", entity_id:entityId, start:iso(start), end:iso(end) });
        if (entry.subscriptionToken !== token) await unsubscribe?.();
        else if (typeof unsubscribe === "function") entry.unsubscribers.push(unsubscribe);
      } catch (error) {
        // Retry on the next lifecycle/poll instead of permanently caching failure.
        this.stopSubscriptions(entry);
        console.debug("Week Planner calendar subscription failed", error);
        break;
      }
    }
  }

  async tick() {
    if (this.ticking || !this.clients.size) return;
    this.ticking = true;
    try {
      await this.getConfig(true);
      const runtimeChanged = this.runtime.status !== "fresh";
      const now = new Date().toISOString();
      this.runtime = { status:"fresh", last_success:now, last_attempt:now, last_error:"" };
      if (runtimeChanged) for (const host of this.clients) host._render(false);
      this.tickCount++;
      const full = this.tickCount % 5 === 0;
      await Promise.allSettled([...this.clients].map(async host => {
        if (!host._config) return;
        const rolled = await host._handleDayRollover();
        if (!rolled) {
          if (full) await host._loadData(false);
          else await host._refreshCalendarEvents(false);
        }
        await this.subscribe(host);
      }));
    } catch (error) {
      for (const host of this.clients) {
        host._markRuntimeFailure(error);
        host._render(false);
      }
    } finally { this.ticking = false; }
  }
}

export function sharedStore(hass) {
  const connection = hass?.connection;
  if (!connection) throw new Error("Home Assistant connection unavailable");
  let store = stores.get(connection);
  if (!store) { store = new WeekPlannerStore(hass); stores.set(connection, store); }
  store.hass = hass;
  return store;
}
