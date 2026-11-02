// Optional browser smoke test. Requires Playwright and an installed Chromium.
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const root=path.resolve("custom_components/week_planner/frontend");
const server=createServer(async(req,res)=>{
  try{
    if(req.url==="/"){
      res.setHeader("Content-Type","text/html");
      res.end('<!doctype html><html><body><div id="host" style="display:none"></div></body></html>');
      return;
    }
    const file=path.resolve(root,decodeURIComponent(req.url.split("?")[0]).slice(1));
    if(!file.startsWith(root+path.sep))throw new Error("Invalid path");
    res.setHeader("Content-Type","text/javascript");
    res.end(await readFile(file));
  }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
let browser;
try{
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1400,height:900},timezoneId:"Europe/Copenhagen"});
  const page=await context.newPage();
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  const cdp=await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate",{rate:6});
  await page.goto("http://127.0.0.1:"+server.address().port);
  await page.evaluate(async()=>{
    await import("/week-planner.js");
    const config={
      calendar_entities:[],weather_display:"none",show_sun_markers:false,
      show_moon_markers:false,history_sources:[],show_energy_prices:false,
      view_mode:"rolling",scroll_mode:"follow_now",server_time:"2026-11-02T15:30:00+01:00",
    };
    const hass={states:{},user:{is_admin:true},connection:{
      sendMessagePromise:async()=>({...config}),
    }};
    const parent=document.getElementById("host");
    window.views=["week-planner-dashboard-card","week-planner-card"].map(name=>{
      const view=document.createElement(name);
      if(name==="week-planner-card")view.setConfig({height:600,scroll_mode:"follow_now"});
      parent.append(view);view.hass=hass;return view;
    });
    window.scrollInfo=()=>views.map(view=>{
      const scroll=view.shadowRoot.getElementById("scroll");
      const now=view._now();
      return {top:scroll?.scrollTop,height:scroll?.clientHeight,
        expected:scroll?Math.max(0,Math.min(scroll.scrollHeight-scroll.clientHeight,
          (now.getHours()+now.getMinutes()/60)*76-8)):null,
        state:view._weekPlannerScrollController?.state};
    });
  });
  await page.waitForFunction(()=>views.every(view=>view._config&&!view._initializing));
  // This exceeds the complete old retry budget; no focus or data reload follows.
  await new Promise(resolve=>setTimeout(resolve,7000));
  await page.evaluate(()=>{document.getElementById("host").style.display="block";});
  await page.waitForFunction(()=>scrollInfo().every(value=>value.height>0
    && value.expected>0&&Math.abs(value.top-value.expected)<2));
  console.log("PASS delayed 7s layout, 6x CPU slowdown:",await page.evaluate(()=>scrollInfo()));
  await page.evaluate(()=>views.forEach(view=>{view.shadowRoot.getElementById("scroll").scrollTop=0;}));
  await page.waitForFunction(()=>scrollInfo().every(value=>value.state==="auto"&&Math.abs(value.top-value.expected)<2));
  console.log("PASS unexpected native scroll/reset corrected without manual override");
  await page.evaluate(()=>views.forEach(view=>view._render(false)));
  await page.waitForFunction(()=>scrollInfo().every(value=>value.state==="auto"&&Math.abs(value.top-value.expected)<2));
  console.log("PASS DOM replacement preserves Følg NU");
  // Real wheel input in the visible card, followed by a real DOM rebuild.
  const card=page.locator("week-planner-card");
  await card.scrollIntoViewIfNeeded();
  const scroller=card.locator("#scroll");
  await scroller.hover();
  await page.mouse.wheel(0,-200);
  await page.waitForFunction(()=>views[1]._weekPlannerScrollController.state==="manual_override");
  const manual=await page.evaluate(()=>views[1].shadowRoot.getElementById("scroll").scrollTop);
  await page.evaluate(()=>views[1]._render(false));
  await page.waitForFunction(expected=>Math.abs(views[1].shadowRoot.getElementById("scroll").scrollTop-expected)<2,manual);
  console.log("PASS real wheel input survives DOM replacement at",manual);
  assert.deepEqual(errors,[],"browser errors");
}finally{
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
}
