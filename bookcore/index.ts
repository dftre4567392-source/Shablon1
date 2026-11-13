
import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";

const ENV = Bun.env;
const TOKEN = ENV.TELEGRAM_BOT_TOKEN || "";
const MASTER = String(ENV.MASTER_TELEGRAM_ID || "");
const APP_URL = ENV.APP_URL || "";
const TENANT = "studio-anna";
const TZ = ENV.TENANT_TIMEZONE || "Europe/Moscow";
const STUDIO = ENV.TENANT_DISPLAY_NAME || "Студия красоты";
const MASTER_NAME = ENV.MASTER_DISPLAY_NAME || "Ваш мастер";
const SQL_URL = ENV.DATABASE_URL || "";
const db = SQL_URL ? new Bun.SQL(SQL_URL) : null;
const HEADERS = {"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const j = (obj, status = 200) => new Response(JSON.stringify(obj), {status, headers:HEADERS});
const q = async (statement, values = []) => {
  if (!db) throw new Error("DATABASE_NOT_CONNECTED");
  return await db.unsafe(statement, values);
};
const escapeStr = (value) => String(value == null ? "" : value).trim().slice(0,200);
const int = (x, def=0) => Number.isFinite(Number(x)) ? Number(x) : def;
const err = (code, status=400) => j({error:code}, status);
function getIdentity(req) {
  if (!TOKEN) return null;
  const init = req.headers.get("x-telegram-init-data") || "";
  const parts = new URLSearchParams(init);
  const hash = parts.get("hash") || "";
  const sentAt = int(parts.get("auth_date"), 0);
  if (!/^[0-9a-f]{64}$/i.test(hash) || Math.abs(Date.now()/1000 - sentAt)>86400) return null;
  parts.delete("hash");
  const base = Array.from(parts.entries()).sort((a,b)=>a[0].localeCompare(b[0])).map(v=>v[0]+"="+v[1]).join("\n");
  const key = createHmac("sha256","WebAppData").update(TOKEN).digest();
  const digest = createHmac("sha256", key).update(base).digest();
  if (!timingSafeEqual(Buffer.from(hash,"hex"), digest)) return null;
  try {
    const user = JSON.parse(parts.get("user") || "{}");
    if (!Number.isInteger(user.id) || user.id < 1) return null;
    return { id:String(user.id), master: String(user.id) === MASTER };
  } catch { return null; }
}
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && !isNaN(Date.parse(s+"T00:00:00Z"));
const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s));
function toUTC(date,time) {
  // Основная студия использует московское время, UTC+3 без сезонного перехода.
  const [y,m,d] = date.split("-").map(Number), [h,min] = time.split(":").map(Number);
  return new Date(Date.UTC(y,m-1,d,h-3,min));
}
function localDate(iso) {
  return new Intl.DateTimeFormat("ru-RU",{timeZone:TZ,day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}).format(new Date(iso));
}
function mins(time) {const [h,m]=time.split(":").map(Number); return h*60+m;}
function fmtMinutes(n) {return String(Math.floor(n/60)).padStart(2,"0")+":"+String(n%60).padStart(2,"0");}
const todayYMD = () => {
 const p = new Intl.DateTimeFormat("en-CA",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
 const dict=Object.fromEntries(p.map(z=>[z.type,z.value]));
 return dict.year+"-"+dict.month+"-"+dict.day;
};
async function schema() {
  if (!db) return;
  await q('CREATE EXTENSION IF NOT EXISTS btree_gist');
  await q('CREATE TABLE IF NOT EXISTS bc_users (telegram_id TEXT PRIMARY KEY, client_name TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  await q('CREATE TABLE IF NOT EXISTS bc_services (id SERIAL PRIMARY KEY, tenant TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT \'\', minutes INTEGER NOT NULL CHECK (minutes BETWEEN 15 AND 600), price INTEGER NOT NULL DEFAULT 0, active BOOLEAN NOT NULL DEFAULT TRUE)');
  await q('CREATE TABLE IF NOT EXISTS bc_schedule (tenant TEXT NOT NULL, weekday INT NOT NULL CHECK (weekday BETWEEN 0 AND 6), start_time TEXT NOT NULL, end_time TEXT NOT NULL, active BOOLEAN NOT NULL, PRIMARY KEY (tenant,weekday))');
  await q('CREATE TABLE IF NOT EXISTS bc_blocks (id SERIAL PRIMARY KEY, tenant TEXT NOT NULL, day DATE NOT NULL, start_time TEXT, end_time TEXT, reason TEXT NOT NULL DEFAULT \'\', CHECK ((start_time IS NULL AND end_time IS NULL) OR (start_time IS NOT NULL AND end_time IS NOT NULL)))');
  await q('CREATE TABLE IF NOT EXISTS bc_bookings (id UUID PRIMARY KEY, tenant TEXT NOT NULL, telegram_id TEXT, name TEXT NOT NULL, service_id INT NOT NULL, service_name TEXT NOT NULL, price INT NOT NULL, starts_at TIMESTAMPTZ NOT NULL, busy_until TIMESTAMPTZ NOT NULL, status TEXT NOT NULL DEFAULT \'confirmed\', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), CHECK (busy_until>starts_at))');
  await q("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bc_booking_no_overlap') THEN ALTER TABLE bc_bookings ADD CONSTRAINT bc_booking_no_overlap EXCLUDE USING gist (tenant WITH =, tstzrange(starts_at,busy_until,'[)') WITH &&) WHERE (status='confirmed'); END IF; END $$");
  await q("CREATE INDEX IF NOT EXISTS bc_booking_time ON bc_bookings (tenant,starts_at)");
  const services = await q('SELECT COUNT(*)::integer AS count FROM bc_services WHERE tenant=$1',[TENANT]);
  if (Number(services[0].count)===0) for (const s of [
     ["Классическое наращивание",120,1700,"Естественный и выразительный взгляд"],
     ["Наращивание 2D",150,2000,"Воздушный двойной объём"],
     ["Наращивание 3D",180,2300,"Эффектный объём"],
     ["Ламинирование ресниц",75,1600,"Натуральный изгиб"],
     ["Снятие ресниц",30,400,"Бережное снятие"]
  ]) await q('INSERT INTO bc_services (tenant,title,minutes,price,description) VALUES ($1,$2,$3,$4,$5)',[TENANT,...s]);
  for(let wd=0;wd<7;wd++) await q("INSERT INTO bc_schedule (tenant,weekday,start_time,end_time,active) VALUES ($1,$2,'10:00','19:00',$3) ON CONFLICT(tenant,weekday) DO NOTHING",[TENANT,wd,wd>=1 && wd<=5]);
}
async function services() { return await q('SELECT id,title,description,minutes,price FROM bc_services WHERE tenant=$1 AND active=true ORDER BY id',[TENANT]); }
async function getSlots(date,serviceId) {
  if(!isDate(date)) return [];
  const n=new Date(date+"T12:00:00Z"), day=(n.getUTCDay()+6)%7;
  if(n.toISOString().slice(0,10)!==date) return [];
  const now=new Date(), future=new Date(now.getTime()+45*86400000);
  if(toUTC(date,"23:59")<now || toUTC(date,"00:00")>future) return [];
  const [service]=await q('SELECT * FROM bc_services WHERE tenant=$1 AND id=$2 AND active=true',[TENANT,int(serviceId)]);
  if(!service) return [];
  const [schedule]=await q('SELECT * FROM bc_schedule WHERE tenant=$1 AND weekday=$2',[TENANT,day]);
  if(!schedule || !schedule.active) return [];
  const blocked=await q('SELECT start_time,end_time FROM bc_blocks WHERE tenant=$1 AND day=$2::date',[TENANT,date]);
  if(blocked.some(b=>!b.start_time)) return [];
  const bookings=await q("SELECT starts_at,busy_until FROM bc_bookings WHERE tenant=$1 AND status='confirmed' AND starts_at < $3::timestamptz AND busy_until > $2::timestamptz",[TENANT,toUTC(date,"00:00").toISOString(),new Date(toUTC(date,"00:00").getTime()+86400000).toISOString()]);
  const open=mins(schedule.start_time),close=mins(schedule.end_time);
  const list=[];
  for(let m=open;m+service.minutes+15<=close;m+=15) {
    const t=fmtMinutes(m), start=toUTC(date,t), end=new Date(start.getTime()+(service.minutes+15)*60000);
    if(start.getTime()<now.getTime()+4*3600000)continue;
    if(m<15*60 && m+service.minutes+15>14*60)continue;
    if(blocked.some(b=>b.start_time && m<mins(b.end_time) && (m+service.minutes+15)>mins(b.start_time)))continue;
    if(bookings.some(b=>start<new Date(b.busy_until) && end>new Date(b.starts_at)))continue;
    list.push(t);
  }
  return list;
}
async function sendTelegram(chat,text) {
  if(!TOKEN || !chat) return;
  try { await fetch("https://api.telegram.org/bot"+TOKEN+"/sendMessage",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({chat_id:chat,text})}); }catch{}
}
async function parse(req){try{return await req.json()}catch{return {}}}
async function handler(req) {
  const url=new URL(req.url), path=url.pathname, method=req.method;
  if(path==="/health") {
    let dbOK=false; try{if(db){await q("SELECT 1");dbOK=true;}}catch{}
    return j({ok:true,database:dbOK,telegramConfigured:!!TOKEN,masterConfigured:!!MASTER});
  }
  if(path==="/" || path==="/index.html") {
    const htmlEsc = (value) => String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
    const hex = (name, fallback) => /^#[0-9a-fA-F]{6}$/.test(ENV[name] || "") ? ENV[name] : fallback;
    const primary = hex("THEME_PRIMARY","#513548");
    const accent = hex("THEME_ACCENT","#8f5c79");
    const background = hex("THEME_BACKGROUND","#f8f3f6");
    const surface = hex("THEME_SURFACE","#ffffff");
    const style = '<style>body{background:'+background+'!important}.btn:not(.soft):not(.line){background:'+primary+'!important}.hero{background:linear-gradient(120deg,'+primary+','+accent+')!important}.dock button.active{color:'+accent+'!important}.card,.item{background:'+surface+'!important}</style>';
    const html = PAGE.replace('<div class="logo">✦ BOOKCORE</div>','<div class="logo">✦ '+htmlEsc(STUDIO)+'</div>')
      .replace("LASH & BEAUTY", htmlEsc(ENV.TENANT_CATEGORY || "LASH & BEAUTY"))
      .replace("Красивый взгляд начинается здесь", htmlEsc(ENV.TENANT_HERO_TITLE || "Красивый взгляд начинается здесь"))
      .replace("Твоя красота — наша забота. Выбирай процедуру и удобное время без переписок.", htmlEsc(ENV.TENANT_HERO_SUBTITLE || "Твоя красота — наша забота. Выбирай процедуру и удобное время без переписок."))
      .replace("</head>", style+"</head>");
    return new Response(html,{headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-cache","x-content-type-options":"nosniff"}});
  }
  if(path==="/bot/webhook" && method==="POST"){
    if(!TOKEN || !ENV.TELEGRAM_WEBHOOK_SECRET || req.headers.get("x-telegram-bot-api-secret-token")!==ENV.TELEGRAM_WEBHOOK_SECRET) return err("FORBIDDEN",403);
    const event=await parse(req), message=event.message;
    if(message && /^\/start(?:\s|$)/.test(message.text||"")) await sendTelegram(message.chat.id, "Добро пожаловать! Откройте приложение для записи: "+APP_URL);
    return j({ok:true});
  }
  if(path==="/api/public" && method==="GET") {
    try {return j({studio:STUDIO,masterName:MASTER_NAME,timezone:TZ,services:await services(),ready:!!TOKEN && !!MASTER,site:APP_URL});}
    catch {return j({studio:STUDIO,masterName:MASTER_NAME,timezone:TZ,services:[],ready:false,error:"База данных ещё не подключена"});}
  }
  if(path==="/api/slots" && method==="GET") {
    try {return j({date:url.searchParams.get("date"),slots:await getSlots(url.searchParams.get("date"),url.searchParams.get("service"))});}
    catch {return err("SERVICE_UNAVAILABLE",503);}
  }
  const identity = getIdentity(req);
  if(!identity) return err("TELEGRAM_AUTH_REQUIRED",401);
  try {
    if(path==="/api/me" && method==="GET"){
      const r=await q("SELECT client_name FROM bc_users WHERE telegram_id=$1",[identity.id]);
      return j({role:identity.master?"master":"client",clientName:r[0]?.client_name||"",needsName:!identity.master&&!r[0]?.client_name});
    }
    if(path==="/api/name" && method==="POST"){
      const body=await parse(req), name=escapeStr(body.name).replace(/\s+/g," ");
      if(name.length<2 || name.length>50 || /[<>]/.test(name))return err("Введите имя от 2 до 50 символов");
      await q("INSERT INTO bc_users(telegram_id,client_name) VALUES ($1,$2) ON CONFLICT(telegram_id) DO UPDATE SET client_name=$2",[identity.id,name]);
      return j({ok:true,name});
    }
    if(path==="/api/bookings" && method==="GET"){
      const rows=identity.master ? await q("SELECT id,telegram_id,name,service_name,price,starts_at,status FROM bc_bookings WHERE tenant=$1 ORDER BY starts_at DESC LIMIT 200",[TENANT]) : await q("SELECT id,name,service_name,price,starts_at,status FROM bc_bookings WHERE tenant=$1 AND telegram_id=$2 ORDER BY starts_at DESC LIMIT 60",[TENANT,identity.id]);
      return j({bookings:rows});
    }
    if(path==="/api/book" && method==="POST"){
      const b=await parse(req),date=String(b.date||""),time=String(b.time||""),serviceId=int(b.serviceId);
      if(!isDate(date)||!isTime(time))return err("INVALID_DATE_TIME");
      const [u]=await q('SELECT client_name FROM bc_users WHERE telegram_id=$1',[identity.id]);
      if(!u?.client_name)return err("NAME_REQUIRED",409);
      const slots=await getSlots(date,serviceId);
      if(!slots.includes(time))return err("TIME_NOT_AVAILABLE",409);
      const [s]=await q('SELECT * FROM bc_services WHERE tenant=$1 AND id=$2 AND active=true',[TENANT,serviceId]);
      const start=toUTC(date,time), end=new Date(start.getTime()+(s.minutes+15)*60000);
      const id=randomUUID();
      try {await q("INSERT INTO bc_bookings (id,tenant,telegram_id,name,service_id,service_name,price,starts_at,busy_until) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",[id,TENANT,identity.id,u.client_name,s.id,s.title,s.price,start.toISOString(),end.toISOString()]);}
      catch(ex){if(String(ex).includes("bc_booking_no_overlap") || String(ex).includes("23P01"))return err("TIME_NOT_AVAILABLE",409);throw ex;}
      await sendTelegram(identity.id,"Запись подтверждена!\n"+s.title+"\n"+localDate(start.toISOString())+"\n"+STUDIO);
      if(MASTER)await sendTelegram(MASTER,"Новая запись: "+u.client_name+"\n"+s.title+"\n"+localDate(start.toISOString()));
      return j({ok:true,id});
    }
    if(path==="/api/cancel" && method==="POST"){
      const b=await parse(req), id=String(b.id||"");
      const [bk]=await q("SELECT * FROM bc_bookings WHERE id=$1 AND tenant=$2",[id,TENANT]);
      if(!bk)return err("NOT_FOUND",404);
      if(!identity.master && bk.telegram_id!==identity.id)return err("FORBIDDEN",403);
      if(!identity.master && new Date(bk.starts_at).getTime()-Date.now()<12*3600000)return err("TOO_LATE_TO_CANCEL",409);
      await q("UPDATE bc_bookings SET status=$1 WHERE id=$2 AND status='confirmed'",[identity.master?"cancelled_by_master":"cancelled_by_client",id]);
      if(identity.master && bk.telegram_id)await sendTelegram(bk.telegram_id,"Мастер отменил вашу запись: "+localDate(bk.starts_at));
      else if(MASTER)await sendTelegram(MASTER,"Клиент отменил запись: "+bk.name);
      return j({ok:true});
    }
    if(path==="/api/master" && method==="GET"){
      if(!identity.master)return err("FORBIDDEN",403);
      const [bs,blocks,sch,sv,users]=await Promise.all([
        q("SELECT id,telegram_id,name,service_name,price,starts_at,status FROM bc_bookings WHERE tenant=$1 ORDER BY starts_at DESC LIMIT 250",[TENANT]),
        q("SELECT id,day::text,start_time,end_time,reason FROM bc_blocks WHERE tenant=$1 ORDER BY day DESC LIMIT 120",[TENANT]),
        q("SELECT weekday,start_time,end_time,active FROM bc_schedule WHERE tenant=$1 ORDER BY weekday",[TENANT]),
        services(),
        q("SELECT telegram_id,client_name,created_at FROM bc_users ORDER BY created_at DESC LIMIT 250")
      ]);
      return j({bookings:bs,blocks,schedule:sch,services:sv,clients:users});
    }
    if(path==="/api/block" && method==="POST"){
      if(!identity.master)return err("FORBIDDEN",403);
      const b=await parse(req),day=String(b.day||""),start=b.startTime?String(b.startTime):null,end=b.endTime?String(b.endTime):null;
      if(!isDate(day)||((start||end)&&(!isTime(start)||!isTime(end)||mins(start)>=mins(end))))return err("INVALID_BLOCK");
      const a=toUTC(day,start||"00:00"),z=toUTC(day,end||"23:59");
      const overlapping=await q("SELECT COUNT(*)::int AS n FROM bc_bookings WHERE tenant=$1 AND status='confirmed' AND starts_at < $3::timestamptz AND busy_until > $2::timestamptz",[TENANT,a.toISOString(),z.toISOString()]);
      if(Number(overlapping[0].n)>0)return j({error:"EXISTING_BOOKINGS",count:Number(overlapping[0].n)},409);
      const added=await q("INSERT INTO bc_blocks(tenant,day,start_time,end_time,reason) VALUES($1,$2::date,$3,$4,$5) RETURNING id",[TENANT,day,start,end,escapeStr(b.reason||"Выходной")]);
      return j({ok:true,id:added[0].id});
    }
    if(path==="/api/unblock" && method==="POST"){
      if(!identity.master)return err("FORBIDDEN",403);
      const b=await parse(req);await q("DELETE FROM bc_blocks WHERE tenant=$1 AND id=$2",[TENANT,int(b.id)]);return j({ok:true});
    }
    if(path==="/api/service" && method==="POST"){
      if(!identity.master)return err("FORBIDDEN",403);
      const b=await parse(req),name=escapeStr(b.title),minutes=int(b.minutes),price=int(b.price);
      if(name.length<3||minutes<15||minutes>600||price<0||price>1000000)return err("INVALID_SERVICE");
      if(b.id) await q("UPDATE bc_services SET title=$1,minutes=$2,price=$3,description=$4 WHERE id=$5 AND tenant=$6",[name,minutes,price,escapeStr(b.description),int(b.id),TENANT]);
      else await q("INSERT INTO bc_services(tenant,title,minutes,price,description) VALUES($1,$2,$3,$4,$5)",[TENANT,name,minutes,price,escapeStr(b.description)]);
      return j({ok:true});
    }
    if(path==="/api/status" && method==="POST"){
      if(!identity.master)return err("FORBIDDEN",403);
      const b=await parse(req),st=String(b.status||"");
      if(!["completed","no_show","cancelled_by_master"].includes(st))return err("INVALID_STATUS");
      await q("UPDATE bc_bookings SET status=$1 WHERE id=$2 AND tenant=$3",[st,String(b.id||""),TENANT]);
      return j({ok:true});
    }
    if(path==="/api/schedule" && method==="POST"){
      if(!identity.master)return err("FORBIDDEN",403);
      const b=await parse(req);
      if(!Number.isInteger(b.weekday)||b.weekday<0||b.weekday>6||!isTime(b.start)||!isTime(b.end)||mins(b.start)>=mins(b.end))return err("INVALID_SCHEDULE");
      await q("UPDATE bc_schedule SET start_time=$1,end_time=$2,active=$3 WHERE tenant=$4 AND weekday=$5",[b.start,b.end,!!b.active,TENANT,b.weekday]);
      return j({ok:true});
    }
    return err("NOT_FOUND",404);
  }catch(ex){console.error("BOOKCORE_REQUEST_FAILED",String(ex));return err("SERVER_ERROR",503);}
}
const PAGE = `<!doctype html><html lang="ru"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no"/><meta name="theme-color" content="#f6f1f5"/><title>BOOKCORE — запись онлайн</title><script src="https://telegram.org/js/telegram-web-app.js"></script><style>
:root{font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#342b34;background:#f8f3f6;font-synthesis:none}*{box-sizing:border-box}body{margin:0}button,input,select,textarea{font:inherit}button{cursor:pointer}button:disabled{opacity:.45;cursor:not-allowed}.wrap{max-width:620px;margin:auto;min-height:100dvh;padding:16px 16px 94px}.top{display:flex;justify-content:space-between;align-items:center;margin:2px 0 16px}.logo{font-weight:800;letter-spacing:2px;font-size:19px}.tiny{font-size:11px;color:#9e8b99;letter-spacing:1px}.circle{width:39px;height:39px;border-radius:50%;background:#eedbe7;display:grid;place-items:center;color:#7d5070;font-size:19px}.hero{position:relative;overflow:hidden;border-radius:25px;min-height:216px;background:linear-gradient(120deg,#4b3044,#8f5c79 60%,#d8b5c7);color:white;padding:25px 22px;box-shadow:0 12px 24px #b58ba547}.hero:before{content:"";position:absolute;width:170px;height:170px;border-radius:50%;right:-35px;top:-55px;border:34px solid #ffffff1a}.hero:after{content:"";position:absolute;width:120px;height:120px;border-radius:60%;right:28px;bottom:-65px;background:#ffffff21}.hero h1{font-size:27px;line-height:1.14;letter-spacing:-.6px;margin:18px 0 11px;max-width:290px}.hero p{font-size:13px;max-width:260px;line-height:1.5;color:#f4eaf0}.kicker{font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#edd7e5}.section{margin:22px 0 12px;display:flex;justify-content:space-between;align-items:center}.section h2{font-size:19px;margin:0}.muted{color:#927e8d}.sub{font-size:13px;color:#8f808b;line-height:1.5}.btn{background:#513548;color:white;border:0;padding:14px 16px;border-radius:14px;font-weight:650;min-height:48px}.btn.soft{background:#f0dfe8;color:#63445a}.btn.line{background:white;border:1px solid #dac9d4;color:#5c4354}.btn.full{width:100%}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}.card{background:white;border:1px solid #f0e5ec;border-radius:18px;padding:16px;box-shadow:0 3px 12px #6e52650b}.service{margin:10px 0;display:flex;align-items:center;justify-content:space-between;gap:10px}.service.selected{border:1.5px solid #92627e;background:#f7e9f0}.tag{font-size:11px;background:#f2e4ec;color:#865d76;padding:6px 8px;border-radius:9px}.price{font-weight:700;white-space:nowrap}.serviceName{font-weight:650;font-size:14px}.chip{padding:10px 12px;border:1px solid #e7d5df;background:white;border-radius:12px;color:#5b4755}.chip.active{background:#4f3448;color:white;border-color:#4f3448}.flex{display:flex;gap:8px;flex-wrap:wrap}.field{width:100%;border-radius:13px;background:white;border:1px solid #dfd3da;padding:12px;margin:9px 0;color:#3f3440}.dock{position:fixed;bottom:0;left:50%;transform:translateX(-50%);max-width:620px;width:100%;padding:8px 12px max(8px,env(safe-area-inset-bottom));background:#fffcfef2;display:flex;justify-content:space-around;border-top:1px solid #eddfeb;backdrop-filter:blur(18px)}.dock button{border:0;background:none;display:flex;flex-direction:column;align-items:center;gap:4px;color:#988593;font-size:10px;flex:1;padding:6px 0}.dock button.active{color:#664158;font-weight:700}.dock .ico{font-size:22px}.empty{background:white;border:1px dashed #d7c2d0;text-align:center;padding:30px 15px;border-radius:18px;color:#867583}.notice{background:#fff8e7;border:1px solid #edd7a8;border-radius:14px;padding:12px;font-size:12px;color:#796448;line-height:1.5}.row{display:flex;justify-content:space-between;align-items:center;gap:14px}.item{background:white;border:1px solid #f0e5ec;padding:14px;border-radius:14px;margin:9px 0}.danger{color:#b1516b}.value{font-size:24px;font-weight:800;margin:9px 0 3px}.pill{border-radius:9px;padding:5px 8px;font-size:11px;background:#eaf5e9;color:#558159}.line{height:1px;background:#f0e6ec;margin:12px 0}h3{font-size:15px}.overlay{position:fixed;inset:0;background:#291a27aa;display:grid;place-items:center;padding:18px;z-index:5}.modal{background:#fbf8fa;border-radius:23px;max-width:440px;width:100%;padding:24px}.error{color:#ad395c;font-size:12px;margin:6px 0}.ok{color:#4b8060}.cap{font-size:11px;color:#988b95}.hint{background:#f4e9f0;color:#795468;border-radius:13px;padding:12px;font-size:12px}.hide{display:none}.loading{opacity:.65;pointer-events:none}@media(min-width:600px){.wrap{padding-top:25px}.hero{min-height:230px}}@media(prefers-reduced-motion:no-preference){.card,.btn,.chip{transition:all .17s ease}.btn:active,.chip:active{transform:scale(.98)}}
</style></head><body><main class="wrap"><div class="top"><div><div class="logo">✦ BOOKCORE</div><div class="tiny">BEAUTY APPOINTMENTS</div></div><div class="circle">✿</div></div><div id="main"><div class="empty">Загружаем студию…</div></div></main><nav id="dock" class="dock"></nav><div id="modalRoot"></div><script>
const tg=window.Telegram&&window.Telegram.WebApp;
if(tg){tg.ready();tg.expand();}
const initial=tg&&tg.initData||"";
const state={public:null,me:null,page:"home",serviceId:0,date:"",time:"",slots:[],bookings:[],master:null,loading:false};
const el=(id)=>document.getElementById(id);
const esc=(s)=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const rub=(x)=>new Intl.NumberFormat("ru-RU").format(x||0)+" ₽";
function fail(msg){alert(msg);}
async function api(path,opts){const r=await fetch(path,{...opts,headers:{"content-type":"application/json","x-telegram-init-data":initial,...(opts&&opts.headers||{})}});const x=await r.json();if(!r.ok)throw new Error(x.error||"Ошибка сервера");return x;}
const isMaster=()=>state.me&&state.me.role==="master";
async function init(){try{state.public=await api("/api/public");if(initial){try{state.me=await api("/api/me")}catch(e){console.error(e)}}}catch(e){state.public={studio:"Студия красоты",masterName:"Ваш мастер",services:[],ready:false}}render();if(state.me&&state.me.needsName)onboard();}
function route(p){state.page=p;render();if(p==="visits")loadBookings();if(p==="calendar"||p==="clients"||p==="settings"||p==="overview")loadMaster();}
function nav(){const n=isMaster()?[["overview","⌂","Обзор"],["calendar","▦","Календарь"],["clients","♧","Клиенты"],["settings","⚙","Настройки"]]:[["home","⌂","Главная"],["booking","▦","Запись"],["visits","♡","Мои"],["profile","♙","Профиль"]];el("dock").innerHTML=n.map(x=>'<button class="'+(state.page===x[0]?"active":"")+'" onclick="route(\''+x[0]+'\')"><span class="ico">'+x[1]+'</span>'+x[2]+'</button>').join("");}
function serviceCards(){return state.public.services.map(s=>'<div class="card service '+(state.serviceId===s.id?"selected":"")+'" onclick="chooseService('+s.id+')"><div><div class="serviceName">'+esc(s.title)+'</div><div class="sub">'+esc(s.description||s.minutes+" мин")+'</div><div class="cap">'+s.minutes+' мин</div></div><div style="text-align:right"><div class="price">'+rub(s.price)+'</div><div style="color:#ad7a95;margin-top:7px">'+(state.serviceId===s.id?"●":"○")+'</div></div></div>').join("")||'<div class="empty">Услуги будут доступны после настройки сервера</div>';}
function chooseService(id){state.serviceId=id;state.time="";state.slots=[];render();if(state.date)loadSlots();}
function publicView(){if(state.page==="home")return '<div class="hero"><div class="kicker">LASH & BEAUTY</div><h1>Красивый взгляд начинается здесь</h1><p>Твоя красота — наша забота. Выбирай процедуру и удобное время без переписок.</p><button class="btn soft" onclick="route(\'booking\')">Записаться →</button></div><div class="section"><h2>Наши услуги</h2><span class="sub">от 400 ₽</span></div>'+serviceCards()+'<div class="card" style="margin-top:13px"><h3>♡ Забота в деталях</h3><div class="sub">Онлайн-запись 24/7 · Удобное расписание · Напоминания в Telegram</div></div>';
if(state.page==="booking")return '<div class="section"><h2>Выберите процедуру</h2></div><div class="sub">Стоимость указана для ознакомления, оплата вне приложения.</div>'+serviceCards()+'<div class="section"><h2>Дата и время</h2></div><div class="card"><label class="sub" for="date">Выберите свободную дату</label><input id="date" type="date" class="field" value="'+esc(state.date)+'" onchange="selectDate(this.value)" min="'+new Date().toISOString().slice(0,10)+'"/><div class="sub">Свободное время</div><div class="flex" id="slotList">'+(state.slots.length?state.slots.map(x=>'<button class="chip '+(state.time===x?"active":"")+'" onclick="selectTime(\''+x+'\')">'+x+'</button>').join(""):'<p class="cap">Сначала выберите услугу и дату</p>')+'</div></div><div class="card" style="margin-top:15px"><div class="row"><b>К записи</b><b>'+rub((state.public.services.find(x=>x.id===state.serviceId)||{}).price)+'</b></div><button class="btn full" style="margin-top:14px" '+(!state.time||!initial||!state.public.ready?"disabled":"")+' onclick="book()">Подтвердить запись</button>'+(!initial?'<div class="hint" style="margin-top:10px">Для записи откройте приложение через Telegram-бота.</div>':!state.public.ready?'<div class="hint" style="margin-top:10px">Онлайн-запись включится после подключения бота и мастера.</div>':'')+'</div>';
if(state.page==="visits")return '<div class="section"><h2>Мои записи</h2></div>'+(!initial?'<div class="empty">Откройте приложение в Telegram</div>':state.bookings.length?state.bookings.map(bookingCard).join(""):'<div class="empty">Пока нет записей<br><button style="margin-top:15px" class="btn" onclick="route(\'booking\')">Записаться</button></div>');
return '<div class="section"><h2>Мой профиль</h2></div><div class="card"><div class="row"><div class="circle">♙</div><div style="flex:1"><b>'+esc(state.me&&state.me.clientName||"Гость")+'</b><div class="sub">Ваш профиль записи</div></div></div><div class="line"></div><button class="btn line full" onclick="onboard()">Изменить имя</button></div><div class="card" style="margin-top:12px"><h3>Информация</h3><p class="sub">Для записи используется идентификатор Telegram и имя, которое вы указали самостоятельно. Никаких платежей в приложении нет.</p></div>';}
function bookingCard(b){const date=new Date(b.starts_at).toLocaleString("ru-RU",{dateStyle:"medium",timeStyle:"short",timeZone:"Europe/Moscow"});return '<div class="card" style="margin-bottom:10px"><div class="row"><b>'+esc(b.service_name)+'</b><span class="pill">'+esc(b.status)+'</span></div><div class="sub" style="margin:9px 0">'+esc(date)+'</div><div class="row"><b>'+rub(b.price)+'</b>'+(b.status==="confirmed"?'<button class="btn line" onclick="cancelBooking(\''+b.id+'\')">Отменить</button>':'')+'</div></div>';}
function masterView(){if(state.page==="overview"){const arr=state.master&&state.master.bookings||[];const recent=arr.filter(x=>x.status==="confirmed");return '<div class="section"><h2>Кабинет мастера</h2></div><div class="grid"><div class="card"><div class="sub">Активных записей</div><div class="value">'+recent.length+'</div></div><div class="card"><div class="sub">Всего клиентов</div><div class="value">'+(state.master&&state.master.clients||[]).length+'</div></div></div><div class="section"><h2>Ближайшие записи</h2></div>'+recent.slice(0,10).map(bookingCard).join("")+'<button class="btn full" onclick="route(\'calendar\')">Управлять календарём</button>';}
if(state.page==="calendar")return '<div class="section"><h2>Календарь мастера</h2></div><div class="card"><h3>Закрыть день или часы</h3><input id="blockDay" type="date" class="field"/><div class="grid"><input id="from" type="time" class="field" placeholder="От"/><input id="to" type="time" class="field" placeholder="До"/></div><input id="blockReason" class="field" placeholder="Причина (необязательно)"/><p class="cap">Оставьте время пустым, чтобы закрыть весь день.</p><button class="btn full" onclick="blockDay()">Заблокировать</button></div><div class="section"><h2>Блокировки</h2></div>'+(state.master&&state.master.blocks||[]).map(b=>'<div class="item row"><div><b>'+esc(b.day.slice(0,10))+'</b><div class="sub">'+(b.start_time?esc(b.start_time)+'–'+esc(b.end_time):"Весь день")+'</div></div><button class="btn line" onclick="unblock('+b.id+')">Открыть</button></div>').join("")+'<div class="section"><h2>Записи</h2></div>'+(state.master&&state.master.bookings||[]).map(b=>bookingCard(b)+'<div class="flex" style="margin-bottom:15px"><button class="chip" onclick="setStatus(\''+b.id+'\',\'completed\')">Выполнено</button><button class="chip" onclick="setStatus(\''+b.id+'\',\'no_show\')">Неявка</button></div>').join("");
if(state.page==="clients")return '<div class="section"><h2>Клиентская база</h2></div>'+(state.master&&state.master.clients||[]).map(u=>'<div class="item row"><div class="circle">♙</div><div style="flex:1"><b>'+esc(u.client_name||"Без имени")+'</b><div class="cap">Telegram ID: '+esc(u.telegram_id)+'</div></div></div>').join("")||'<div class="empty">Клиентов пока нет</div>';
return '<div class="section"><h2>Услуги и настройки</h2></div><div class="card"><h3>Добавить услугу</h3><input id="newServiceName" class="field" placeholder="Название услуги"/><div class="grid"><input id="newServiceMinutes" class="field" type="number" min="15" value="120" placeholder="Минут"/><input id="newServicePrice" class="field" type="number" min="0" value="1700" placeholder="Цена ₽"/></div><button class="btn full" onclick="createService()">Добавить</button></div><div class="section"><h2>Текущие услуги</h2></div>'+serviceCards()+'<div class="section"><h2>Рабочие дни</h2></div>'+(state.master&&state.master.schedule||[]).map(w=>'<div class="item row"><span>'+["Пн","Вт","Ср","Чт","Пт","Сб","Вс"][w.weekday]+'</span><span>'+esc(w.start_time)+'–'+esc(w.end_time)+'</span><span class="pill">'+(w.active?"Рабочий":"Выходной")+'</span></div>').join("");}
function render(){nav();el("main").innerHTML=isMaster()?masterView():publicView();}
async function loadSlots(){if(!state.serviceId||!state.date)return;try{const r=await api("/api/slots?service="+state.serviceId+"&date="+encodeURIComponent(state.date));state.slots=r.slots||[]}catch(e){state.slots=[]}render();}
function selectDate(v){state.date=v;state.time="";loadSlots();}
function selectTime(t){state.time=t;render();}
async function book(){try{const r=await api("/api/book",{method:"POST",body:JSON.stringify({serviceId:state.serviceId,date:state.date,time:state.time})});fail("Вы успешно записаны!");state.time="";state.slots=[];route("visits");}catch(e){fail("Не удалось записаться: "+e.message);loadSlots();}}
async function loadBookings(){try{state.bookings=(await api("/api/bookings")).bookings||[];render()}catch{}}
async function cancelBooking(id){if(!confirm("Отменить эту запись?"))return;try{await api("/api/cancel",{method:"POST",body:JSON.stringify({id})});loadBookings();loadMaster()}catch(e){fail(e.message)}}
async function loadMaster(){if(!isMaster())return;try{state.master=await api("/api/master");render()}catch(e){fail(e.message)}}
async function blockDay(){try{const day=el("blockDay").value, start=el("from").value,end=el("to").value;await api("/api/block",{method:"POST",body:JSON.stringify({day,startTime:start||null,endTime:end||null,reason:el("blockReason").value})});loadMaster()}catch(e){fail("Не удалось закрыть день: "+e.message)}}
async function unblock(id){try{await api("/api/unblock",{method:"POST",body:JSON.stringify({id})});loadMaster()}catch(e){fail(e.message)}}
async function setStatus(id,status){try{await api("/api/status",{method:"POST",body:JSON.stringify({id,status})});loadMaster()}catch(e){fail(e.message)}}
async function createService(){try{await api("/api/service",{method:"POST",body:JSON.stringify({title:el("newServiceName").value,minutes:Number(el("newServiceMinutes").value),price:Number(el("newServicePrice").value)})});state.public=await api("/api/public");loadMaster()}catch(e){fail(e.message)}}
function onboard(){if(!initial){fail("Откройте приложение через Telegram-бота");return;}el("modalRoot").innerHTML='<div class="overlay"><div class="modal"><div style="font-size:34px;text-align:center">✿</div><h2 style="text-align:center">Давайте знакомиться!</h2><p class="sub" style="text-align:center">Укажите ваше настоящее имя, чтобы мастер знал, кого ожидать на процедуре.</p><input class="field" id="newName" maxlength="50" placeholder="Например, Анастасия"/><button class="btn full" onclick="saveName()">Продолжить</button><p class="cap" style="text-align:center">Без паспортов и данных банковских карт</p></div></div>';}
async function saveName(){const name=el("newName").value.trim();if(name.length<2)return fail("Введите имя, не менее двух символов");try{await api("/api/name",{method:"POST",body:JSON.stringify({name})});state.me.clientName=name;state.me.needsName=false;el("modalRoot").innerHTML="";render()}catch(e){fail(e.message)}}
init();
</script></body></html>`;
try {await schema();console.info("BOOKCORE_SCHEMA_READY");}catch(e){console.error("BOOKCORE_DB_SETUP_PENDING",String(e));}
const server = Bun.serve({port:Number(ENV.PORT||3000),hostname:"0.0.0.0",fetch:handler});
console.log("BOOKCORE server listening at "+server.port);
