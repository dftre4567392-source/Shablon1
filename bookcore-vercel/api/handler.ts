// @ts-nocheck
import { createHmac, createHash, timingSafeEqual, randomUUID } from "node:crypto";
import { get, head, put, BlobPreconditionFailedError } from "@vercel/blob";

const PATH="bookcore/v1/state.json";
const TOKEN=process.env.TELEGRAM_BOT_TOKEN||"";
const MASTER=String(process.env.MASTER_TELEGRAM_ID||"");
const STUDIO=process.env.TENANT_DISPLAY_NAME||"Студия красоты";
const MASTER_NAME=process.env.MASTER_DISPLAY_NAME||"Ваш мастер";
const TZ=process.env.TENANT_TIMEZONE||"Europe/Moscow";

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
const toNum=(v)=>Number(v);
const validDate=(x)=>/^\d{4}-\d{2}-\d{2}$/.test(String(x))&&new Date(x+"T00:00:00Z").toISOString().slice(0,10)===x;
const validTime=(x)=>/^([01]\d|2[0-3]):[0-5]\d$/.test(String(x));
const minutes=(t)=>t.split(":").map(Number).reduce((a,b)=>a*60+b);
const pad=(i)=>String(i).padStart(2,"0");
const fmt=(m)=>pad(Math.floor(m/60))+":"+pad(m%60);
function utc(date,time){const [y,mo,d]=date.split("-").map(Number),[h,m]=time.split(":").map(Number);return new Date(Date.UTC(y,mo-1,d,h-3,m));}
function seed(){return {
 users:{},
 services:[
  {id:1,title:"Классическое наращивание",description:"Естественный и выразительный взгляд",minutes:120,price:1700,active:true},
  {id:2,title:"Наращивание 2D",description:"Воздушный двойной объём",minutes:150,price:2000,active:true},
  {id:3,title:"Наращивание 3D",description:"Эффектный объём",minutes:180,price:2300,active:true},
  {id:4,title:"Ламинирование ресниц",description:"Натуральный изгиб",minutes:75,price:1600,active:true},
  {id:5,title:"Снятие ресниц",description:"Бережное снятие",minutes:30,price:400,active:true}
 ],
 schedule:[0,1,2,3,4,5,6].map(weekday=>({weekday,start_time:"10:00",end_time:"19:00",active:weekday>=1&&weekday<=5})),
 blocks:[],bookings:[],seq:1
};}
async function load(){
  if(!process.env.BLOB_READ_WRITE_TOKEN) fail(503,"STORAGE_NOT_CONFIGURED");
  // Must bypass Blob CDN on a mutable JSON file; cached ETags cause permanent 412 retries.
  const result=await get(PATH,{access:"private",useCache:false});
  if(!result)return {state:seed(),etag:null};
  if(result.statusCode!==200||!result.stream)fail(503,"STORAGE_READ_FAILED");
  const raw=await new Response(result.stream).text();
  return {state:JSON.parse(raw),etag:result.blob.etag};
}
async function mutate(fn){
  for(let i=0;i<12;i++){
    const {state,etag}=await load();
    const output=await fn(state);
    try {
      await put(PATH,JSON.stringify(state),{access:"private",contentType:"application/json",allowOverwrite:!!etag,...(etag?{ifMatch:etag}:{}) ,cacheControlMaxAge:60});
      return output;
    }catch(e){
      const reason=String(e?.message||e);
      if(e instanceof BlobPreconditionFailedError || /already exists|precondition|conflict|412|409|blob_already/i.test(reason)){
        console.warn("BOOKCORE_STORAGE_CONFLICT_RETRY",i+1,JSON.stringify({readHasEtag:!!etag,etagLength:etag?.length||0,errorType:e?.name||"Unknown",errorCode:e?.code||null,message:reason.slice(0,170)}));
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
  try{const u=JSON.parse(p.get("user")||"{}");if(!Number.isSafeInteger(u.id)||u.id<1)return null;return {id:String(u.id),master:String(u.id)===MASTER};}catch{return null;}
}
function daySchedule(s,date){
  const day=(new Date(date+"T12:00:00Z").getUTCDay()+6)%7;
  return s.schedule.find(x=>x.weekday===day);
}
function slots(s,date,id,ignoreId=null){
  if(!validDate(date))return [];
  const svc=s.services.find(x=>x.id===Number(id)&&x.active);
  if(!svc)return [];
  const sch=daySchedule(s,date);
  if(!sch||!sch.active)return [];
  const now=Date.now(),dayStart=utc(date,"00:00").getTime(),endLimit=now+45*86400000;
  if(dayStart>endLimit||dayStart+86400000<now)return [];
  const anyWholeBlock=s.blocks.some(x=>x.day===date&&!x.start_time);
  if(anyWholeBlock)return [];
  const list=[];
  for(let m=minutes(sch.start_time);m+svc.minutes+15<=minutes(sch.end_time);m+=15){
    const t=fmt(m),a=utc(date,t).getTime(),b=a+(svc.minutes+15)*60000;
    if(a<now+4*3600000)continue;
    if(m<15*60 && m+svc.minutes+15>14*60)continue;
    if(s.blocks.some(x=>x.day===date&&x.start_time&&m<minutes(x.end_time)&&m+svc.minutes+15>minutes(x.start_time)))continue;
    if(s.bookings.some(x=>x.id!==ignoreId&&x.status==="confirmed"&&a<Date.parse(x.busy_until)&&b>Date.parse(x.starts_at)))continue;
    list.push(t);
  }
  return list;
}
const toISO=(date,time)=>utc(date,time).toISOString();
function timeRange(svc,date,time){const start=utc(date,time);return {starts_at:start.toISOString(),busy_until:new Date(start.getTime()+(svc.minutes+15)*60000).toISOString()};}
async function notify(chat,text,reply_markup){
  if(!TOKEN||!chat)return;
  try{await botCall("sendMessage",{chat_id:chat,text,...(reply_markup?{reply_markup}:{})});}catch(e){console.warn("BOOKCORE_NOTIFICATION_FAILED",String(e))}
}
function prettyDate(value){return new Date(value).toLocaleString("ru-RU",{timeZone:TZ,dateStyle:"medium",timeStyle:"short"});}
async function body(req){try{return await req.json()}catch{return {};}}
function secureUser(a){return {role:a.master?"master":"client"};}
function listBooking(b){return {id:b.id,name:b.name,service_id:b.service_id,service_name:b.service_name,price:b.price,starts_at:b.starts_at,status:b.status, ...(b.telegram_id?{telegram_id:b.telegram_id}:{})};}
async function execute(req){
  const uri=new URL(req.url);
  const route=uri.searchParams.get("route")||"/health";
  const method=req.method;

  // Temporary, hash-guarded storage migration check; removed after verification.
  if(route==="/api/__one_time_storage_probe"&&method==="GET"){
    const provided=uri.searchParams.get("key")||"";
    const expected="33e4438b742bc2dcb7ded974c341f03f31eca8d31d719a66c99a10fbd1c9b827";
    if(createHash("sha256").update(provided).digest("hex")!==expected)fail(404,"NOT_FOUND");
    if(uri.searchParams.get("mode")==="meta"){
      const current=await load();
      const meta=await head(PATH);
      return respond({getHasEtag:!!current.etag,headHasEtag:!!meta?.etag,etagEqual:current.etag===meta?.etag,
        getEtagLength:current.etag?.length||0,headEtagLength:meta?.etag?.length||0,
        getQuoted:current.etag?.startsWith('"')||false,headQuoted:meta?.etag?.startsWith('"')||false});
    }
    const proof=randomUUID();
    await mutate(s=>{s.__storage_probe={proof};return true;});
    const verified=await mutate(s=>{
      if(s.__storage_probe?.proof!==proof)fail(503,"STORAGE_READ_AFTER_WRITE_INCONSISTENT");
      delete s.__storage_probe;return true;
    });
    return respond({ok:verified,writeOne:true,readAfterWrite:true,writeTwo:true});
  }
  if(route==="/health"||route==="/api/health"){
    let storage=false;
    try{await load();storage=true;}catch(e){console.error("BOOKCORE_STORAGE_STATUS",String(e));}
    return respond({ok:storage,storage,telegramConfigured:!!TOKEN,masterConfigured:!!MASTER,provider:"vercel"},storage?200:503);
  }
  if(route==="/api/public"&&method==="GET"){
    const {state}=await load();
    const bot=await ensureBotSetup();
    return respond({studio:STUDIO,masterName:MASTER_NAME,timezone:TZ,services:state.services.filter(x=>x.active).map(x=>({id:x.id,title:x.title,description:x.description,minutes:x.minutes,price:x.price})),ready:!!TOKEN&&!!MASTER&&bot.configured,botConfigured:bot.configured,botUsername:bot.username||null,masterConfigured:!!MASTER});
  }
  if(route==="/api/slots"&&method==="GET"){
    const {state}=await load();
    const date=uri.searchParams.get("date")||"",service=uri.searchParams.get("service")||"";
    return respond({date,slots:slots(state,date,service)});
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
  if(route==="/api/me"&&method==="GET"){
    const {state}=await load();
    const user=state.users[auth.id];
    return respond({...secureUser(auth),clientName:user?.client_name||"",needsName:!auth.master&&!user?.client_name});
  }
  if(route==="/api/name"&&method==="POST"){
    const b=await body(req),name=clean(b.name);
    if(name.length<2||name.length>50||/[<>]/.test(name))fail(400,"Введите имя от 2 до 50 символов");
    await mutate(s=>{s.users[auth.id]={client_name:name,created_at:s.users[auth.id]?.created_at||new Date().toISOString()};return true;});
    return respond({ok:true,name});
  }
  if(route==="/api/bookings"&&method==="GET"){
    const {state}=await load();
    const rows=state.bookings.filter(b=>auth.master||b.telegram_id===auth.id).sort((a,b)=>b.starts_at.localeCompare(a.starts_at)).slice(0,auth.master?250:60);
    return respond({bookings:rows.map(listBooking)});
  }
  if(route==="/api/book"&&method==="POST"){
    const b=await body(req),date=String(b.date||""),time=String(b.time||""),id=Number(b.serviceId);
    if(!validDate(date)||!validTime(time))fail(400,"INVALID_DATE_TIME");
    const saved=await mutate(s=>{
      const name=s.users[auth.id]?.client_name;
      if(!name)fail(409,"NAME_REQUIRED");
      const svc=s.services.find(x=>x.id===id&&x.active);
      if(!svc||!slots(s,date,id).includes(time))fail(409,"TIME_NOT_AVAILABLE");
      const appointment={id:randomUUID(),tenant:"default",telegram_id:auth.id,name,service_id:svc.id,service_name:svc.title,price:svc.price,...timeRange(svc,date,time),status:"confirmed",created_at:new Date().toISOString()};
      s.bookings.push(appointment);
      return appointment;
    });
    await notify(auth.id,"Запись подтверждена!\n"+saved.service_name+"\n"+prettyDate(saved.starts_at));
    if(MASTER)await notify(MASTER,"Новая запись: "+saved.name+"\n"+prettyDate(saved.starts_at));
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
    else await notify(MASTER,"Клиент отменил запись: "+booking.name);
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
      const svc=s.services.find(z=>z.id===x.service_id);
      if(!svc||!slots(s,date,svc.id,x.id).includes(time))fail(409,"TIME_NOT_AVAILABLE");
      Object.assign(x,timeRange(svc,date,time));return {...x};
    });
    await notify(booking.telegram_id,"Запись перенесена: "+prettyDate(booking.starts_at));
    if(!auth.master)await notify(MASTER,"Клиент перенёс запись: "+booking.name);
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
    if(!validDate(day)||(start||end)&&(!validTime(start)||!validTime(end)||minutes(start)>=minutes(end)))fail(400,"INVALID_BLOCK");
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
    await mutate(s=>{const item=s.schedule.find(x=>x.weekday===b.weekday);Object.assign(item,{start_time:b.start,end_time:b.end,active:!!b.active});return true;});
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
    const b=await body(req),date=String(b.date||""),time=String(b.time||""),name=clean(b.name),sid=Number(b.serviceId);
    if(name.length<2||!validDate(date)||!validTime(time))fail(400,"INVALID_MANUAL_BOOKING");
    const appointment=await mutate(s=>{const svc=s.services.find(x=>x.id===sid&&x.active);
      if(!svc||!slots(s,date,sid).includes(time))fail(409,"TIME_NOT_AVAILABLE");
      const x={id:randomUUID(),tenant:"default",telegram_id:null,name,service_id:svc.id,service_name:svc.title,price:svc.price,...timeRange(svc,date,time),status:"confirmed",created_at:new Date().toISOString()};
      s.bookings.push(x);return x;});
    return respond({ok:true,id:appointment.id});
  }
  if(route==="/api/status"&&method==="POST"){
    const b=await body(req);
    if(!["completed","no_show","cancelled_by_master"].includes(b.status))fail(400,"INVALID_STATUS");
    const x=await mutate(s=>{const item=s.bookings.find(x=>x.id===b.id);if(!item)fail(404,"NOT_FOUND");item.status=b.status;return {...item};});
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
