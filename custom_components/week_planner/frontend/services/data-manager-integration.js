import { sharedStore } from "./shared-store.js";

const panel = customElements.get("week-planner-panel");
if (!panel) throw new Error("Week Planner data integration requires panel definition");
const proto = panel.prototype;

proto._sharedStore = function() {
  const store = sharedStore(this._hass);
  if (this.__sharedStore && this.__sharedStore !== store) this.__sharedStore.detach(this);
  this.__sharedStore = store;
  if (this.isConnected) store.attach(this);
  return store;
};

proto._getSharedConfig = async function(force = false) {
  const store = this._sharedStore();
  await store.getConfig(force);
  return store.config;
};

proto._applySharedConfig = function(config) {
  return this._sharedStore().applyConfig(config);
};

proto._dataManager = function() {
  return this._sharedStore().manager(this);
};

proto._dataSnapshot = function() { return this._dataManager().snapshot(); };

proto._loadDataManaged = async function() {
  const manager = this._dataManager();
  const before = this._healthRenderSignature();
  const result = await manager.loadAll();
  if (!this.isConnected || this._dataManager() !== manager) return { obsolete:true };
  if (result.changed || before !== this._healthRenderSignature()) {
    this._sharedStore().notify(manager, result, this);
  }
  return result;
};

proto._refreshCalendarEventsManaged = async function() {
  const manager = this._dataManager();
  const result = await manager.fetchCalendars();
  if (!this.isConnected || this._dataManager() !== manager) return { obsolete:true };
  return result;
};

proto._setupCalendarSubscriptions = function() {
  return this._sharedStore().subscribe(this);
};

proto._clearCalendarSubscriptions = function() {
  this.__sharedStore?.releaseUnusedRanges();
};

const disconnect = proto.disconnectedCallback;
proto.disconnectedCallback = function() {
  this.__sharedStore?.detach(this);
  return disconnect.call(this);
};
