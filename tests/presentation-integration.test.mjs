// Exercise the actual entrypoint, prototype adapters and lifecycle together.
import test from "node:test";
import assert from "node:assert/strict";

const registry=new Map();
globalThis.customElements={
  define(name,ctor){registry.set(name,ctor);}, get(name){return registry.get(name);},
};
globalThis.window={
  customElements:globalThis.customElements, customCards:[], innerHeight:900,
  addEventListener(){},removeEventListener(){},
};
globalThis.document={hidden:false,addEventListener(){},removeEventListener(){}};
globalThis.HTMLElement=class {
  constructor(){this.isConnected=true;this.style={};}
  attachShadow(){this.shadowRoot={getElementById:()=>null};}
  getBoundingClientRect(){return {top:0};}
};
globalThis.requestAnimationFrame=callback=>{queueMicrotask(callback);return 1;};
await import("../custom_components/week_planner/frontend/week-planner.js");
const waitFor=async predicate=>{
  for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,5));}
  throw new Error("Timed out waiting for initialization");
};

test("real panel/card bootstrap shares config/cache; local hiding does not change retrieval",async()=>{
  const calls=[];
  const config={
    calendar_entities:["calendar.home"], weather_entity:"weather.home",weather_display:"both",
    show_sun_markers:false,show_moon_markers:false,history_sources:[],view_mode:"rolling",
    energy_entity:"",show_energy_prices:false,scroll_mode:"fixed",default_scroll_hour:6,
  };
  let subscriptions=0,unsubscribed=0;
  const hass={
    states:{},user:{is_admin:true},connection:{
      sendMessagePromise:async()=>structuredClone(config),
      subscribeMessage:async()=>{subscriptions++;return ()=>{unsubscribed++;};},
    },
    callWS:async args=>{
      calls.push(args);
      if(args.type==="lovelace/resources")return [];
      if(args.domain==="calendar")return {response:{"calendar.home":{events:[]}}};
      if(args.domain==="weather")return {response:{"weather.home":{forecast:[
        {datetime:"2026-11-02T12:00:00",temperature:10},
      ]}}};
      return {};
    },
  };
  const panel=new (registry.get("week-planner-dashboard-card"))();
  const card=new (registry.get("week-planner-card"))();
  let panelRenders=0,cardRenders=0;
  panel._render=()=>{panelRenders++;};card._render=()=>{cardRenders++;};
  card.setConfig({hide_weather:true,height:500,days_to_show:7});
  try {
    panel.hass=hass;card.hass=hass;
    await waitFor(()=>!panel._initializing&&!card._initializing&&panel._config&&card._config);
    assert.equal(panel._config,card._config);
    assert.equal(panel._dataManager(),card._dataManager());
    assert.equal(calls.filter(x=>x.domain==="weather").length,2);
    assert.equal(calls.filter(x=>x.domain==="calendar").length,1);
    assert.equal(subscriptions,1);
    assert.equal(card._weatherVisibleNow(),false);
    assert.equal(panel._weatherVisibleNow(),true);
    assert.equal(card._cardConfig.height,500);
    const beforePollRenders=panelRenders;
    await panel._refreshCalendarEvents(false);
    await panel._refreshCalendarEvents(false);
    assert.equal(panelRenders,beforePollRenders,"unchanged polls must not rebuild DOM");
    panel._applySharedConfig({...config,show_week_number:false});
    await waitFor(()=>card._config.show_week_number===false);
    assert.equal(panel._config,card._config);
    await waitFor(()=>!panel._dataManager()._allPending);
    const previousCalls=calls.filter(x=>x.domain==="calendar").length;
    card.setConfig({days_to_show:14,hide_weather:true,height:500});
    await waitFor(()=>calls.filter(x=>x.domain==="calendar").length>previousCalls);
    assert.notEqual(panel._dataManager(),card._dataManager());
    assert.equal(card._dayCount(),14);
    assert.ok(panelRenders&&cardRenders);
  } finally {
    panel.isConnected=false;card.isConnected=false;
    panel.disconnectedCallback();card.disconnectedCallback();
    await new Promise(r=>setTimeout(r,10));
  }
  assert.ok(unsubscribed>=1);
  assert.equal(panel.__sharedStore.timer,null);
});
