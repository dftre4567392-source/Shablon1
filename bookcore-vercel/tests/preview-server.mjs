// Local, disposable BOOKCORE test server for Playwright.
// All data is in-memory; no real Telegram credentials or production Blob.
import http from "node:http";
import fs from "node:fs";
import {createHarness} from "./harness.mjs";

const harness=createHarness();
const html=fs.readFileSync(new URL("../index.html",import.meta.url));
const port=Number(process.env.PORT||3125);
const server=http.createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,"http://127.0.0.1:"+port);
    if(u.pathname==="/"||u.pathname==="/index.html"){
      res.writeHead(200,{"content-type":"text/html; charset=utf-8","cache-control":"no-store"});
      res.end(html);return;
    }
    if(u.pathname==="/api/handler"){
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const options={method:req.method,headers:req.headers};
      if(!["GET","HEAD"].includes(req.method))options.body=Buffer.concat(chunks);
      const remote=new Request("https://bookcore-test.invalid"+req.url,options);
      const result=await harness.handler.fetch(remote);
      const headers=Object.fromEntries(result.headers.entries());
      res.writeHead(result.status,headers);
      res.end(Buffer.from(await result.arrayBuffer()));
      return;
    }
    res.writeHead(404,{"content-type":"text/plain"});res.end("Not Found");
  }catch(e){
    console.error("STAGING_ERROR",e);
    res.writeHead(500,{"content-type":"application/json"});
    res.end(JSON.stringify({error:"STAGING_ERROR"}));
  }
});
server.listen(port,"127.0.0.1",()=>console.log("BOOKCORE_FAKE_STAGE_READY http://127.0.0.1:"+port));
