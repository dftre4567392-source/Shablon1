import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {createHarness,ids} from "./harness.mjs";

async function named(h,user,name="Анастасия"){
  const r=await h.post("/api/name",{name},user);
  assert.equal(r.status,200,JSON.stringify(r.body));
}
async function free(h,date,services="1,4"){
  const r=await h.request("/api/slots?date="+date+"&services="+encodeURIComponent(services));
  assert.equal(r.status,200,JSON.stringify(r.body));
  return r.body.slots;
}
async function bookTwo(h,user,date,time){
  return h.post("/api/book",{date,time,serviceIds:[1,4]},user);
}
test("01 GET /health reports isolated storage and Telegram enabled",async()=>{
  const h=createHarness();
  const health=await h.request("/health");
  assert.equal(health.status,200);
  assert.equal(health.body.storage,true);
  const pub=await h.request("/api/public");
  assert.equal(pub.status,200);
  assert.equal(pub.body.services.length,5);
  assert.equal(pub.body.ready,true);
  assert.ok(h.botSettings.some(x=>x.operation==="setWebhook"));
  assert.ok(h.botSettings.some(x=>x.operation==="setChatMenuButton"));
});
test("02 unauthenticated and forged clients cannot access bookings/master",async()=>{
  const h=createHarness();
  assert.equal((await h.request("/api/me")).status,401);
  assert.equal((await h.request("/api/bookings")).status,401);
  assert.equal((await h.request("/api/master")).status,401);
  assert.equal((await h.request("/api/me",{user:ids.a,signOpts:{badSignature:true}})).status,401);
  assert.equal((await h.request("/api/me",{user:ids.a,signOpts:{authDate:Math.floor(Date.now()/1000)-90000}})).status,401);
});
test("03 profile name rules and client role",async()=>{
  const h=createHarness();
  const me=await h.request("/api/me",{user:ids.a});
  assert.equal(me.status,200);
  assert.equal(me.body.needsName,true);
  assert.equal(me.body.role,"client");
  assert.equal((await h.post("/api/name",{name:""},ids.a)).status,400);
  assert.equal((await h.post("/api/name",{name:"<script>"},ids.a)).status,400);
  await named(h,ids.a,"Анастасия");
  const namedMe=await h.request("/api/me",{user:ids.a});
  assert.equal(namedMe.body.clientName,"Анастасия");
  assert.equal(namedMe.body.needsName,false);
  assert.equal((await h.request("/api/me",{user:ids.master})).body.role,"master");
});
test("04 invalid dates including 31 September, year 9999, past and >45 days",async()=>{
  const h=createHarness();
  for(const date of ["2026-09-31","9999-02-29","92920-09-31","2027-02-29","2026-13-01"]){
    const res=await h.request("/api/slots?date="+encodeURIComponent(date)+"&services=1,4");
    assert.equal(res.status,400,"Date "+date);
    assert.equal(res.body.error,"INVALID_DATE");
  }
  const tooFar=h.addDays(46);
  const far=await h.request("/api/slots?date="+tooFar+"&services=1,4");
  assert.equal(far.status,400);
  assert.equal(far.body.error,"DATE_OUT_OF_RANGE");
  const past=await h.request("/api/slots?date="+h.addDays(-2)+"&services=1");
  assert.equal(past.status,400);
});
test("05 supported multi-service pricing and durations",async()=>{
  const h=createHarness();
  await named(h,ids.a);
  const day=h.openDay(),slots=await free(h,day);
  assert.ok(slots.length>0,"Combined service must have availability");
  const b=await bookTwo(h,ids.a,day,slots[0]);
  assert.equal(b.status,200,JSON.stringify(b.body));
  const bk=h.readStore().bookings[0];
  assert.deepEqual(bk.service_ids,[1,4]);
  assert.equal(bk.price,3300);
  assert.equal(bk.name,"Анастасия");
  assert.match(bk.service_name,/Ламинирование/);
  assert.equal((Date.parse(bk.busy_until)-Date.parse(bk.starts_at))/60000,210);
});
test("06 single-service booking backward compatibility",async()=>{
  const h=createHarness();await named(h,ids.a);
  const day=h.openDay(),times=await free(h,day,"5");
  assert.ok(times.length>0);
  const r=await h.post("/api/book",{date:day,time:times[0],serviceId:5},ids.a);
  assert.equal(r.status,200,JSON.stringify(r.body));
  assert.deepEqual(h.readStore().bookings[0].service_ids,[5]);
  assert.equal(h.readStore().bookings[0].price,400);
});
test("07 duplicate/invalid service ids, unsupported bundles and malformed booking time",async()=>{
  const h=createHarness();await named(h,ids.a);
  const day=h.openDay(),slots=await free(h,day);
  for(const serviceIds of [[],[1,1],[1,999],[0],[-1],["hello"],[1,2,3,4,5,6,7]]){
    const r=await h.post("/api/book",{date:day,time:slots[0],serviceIds},ids.a);
    assert.equal(r.status,400,JSON.stringify({serviceIds,r}));
  }
  const huge=await h.post("/api/book",{date:day,time:slots[0],serviceIds:[1,2,3,4,5]},ids.a);
  // All five known procedures total 555 minutes; this is valid syntax but cannot fit a workday.
  assert.equal(huge.status,409);
  assert.equal(huge.body.error,"TIME_NOT_AVAILABLE");
  assert.equal((await h.post("/api/book",{date:day,time:"99:00",serviceIds:[1]},ids.a)).status,400);
  assert.equal((await h.post("/api/book",{date:"92920-02-29",time:"10:00",serviceIds:[1]},ids.a)).status,400);
});
test("08 client cannot book before entering a name",async()=>{
  const h=createHarness(),date=h.openDay(),times=await free(h,date);
  const r=await bookTwo(h,ids.a,date,times[0]);
  assert.equal(r.status,409);
  assert.equal(r.body.error,"NAME_REQUIRED");
});
test("09 overlapping booking is prevented for same client and other client",async()=>{
  const h=createHarness();await named(h,ids.a);await named(h,ids.b,"Мария");
  const day=h.openDay(),time=(await free(h,day))[0];
  assert.equal((await bookTwo(h,ids.a,day,time)).status,200);
  assert.equal((await bookTwo(h,ids.a,day,time)).status,409);
  assert.equal((await bookTwo(h,ids.b,day,time)).status,409);
  const available=await free(h,day);
  assert.ok(!available.includes(time));
});
test("10 concurrent requests with stale Blob ETags cannot double-book",async()=>{
  const h=createHarness();await named(h,ids.a);await named(h,ids.b,"Мария");
  const day=h.openDay(),time=(await free(h,day))[0];
  const result=await Promise.all([bookTwo(h,ids.a,day,time),bookTwo(h,ids.b,day,time)]);
  assert.deepEqual(result.map(x=>x.status).sort(),[200,409]);
  assert.equal(h.readStore().bookings.filter(x=>x.status==="confirmed").length,1);
});
test("11 transient ETag conflict is retried without duplicate writes",async()=>{
  const h=createHarness({forcedConflicts:2});await named(h,ids.a);
  assert.equal(h.readStore().users[String(ids.a)].client_name,"Анастасия");
  assert.equal(h.readStore().bookings.length,0);
});
test("12 appointments are private to their owner; master sees all",async()=>{
  const h=createHarness();await named(h,ids.a);await named(h,ids.b,"Мария");
  const day=h.openDay(),times=await free(h,day);
  const booked=await bookTwo(h,ids.a,day,times[0]);
  assert.equal(booked.status,200);
  const own=await h.request("/api/bookings",{user:ids.a}),other=await h.request("/api/bookings",{user:ids.b});
  assert.equal(own.body.bookings.length,1);
  assert.equal(other.body.bookings.length,0);
  assert.equal((await h.request("/api/master",{user:ids.b})).status,403);
  assert.equal((await h.request("/api/master",{user:ids.master})).body.bookings.length,1);
});
test("13 cancellation requires owner/master and reopens availability",async()=>{
  const h=createHarness();await named(h,ids.a);
  const day=h.openDay(),time=(await free(h,day))[0];
  const b=await bookTwo(h,ids.a,day,time),id=b.body.id;
  assert.equal((await h.post("/api/cancel",{id},ids.b)).status,403);
  assert.equal((await h.post("/api/cancel",{id},ids.a)).status,200);
  assert.equal((await h.post("/api/cancel",{id},ids.a)).status,409);
  assert.ok((await free(h,day)).includes(time));
});
test("14 reschedule preserves multi-service total and protects ownership",async()=>{
  const h=createHarness();await named(h,ids.a);
  const day=h.openDay({min:4,max:12}),day2=h.openDay({min:13,max:30});
  const a=(await free(h,day))[0];
  const booked=await bookTwo(h,ids.a,day,a);
  assert.equal(booked.status,200);
  const b=(await free(h,day2))[0];
  assert.equal((await h.post("/api/reschedule",{id:booked.body.id,date:day2,time:b},ids.b)).status,403);
  assert.equal((await h.post("/api/reschedule",{id:booked.body.id,date:day2,time:b},ids.a)).status,200);
  const record=h.readStore().bookings[0];
  assert.equal(record.price,3300);
  assert.deepEqual(record.service_ids,[1,4]);
  assert.equal((Date.parse(record.busy_until)-Date.parse(record.starts_at))/60000,210);
  assert.ok((await free(h,day)).includes(a));
});
test("15 reschedule rejects invalid days and long-past year",async()=>{
  const h=createHarness();await named(h,ids.a);
  const day=h.openDay(),time=(await free(h,day))[0];
  const b=await bookTwo(h,ids.a,day,time);
  for(const date of ["2026-09-31","92920-02-29",h.addDays(55)]){
    const r=await h.post("/api/reschedule",{id:b.body.id,date,time},ids.a);
    assert.ok([400,409].includes(r.status),JSON.stringify(r.body));
  }
});
test("16 master blocks full day, cannot block occupied day, then unblocks",async()=>{
  const h=createHarness();await named(h,ids.a);
  const day=h.openDay(),time=(await free(h,day))[0];
  const booked=await bookTwo(h,ids.a,day,time);
  assert.equal((await h.post("/api/block",{day,reason:"Отпуск"},ids.a)).status,403);
  assert.equal((await h.post("/api/block",{day,reason:"Отпуск"},ids.master)).status,409);
  assert.equal((await h.post("/api/cancel",{id:booked.body.id},ids.a)).status,200);
  const blocked=await h.post("/api/block",{day,reason:"Отпуск"},ids.master);
  assert.equal(blocked.status,200);
  assert.equal((await free(h,day)).length,0);
  assert.equal((await h.post("/api/unblock",{id:blocked.body.id},ids.master)).status,200);
  assert.ok((await free(h,day)).length>0);
});
test("17 partial day blocks affect time but not other intervals",async()=>{
  const h=createHarness(),day=h.openDay();
  const before=await free(h,day,"5");
  assert.ok(before.includes("10:00"));
  const result=await h.post("/api/block",{day,startTime:"10:00",endTime:"11:00"},ids.master);
  assert.equal(result.status,200,JSON.stringify(result.body));
  const after=await free(h,day,"5");
  assert.ok(!after.includes("10:00"));
  assert.ok(after.some(time=>time>="15:00"));
});
test("18 master weekly schedule toggles access, client cannot edit",async()=>{
  const h=createHarness(),day=h.openDay();
  const weekday=(new Date(day+"T12:00:00Z").getUTCDay()+6)%7;
  const payload={weekday,start:"10:00",end:"19:00",active:false};
  assert.equal((await h.post("/api/schedule",payload,ids.a)).status,403);
  assert.equal((await h.post("/api/schedule",payload,ids.master)).status,200);
  assert.equal((await free(h,day)).length,0);
  assert.equal((await h.post("/api/schedule",{...payload,active:true},ids.master)).status,200);
  assert.ok((await free(h,day)).length>0);
  assert.equal((await h.post("/api/schedule",{weekday,start:"20:00",end:"10:00",active:true},ids.master)).status,400);
});
test("19 master edits services and validation rejects bad prices/duration",async()=>{
  const h=createHarness();
  assert.equal((await h.post("/api/service",{title:"Новая услуга",minutes:75,price:1234},ids.a)).status,403);
  assert.equal((await h.post("/api/service",{title:"Новая услуга",minutes:75,price:1234},ids.master)).status,200);
  const pub=await h.request("/api/public");
  assert.ok(pub.body.services.some(x=>x.title==="Новая услуга"&&x.price===1234));
  assert.equal((await h.post("/api/service",{title:"x",minutes:1,price:-5},ids.master)).status,400);
});
test("20 master manual booking and conflict with client booking",async()=>{
  const h=createHarness();await named(h,ids.a);
  const day=h.openDay(),time=(await free(h,day))[0];
  assert.equal((await h.post("/api/manual-book",{date:day,time,name:"Клиент в салоне",serviceIds:[1,4]},ids.a)).status,403);
  const manual=await h.post("/api/manual-book",{date:day,time,name:"Клиент в салоне",serviceIds:[1,4]},ids.master);
  assert.equal(manual.status,200,JSON.stringify(manual.body));
  assert.equal(h.readStore().bookings[0].telegram_id,null);
  assert.equal(h.readStore().bookings[0].price,3300);
  assert.equal((await bookTwo(h,ids.a,day,time)).status,409);
});
test("21 master sets completed and no-show; client forbidden",async()=>{
  const h=createHarness();await named(h,ids.a);
  const day=h.openDay(),time=(await free(h,day))[0];
  const b=await bookTwo(h,ids.a,day,time);
  assert.equal((await h.post("/api/status",{id:b.body.id,status:"completed"},ids.a)).status,403);
  assert.equal((await h.post("/api/status",{id:b.body.id,status:"bad"},ids.master)).status,400);
  assert.equal((await h.post("/api/status",{id:b.body.id,status:"completed"},ids.master)).status,200);
  assert.equal(h.readStore().bookings[0].status,"completed");
});
test("22 bot /start, /id and webhook secret guard",async()=>{
  const h=createHarness(),event={message:{chat:{id:ids.a,type:"private"},from:{id:ids.a,first_name:"Настя"},text:"/start"}};
  assert.equal((await h.post("/bot/webhook",event)).status,403);
  assert.equal((await h.request("/bot/webhook",{method:"POST",body:event,headers:{"x-telegram-bot-api-secret-token":"test-webhook-secret"}})).status,200);
  assert.ok(h.messages.some(m=>m.chat_id===ids.a&&m.text.includes("BOOKCORE")));
  assert.ok(h.messages.some(m=>m.reply_markup?.inline_keyboard?.[0]?.[0]?.web_app?.url));
  event.message.text="/id";
  assert.equal((await h.request("/bot/webhook",{method:"POST",body:event,headers:{"x-telegram-bot-api-secret-token":"test-webhook-secret"}})).status,200);
  assert.ok(h.messages.some(m=>m.text.includes(String(ids.a))));
});
test("23 private avatar requires Telegram signature",async()=>{
  const h=createHarness();
  assert.equal((await h.request("/api/avatar")).status,401);
  assert.equal((await h.request("/api/avatar",{user:ids.a})).status,204);
});
test("24 late client cancellation/reschedule is blocked",async()=>{
  const h=createHarness();await named(h,ids.a);
  const day=h.openDay(),time=(await free(h,day))[0];
  const booked=await bookTwo(h,ids.a,day,time);
  const id=booked.body.id;
  h.overrideStore(s=>{
    const entry=s.bookings.find(x=>x.id===id);
    entry.starts_at=new Date(Date.now()+60*60*1000).toISOString();
    entry.busy_until=new Date(Date.now()+4*60*60*1000).toISOString();
  });
  assert.equal((await h.post("/api/cancel",{id},ids.a)).status,409);
  assert.equal((await h.post("/api/reschedule",{id,date:h.openDay({min:15,max:30}),time:"10:00"},ids.a)).status,409);
  assert.equal((await h.post("/api/cancel",{id},ids.master)).status,200);
});

