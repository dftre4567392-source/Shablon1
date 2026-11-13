import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const html=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");
const script=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].at(-1)[1].replace(/\binit\(\);\s*$/,"");
function environment(){
 const elements=new Map(),modal={innerHTML:""};
 elements.set("modalRoot",modal);
 const element=id=>{
  if(id==="modalRoot")return modal;
  if(["moveCalendar","moveSlots","moveSave"].includes(id)&&!modal.innerHTML.includes('id="'+id+'"'))return null;
  if(!elements.has(id))elements.set(id,{innerHTML:"",disabled:false,querySelectorAll:()=>[]});
  return elements.get(id);
 };
 const errors=[],dialogs=[];
 const sandbox={
  window:{Telegram:{WebApp:{initData:"test-data",ready(){},expand(){}}}},
  document:{getElementById:element,documentElement:{style:{setProperty(){}}}},
  location:{origin:"https://bookcore-test.invalid"},
  URL,Blob,Intl,Date,TextEncoder,TextDecoder,AbortSignal,Response,
  fetch:async()=>new Response(JSON.stringify({slots:[]}),{status:200}),
  alert:msg=>dialogs.push(String(msg)),console:{...console,error:e=>errors.push(String(e))},setTimeout,clearTimeout
 };
 vm.createContext(sandbox);vm.runInContext(script,sandbox);
 vm.runInContext('state.public={timezone:"Europe/Moscow",ready:true,services:[{id:1,title:"Услуга",minutes:60,price:1200}]};state.me={role:"client",clientName:"Анна"};',sandbox);
 return {sandbox,run:code=>vm.runInContext(code,sandbox),elements,element,modal,errors,dialogs};
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
test("UI-ABUSE-01 closing reschedule before response never raises JavaScript error",async()=>{
 const e=environment();
 e.run('rescheduleForm("booking-id",[1]);api=()=>new Promise(resolve=>globalThis.__finish=resolve);selectMoveDate("2026-11-21")');
 e.run("closeMoveModal()");
 e.run('__finish({slots:["10:00"]})');
 await tick();
 assert.equal(e.modal.innerHTML,"");
 assert.equal(e.errors.length,0,e.errors.join("; "));
});
test("UI-ABUSE-02 stale calendar response cannot replace newer free hours",async()=>{
 const e=environment();
 e.run('rescheduleForm("booking-id",[1]);globalThis.__requests=[];api=()=>new Promise(resolve=>__requests.push(resolve));');
 e.run('selectMoveDate("2026-11-21");selectMoveDate("2026-11-22");');
 assert.equal(e.run("__requests.length"),2);
 e.run('__requests[1]({slots:["14:00"]})');await tick();
 e.run('__requests[0]({slots:["10:00"]})');await tick();
 assert.match(e.element("moveSlots").innerHTML,/14:00/);
 assert.doesNotMatch(e.element("moveSlots").innerHTML,/10:00/);
 assert.equal(e.run("rescheduling.date"),"2026-11-22");
});
test("UI-ABUSE-03 rejected late network response after modal close is harmless",async()=>{
 const e=environment();
 e.run('rescheduleForm("booking-id",[1]);api=()=>new Promise((resolve,reject)=>globalThis.__reject=reject);selectMoveDate("2026-11-21")');
 e.run("closeMoveModal()");e.run('__reject(new Error("NETWORK_TIMEOUT"))');await tick();
 assert.equal(e.modal.innerHTML,"");
 assert.equal(e.errors.length,0,e.errors.join("; "));
});
test("UI-ABUSE-04 rapid triple click sends only one booking request",async()=>{
 const e=environment();
 e.run('state.serviceIds=[1];state.date="2026-11-21";state.slots=["10:00"];state.time="10:00";state.page="booking";globalThis.__calls=0;api=(path,opts)=>{if(path==="/api/book"){__calls++;return new Promise(resolve=>globalThis.__done=resolve);}return Promise.resolve({bookings:[]})};');
 e.run("book();book();book()");
 assert.equal(e.run("__calls"),1);
 e.run('__done({ok:true,id:"bk-1"})');await tick();
 assert.equal(e.run("state.bookingPending"),false);
});
test("UI-ABUSE-05 malicious HTML from service title is escaped",()=>{
 const e=environment();
 e.run('state.public.services=[{id:1,title:"<img src=x onerror=alert(1)>",description:"<script>bad</script>",minutes:30,price:400}]');
 const markup=e.run("serviceCards()");
 assert.ok(!markup.includes("<img"));
 assert.ok(!markup.includes("<script"));
 assert.match(markup,/&lt;img/);
});
test("UI-ABUSE-06 HTML error pages yield understandable message, not JSON parser error",async()=>{
 const e=environment();
 e.run('fetch=async()=>new Response("<html>502 Bad Gateway</html>",{status:502,headers:{"content-type":"text/html"}})');
 let message="";
 try{await e.run('api("/api/slots")')}catch(error){message=error.message;}
 assert.match(message,/сервер|временно|Повторите|недоступ|позже/i);
 assert.doesNotMatch(message,/Unexpected token|JSON|SyntaxError/i);
});
