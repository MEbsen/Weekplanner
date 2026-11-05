import test from "node:test";
import assert from "node:assert/strict";
const {WeekPlannerScrollController:Controller,ScrollState} = await import(
  process.env.SCROLL_CONTROLLER_MODULE || "../custom_components/week_planner/frontend/services/scroll-controller.js");

function harness({hour=15,minute=30,mode="follow_now",height=400,contentHeight=1824}={}) {
  const originals = new Map();
  const replace=(key,value)=>{originals.set(key,globalThis[key]);globalThis[key]=value;};
  let now=10000,id=0;
  const frames=new Map(),timers=new Map(),resizes=[],mutations=[];
  const dateNow=Date.now;Date.now=()=>now;
  replace("requestAnimationFrame",fn=>{const n=++id;frames.set(n,fn);return n;});
  replace("cancelAnimationFrame",n=>frames.delete(n));
  replace("setTimeout",(fn,delay=0)=>{const n=++id;timers.set(n,{fn,time:now+delay});return n;});
  replace("clearTimeout",n=>timers.delete(n));
  replace("ResizeObserver",class{
    constructor(fn){this.fn=fn;this.targets=new Set();resizes.push(this);}
    observe(target){this.targets.add(target);}
    disconnect(){this.targets.clear();}
  });
  replace("MutationObserver",class{
    constructor(fn){this.fn=fn;this.connected=false;mutations.push(this);}
    observe(){this.connected=true;}
    disconnect(){this.connected=false;}
  });
  const element=()=>{
    const handlers=new Map();
    return {
      clientHeight:height,scrollHeight:contentHeight,scrollTop:0,scrollLeft:0,
      firstElementChild:{},dataset:{},tagName:"DIV",writes:0,
      addEventListener(name,fn){if(!handlers.has(name))handlers.set(name,new Set());handlers.get(name).add(fn);},
      removeEventListener(name,fn){handlers.get(name)?.delete(fn);},
      dispatch(name,args={}){for(const fn of [...(handlers.get(name)||[])])fn({target:this,...args});},
      scrollTo({top,left}){this.writes++;this.scrollTop=top;this.scrollLeft=left;},
      listenerCount(){return [...handlers.values()].reduce((n,set)=>n+set.size,0);},
    };
  };
  let scroll=element();const header={scrollLeft:0};
  const root={getElementById:name=>name==="scroll"?scroll:name==="headerScroll"?header:null};
  const controller=new Controller({
    getMode:()=>mode,getFixedHour:()=>6,
    getNow:()=>new Date(2026,10,2,hour,minute),hourHeight:76,manualOverrideMs:5000,
  });
  const flush=()=>{
    for(let attempt=0;frames.size&&attempt<100;attempt++){
      const current=[...frames.values()];frames.clear();for(const fn of current)fn(now);
    }
    assert.equal(frames.size,0,"animation frames should settle");
  };
  const advance=ms=>{
    const end=now+ms;
    while(true){
      const next=[...timers].sort((a,b)=>a[1].time-b[1].time)[0];
      if(!next||next[1].time>end)break;
      now=next[1].time;timers.delete(next[0]);next[1].fn();flush();
    }
    now=end;flush();
  };
  const resize=()=>{for(const observer of resizes)if(observer.targets.size)observer.fn([]);flush();};
  const mutate=()=>{for(const observer of mutations)if(observer.connected)observer.fn([]);flush();};
  return {
    controller,root,header,get scroll(){return scroll;},flush,advance,resize,
    replaceDom(){const previous=scroll;scroll=element();mutate();return previous;},
    setMode(value){mode=value;controller.onConfigChanged();flush();},
    setTime(h,m=0){hour=h;minute=m;},
    close(){controller.destroy();Date.now=dateNow;for(const [key,value]of originals){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}},
  };
}

test("Følg NU positions when layout becomes ready after ten seconds",()=>{
  const h=harness({height:0});try{
    h.controller.attach(h.root);h.flush();h.advance(10000);
    h.scroll.clientHeight=400;h.resize();
    assert.equal(h.scroll.scrollTop,1170);
    assert.equal(h.controller.state,ScrollState.AUTO);
  }finally{h.close();}
});

test("Følg NU repositions after viewport initially fits the whole day",()=>{
  const h=harness({height:1824});try{
    h.controller.attach(h.root);h.flush();assert.equal(h.scroll.scrollTop,0);
    h.advance(6000);h.scroll.clientHeight=400;h.resize();
    assert.equal(h.scroll.scrollTop,1170);
  }finally{h.close();}
});

