import test from "node:test";
import assert from "node:assert/strict";
import {createHarness,ids} from "./harness.mjs";

async function name(h,user=ids.a,value="Анастасия"){
 const r=await h.post("/api/name",{name:value},user);
 assert.equal(r.status,200,JSON.stringify(r.body));
}
async function slots(h,date,services="1"){
 const r=await h.request("/api/slots?date="+date+"&services="+services);
 assert.equal(r.status,200,JSON.stringify(r.body));
 return r.body.slots;
}
const book=(h,u,date,time,serviceIds=[1])=>h.post("/api/book",{date,time,serviceIds},u);

test("ABUSE-01 impossible, malformed and out-of-window dates cannot create bookings",async()=>{
 const h=createHarness();await name(h);
 for(const date of ["2026-02-29","2026-04-31","9999-02-29","92920-09-31","2026-13-20","2026-11-00","2026-11-15T14:00","<script>","2025-11-14","0000-01-01"]){
  const r=await book(h,ids.a,date,"10:00");assert.equal(r.status,400,JSON.stringify({date,r}));
 }
 assert.equal(h.readStore().bookings.length,0);
});
test("ABUSE-02 malformed times and invalid service lists cannot book",async()=>{
 const h=createHarness();await name(h);const d=h.openDay();
 for(const time of ["24:00","25:00","-1:00","10:60","9:30","11:15<script>","00:00","14:00","23:00","10:01"]){
  const r=await book(h,ids.a,d,time);assert.notEqual(r.status,200,"Invalid time accepted: "+time);
 }
 for(const services of [[],[1,1],[999],[1,999],["not-id"],[0],[-1],[null],[1,2,3,4,5,6,7]]){
  const r=await book(h,ids.a,d,"10:00",services);assert.notEqual(r.status,200,JSON.stringify(services));
 }
 assert.equal(h.readStore().bookings.length,0);
});
test("ABUSE-03 repeated submit cannot create duplicate appointment",async()=>{
 const h=createHarness();await name(h);const d=h.openDay(),t=(await slots(h,d))[0];
 assert.equal((await book(h,ids.a,d,t)).status,200);
 assert.equal((await book(h,ids.a,d,t)).status,409);
 assert.equal(h.readStore().bookings.length,1);
});
test("ABUSE-04 two competing clients get at most one confirmed slot",async()=>{
 const h=createHarness();await name(h);await name(h,ids.b,"Мария");
 const d=h.openDay(),t=(await slots(h,d))[0];
 const results=await Promise.all([book(h,ids.a,d,t),book(h,ids.b,d,t)]);
 assert.equal(results.filter(r=>r.status===200).length,1);
 assert.equal(h.readStore().bookings.filter(x=>x.status==="confirmed").length,1);
});
test("ABUSE-05 regular client cannot mutate master routes or another appointment",async()=>{
 const h=createHarness();await name(h);await name(h,ids.b,"Мария");
 const d=h.openDay(),t=(await slots(h,d))[0],b=await book(h,ids.a,d,t);
 for(const [path,payload] of [["/api/block",{day:d}],["/api/schedule",{weekday:0,start:"10:00",end:"12:00",active:true}],["/api/status",{id:b.body.id,status:"completed"}],["/api/manual-book",{name:"Unknown",date:d,time:t,serviceId:5}],["/api/service",{title:"Change",minutes:60,price:100}],["/api/unblock",{id:1}],["/api/cancel",{id:b.body.id}],["/api/reschedule",{id:b.body.id,date:d,time:t}]]){
  const result=await h.post(path,payload,ids.b);assert.equal(result.status,403,path);
 }
 assert.equal(h.readStore().bookings[0].status,"confirmed");
});
test("ABUSE-06 canceled booking cannot be reactivated by a client",async()=>{
 const h=createHarness();await name(h);const d=h.openDay(),t=(await slots(h,d))[0],b=await book(h,ids.a,d,t);
 assert.equal((await h.post("/api/cancel",{id:b.body.id},ids.a)).status,200);
 assert.equal((await h.post("/api/reschedule",{id:b.body.id,date:d,time:t},ids.a)).status,409);
 assert.equal((await h.post("/api/cancel",{id:b.body.id},ids.a)).status,409);
});
test("ABUSE-07 malformed time blocks are rejected",async()=>{
 const h=createHarness(),d=h.openDay();
 for(const data of [{day:"not-a-date"},{day:d,startTime:"22:00",endTime:"10:00"},{day:d,startTime:"10:00",endTime:"10:00"},{day:d,startTime:"25:00",endTime:"26:00"},{day:d,startTime:"10:00"}]){
  assert.equal((await h.post("/api/block",data,ids.master)).status,400,JSON.stringify(data));
 }
});
test("ABUSE-08 invisible characters or emojis cannot become client names",async()=>{
 const h=createHarness();
 for(const value of ["\u0000\u0001","🙂🙂","\u200B\u200B","\u202eXX","\r\n","👁️"]){
  const r=await h.post("/api/name",{name:value},ids.a);assert.equal(r.status,400,JSON.stringify({value,r}));
 }
});
test("ABUSE-09 legitimate multilingual customer names remain supported",async()=>{
 const h=createHarness();
 for(const value of ["Анна-Мария","李明","Émilie","O’Connor"]){
  assert.equal((await h.post("/api/name",{name:value},ids.a)).status,200,value);
 }
});
test("ABUSE-10 master cannot prematurely complete or no-show future bookings",async()=>{
 const h=createHarness();await name(h);const d=h.openDay(),t=(await slots(h,d))[0],b=await book(h,ids.a,d,t);
 for(const status of ["completed","no_show"])assert.equal((await h.post("/api/status",{id:b.body.id,status},ids.master)).status,409);
 assert.equal(h.readStore().bookings[0].status,"confirmed");
});
test("ABUSE-11 already cancelled records cannot be completed, no-showed or cancelled twice",async()=>{
 const h=createHarness();await name(h);const d=h.openDay(),t=(await slots(h,d))[0],b=await book(h,ids.a,d,t);
 await h.post("/api/cancel",{id:b.body.id},ids.a);
 for(const status of ["completed","no_show","cancelled_by_master"]){
  assert.equal((await h.post("/api/status",{id:b.body.id,status},ids.master)).status,409);
 }
});
test("ABUSE-12 changing weekly work hours cannot invalidate existing confirmed bookings",async()=>{
 const h=createHarness();await name(h);const d=h.openDay(),t=(await slots(h,d))[0];
 assert.equal((await book(h,ids.a,d,t)).status,200);
 const weekday=(new Date(d+"T12:00:00Z").getUTCDay()+6)%7;
 const result=await h.post("/api/schedule",{weekday,start:"15:00",end:"19:00",active:true},ids.master);
 assert.equal(result.status,409,JSON.stringify(result.body));
 assert.equal(h.readStore().schedule.find(x=>x.weekday===weekday).start_time,"10:00");
});
test("ABUSE-13 wrong content type does not cause unhandled API error",async()=>{
 const h=createHarness();
 const result=await h.request("/api/book",{method:"POST",user:ids.a,headers:{"content-type":"text/plain"},body:{date:"bad",time:"bad",serviceId:1}});
 assert.ok([400,409,415].includes(result.status),JSON.stringify(result));
});
test("ABUSE-14 storm of concurrent requests never double-books one time",async()=>{
 const h=createHarness();await Promise.all([ids.a,ids.b,ids.c].map((u,i)=>name(h,u,["Анна","Мария","Елена"][i])));
 const d=h.openDay(),t=(await slots(h,d))[0],u=[ids.a,ids.b,ids.c];
 const results=await Promise.all(Array.from({length:12},(_,i)=>book(h,u[i%3],d,t)));
 assert.equal(results.filter(r=>r.status===200).length,1);
 assert.equal(h.readStore().bookings.filter(b=>b.status==="confirmed").length,1);
});
test("ABUSE-15 invalid 9999, past and one-year-plus master block dates cannot save",async()=>{
 const h=createHarness();
 for(const day of ["9999-12-31","2020-01-01",h.addDays(366)]){
  assert.equal((await h.post("/api/block",{day,reason:"Test"},ids.master)).status,400,day);
 }
 assert.equal(h.readStore()?.blocks.length||0,0);
});
test("ABUSE-16 master cannot create invisible-name appointments",async()=>{
 const h=createHarness(),d=h.openDay(),t=(await slots(h,d))[0];
 for(const value of ["\u0000\u0001","🙂🙂","\u200B\u200B"]){
  assert.equal((await h.post("/api/manual-book",{name:value,date:d,time:t,serviceId:5},ids.master)).status,400);
 }
 assert.equal(h.readStore()?.bookings.length||0,0);
});
test("ABUSE-17 completed booking cannot be converted to no-show afterward",async()=>{
 const h=createHarness();await name(h);const d=h.openDay(),t=(await slots(h,d))[0],b=await book(h,ids.a,d,t);
 h.overrideStore(s=>{const x=s.bookings.find(y=>y.id===b.body.id);x.starts_at=new Date(Date.now()-3600000).toISOString();x.busy_until=new Date(Date.now()+600000).toISOString();});
 assert.equal((await h.post("/api/status",{id:b.body.id,status:"completed"},ids.master)).status,200);
 assert.equal((await h.post("/api/status",{id:b.body.id,status:"no_show"},ids.master)).status,409);
});
