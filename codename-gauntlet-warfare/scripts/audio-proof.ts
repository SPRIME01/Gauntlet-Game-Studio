import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
const root=new URL("../",import.meta.url).pathname;
// Build the harness from current source; never prove a stale bundle.
const build=await Bun.build({entrypoints:[root+"scripts/audio-harness.ts"],target:"browser"});
if(!build.success)throw new Error(String(build.logs));
const bundle=await build.outputs[0].text();
const bundleSha256=createHash("sha256").update(bundle).digest("hex");
const out=root+"artifacts/evidence/audio/"+new Date().toISOString().replaceAll(":","-");await mkdir(out,{recursive:true});
const server=Bun.serve({port:0,hostname:"127.0.0.1",fetch(req){if(new URL(req.url).pathname==="/harness.js")return new Response(bundle,{headers:{"Content-Type":"text/javascript"}});return new Response('<!doctype html><html><head><link rel="icon" href="data:,"></head><body><button id="gesture">GESTURE</button><script type="module" src="/harness.js"></script></body></html>',{headers:{"Content-Type":"text/html"}});}});
const baseUrl=`http://127.0.0.1:${server.port}`;
const CHROME="/usr/bin/google-chrome";
const hasDisplay=Boolean(process.env.DISPLAY||process.env.WAYLAND_DISPLAY);

