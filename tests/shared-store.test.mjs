import test from "node:test";
import assert from "node:assert/strict";
import { WeekPlannerDataManager } from "../custom_components/week_planner/frontend/services/data-manager.js";
import { WeekPlannerStore, sharedStore } from "../custom_components/week_planner/frontend/services/shared-store.js";
import { WeekPlannerSourceHealth } from "../custom_components/week_planner/frontend/services/source-health.js";
import { dailyForecastFromHourly } from "../custom_components/week_planner/frontend/services/weather-data.js";

const config = overrides => ({
  calendar_entities:["calendar.family"], weather_entity:"weather.home", weather_display:"both",
  show_sun_markers:true, show_moon_markers:true, history_sources:[], view_mode:"rolling",
  ...overrides,
});
function fixture(overrides = {}) {
  const calls = [];
  let current = config(overrides);
  const hass = {
    states:{}, user:{is_admin:true},
    connection:{
      sendMessagePromise:async args => { calls.push(args); return structuredClone(current); },
    },
    callWS:async args => {
      calls.push(args);
      if (args.domain === "calendar") return {response:{"calendar.family":{events:[]}}};
      if (args.domain === "weather") return {response:{"weather.home":{forecast:[
        {datetime:"2026-11-02T12:00:00",temperature:12},
      ]}}};
      if (args.type === "week_planner/moon_transitions") return [];
      return {};
    },
    callApi:async () => [],
  };
  const store = new WeekPlannerStore(hass);
  const host = (count=7, start="2026-11-02") => ({
    _config:store.config, _weekStart:new Date(start+"T00:00:00"), _dayCount:()=>count,
    _syncServerTime(){}, _render(){}, _startOfView:()=>new Date(start+"T00:00:00"),
    _loadData:async()=>{}, _setupCalendarSubscriptions:async()=>{},
  });
  return {store,hass,calls,host,setConfig:value=>{current=value;}};
}

test("presentation-only config changes preserve fetched data cache",async()=>{
  const f=fixture();await f.store.getConfig();
  const host=f.host(),manager=f.store.manager(host);
  await manager.loadAll();const count=f.calls.length;
  f.store.applyConfig(config({show_week_number:false,calendar_colors:{"calendar.family":"#112233"}}));
  assert.equal(f.store.manager(host),manager);
  await manager.loadAll();
  assert.equal(f.calls.length,count);
});

test("hourly failure remains visible even when native daily forecast succeeds",async()=>{
  const f=fixture();await f.store.getConfig();
  const original=f.hass.callWS;
  f.hass.callWS=args=>args.service_data?.type==="hourly"?Promise.reject(new Error("hourly offline")):original(args);
  const host=f.host(),result=await f.store.manager(host).loadAll();
  assert.equal(result.warnings.length,1);
  assert.match(result.warnings[0],/Timevejr/);
  assert.equal(f.store.health(host).sources.weather.status,"error");
});

test("identical simultaneous config reads issue one backend request",async()=>{
  const f=fixture();
  await Promise.all([f.store.getConfig(),f.store.getConfig()]);
  assert.equal(f.calls.filter(x=>x.type==="week_planner/config").length,1);
});

test("failed transport requests are not cached",async()=>{
  const f=fixture();let attempts=0;
  const run=async()=>{attempts++;if(attempts===1)throw new Error("offline");return "ok";};
  await assert.rejects(f.store.request("test",{},run,10000));
  assert.equal(await f.store.request("test",{},run,10000),"ok");
  assert.equal(attempts,2);
});

test("shared poll recovers runtime health after a configuration transport failure",async()=>{
  const f=fixture();await f.store.getConfig();
  const host=f.host();host._handleDayRollover=async()=>false;
  host._refreshCalendarEvents=async()=>f.store.manager(host).fetchCalendars();
  host._markRuntimeFailure=error=>f.store.health(host).markRuntimeFailure(error);
  f.store.attach(host);
  const read=f.hass.connection.sendMessagePromise;
  try{
    f.hass.connection.sendMessagePromise=async()=>{throw new Error("offline");};
    await f.store.tick();
    assert.equal(f.store.runtime.status,"error");
    f.hass.connection.sendMessagePromise=read;
    await f.store.tick();
    assert.equal(f.store.runtime.status,"fresh");
    assert.equal(f.store.ticking,false);
  }finally{f.store.detach(host);}
});