test("25 studio timezone handles Barnaul, Moscow and Amsterdam correctly",()=>{
  const cases=[
    ["Europe/Moscow","2026-11-20T07:00:00.000Z"],
    ["Asia/Barnaul","2026-11-20T03:00:00.000Z"],
    ["Europe/Amsterdam","2026-11-20T09:00:00.000Z"]
  ];
  for(const [timezone,expected] of cases){
    const h=createHarness({timezone});
    const instant=vm.runInContext('utc("2026-11-20","10:00").toISOString()',h.sandbox);
    assert.equal(instant,expected,timezone);
  }
});

test("26 original and additional masters both have access; both receive booking notice",async()=>{
  const second=769983100;
  const h=createHarness({additionalMasters:String(second)});
  const original=await h.request("/api/me",{user:ids.master});
  const extra=await h.request("/api/me",{user:second});
  const client=await h.request("/api/me",{user:ids.a});
  assert.equal(original.status,200);
  assert.equal(extra.status,200);
  assert.equal(original.body.role,"master");
  assert.equal(extra.body.role,"master");
  assert.equal(client.body.role,"client");
  assert.equal((await h.request("/api/master",{user:second})).status,200);
  assert.equal((await h.request("/api/master",{user:ids.a})).status,403);
  await named(h,ids.a);
  const date=h.openDay();
  const time=(await free(h,date))[0];
  const booked=await bookTwo(h,ids.a,date,time);
  assert.equal(booked.status,200);
  assert.ok(h.messages.some(m=>String(m.chat_id)===String(ids.master)&&m.text.startsWith("Новая запись:")));
  assert.ok(h.messages.some(m=>String(m.chat_id)===String(second)&&m.text.startsWith("Новая запись:")));
});
test("27 malformed extra master IDs are never authorized",async()=>{
  const h=createHarness({additionalMasters:"not-id,1234,769983100xyz"});
  assert.equal((await h.request("/api/me",{user:ids.master})).body.role,"master");
  assert.equal((await h.request("/api/me",{user:769983100})).body.role,"client");
});