test("delayed native scroll/reset without user input does not enter manual mode",()=>{
  const h=harness();try{
    h.controller.attach(h.root);h.flush();h.advance(2000);
    h.scroll.scrollTop=0;h.scroll.dispatch("scroll");h.flush();
    assert.equal(h.controller.state,ScrollState.AUTO);
    assert.equal(h.scroll.scrollTop,1170);
  }finally{h.close();}
});

test("repeated positioning requests coalesce instead of starving the frame",()=>{
  const h=harness();try{
    h.controller.attach(h.root);
    for(let i=0;i<100;i++)h.controller.position("render",true);
    h.flush();
    assert.equal(h.scroll.scrollTop,1170);
    assert.equal(h.scroll.writes,1);
  }finally{h.close();}
});

test("wheel scrolling is preserved through resize and DOM replacement then resumes automatically",()=>{
  const h=harness();try{
    h.controller.attach(h.root);h.flush();
    h.scroll.dispatch("wheel",{deltaY:-100});
    h.scroll.scrollTop=700;h.scroll.dispatch("scroll");
    assert.equal(h.controller.state,ScrollState.MANUAL_OVERRIDE);
    h.resize();assert.equal(h.scroll.scrollTop,700);
    const old=h.replaceDom();h.flush();
    assert.equal(old.listenerCount(),0);
    assert.equal(h.scroll.scrollTop,700);
    h.advance(5100);
    assert.equal(h.controller.state,ScrollState.AUTO);
    assert.equal(h.scroll.scrollTop,1170);
  }finally{h.close();}
});

test("touch, scrollbar and keyboard input are recognized without a timing grace period",()=>{
  const h=harness();try{
    h.controller.attach(h.root);h.flush();
    for(const [event,args]of [["touchmove",{}],["pointerdown",{}],["keydown",{key:"PageDown"}]]){
      h.setMode("follow_now");
      h.scroll.dispatch(event,args);
      h.scroll.scrollTop=500;h.scroll.dispatch("scroll");
      assert.equal(h.controller.state,ScrollState.MANUAL_OVERRIDE,event);
      assert.equal(h.controller.savedTop,500,event);
    }
  }finally{h.close();}
});

test("typing or clicking an event is not manual scrolling",()=>{
  const h=harness();try{
    h.controller.attach(h.root);h.flush();
    h.scroll.dispatch("keydown",{key:" ",target:{tagName:"INPUT"}});
    h.scroll.dispatch("pointerdown",{target:{tagName:"BUTTON"}});
    assert.equal(h.controller.state,ScrollState.AUTO);
  }finally{h.close();}
});

test("none preserves manual viewport, fixed positions at configured hour",()=>{
  const h=harness({mode:"none"});try{
    h.controller.attach(h.root);h.flush();assert.equal(h.scroll.scrollTop,0);
    h.scroll.dispatch("wheel",{deltaY:100});
    h.scroll.scrollTop=450;h.scroll.dispatch("scroll");
    h.resize();assert.equal(h.scroll.scrollTop,450);
    h.advance(10000);assert.equal(h.scroll.scrollTop,450);
    h.setMode("fixed");assert.equal(h.scroll.scrollTop,448);
  }finally{h.close();}
});

test("late-day NOW clamps to a viewport ending at midnight",()=>{
  const h=harness({hour:23,minute:55});try{
    h.controller.attach(h.root);h.flush();assert.equal(h.scroll.scrollTop,1424);
  }finally{h.close();}
});

test("day rollover resumes automatic positioning but focus preserves active manual override",()=>{
  const h=harness();try{
    h.controller.attach(h.root);h.flush();
    h.scroll.dispatch("wheel",{deltaY:-100});h.scroll.scrollTop=700;h.scroll.dispatch("scroll");
    h.controller.onFocus();h.flush();assert.equal(h.scroll.scrollTop,700);
    h.setTime(1);h.controller.onDayChange();h.flush();assert.equal(h.scroll.scrollTop,68);
  }finally{h.close();}
});

test("destroy detaches observers, input listeners and pending work",()=>{
  const h=harness({height:0});try{
    h.controller.attach(h.root);
    h.controller.destroy();
    h.scroll.clientHeight=400;h.resize();h.advance(10000);
    assert.equal(h.scroll.scrollTop,0);
    assert.equal(h.scroll.listenerCount(),0);
  }finally{h.close();}
});