test("all sources run even when calendars/weather change", async () => {
  const manager = new WeekPlannerDataManager({});
  const calls=[];
  manager.fetchCalendars=async()=>({ok:true,changed:true});
  for(const name of ["loadWeather","loadSun","loadMoon"])manager[name]=async()=>{calls.push(name);return true;};
  manager.loadHistory=async()=>({changed:false});manager.checkEnergy=()=>{};
  await manager.loadAll();
  assert.deepEqual(calls,["loadWeather","loadSun","loadMoon"]);
});

test("missing temperatures do not manufacture zero degrees", () => {
  const result=dailyForecastFromHourly([
    {datetime:"2026-11-02T12:00:00",temperature:null},
    {datetime:"2026-11-02T13:00:00",temperature:""},
    {datetime:"2026-11-02T14:00:00",temperature:12},
  ]);
  assert.equal(result[0].templow,12);
});

test("connection singleton is shared and isolates different connections", () => {
  const a=fixture(),b=fixture();
  assert.equal(sharedStore(a.hass),sharedStore({...a.hass}));
  assert.notEqual(sharedStore(a.hass),sharedStore(b.hass));
});

test("same-range panel and card share manager, requests and cache", async () => {
  const f=fixture();await f.store.getConfig();
  const a=f.host(),b=f.host();
  assert.equal(f.store.manager(a),f.store.manager(b));
  await Promise.all([f.store.manager(a).loadAll(),f.store.manager(b).loadAll()]);
  assert.equal(f.calls.filter(c=>c.domain==="calendar").length,1);
  assert.equal(f.calls.filter(c=>c.domain==="weather").length,2);
  assert.ok(f.calls.some(c=>c.type==="week_planner/sun_times"));
  assert.ok(f.calls.some(c=>c.type==="week_planner/moon_transitions"));
  await f.store.manager(b).loadAll();
  assert.equal(f.calls.filter(c=>c.domain==="calendar").length,1);
});

test("different date ranges keep calendar data isolated but share weather requests",async()=>{
  const f=fixture();await f.store.getConfig();
  const a=f.host(7),b=f.host(14);
  assert.notEqual(f.store.manager(a),f.store.manager(b));
  await Promise.all([f.store.manager(a).loadAll(),f.store.manager(b).loadAll()]);
  assert.equal(f.calls.filter(c=>c.domain==="calendar").length,2);
  assert.equal(f.calls.filter(c=>c.domain==="weather").length,2);
});

test("configuration change broadcasts and invalidates managers, local presentation survives",async()=>{
  const f=fixture();await f.store.getConfig();
  const a=f.host(),b=f.host();a._cardConfig={hide_weather:true};a._sessionVisibility={sun:false};
  f.store.attach(a);f.store.attach(b);
  try{
    const old=f.store.manager(a);
    f.store.applyConfig(config({calendar_entities:["calendar.new"]}));
    assert.equal(a._config,b._config);
    assert.deepEqual(a._config.calendar_entities,["calendar.new"]);
    assert.notEqual(f.store.manager(a),old);
    assert.equal(a._cardConfig.hide_weather,true);
    assert.equal(a._sessionVisibility.sun,false);
  }finally{f.store.detach(a);f.store.detach(b);}
});

test("an in-flight config read cannot undo a newer saved config",async()=>{
  const f=fixture();await f.store.getConfig();
  let resolve;
  f.hass.connection.sendMessagePromise=()=>new Promise(r=>{resolve=r;});
  const pending=f.store.getConfig(true);
  f.store.applyConfig(config({weather_display:"none"}));
  resolve(config({weather_display:"both"}));
  await pending;
  assert.equal(f.store.config.weather_display,"none");
});

test("calendar poll cannot overwrite a newer subscription update",async()=>{
  const f=fixture();await f.store.getConfig();
  const manager=f.store.manager(f.host());let resolve;
  f.hass.callWS=()=>new Promise(r=>{resolve=r;});
  const pending=manager.fetchCalendars();
  await Promise.resolve();await Promise.resolve();
  manager.invalidateCalendar();manager.events={newer:true};
  resolve({response:{older:true}});await pending;
  assert.deepEqual(manager.events,{newer:true});
});

