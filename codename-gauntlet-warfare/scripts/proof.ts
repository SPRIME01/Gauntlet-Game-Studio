import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const root=new URL("../",import.meta.url).pathname;
// Always prove the current source, never a bundle left by an interrupted run.
const build=await Bun.build({entrypoints:[root+"src/main.ts"],outdir:root+"dist",target:"browser",minify:true});
if(!build.success)throw new Error(String(build.logs));
const bundleSha256=createHash("sha256").update(await Bun.file(root+"dist/main.js").bytes()).digest("hex");
const server=Bun.serve({port:0,hostname:"127.0.0.1",fetch(req){const path=new URL(req.url).pathname;const routes:Record<string,string>={"/":"index.html","/style.css":"style.css","/dist/main.js":"dist/main.js"};// Isolation enables performance.measureUserAgentSpecificMemory for page-total memory.
const response=routes[path]?new Response(Bun.file(root+routes[path])):path.startsWith("/assets/")?returnAssetFile(path):new Response("Not found",{status:404});response.headers.set("Cross-Origin-Opener-Policy","same-origin");response.headers.set("Cross-Origin-Embedder-Policy","require-corp");return response;}});
import { join, normalize } from "node:path";
function returnAssetFile(path:string){const resolved=normalize(join(root,path));if(!resolved.startsWith(root+"assets"))return new Response("Forbidden",{status:403});const file=Bun.file(resolved);return new Response(file);}
// ANGLE's SwiftShader backend is used deliberately: the legacy --enable-unsafe-swiftshader
// GL frontend emits four spurious "GPU stall due to ReadPixels" driver warnings during page
// load before any application code runs. Both paths are pure software rendering (no GPU in
// this environment); nothing is filtered -- the console gate still counts every warning/error.
const browser=await chromium.launch({executablePath:"/usr/bin/google-chrome",headless:true,args:["--no-sandbox","--use-angle=swiftshader","--enable-unsafe-swiftshader"]});
const page=await browser.newPage({viewport:{width:1280,height:720}});
const errors:string[]=[],warnings:string[]=[];page.on("pageerror",e=>errors.push(e.message));page.on("console",m=>{if(m.type()==="error")errors.push(m.text());if(m.type()==="warning")warnings.push(m.text());});
// Total-runtime-memory sampling: page-attributed JS+WASM bytes via
// measureUserAgentSpecificMemory (crossOriginIsolated above), plus OS RSS of
// the renderer and GPU processes of this dedicated browser instance. A JS-heap
// metric alone is explicitly not accepted as total runtime memory.
const MEMORY_BUDGET_BYTES=256*1024*1024;
const cdp=await browser.newBrowserCDPSession();
const rssOf=(pid:number):number|null=>{try{const match=/VmRSS:\s+(\d+) kB/.exec(readFileSync(`/proc/${pid}/status`,"utf8"));return match?Number(match[1])*1024:null;}catch{return null;}};
const memorySamples:Array<{label:string;pageBytes:number|null;rendererRss:number|null;gpuRss:number|null}>=[];
async function sampleMemory(label:string){
 let pageBytes:number|null=null;
 try{pageBytes=await page.evaluate(async()=>crossOriginIsolated?(await (performance as any).measureUserAgentSpecificMemory()).bytes:null);}catch{}
 const info=await cdp.send("SystemInfo.getProcessInfo").catch(()=>null);
 let rendererRss:number|null=null,gpuRss:number|null=null;
 for(const process of info?.processInfo??[]){
  const rss=rssOf(process.id);if(rss===null)continue;
  if(process.type==="Renderer")rendererRss=(rendererRss??0)+rss;
  if(process.type==="GPU")gpuRss=(gpuRss??0)+rss;
 }
 memorySamples.push({label,pageBytes,rendererRss,gpuRss});
}
const out=root+"artifacts/evidence/repair/"+new Date().toISOString().replaceAll(":","-");await mkdir(out,{recursive:true});
const scenarios:Record<string,unknown>={};
const snapshot=()=>page.evaluate(()=>(window as any).__GAUNTLET_WARFARE__.snapshot());
let aimX=640,aimY=360;
async function deploy(){
 await page.goto(`http://127.0.0.1:${server.port}`);
 await page.waitForFunction(()=>!(document.getElementById("start") as HTMLButtonElement).disabled,{},{timeout:30000});
 await page.click("#start");await page.waitForFunction(()=>document.pointerLockElement!==null);
 aimX=640;aimY=360;await page.mouse.move(aimX,aimY);
}
async function recordOutcome(name:string,message:string){
 const state=await snapshot();
 if(state.round.message!==message)throw new Error(`${name}: expected ${message}, observed ${state.round.message}`);
 await page.waitForFunction(()=>document.pointerLockElement===null&&!document.getElementById("overlay")!.hidden);
 await page.screenshot({path:out+`/${name}.png`});
 const telemetry=await page.evaluate(()=>(window as any).__GAUNTLET_WARFARE__.telemetry());
 scenarios[name]={state,telemetry};
 await Bun.write(out+"/scenarios.json",JSON.stringify({bundleSha256,scenarios},null,2));
}
try{
 await page.goto(`http://127.0.0.1:${server.port}`);await page.waitForFunction(()=>!(document.getElementById("start") as HTMLButtonElement).disabled,{},{timeout:30000});
 await page.screenshot({path:out+"/deployment.png"});await page.click("#start");await page.waitForFunction(()=>document.pointerLockElement!==null);
 await page.keyboard.down("KeyW");await page.waitForTimeout(700);await page.keyboard.up("KeyW");
 await page.mouse.down();await page.waitForTimeout(400);await page.mouse.up();
 const fired=await page.evaluate(()=>(window as any).__GAUNTLET_WARFARE__.snapshot());
 if(fired.weapon.magazine>=30)throw new Error("Browser input did not fire");
 if(fired.player.z>=9)throw new Error("Browser input did not move");
 await page.keyboard.press("KeyR");await page.waitForFunction(()=>(window as any).__GAUNTLET_WARFARE__.snapshot().weapon.magazine===30,{},{timeout:15000});
 await page.screenshot({path:out+"/hip-fire.png"});await page.mouse.down({button:"right"});await page.waitForFunction(()=>(window as any).__GAUNTLET_WARFARE__.snapshot().ads>.9);await page.screenshot({path:out+"/ads.png"});await page.mouse.up({button:"right"});
 await sampleMemory("round-active");
 await page.keyboard.press("Escape");await page.waitForFunction(()=>document.pointerLockElement===null&&!document.getElementById("overlay")!.hidden);const paused=await page.evaluate(()=>(window as any).__GAUNTLET_WARFARE__.snapshot().round.elapsed);await page.waitForTimeout(200);
 if(await page.evaluate(()=>(window as any).__GAUNTLET_WARFARE__.snapshot().round.elapsed)!==paused)throw new Error("Pause did not stop simulation");
 await page.click("#start");await page.waitForFunction(()=>document.pointerLockElement!==null);
 await page.waitForFunction(()=>(window as any).__GAUNTLET_WARFARE__.snapshot().round.phase!=="playing",{},{timeout:65000});
 const terminal=await page.evaluate(()=>(window as any).__GAUNTLET_WARFARE__.snapshot().round);
 await recordOutcome("timeout","TIME EXPIRED");
 await page.screenshot({path:out+"/terminal.png"});await page.click("#start");await page.waitForFunction(()=>document.pointerLockElement!==null);
 const observation=await page.evaluate(()=>({state:(window as any).__GAUNTLET_WARFARE__.snapshot(),telemetry:(window as any).__GAUNTLET_WARFARE__.telemetry()}));
 if(observation.state.player.health!==100||observation.state.weapon.magazine!==30||observation.state.round.elapsed>2)throw new Error("Redeploy did not reset combat state");
 await deploy();
 // Follow an enemy into the open without firing; no semantic/debug mutation.
 async function aim(state:any,target:any){
  const dx=target.x-state.player.x,dz=target.z-state.player.z;
  const yaw=Math.atan2(-dx,-dz),pitch=Math.atan2(target.y-state.player.y,Math.hypot(dx,dz));
  const deltaYaw=Math.atan2(Math.sin(yaw-state.player.yaw),Math.cos(yaw-state.player.yaw));
  // CDP derives pointer-lock movement from coordinates, not movementX/Y fields.
  aimX+=Math.round(-deltaYaw/.002);aimY+=Math.round(-(pitch-state.player.pitch)/.002);
  await page.mouse.move(aimX,aimY);
 }
 const deathDeadline=Date.now()+180000;
 while(Date.now()<deathDeadline){
  const state=await snapshot();if(state.round.phase!=="playing")break;
  const target=state.enemies[0];await aim(state,target);
  if(Math.hypot(target.x-state.player.x,target.z-state.player.z)>3)await page.keyboard.down("KeyW");else await page.keyboard.up("KeyW");
  await page.waitForTimeout(200);
 }
 await page.keyboard.up("KeyW");
 await recordOutcome("death","OPERATOR DOWN");
 await deploy();
 // Aim through browser input while reading only the immutable observation surface.
 const deadline=Date.now()+120000;let sampledVictory=false;
 while(Date.now()<deadline){
  const state=await snapshot();if(state.round.phase!=="playing")break;
  const target=state.enemies.find((e:any)=>e.health>0);if(!target)break;
  await aim(state,target);
  await page.mouse.down();await page.waitForTimeout(140);await page.mouse.up();
  if(state.weapon.magazine===0)await page.keyboard.press("KeyR");
  if(state.round.kills===1){
   // Close the distance to the second combatant instead of firing through cover.
   if(!sampledVictory){sampledVictory=true;await sampleMemory("victory-midcombat");}
   await page.keyboard.down("KeyW");
  }
 }
 await page.keyboard.up("KeyW");await page.mouse.up();
 await recordOutcome("victory","COMPOUND SECURED");
 const measurements=Object.values(scenarios).map(s=>(s as {telemetry:any}).telemetry);
 const peakDrawCalls=Math.max(...measurements.map(t=>t.maxDrawCalls));
 const peakTriangles=Math.max(...measurements.map(t=>t.maxTriangles));
 const peakPageMemory=Math.max(0,...memorySamples.map(s=>s.pageBytes??0));
 const peakOf=(key:"pageBytes"|"rendererRss"|"gpuRss")=>{const values=memorySamples.map(s=>s[key]).filter((v):v is number=>typeof v==="number");return values.length?Math.max(...values):null;};
 const memory={budgetBytes:MEMORY_BUDGET_BYTES,peakPageMemory,peakRendererRss:peakOf("rendererRss"),peakGpuRss:peakOf("gpuRss"),samples:memorySamples,method:"page-attributed JS+WASM bytes via performance.measureUserAgentSpecificMemory under COOP/COEP crossOriginIsolation; renderer+GPU process RSS of the dedicated proof browser recorded as context (null when unreadable); a JS-heap-only metric is not accepted as total runtime memory"};
 await Bun.write(out+"/browser.json",JSON.stringify({bundleSha256,scenarios,errors,warnings,memory,terminal,...observation,peakDrawCalls,peakTriangles},null,2));
 console.log(JSON.stringify({errors,warnings,scenarios:Object.keys(scenarios),peakDrawCalls,peakTriangles,peakPageMemoryMB:Math.round(memory.peakPageMemory/1048576*10)/10}));
 if(peakDrawCalls>150||peakTriangles>180000)throw new Error("Render budget exceeded");
 if(memory.peakPageMemory<=0)throw new Error("Total runtime memory was not measured; page memory API unavailable under this renderer");
 if(memory.peakPageMemory>MEMORY_BUDGET_BYTES)throw new Error(`Memory budget exceeded: ${memory.peakPageMemory} > ${MEMORY_BUDGET_BYTES} page-attributed bytes`);
 if(errors.length||warnings.length)process.exitCode=1;
}catch(error){
 const status=await page.locator("#status").textContent({timeout:1000}).catch(()=>null);
 const finalObservation=await page.evaluate(()=>({state:(window as any).__GAUNTLET_WARFARE__?.snapshot(),telemetry:(window as any).__GAUNTLET_WARFARE__?.telemetry()})).catch(()=>null);
 const failure={bundleSha256,scenarios,errors,warnings,status,finalObservation,failure:String(error)};
 await Bun.write(out+"/failure.json",JSON.stringify(failure,null,2));
 console.log(JSON.stringify({bundleSha256,scenarios:Object.keys(scenarios),errors,warnings,status,failure:String(error)}));
 await page.screenshot({path:out+"/failure.png",timeout:5000}).catch(()=>{});
 process.exitCode=1;
}finally{await browser.close();server.stop();}
