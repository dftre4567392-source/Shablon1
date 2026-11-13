// @ts-nocheck
import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { get, head, put, BlobPreconditionFailedError } from "@vercel/blob";

// Isolate customer deployments; the default continues reading the existing live store.
const PATH=process.env.BOOKCORE_STORAGE_PATH||"bookcore/v1/state.json";
if(!/^bookcore\/[a-z0-9][a-z0-9/_-]{0,120}\.json$/i.test(PATH)||PATH.includes("..")||PATH.includes("//"))throw new Error("INVALID_BOOKCORE_STORAGE_PATH");
const TOKEN=process.env.TELEGRAM_BOT_TOKEN||"";
const MASTER=String(process.env.MASTER_TELEGRAM_ID||"");
const MASTER_IDS=new Set([MASTER,...String(process.env.ADDITIONAL_MASTER_TELEGRAM_IDS||"").split(/[,;\s]+/)].filter(id=>/^\d{5,20}$/.test(id)));
const STUDIO=process.env.TENANT_DISPLAY_NAME||"Студия красоты";
const MASTER_NAME=process.env.MASTER_DISPLAY_NAME||"Ваш мастер";
const TZ=process.env.TENANT_TIMEZONE||"Europe/Moscow";
const BRAND_COLOR=/^#[0-9a-fA-F]{6}$/.test(process.env.TENANT_ACCENT_COLOR||"")?process.env.TENANT_ACCENT_COLOR:"#513548";

const APP_URL=process.env.APP_URL||"";
let botSetupPromise=null;
async function botCall(method,payload){
  const response=await fetch("https://api.telegram.org/bot"+TOKEN+"/"+method,{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify(payload),signal:AbortSignal.timeout(5000)
  });
  const result=await response.json();
  if(!response.ok||!result.ok)throw new Error("TELEGRAM_"+method+"_"+String(result.error_code||response.status));
  return result.result;
}
async function ensureBotSetup(){
  if(!TOKEN||!APP_URL||!process.env.TELEGRAM_WEBHOOK_SECRET)return {configured:false};
  if(!botSetupPromise){
    botSetupPromise=(async()=>{
      const url=new URL(APP_URL);
      if(url.protocol!=="https:")throw new Error("APP_URL_MUST_BE_HTTPS");
      const webhook=url.origin+"/api/handler?route=%2Fbot%2Fwebhook";
      const bot=await botCall("getMe",{});
      await Promise.all([
        botCall("setWebhook",{url:webhook,secret_token:process.env.TELEGRAM_WEBHOOK_SECRET,allowed_updates:["message"]}),
        botCall("setChatMenuButton",{menu_button:{type:"web_app",text:"Открыть BOOKCORE",web_app:{url:url.origin}}}),
        botCall("setMyCommands",{commands:[{command:"start",description:"Приветствие и онлайн-запись"},{command:"id",description:"Узнать свой Telegram ID"},{command:"help",description:"Как пользоваться BOOKCORE"}]})
      ]);
      console.info("BOOKCORE_TELEGRAM_BOT_CONFIGURED",bot.username||"");
      return {configured:true,username:bot.username||null};
    })().catch(error=>{botSetupPromise=null;console.warn("BOOKCORE_TELEGRAM_SETUP_FAILED",String(error));return {configured:false};});
  }
  return botSetupPromise;
}