// Minimal raw CDP client: leg 1 runs BEFORE Playwright attaches, so no
// automation surface can grant the page user activation (T17 pattern).
class RawCdp{
 private ws:WebSocket;private seq=0;private pending=new Map<number,{resolve:(v:any)=>void;reject:(e:any)=>void}>();
 private constructor(ws:WebSocket){this.ws=ws;ws.addEventListener("message",event=>{const msg=JSON.parse(event.data as string);if(msg.id&&this.pending.has(msg.id)){const{resolve,reject}=this.pending.get(msg.id)!;this.pending.delete(msg.id);msg.error?reject(new Error(msg.error.message)):resolve(msg.result?.result?.value);}});}
 static async connect(port:number){
  const targets=await(await fetch(`http://127.0.0.1:${port}/json`)).json() as Array<{type:string;id:string;url:string}>;
  const target=targets.find(t=>t.type==="page"&&t.url.startsWith(baseUrl));
  if(!target)throw new Error("fixture page target not found");
  const ws=new WebSocket(`ws://127.0.0.1:${port}/devtools/page/${target.id}`);
  await new Promise((resolve,reject)=>{ws.addEventListener("open",resolve,{once:true});ws.addEventListener("error",reject,{once:true});});
  return new RawCdp(ws);
 }
 evaluate<T>(expression:string):Promise<T>{
  const id=++this.seq;
  return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.ws.send(JSON.stringify({id,method:"Runtime.evaluate",params:{expression,awaitPromise:true,returnByValue:true}}));});
 }
}
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const waitFor=async<T>(probe:()=>Promise<T|null|false>,timeoutMs:number,label:string):Promise<T>=>{
 const deadline=Date.now()+timeoutMs;
 for(;;){
  const value=await probe();
  if(value!==null&&value!==false)return value as T;
  if(Date.now()>deadline)throw new Error(`timed out waiting for ${label}`);
  await sleep(200);
 }
};
const errors:string[]=[],warnings:string[]=[];
let chrome:ReturnType<typeof spawn>|null=null;
let legs:Record<string,unknown>;
try{
 // Launch the REAL system Chrome directly; Chrome itself opens the fixture tab,
 // so no automation navigation ever grants user activation. No autoplay-policy
 // flags of any kind: the real gesture policy must be observable.
 const debugPort=30000+Math.floor(Math.random()*20000);
 const profile=out+"/chrome-profile";
 const mode=hasDisplay?"headed":"headless=new";
 const chromeArgs=["--user-data-dir="+profile,"--no-first-run",`--remote-debugging-port=${debugPort}`,...(hasDisplay?[]:["--headless=new"]),baseUrl];
 console.log(JSON.stringify({mode,debugPort}));
 chrome=spawn(CHROME,chromeArgs,{stdio:"ignore"});chrome.unref();
 const chromeExited=new Promise<never>((_,reject)=>chrome!.on("exit",code=>reject(new Error(`chrome exited early with code ${code}`))));
 await Promise.race([waitFor(async()=>{try{const v=await(await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json();return v.Browser as string;}catch{return null;}},30000,"chrome devtools endpoint"),chromeExited]);
  const cdp=await Promise.race([RawCdp.connect(debugPort),chromeExited]); await Promise.race([waitFor(async()=>await cdp.evaluate<boolean>("Boolean(window.audioHarness)"),20000,"harness ready"),chromeExited]); const h=`(()=>({create:()=>window.audioHarness.create(),unlock:()=>window.audioHarness.unlockProgrammatic(),state:()=>window.audioHarness.contextState(),signal:()=>window.audioHarness.signal(),shot:p=>window.audioHarness.playShot(p),reload:()=>window.audioHarness.playReload(),close:()=>window.audioHarness.dispose(),activation:{isActive:navigator.userActivation.isActive,hasBeenActive:navigator.userActivation.hasBeenActive}}))()`;
 // Leg 1 (negative control): unlock attempt WITHOUT any user gesture must leave
 // the context suspended and the graph silent.
 const activation=await Promise.race([cdp.evaluate<any>(`${h}.activation`),chromeExited]);
 if(activation.hasBeenActive!==false)throw new Error(`page already has user activation (hasBeenActive=${activation.hasBeenActive}) before any interaction; gesture policy is not observable in this environment. No bypass flags were used; re-run where tab creation does not grant activation.`);
 const harnessRef="window.audioHarness";
 await Promise.race([cdp.evaluate(`${harnessRef}.create()`),chromeExited]);
 // Chrome's blocked resume() promise may stay pending forever under autoplay
 // policy, so the attempt is fired without awaiting it; state is polled instead.
 await Promise.race([cdp.evaluate(`(function(){window.__unlockOutcome=(function(){try{window.audioHarness.unlockProgrammatic();return {threw:null};}catch(e){return {threw:String(e)};}})();return "fired";})()`),chromeExited]);
 const ungestured=await Promise.race([cdp.evaluate(`window.__unlockOutcome`),chromeExited]);
 await sleep(500);
 const lockedState=await Promise.race([cdp.evaluate<string>(`${harnessRef}.contextState()`),chromeExited]);
 await Promise.race([cdp.evaluate(`${harnessRef}.playShot()`),chromeExited]);
 await sleep(80);
 const lockedSignal=await Promise.race([cdp.evaluate<{peak:number;rms:number}>(`${harnessRef}.signal()`),chromeExited]);
 if(lockedState!=="suspended")throw new Error(`Un-gestured context state is ${lockedState}, expected suspended (unlock outcome ${JSON.stringify(ungestured)})`);
 if(lockedSignal.peak>0)throw new Error(`Un-gestured graph produced signal (peak ${lockedSignal.peak})`);
 // Leg 2: a REAL trusted click (Playwright over CDP, no re-navigation) unlocks
 // playback; the graph carries non-silent, transient-shaped signal for direct
 // and spatialized paths, and reload and dispose behave.
 const browser=await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
 const context=browser.contexts()[0];const page=context.pages().find(p=>p.url().startsWith(baseUrl))!;
 page.on("pageerror",e=>errors.push(e.message));
 page.on("console",m=>{if(m.type()==="error")errors.push(m.text());if(m.type()==="warning")warnings.push(m.text());});
 const lockedWarnings=[...warnings];
 await page.click("#gesture");
 await page.evaluate(async()=>{await (window as any).audioHarness.unlockProgrammatic();});
 await sleep(300);
 const runningState=await page.evaluate(()=>(window as any).audioHarness.contextState());
 if(runningState!=="running")throw new Error(`Gestured context state is ${runningState}, expected running`);
 await page.evaluate(()=>(window as any).audioHarness.playShot());await sleep(60);
 const early=await page.evaluate(()=>(window as any).audioHarness.signal());
 await sleep(150);
 const late=await page.evaluate(()=>(window as any).audioHarness.signal());
 await page.evaluate(()=>(window as any).audioHarness.playShot({x:6,y:1.1,z:-17}));await sleep(60);
 const spatial=await page.evaluate(()=>(window as any).audioHarness.signal());
 await sleep(150);
 await page.evaluate(()=>(window as any).audioHarness.playReload());await sleep(40);
 const reload=await page.evaluate(()=>(window as any).audioHarness.signal());
 await sleep(200);
 const gesturedWarnings=warnings.slice(lockedWarnings.length);
 await page.evaluate(()=>(window as any).audioHarness.dispose());await sleep(150);
 const closedState=await page.evaluate(()=>(window as any).audioHarness.contextState());
 legs={ungestured:{activation,unlock:ungestured,state:lockedState,peak:lockedSignal.peak},gestured:{state:runningState,earlyPeak:early.peak,earlyRms:early.rms,latePeak:late.peak,lateRms:late.rms,spatialPeak:spatial.peak,reloadPeak:reload.peak,closedState,warnings:gesturedWarnings}};
 console.log(JSON.stringify({legs,errors,warnings}));
 if(early.peak<.02)throw new Error(`Gestured shot signal too weak: peak ${early.peak}`);
 if(late.rms>=early.rms/10&&late.peak>0.001)throw new Error(`Shot signal does not decay: early rms ${early.rms}, late rms ${late.rms}`);
 if(spatial.peak<=0)throw new Error("Spatialized shot produced no signal");
 if(reload.peak<=0)throw new Error("Reload produced no signal");
 if(closedState!=="closed")throw new Error(`Dispose left context ${closedState}`);
 if(errors.length||gesturedWarnings.length)process.exitCode=1;
 await Bun.write(out+"/audio-proof.json",JSON.stringify({bundleSha256,launch:{mode:hasDisplay?"headed":"headless=new",chromeArgs:chromeArgs.map(a=>a.includes("user-data-dir")?"--user-data-dir=<profile>":a),autoplayBypassFlags:false},legs,errors,warnings,gates:{activation:"hasBeenActive false before any interaction",ungesturedSilence:"context suspended and peak==0 after un-gestured unlock attempt",gesturedTransient:"earlyPeak>=0.02 with decay to <10% rms",spatial:"peak>0",reload:"peak>0",dispose:"closed",console:"zero errors; zero warnings in gestured leg"},method:"signal-level observation via AnalyserNode tap on the same AudioContext, Chrome-opened tab (no automation navigation), trusted CDP click; audibility is not claimed"},null,2));
}finally{
 if(chrome)chrome.kill("SIGKILL");
 await sleep(300);
 server.stop();
 // A living spawned Chrome would keep the Bun loop (and CI) alive forever.
 process.exit(process.exitCode??0);
}