test("weather failure retains cache and stays stale instead of reporting success",async()=>{
  const f=fixture();await f.store.getConfig();
  const host=f.host(),manager=f.store.manager(host);
  await manager.loadAll();
  const previous=manager.dailyWeather;
  manager._lastLoad=0;f.store.requests.clear();
  const original=f.hass.callWS;
  f.hass.callWS=args=>args.domain==="weather"?Promise.reject(new Error("offline")):original(args);
  const result=await manager.loadAll();
  assert.equal(manager.dailyWeather,previous);
  assert.equal(f.store.health(host).sources.weather.status,"stale");
  assert.equal(result.warnings.length,2);
});

test("daily fallback requires fresh hourly data and does not fabricate fresh from old cache",async()=>{
  const f=fixture({weather_display:"daily"});await f.store.getConfig();
  const original=f.hass.callWS;
  f.hass.callWS=args=>args.service_data?.type==="daily"?Promise.reject(new Error("unsupported")):original(args);
  const host=f.host(),manager=f.store.manager(host);
  const result=await manager.loadAll();
  assert.equal(manager.dailyWeather[0]._weekPlannerDerivedFromHourly,true);
  assert.equal(result.warnings.length,0);
  assert.equal(f.store.health(host).sources.weather.status,"fresh");
});

test("health timestamps are excluded from render signature, failures are included",()=>{
  let now=0;
  const health=new WeekPlannerSourceHealth({getNow:()=>new Date(++now),getConfig:()=>config()});
  health.markSuccess("calendar","Calendar");
  const signature=health.renderSignature(),snapshot=JSON.stringify(health.snapshot());
  health.markSuccess("calendar","Calendar");
  assert.equal(health.renderSignature(),signature);
  assert.notEqual(JSON.stringify(health.snapshot()),snapshot);
  health.markFailure("calendar","Calendar",new Error("offline"));
  assert.notEqual(health.renderSignature(),signature);
});

test("last view disconnect stops the only polling timer and subscriptions",async()=>{
  const f=fixture();await f.store.getConfig();
  const a=f.host(),b=f.host();
  f.store.attach(a);const timer=f.store.timer;f.store.attach(b);
  assert.equal(f.store.timer,timer);
  f.store.detach(a);assert.equal(f.store.timer,timer);
  f.store.detach(b);assert.equal(f.store.timer,null);
});

test("late subscription setup is cleaned up after last view disconnects",async()=>{
  const f=fixture();await f.store.getConfig();
  let resolve,unsubscribed=0;
  f.hass.connection.subscribeMessage=()=>new Promise(r=>{resolve=r;});
  const host=f.host();f.store.attach(host);
  const pending=f.store.subscribe(host);
  f.store.detach(host);
  resolve(()=>{unsubscribed++;});
  await pending;
  assert.equal(unsubscribed,1);
});

test("failed subscription is retried and identical views subscribe only once",async()=>{
  const f=fixture();await f.store.getConfig();let attempts=0;
  f.hass.connection.subscribeMessage=async()=>{attempts++;if(attempts===1)throw new Error("offline");return ()=>{};};
  const a=f.host(),b=f.host();f.store.attach(a);f.store.attach(b);
  try{
    await f.store.subscribe(a);await f.store.subscribe(a);await f.store.subscribe(b);
    assert.equal(attempts,2);
  }finally{f.store.detach(a);f.store.detach(b);}
});

test("old range response cannot populate a replacement config manager",async()=>{
  const f=fixture();await f.store.getConfig();
  const host=f.host(),old=f.store.manager(host);
  let resolve;f.hass.callWS=()=>new Promise(r=>{resolve=r;});
  const pending=old.fetchCalendars();await Promise.resolve();await Promise.resolve();
  f.store.applyConfig(config({calendar_entities:["calendar.replacement"]}));
  host._config=f.store.config;
  const next=f.store.manager(host);
  resolve({response:{old:true}});await pending;
  assert.notEqual(old,next);
  assert.deepEqual(next.events,{});
});