const JSON_HEADERS={"content-type":"application/json; charset=utf-8","cache-control":"private, no-store","x-content-type-options":"nosniff"};
const respond=(payload,status=200)=>new Response(JSON.stringify(payload),{status,headers:JSON_HEADERS});
class HttpError extends Error{constructor(status,message){super(message);this.status=status;}}
const fail=(status,message)=>{throw new HttpError(status,message);};
const clean=(s)=>String(s??"").trim().replace(/\s+/g," ").slice(0,150);
const validPersonName=(name)=>name.length>=2&&name.length<=50&&!/[<>\p{Cc}\p{Cf}]/u.test(name)&&(name.match(/\p{L}/gu)||[]).length>=2;
const toNum=(v)=>Number(v);
const validDate=(x)=>{
  if(typeof x!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(x))return false;
  const parsed=new Date(x+"T00:00:00Z");
  return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===x;
};
function todayInStudio(){
  const p=new Intl.DateTimeFormat("en-US",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const o=Object.fromEntries(p.map(x=>[x.type,x.value]));
  return o.year+"-"+o.month+"-"+o.day;
}
function blockableDate(day){
  if(!validDate(day))return false;
  const today=Date.parse(todayInStudio()+"T00:00:00Z");
  const target=Date.parse(day+"T00:00:00Z");
  return target>=today&&target<=today+365*86400000;
}
function bookableDate(date){
  if(!validDate(date))return false;
  const today=Date.parse(todayInStudio()+"T00:00:00Z");
  const d=Date.parse(date+"T00:00:00Z");
  return d>=today&&d<=today+45*86400000;
}
function resolveServices(s,raw){
  const values=Array.isArray(raw)?raw:typeof raw==="number"?[raw]:typeof raw==="string"?raw.split(","):[];
  if(!values.length||values.length>6)return null;
  const ids=values.map(Number);
  if(ids.some(id=>!Number.isSafeInteger(id)||id<=0)||new Set(ids).size!==ids.length)return null;
  const selected=ids.map(id=>s.services.find(x=>x.id===id&&x.active));
  if(selected.some(x=>!x))return null;
  return {ids,items:selected,minutes:selected.reduce((a,b)=>a+b.minutes,0),
    price:selected.reduce((a,b)=>a+b.price,0),name:selected.map(x=>x.title).join(" + ")};
}
const validTime=(x)=>/^([01]\d|2[0-3]):[0-5]\d$/.test(String(x));
const minutes=(t)=>t.split(":").map(Number).reduce((a,b)=>a*60+b);
const pad=(i)=>String(i).padStart(2,"0");
const fmt=(m)=>pad(Math.floor(m/60))+":"+pad(m%60);
// Interpret appointment hours in the studio's IANA timezone, not a hardcoded UTC+3.
const studioFormatter=new Intl.DateTimeFormat("en-US",{timeZone:TZ,
  year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
function utc(date,time){
  const [y,mo,d]=date.split("-").map(Number),[h,m]=time.split(":").map(Number);
  const intended=Date.UTC(y,mo-1,d,h,m);
  let guess=intended;
  for(let i=0;i<4;i++){
    const entries=Object.fromEntries(studioFormatter.formatToParts(new Date(guess)).map(x=>[x.type,x.value]));
    const actual=Date.UTC(Number(entries.year),Number(entries.month)-1,Number(entries.day),Number(entries.hour),Number(entries.minute));
    if(actual===intended)break;
    guess+=intended-actual;
  }
  return new Date(guess);
}
const DEFAULT_SERVICES=[
  {id:1,title:"Классическое наращивание",description:"Естественный и выразительный взгляд",minutes:120,price:1700,active:true},
  {id:2,title:"Наращивание 2D",description:"Воздушный двойной объём",minutes:150,price:2000,active:true},
  {id:3,title:"Наращивание 3D",description:"Эффектный объём",minutes:180,price:2300,active:true},
  {id:4,title:"Ламинирование ресниц",description:"Натуральный изгиб",minutes:75,price:1600,active:true},
  {id:5,title:"Снятие ресниц",description:"Бережное снятие",minutes:30,price:400,active:true}
 ];
function bootstrapServices(){
  const defaults=DEFAULT_SERVICES;
  const raw=process.env.BOOKCORE_SERVICES_JSON;
  if(!raw)return defaults.map(x=>({...x}));
  let items;
  try{items=JSON.parse(raw)}catch{throw new Error("INVALID_BOOKCORE_SERVICES_JSON")}
  if(!Array.isArray(items)||items.length<1||items.length>30)throw new Error("INVALID_BOOKCORE_SERVICES_JSON");
  return items.map((item,index)=>{
    const title=clean(item?.title),description=clean(item?.description||"");
    const minutesCount=Number(item?.minutes),price=Number(item?.price);
    if(title.length<3||!Number.isInteger(minutesCount)||minutesCount<15||minutesCount>600||
      !Number.isInteger(price)||price<0||price>1000000)throw new Error("INVALID_BOOKCORE_SERVICES_JSON");
    return {id:index+1,title,description,minutes:minutesCount,price,active:true};
  });
}
function seed(){return {
 users:{},
 services:bootstrapServices(),
 schedule:[0,1,2,3,4,5,6].map(weekday=>({weekday,start_time:"10:00",end_time:"19:00",active:weekday>=1&&weekday<=5})),
 blocks:[],bookings:[],seq:1
};}
async function getMetadata(){
  try{return await head(PATH);}
  catch(e){if(/not found|does not exist|404/i.test(String(e?.message||e)))return null;throw e;}
}
async function load({forWrite=false}={}){
  if(!process.env.BLOB_READ_WRITE_TOKEN) fail(503,"STORAGE_NOT_CONFIGURED");
  for(let attempt=0;attempt<(forWrite?5:1);attempt++){
    // The get() response ETag is a different value from the canonical head() ETag in this store.
    // Check metadata both before and after the uncached read to avoid lost updates.
    const before=forWrite?await getMetadata():null;
    const result=await get(PATH,{access:"private",useCache:false});
    if(!result){
      const after=forWrite?await getMetadata():null;
      if(after)continue;
      return {state:seed(),etag:null};
    }
    if(result.statusCode!==200||!result.stream)fail(503,"STORAGE_READ_FAILED");
    const raw=await new Response(result.stream).text();
    const state=JSON.parse(raw);
    if(!forWrite)return {state,etag:null};
    const after=await getMetadata();
    if(before?.etag===after?.etag)return {state,etag:after?.etag||null};
    await new Promise(ok=>setTimeout(ok,50*(attempt+1)));
  }
  fail(503,"STORAGE_CHANGED_DURING_READ");
}
async function mutate(fn){
  for(let i=0;i<12;i++){
    const {state,etag}=await load({forWrite:true});
    const output=await fn(state);
    try {
      await put(PATH,JSON.stringify(state),{access:"private",contentType:"application/json",allowOverwrite:!!etag,...(etag?{ifMatch:etag}:{}) ,cacheControlMaxAge:60});
      return output;
    }catch(e){
      const reason=String(e?.message||e);
      if(e instanceof BlobPreconditionFailedError || /already exists|precondition|conflict|412|409|blob_already/i.test(reason)){
        console.warn("BOOKCORE_STORAGE_CONFLICT_RETRY",i+1);
        await new Promise(ok=>setTimeout(ok,20+i*80));
        continue;
      }
      throw e;
    }
  }
  fail(503,"STORAGE_BUSY_TRY_AGAIN");
}
function identity(req){
  if(!TOKEN)return null;
  const raw=req.headers.get("x-telegram-init-data")||"";
  const p=new URLSearchParams(raw),hash=p.get("hash")||"";
  const auth=Number(p.get("auth_date")||"0");
  if(!/^[0-9a-f]{64}$/i.test(hash)||Math.abs(Date.now()/1000-auth)>86400)return null;
  p.delete("hash");
  const check=Array.from(p.entries()).sort((a,b)=>a[0].localeCompare(b[0])).map(([k,v])=>k+"="+v).join("\n");
  const key=createHmac("sha256","WebAppData").update(TOKEN).digest();
  const expected=createHmac("sha256",key).update(check).digest();
  if(!timingSafeEqual(Buffer.from(hash,"hex"),expected))return null;
  try{const u=JSON.parse(p.get("user")||"{}");if(!Number.isSafeInteger(u.id)||u.id<1)return null;return {id:String(u.id),master:MASTER_IDS.has(String(u.id))};}catch{return null;}
}
function daySchedule(s,date){
  const day=(new Date(date+"T12:00:00Z").getUTCDay()+6)%7;
  return s.schedule.find(x=>x.weekday===day);
}
function slots(s,date,ids,ignoreId=null){
  if(!bookableDate(date))return [];
  const bundle=resolveServices(s,ids);
  if(!bundle||bundle.minutes>600)return [];
  const sch=daySchedule(s,date);
  if(!sch||!sch.active||!validTime(sch.start_time)||!validTime(sch.end_time))return [];
  const now=Date.now();
  if(s.blocks.some(x=>x.day===date&&!x.start_time))return [];
  const result=[];
  for(let m=minutes(sch.start_time);m+bundle.minutes+15<=minutes(sch.end_time);m+=15){
    const time=fmt(m),start=utc(date,time).getTime(),end=start+(bundle.minutes+15)*60000;
    if(start<now+4*3600000)continue;
    if(m<15*60&&m+bundle.minutes+15>14*60)continue;
    if(s.blocks.some(x=>x.day===date&&x.start_time&&m<minutes(x.end_time)&&m+bundle.minutes+15>minutes(x.start_time)))continue;
    if(s.bookings.some(x=>x.id!==ignoreId&&x.status==="confirmed"&&start<Date.parse(x.busy_until)&&end>Date.parse(x.starts_at)))continue;
    result.push(time);
  }
  return result;
}
const toISO=(date,time)=>utc(date,time).toISOString();
function timeRange(svc,date,time){const start=utc(date,time);return {starts_at:start.toISOString(),busy_until:new Date(start.getTime()+(svc.minutes+15)*60000).toISOString()};}
async function notify(chat,text,reply_markup){
  if(!TOKEN||!chat)return;
  try{await botCall("sendMessage",{chat_id:chat,text,...(reply_markup?{reply_markup}:{})});}catch(e){console.warn("BOOKCORE_NOTIFICATION_FAILED",String(e))}
}
async function notifyMasters(message){await Promise.all([...MASTER_IDS].map(id=>notify(id,message)));}
function prettyDate(value){return new Date(value).toLocaleString("ru-RU",{timeZone:TZ,dateStyle:"medium",timeStyle:"short"});}
async function body(req){try{return await req.json()}catch{return {};}}
function secureUser(a){return {role:a.master?"master":"client"};}
function listBooking(b){return {id:b.id,name:b.name,service_id:b.service_id,service_ids:b.service_ids||[b.service_id],service_name:b.service_name,price:b.price,starts_at:b.starts_at,status:b.status, ...(b.telegram_id?{telegram_id:b.telegram_id}:{})};}
async function execute(req){
  const uri=new URL(req.url);
  const route=uri.searchParams.get("route")||"/health";
  const method=req.method;

  if(route==="/health"||route==="/api/health"){
    let storage=false;
    try{await load();storage=true;}catch(e){console.error("BOOKCORE_STORAGE_STATUS",String(e));}
    return respond({ok:storage,storage,telegramConfigured:!!TOKEN,masterConfigured:!!MASTER,provider:"vercel"},storage?200:503);
  }
  if(route==="/api/public"&&method==="GET"){
    const {state}=await load();
    const bot=await ensureBotSetup();
    return respond({studio:STUDIO,masterName:MASTER_NAME,timezone:TZ,accentColor:BRAND_COLOR,services:state.services.filter(x=>x.active).map(x=>({id:x.id,title:x.title,description:x.description,minutes:x.minutes,price:x.price})),ready:!!TOKEN&&!!MASTER&&bot.configured,botConfigured:bot.configured,botUsername:bot.username||null,masterConfigured:!!MASTER});
  }
  if(route==="/api/slots"&&method==="GET"){
    const {state}=await load();
    const date=uri.searchParams.get("date")||"";
    const services=uri.searchParams.get("services")||uri.searchParams.get("service")||"";
    if(!validDate(date))return respond({date,slots:[],error:"INVALID_DATE"},400);
    if(!bookableDate(date))return respond({date,slots:[],error:"DATE_OUT_OF_RANGE"},400);
    return respond({date,slots:slots(state,date,services)});
  }
  if(route==="/bot/webhook"&&method==="POST"){
    if(!TOKEN||!process.env.TELEGRAM_WEBHOOK_SECRET||req.headers.get("x-telegram-bot-api-secret-token")!==process.env.TELEGRAM_WEBHOOK_SECRET)fail(403,"FORBIDDEN");
    const event=await body(req);
    const message=event.message;
    if(message&&message.chat?.type==="private"){
      const text=String(message.text||"").trim();
      const command=text.split(/\s+/)[0].split("@")[0].toLowerCase();
      const firstName=clean(message.from?.first_name||"");
      const greeting=firstName?"Здравствуйте, "+firstName+"!":"Здравствуйте!";
      const replyMarkup=APP_URL?{inline_keyboard:[[{text:"📅 Открыть онлайн-запись",web_app:{url:APP_URL}}]]}:undefined;
      if(command==="/start"||command==="/help"){
        await notify(message.chat.id,
          "✨ BOOKCORE | Онлайн-запись\n\n"+
          greeting+" Добро пожаловать в "+STUDIO+"! 💗\n\n"+
          "Здесь вы можете:\n"+
          "🌸 Посмотреть процедуры и цены\n"+
          "📆 Выбрать свободную дату и время\n"+
          "✅ Записаться без ожидания ответа\n"+
          "💌 Посмотреть свои записи, перенести или отменить их\n\n"+
          "Нажмите кнопку ниже, чтобы выбрать удобное время. 👇",
          replyMarkup);
      }else if(command==="/id"){
        await notify(message.chat.id,"🪪 Ваш Telegram ID: "+String(message.from?.id||message.chat.id)+"\n\nЭтот номер можно использовать для настройки доступа мастера.");
      }else if(text){
        await notify(message.chat.id,"Чтобы записаться на процедуру, нажмите кнопку ниже. 💗\n\nКоманды: /start — приветствие, /id — ваш Telegram ID.",replyMarkup);
      }
    }
    return respond({ok:true});
  }
  const auth=identity(req);
  if(!auth)fail(401,"TELEGRAM_AUTH_REQUIRED");
  if(route==="/api/avatar"&&method==="GET"){
    // Only return the authenticated Telegram user's own public profile photo.
    // The Telegram bot token and file_path must never reach the browser.
    let photos;
    try { photos=await botCall("getUserProfilePhotos",{user_id:Number(auth.id),limit:1}); }
    catch(e){console.warn("BOOKCORE_AVATAR_LOOKUP_FAILED",String(e));return new Response(null,{status:204,headers:{"cache-control":"private, max-age=120"}});}
    const variants=photos?.photos?.[0];
    if(!Array.isArray(variants)||variants.length===0)return new Response(null,{status:204,headers:{"cache-control":"private, max-age=120"}});
    const selected=variants.slice().sort((a,b)=>(b.width*b.height)-(a.width*a.height))[0];
    const file=await botCall("getFile",{file_id:selected.file_id});
    const filePath=String(file?.file_path||"");
    if(!/^[A-Za-z0-9_.\/-]+$/.test(filePath)||filePath.includes(".."))fail(503,"AVATAR_UNAVAILABLE");
    const photo=await fetch("https://api.telegram.org/file/bot"+TOKEN+"/"+filePath,{signal:AbortSignal.timeout(9000)});
    if(!photo.ok)return new Response(null,{status:204,headers:{"cache-control":"private, max-age=120"}});
    const bytes=await photo.arrayBuffer();
    if(bytes.byteLength>2*1024*1024||bytes.byteLength===0)return new Response(null,{status:204});
    return new Response(bytes,{status:200,headers:{"content-type":"image/jpeg","cache-control":"private, max-age=600","x-content-type-options":"nosniff"}});
  }
  if(route==="/api/me"&&method==="GET"){
    const {state}=await load();
    const user=state.users[auth.id];
    return respond({...secureUser(auth),clientName:user?.client_name||"",needsName:!auth.master&&!user?.client_name});
  }
  if(route==="/api/name"&&method==="POST"){
    const b=await body(req),name=clean(b.name);
    if(!validPersonName(name))fail(400,"Введите имя от 2 до 50 символов, без скрытых символов");
    await mutate(s=>{s.users[auth.id]={client_name:name,created_at:s.users[auth.id]?.created_at||new Date().toISOString()};return true;});
    return respond({ok:true,name});
  }
  if(route==="/api/bookings"&&method==="GET"){
    const {state}=await load();
    const rows=state.bookings.filter(b=>auth.master||b.telegram_id===auth.id).sort((a,b)=>b.starts_at.localeCompare(a.starts_at)).slice(0,auth.master?250:60);
    return respond({bookings:rows.map(listBooking)});
  }
  if(route==="/api/book"&&method==="POST"){
    const b=await body(req),date=String(b.date||""),time=String(b.time||"");
    if(!bookableDate(date)||!validTime(time))fail(400,"INVALID_DATE_TIME");
    const requested=b.serviceIds??b.serviceId;
    const saved=await mutate(s=>{
      const name=s.users[auth.id]?.client_name;
      if(!name)fail(409,"NAME_REQUIRED");
      const bundle=resolveServices(s,requested);
      if(!bundle||bundle.minutes>600)fail(400,"INVALID_SERVICES");
      if(!slots(s,date,bundle.ids).includes(time))fail(409,"TIME_NOT_AVAILABLE");
      const appointment={id:randomUUID(),tenant:"default",telegram_id:auth.id,name,
        service_id:bundle.ids[0],service_ids:bundle.ids,service_name:bundle.name,
        price:bundle.price,...timeRange(bundle,date,time),status:"confirmed",created_at:new Date().toISOString()};
      s.bookings.push(appointment);
      return appointment;
    });
    await notify(auth.id,"Запись подтверждена!\n"+saved.service_name+"\n"+prettyDate(saved.starts_at));
    await notifyMasters("Новая запись: "+saved.name+"\n"+saved.service_name+"\n"+prettyDate(saved.starts_at));
    return respond({ok:true,id:saved.id});
  }
  if(route==="/api/cancel"&&method==="POST"){
    const b=await body(req);
    const booking=await mutate(s=>{
      const x=s.bookings.find(x=>x.id===b.id);
      if(!x)fail(404,"NOT_FOUND");
      if(!auth.master&&x.telegram_id!==auth.id)fail(403,"FORBIDDEN");
      if(!auth.master&&Date.parse(x.starts_at)-Date.now()<12*3600000)fail(409,"TOO_LATE_TO_CANCEL");
      if(x.status!=="confirmed")fail(409,"NOT_ACTIVE");
      x.status=auth.master?"cancelled_by_master":"cancelled_by_client";return {...x};
    });
    if(auth.master)await notify(booking.telegram_id,"Мастер отменил запись: "+prettyDate(booking.starts_at));
    else await notifyMasters("Клиент отменил запись: "+booking.name);
    return respond({ok:true});
  }
  if(route==="/api/reschedule"&&method==="POST"){
    const b=await body(req),date=String(b.date||""),time=String(b.time||"");
    if(!validDate(date)||!validTime(time))fail(400,"INVALID_DATE_TIME");
    const booking=await mutate(s=>{
      const x=s.bookings.find(x=>x.id===b.id);
      if(!x)fail(404,"NOT_FOUND");
      if(x.status!=="confirmed")fail(409,"NOT_ACTIVE");
      if(!auth.master&&x.telegram_id!==auth.id)fail(403,"FORBIDDEN");
      if(!auth.master&&Date.parse(x.starts_at)-Date.now()<12*3600000)fail(409,"TOO_LATE_TO_RESCHEDULE");
      const bundle=resolveServices(s,x.service_ids||[x.service_id]);
      if(!bundle||!slots(s,date,bundle.ids,x.id).includes(time))fail(409,"TIME_NOT_AVAILABLE");
      Object.assign(x,timeRange(bundle,date,time));return {...x};
    });
    await notify(booking.telegram_id,"Запись перенесена: "+prettyDate(booking.starts_at));
    if(!auth.master)await notifyMasters("Клиент перенёс запись: "+booking.name);
    return respond({ok:true,id:booking.id});
  }
  if(!auth.master)fail(403,"FORBIDDEN");
  if(route==="/api/master"&&method==="GET"){
    const {state}=await load();
    return respond({bookings:state.bookings.slice().sort((a,b)=>b.starts_at.localeCompare(a.starts_at)).slice(0,250).map(listBooking),
      blocks:state.blocks.slice(-120),schedule:state.schedule,services:state.services.filter(s=>s.active),
      clients:Object.entries(state.users).map(([telegram_id,u])=>({telegram_id,client_name:u.client_name,created_at:u.created_at}))});
  }
  if(route==="/api/block"&&method==="POST"){
    const b=await body(req),day=String(b.day||""),start=b.startTime||null,end=b.endTime||null;
    if(!blockableDate(day)||(start||end)&&(!validTime(start)||!validTime(end)||minutes(start)>=minutes(end)))fail(400,"INVALID_BLOCK");
    const block=await mutate(s=>{
      const a=utc(day,start||"00:00").getTime(),z=utc(day,end||"23:59").getTime();
      const count=s.bookings.filter(b=>b.status==="confirmed"&&Date.parse(b.starts_at)<z&&Date.parse(b.busy_until)>a).length;
      if(count)fail(409,"EXISTING_BOOKINGS");
      const v={id:s.seq++,day,start_time:start,end_time:end,reason:clean(b.reason||"Выходной")};
      s.blocks.push(v);return v;
    });
    return respond({ok:true,id:block.id});
  }
  if(route==="/api/unblock"&&method==="POST"){
    const b=await body(req);
    await mutate(s=>{s.blocks=s.blocks.filter(x=>x.id!==Number(b.id));return true;});
    return respond({ok:true});
  }
  if(route==="/api/schedule"&&method==="POST"){
    const b=await body(req);
    if(!Number.isInteger(b.weekday)||b.weekday<0||b.weekday>6||!validTime(b.start)||!validTime(b.end)||minutes(b.start)>=minutes(b.end))fail(400,"INVALID_SCHEDULE");
    await mutate(s=>{
      // Changes must not silently invalidate confirmed future appointments.
      for(const appointment of s.bookings){
        if(appointment.status!=="confirmed"||Date.parse(appointment.busy_until)<=Date.now())continue;
        const entries=Object.fromEntries(studioFormatter.formatToParts(new Date(appointment.starts_at)).map(x=>[x.type,x.value]));
        const localDay=entries.year+"-"+entries.month+"-"+entries.day;
        if((new Date(localDay+"T12:00:00Z").getUTCDay()+6)%7!==b.weekday)continue;
        const start=utc(localDay,b.start).getTime(),end=utc(localDay,b.end).getTime();
        if(!b.active||Date.parse(appointment.starts_at)<start||Date.parse(appointment.busy_until)>end)fail(409,"EXISTING_BOOKINGS");
      }
      const item=s.schedule.find(x=>x.weekday===b.weekday);
      Object.assign(item,{start_time:b.start,end_time:b.end,active:!!b.active});
      return true;
    });
    return respond({ok:true});
  }
  if(route==="/api/service"&&method==="POST"){
    const b=await body(req),title=clean(b.title),min=Number(b.minutes),price=Number(b.price);
    if(title.length<3||!Number.isInteger(min)||min<15||min>600||!Number.isInteger(price)||price<0||price>1000000)fail(400,"INVALID_SERVICE");
    await mutate(s=>{let item=s.services.find(x=>x.id===Number(b.id));if(!item){item={id:Math.max(0,...s.services.map(x=>x.id))+1,active:true};s.services.push(item);}
      Object.assign(item,{title,minutes:min,price,description:clean(b.description)});return true;});
    return respond({ok:true});
  }
  if(route==="/api/manual-book"&&method==="POST"){
    const b=await body(req),date=String(b.date||""),time=String(b.time||""),name=clean(b.name);
    if(!validPersonName(name)||!bookableDate(date)||!validTime(time))fail(400,"INVALID_MANUAL_BOOKING");
    const appointment=await mutate(s=>{
      const bundle=resolveServices(s,b.serviceIds??b.serviceId);
      if(!bundle||bundle.minutes>600)fail(400,"INVALID_SERVICES");
      if(!slots(s,date,bundle.ids).includes(time))fail(409,"TIME_NOT_AVAILABLE");
      const x={id:randomUUID(),tenant:"default",telegram_id:null,name,
        service_id:bundle.ids[0],service_ids:bundle.ids,service_name:bundle.name,
        price:bundle.price,...timeRange(bundle,date,time),status:"confirmed",created_at:new Date().toISOString()};
      s.bookings.push(x);return x;
    });
    return respond({ok:true,id:appointment.id});
  }
  if(route==="/api/status"&&method==="POST"){
    const b=await body(req);
    if(!["completed","no_show","cancelled_by_master"].includes(b.status))fail(400,"INVALID_STATUS");
    const x=await mutate(s=>{
      const item=s.bookings.find(x=>x.id===b.id);
      if(!item)fail(404,"NOT_FOUND");
      if(item.status!=="confirmed")fail(409,"NOT_ACTIVE");
      if(b.status!=="cancelled_by_master"&&Date.parse(item.starts_at)>Date.now())fail(409,"APPOINTMENT_NOT_STARTED");
      item.status=b.status;
      return {...item};
    });
    if(b.status==="cancelled_by_master")await notify(x.telegram_id,"Мастер отменил вашу запись.");
    return respond({ok:true});
  }
  fail(404,"NOT_FOUND");
}
export default {async fetch(request){
  try{return await execute(request);}
  catch(e){if(e instanceof HttpError)return respond({error:e.message},e.status);
    console.error("BOOKCORE_ERROR",String(e));return respond({error:"SERVICE_UNAVAILABLE"},503);}
}};
