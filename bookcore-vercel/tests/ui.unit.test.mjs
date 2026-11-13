import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";

const html=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");
const match=html.match(/<script>([\s\S]*?)<\/script>/);
if(!match)throw Error("BOOKCORE inline app script missing");
const script=match[1].replace(/\binit\(\);\s*$/,"");
function environment({now="2026-11-13T10:00:00Z",role="client",ready=true}={}){
  class TestDate extends Date{
    constructor(...args){super(...(args.length?args:[now]));}
    static now(){return new Date(now).getTime();}
  }
  const elements=new Map();
  function element(id){
    if(!elements.has(id))elements.set(id,{innerHTML:"",value:"",disabled:false,
      querySelectorAll:()=>[]});
    return elements.get(id);
  }
  const requests=[];
  const context={
    window:{Telegram:{WebApp:{initData:"test-init-data",ready(){},expand(){}}}},
    document:{getElementById:element},location:{origin:"https://bookcore-test.invalid"},
    console,URL,Intl,Date:TestDate,Blob,TextDecoder,TextEncoder,AbortSignal,
    setTimeout,clearTimeout,alert:()=>{},confirm:()=>true,
    fetch:async(url,options)=>{
      requests.push({url:String(url),options});
      const route=new URL(String(url)).searchParams.get("route");
      const response=route==="/api/slots"?{slots:["10:00","10:15"]}:route==="/api/public"?{ready:true,services:[]}:route==="/api/me"?{role:"client",needsName:false}:
        {ok:true,bookings:[],blocks:[],schedule:[],clients:[],services:[]};
      return new Response(JSON.stringify(response),{status:200,headers:{"content-type":"application/json"}});
    }
  };
  vm.createContext(context);
  vm.runInContext(script,context,{filename:"bookcore-client-under-test.js"});
  const seed=JSON.stringify({studio:"BOOKCORE тест",masterName:"Мастер",timezone:"Europe/Moscow",ready,
    services:[
      {id:1,title:"Классическое наращивание",description:"",minutes:120,price:1700,active:true},
      {id:4,title:"Ламинирование",description:"",minutes:75,price:1600,active:true},
      {id:5,title:"Снятие",description:"",minutes:30,price:400,active:true}
    ]});
  vm.runInContext("state.public="+seed+";state.me="+JSON.stringify({role,clientName:"Настя",needsName:false})+";",context);
  const run=code=>vm.runInContext(code,context);
  return {run,elements,element,requests,context};
}
test("UI-01 legacy native client date input no longer present",()=>{
  assert.ok(!html.includes('id="date" type="date"'));
  assert.ok(!html.includes('id="moveDate" type="date"'));
  assert.ok(html.includes("function calendarMarkup("));
});
test("UI-02 month heading hides year; actual day values still keep it",()=>{
  const b=environment(),markup=b.run("calendarMarkup()");
  assert.match(markup,/Ноябрь<\/b>/);
  assert.doesNotMatch(markup,/<b>Ноябрь\s*2026<\/b>/);
  assert.ok(markup.includes("2026-11-13"),"date persists internally for booking");
  assert.match(b.run('visibleDate("2026-11-23")'),/23 ноября/);
  assert.doesNotMatch(b.run('visibleDate("2026-11-23")'),/2026/);
});
test("UI-03 invalid day/year/leap-year rejected in browser",()=>{
  const b=environment();
  for(const invalid of ["92920-02-29","9999-09-31","2026-09-31","2027-02-29","2026-00-12","2026-11-99"]){
    assert.equal(b.run("validCalendarDate("+JSON.stringify(invalid)+")"),false,invalid);
  }
  assert.equal(b.run('validCalendarDate("2026-11-13")'),true);
  assert.equal(b.run('validCalendarDate("2026-11-12")'),false);
  assert.equal(b.run("validCalendarDate(studioMaxDate())"),true);
  assert.equal(b.run('validCalendarDate("2027-01-01")'),false);
});
test("UI-04 year boundary December -> January without visible year",()=>{
  const b=environment({now:"2026-12-20T12:00:00Z"});
  assert.match(b.run("calendarMarkup()"),/Декабрь<\/b>/);
  b.run("changeMonth(1)");
  const january=b.run("calendarMarkup()");
  assert.match(january,/Январь<\/b>/);
  assert.doesNotMatch(january,/<b>Январь 2027<\/b>/);
  assert.ok(january.includes("2027-01-10"));
  assert.equal(b.run('validCalendarDate("2027-01-10")'),true);
  b.run("changeMonth(1)");
  const february=b.run("calendarMarkup()");
  assert.match(february,/Февраль<\/b>/);
  b.run("changeMonth(1)");
  assert.match(b.run("calendarMarkup()"),/Февраль<\/b>/,"cannot scroll beyond booking window");
});
test("UI-05 multi-service selection and deselection preserves totals",()=>{
  const b=environment();
  b.run("chooseService(1);chooseService(4)");
  assert.equal(b.run("selectionTotal().count"),2);
  assert.equal(b.run("selectionTotal().price"),3300);
  assert.equal(b.run("selectionTotal().minutes"),195);
  let markup=b.run("serviceCards()");
  assert.match(markup,/aria-checked="true"/);
  b.run("chooseService(1)");
  assert.equal(b.run("selectionTotal().count"),1);
  assert.equal(b.run("selectionTotal().price"),1600);
});
test("UI-06 booking summary shows a localized day without year",()=>{
  const b=environment();
  b.run('state.page="booking";state.date="2026-11-23";state.serviceIds=[1,4];state.time="10:00";');
  const rendered=b.run("publicView()");
  assert.match(rendered,/Дата: 23 ноября/);
  assert.doesNotMatch(rendered,/Дата: 2026-11-23/);
  assert.match(rendered,/3 300 ₽|3 300 ₽/);
  assert.match(rendered,/Общая длительность: 195 мин/);
});
test("UI-07 invalid date not applied by selectDate",()=>{
  const b=environment();
  b.run("selectDate('9999-02-29')");
  assert.equal(b.run("state.date"),"");
  b.run("selectDate('2026-11-21')");
  assert.equal(b.run("state.date"),"2026-11-21");
});
test("UI-08 reschedule uses new calendar without native year input",()=>{
  const b=environment();
  b.run('rescheduleForm("booking-test",[1,4])');
  const modal=b.element("modalRoot").innerHTML;
  assert.match(modal,/Перенос записи/);
  assert.match(modal,/book-calendar/);
  assert.doesNotMatch(modal,/type="date"/);
  assert.match(modal,/Ноябрь<\/b>/);
  b.run("closeMoveModal()");
  assert.equal(b.element("modalRoot").innerHTML,"");
});
test("UI-09 calendar layout has seven columns, disabled out-of-range days",()=>{
  const b=environment();
  const markup=b.run("calendarMarkup()");
  assert.match(html,/grid-template-columns:repeat\(7,minmax\(0,1fr\)\)/);
  assert.match(markup,/class="cal-day/);
  assert.match(markup,/disabled aria-label=/);
  assert.ok(markup.includes("aria-pressed="));
});
test("UI-10 client and master navigation still render without errors",()=>{
  for(const role of ["client","master"]){
    const b=environment({role});
    b.run("render()");
    assert.ok(b.element("dock").innerHTML.length>0);
    assert.ok(b.element("main").innerHTML.length>0);
    if(role==="master")assert.match(b.element("main").innerHTML,/Кабинет мастера/);
    else assert.match(b.element("main").innerHTML,/Запись к мастеру/);
  }
});
test("UI-11 selecting a day triggers combined service request",async()=>{
  const b=environment();
  b.run("chooseService(1);chooseService(4);selectDate('2026-11-21');");
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.ok(b.requests.some(x=>x.url.includes("services=1%2C4")));
  assert.equal(b.run("state.slots.length"),2);
  assert.equal(b.run("state.slotsLoading"),false);
});
test("UI-12 booking disabled when bot is not configured",()=>{
  const b=environment({ready:false});
  b.run('state.page="booking";state.serviceIds=[1];state.date="2026-11-21";state.time="10:00";');
  const markup=b.run("publicView()");
  assert.match(markup,/Онлайн-запись включится после подключения бота и мастера/);
  assert.match(markup,/<button type="button" class="btn full"[^>]+disabled/);
});
