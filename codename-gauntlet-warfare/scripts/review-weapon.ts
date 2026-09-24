import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const root=new URL("../",import.meta.url).pathname;
const build=await Bun.build({entrypoints:[root+"scripts/weapon-scene.ts"],target:"browser"});
if(!build.success)throw new Error(String(build.logs));
const bundle=await build.outputs[0].text();
const out=root+"artifacts/evidence/weapon-manual/"+new Date().toISOString().replaceAll(":","-");await mkdir(out,{recursive:true});
const server=Bun.serve({port:0,hostname:"127.0.0.1",fetch(req){return new URL(req.url).pathname==="/review.js"?new Response(bundle,{headers:{"Content-Type":"text/javascript"}}):new Response('<!doctype html><html><head><link rel="icon" href="data:,"></head><body><script type="module" src="/review.js"></script></body></html>',{headers:{"Content-Type":"text/html"}});}});
const browser=await chromium.launch({executablePath:"/usr/bin/google-chrome",headless:true,args:["--no-sandbox","--use-angle=swiftshader","--enable-unsafe-swiftshader"]});
try {
 const page=await browser.newPage({viewport:{width:1200,height:404}}),errors:string[]=[],warnings:string[]=[];
 page.on("pageerror",e=>errors.push(e.message));page.on("console",m=>{if(m.type()==="warning")warnings.push(m.text());if(m.type()==="error")errors.push(m.text());});
 const views:Record<string,unknown>={};
 for(const [name,query] of [["silhouette","angle=180&silhouette=1"],["side","angle=180"],["quarter","angle=225"],["opposite","angle=0"],["front","angle=90"]]) {
  await page.goto('http://127.0.0.1:'+server.port+'/?'+query);await page.waitForFunction(()=>(window as any).reviewReady);
  views[name]=await page.evaluate(()=>(window as any).weaponReview);await page.screenshot({path:out+'/'+name+'.png'});
 }
 const sourceSha256=createHash("sha256").update(await Bun.file(root+"src/assets/m4a1-viewmodel.ts").bytes()).digest("hex");
 await Bun.write(out+"/review.json",JSON.stringify({sourceSha256,views,errors,warnings},null,2));
 console.log(JSON.stringify({out,sourceSha256,views,errors,warnings}));if(errors.length)process.exitCode=1;
}finally{await browser.close();server.stop();}