test("28 per-customer storage path defaults to previous production data path",()=>{
  const h=createHarness();
  assert.equal(vm.runInContext("PATH",h.sandbox),"bookcore/v1/state.json");
});
test("29 custom customer deployment loads its own catalog, price and brand accent",async()=>{
  const items=[
    {title:"Маникюр без покрытия",description:"Маникюр",minutes:60,price:1300},
    {title:"Укрепление ногтей",description:"Вместе с маникюром",minutes:45,price:900}
  ];
  const h=createHarness({
    storagePath:"bookcore/customers/nails-001/state.json",
    services:items,accentColor:"#734B67"
  });
  assert.equal(vm.runInContext("PATH",h.sandbox),"bookcore/customers/nails-001/state.json");
  const pub=await h.request("/api/public");
  assert.equal(pub.status,200);
  assert.equal(pub.body.services.length,2);
  assert.equal(pub.body.services[0].title,"Маникюр без покрытия");
  assert.equal(pub.body.accentColor,"#734B67");
  await named(h,ids.a);
  const day=h.openDay(),times=await free(h,day,"1,2");
  assert.ok(times.length>0);
  const booked=await h.post("/api/book",{date:day,time:times[0],serviceIds:[1,2]},ids.a);
  assert.equal(booked.status,200);
  assert.equal(h.readStore().bookings[0].price,2200);
  assert.equal((Date.parse(h.readStore().bookings[0].busy_until)-
    Date.parse(h.readStore().bookings[0].starts_at))/60000,120);
});
test("30 invalid customer storage path is rejected before API startup",()=>{
  for(const badPath of ["../master/state.json","bookcore/../state.json","/home/.env","bookcore//state.json","bookcore/data.txt"]){
    assert.throws(()=>createHarness({storagePath:badPath}),/INVALID_BOOKCORE_STORAGE_PATH/);
  }
});
test("31 malformed or unsafe customer service catalog is rejected",()=>{
  const invalid=[
    [], Array.from({length:31},(_,n)=>({title:"Service "+n,minutes:60,price:1000})),
    [{title:"x",minutes:60,price:300}],
    [{title:"Маникюр",minutes:3,price:500}],
    [{title:"Маникюр",minutes:60,price:-50}],
    [{title:"Маникюр",minutes:60,price:1000001}]
  ];
  for(const services of invalid){
    const h=createHarness({services});
    const response=await h.request("/api/public");
    assert.equal(response.status,503,"Invalid initial services should never initialize a new tenant");
  }
});
test("32 invalid accent color reverts to BOOKCORE default",async()=>{
  const h=createHarness({accentColor:"red; background:evil"});
  const p=await h.request("/api/public");
  assert.equal(p.status,200);
  assert.equal(p.body.accentColor,"#513548");
});
test("33 original default service catalog stays unchanged for the existing live studio",async()=>{
  const h=createHarness();
  const r=await h.request("/api/public");
  assert.equal(r.status,200);
  assert.equal(r.body.services.length,5);
  assert.equal(r.body.services[0].price,1700);
});
