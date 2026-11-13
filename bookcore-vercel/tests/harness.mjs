// BOOKCORE isolated test harness: no production clients, tokens or storage.
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";

const SOURCE=fs.readFileSync(new URL("../api/handler.ts",import.meta.url),"utf8")
  .replace(/^import .*;\s*$/gm,"")
  .replace("export default {","globalThis.__handler = {");
export const ids={master:10001,a:20002,b:20003,c:20004};
const BOT_TOKEN="123456:test-only-fake-token";
const WEBHOOK_SECRET="test-webhook-secret";
export function createHarness({forcedConflicts=0,timezone="Europe/Moscow"}={}){
  let storage=null,version=0,conflictBudget=forcedConflicts;
  const messages=[],botSettings=[];
  class BlobPreconditionFailedError extends Error {}
  const etag=()=>'"stable-head-etag-'+version+'"';
  const head=async()=>storage===null?null:{etag:etag()};
  const get=async()=>storage===null?null:{
    statusCode:200,stream:new Response(JSON.stringify(storage)).body,
    blob:{etag:'"different-get-response-etag-'+version+'"'}
  };
  const put=async(path,content,{ifMatch,allowOverwrite}={})=>{
    if(conflictBudget>0){conflictBudget--;throw new BlobPreconditionFailedError("Injected conflict");}
    if(storage===null){
      if(allowOverwrite||ifMatch)throw new BlobPreconditionFailedError("Unexpected existing object");
    }else if(ifMatch!==etag())throw new BlobPreconditionFailedError("412 HEAD etag mismatch");
    storage=JSON.parse(String(content));version++;
    return {etag:etag()};
  };
  async function fakeFetch(url,options={}){
    const u=String(url);
    if(!u.startsWith("https://api.telegram.org/"))throw Error("Unexpected network in test: "+u);
    const operation=u.split("/").at(-1);
    const data=JSON.parse(options.body||"{}");
    if(operation==="sendMessage")messages.push(data);
    if(["setWebhook","setChatMenuButton","setMyCommands"].includes(operation))botSettings.push({operation,data});
    let result=true;
    if(operation==="getMe")result={id:999,username:"test_bookcore_bot"};
    if(operation==="getUserProfilePhotos")result={photos:[],total_count:0};
    if(operation==="getFile")result={file_path:"photos/test.jpg"};
    return new Response(JSON.stringify({ok:true,result}),{status:200,headers:{"content-type":"application/json"}});
  }
  const sandbox={
    console,process:{env:{
      BLOB_READ_WRITE_TOKEN:"test-blob-token",TELEGRAM_BOT_TOKEN:BOT_TOKEN,
      TELEGRAM_WEBHOOK_SECRET:WEBHOOK_SECRET,MASTER_TELEGRAM_ID:String(ids.master),
      TENANT_TIMEZONE:timezone,TENANT_DISPLAY_NAME:"Тестовая студия",
      MASTER_DISPLAY_NAME:"Тестовый мастер",APP_URL:"https://bookcore-test.invalid"
    }},
    createHmac:crypto.createHmac,timingSafeEqual:crypto.timingSafeEqual,randomUUID:crypto.randomUUID,
    get,head,put,BlobPreconditionFailedError,fetch:fakeFetch,
    Request,Response,Headers,URL,URLSearchParams,Blob,AbortSignal,
    TextDecoder,TextEncoder,Buffer,setTimeout,clearTimeout,Date,Intl
  };
  vm.createContext(sandbox);
  vm.runInContext(SOURCE,sandbox,{filename:"bookcore-server-under-test.js"});
  const handler=sandbox.__handler;
  function signed(user,{authDate=Math.floor(Date.now()/1000),badSignature=false}={}){
    const params=new URLSearchParams({auth_date:String(authDate),user:JSON.stringify({id:user,first_name:"Tester"})});
    const check=[...params].sort((a,b)=>a[0].localeCompare(b[0])).map(([k,v])=>k+"="+v).join("\n");
    const secret=crypto.createHmac("sha256","WebAppData").update(BOT_TOKEN).digest();
    const digest=crypto.createHmac("sha256",secret).update(check).digest("hex");
    params.set("hash",badSignature?"f".repeat(64):digest);
    return params.toString();
  }
  async function request(route,{method="GET",body=null,user=null,signOpts={},headers={}}={}){
    const target=new URL("https://bookcore-test.invalid/api/handler");
    const wanted=new URL(route,"https://bookcore-test.invalid");
    target.searchParams.set("route",wanted.pathname);
    for(const [k,v] of wanted.searchParams)target.searchParams.set(k,v);
    const h={"content-type":"application/json",...headers};
    if(user!==null)h["x-telegram-init-data"]=signed(user,signOpts);
    const req=new Request(target,{method,headers:h,...(body===null?{}:{body:JSON.stringify(body)})});
    const res=await handler.fetch(req);
    const text=await res.text();
    let data=null;try{data=text?JSON.parse(text):null}catch{data=text;}
    return {status:res.status,body:data,headers:res.headers};
  }
  const post=(route,body,user,opts={})=>request(route,{method:"POST",body,user,...opts});
  function today(){return vm.runInContext("todayInStudio()",sandbox);}
  function addDays(n){const d=new Date(today()+"T00:00:00Z");d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
  function openDay({min=4,max=20}={}){
    for(let i=min;i<=max;i++){
      const day=addDays(i),week=(new Date(day+"T12:00:00Z").getUTCDay()+6)%7;
      if(week>=1&&week<=5)return day;
    }
    throw Error("No open day in test window");
  }
  const readStore=()=>storage===null?null:structuredClone(storage);
  function overrideStore(fn){const data=readStore();fn(data);storage=data;version++;}
  return {request,post,signed,today,addDays,openDay,readStore,overrideStore,messages,botSettings,ids,sandbox,handler};
}
