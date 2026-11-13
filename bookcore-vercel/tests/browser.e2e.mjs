import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {chromium} from "playwright";
import {createHarness,ids} from "./harness.mjs";

const BASE_URL="http://127.0.0.1:3125";
const dates=createHarness();
const screenshots=new URL("../test-artifacts/",import.meta.url);
fs.mkdirSync(screenshots,{recursive:true});

async function createContext(browser,id){
  const context=await browser.newContext({
    viewport:{width:390,height:844},deviceScaleFactor:1,
    isMobile:true,hasTouch:true
  });
  await context.route("https://telegram.org/js/telegram-web-app.js",route=>
    route.fulfill({status:200,contentType:"application/javascript",body:""}));
  if(id!==null){
    const initData=dates.signed(id);
    await context.addInitScript(value=>{
      window.Telegram={WebApp:{initData:value,ready(){},expand(){}}};
    },initData);
  }
  const page=await context.newPage();
  page.on("dialog",dialog=>dialog.accept());
  const errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  await page.goto(BASE_URL,{waitUntil:"domcontentloaded"});
  return {page,context,errors};
}
async function navigate(page,label){
  await page.locator("#dock button").filter({hasText:label}).click();
}
async function pickDate(page,selector,date){
  const month=date.slice(0,7);
  for(let i=0;i<3;i++){
    const desired=page.locator(selector+' .cal-day[aria-label="'+date+'"]');
    if(await desired.count()>0&&await desired.isEnabled()){await desired.click();return;}
    const next=page.locator(selector+" .cal-nav").last();
    assert.equal(await next.isEnabled(),true,"Calendar cannot reach "+month);
    await next.click();
  }
  throw new Error("Could not pick "+date+" on calendar");
}
async function noHorizontalOverflow(page){
  const dimensions=await page.evaluate(()=>({screen:innerWidth,scroll:document.documentElement.scrollWidth}));
  assert.ok(dimensions.scroll<=dimensions.screen+3,JSON.stringify(dimensions));
}

test("Real Chromium mobile: client + master full booking scenario", {timeout:110000}, async()=>{
  const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
  const errors=[];
  try{
    const client=await createContext(browser,ids.a);errors.push(client.errors);
    const p=client.page;
    await p.locator("#newName").waitFor({timeout:10000});
    await p.locator("#newName").fill("Анастасия");
    await p.getByRole("button",{name:"Продолжить"}).click();
    await p.locator("#newName").waitFor({state:"detached"});
    await navigate(p,"Запись");
    await p.locator(".service").filter({hasText:"Классическое наращивание"}).click();
    await p.locator(".service").filter({hasText:"Ламинирование"}).click();
    await p.getByText("Общая длительность: 195 мин").waitFor();
    const summary=await p.locator(".booking-total").innerText();
    assert.match(summary,/3\s*300/);

    const d=dates.openDay({min:4,max:15});
    await pickDate(p,".book-calendar",d);
    await p.locator("#slotList button.chip").first().waitFor({timeout:10000});
    await noHorizontalOverflow(p);
    await p.screenshot({path:new URL("client-booking.png",screenshots).pathname,fullPage:true});
    await p.locator("#slotList button.chip").first().click();
    await p.getByRole("button",{name:"Подтвердить запись"}).click();
    await p.getByText("Мои записи",{exact:true}).first().waitFor();
    await p.getByText("Классическое наращивание + Ламинирование").waitFor();
    assert.equal(client.errors.length,0,"Browser errors: "+client.errors.join("; "));
    // Client reschedules the same combined procedure via the no-year calendar.
    await p.getByRole("button",{name:"Перенести"}).first().click();
    const d2=dates.openDay({min:15,max:35});
    await pickDate(p,"#moveCalendar",d2);
    await p.locator("#moveSlots button.chip").first().waitFor({timeout:10000});
    await p.locator("#moveSlots button.chip").first().click();
    await p.getByRole("button",{name:"Сохранить перенос"}).click();
    await p.getByText("Классическое наращивание + Ламинирование").waitFor();
    // Guest cannot bypass authenticated booking.
    const guest=await createContext(browser,null);
    await navigate(guest.page,"Запись");
    assert.match(await guest.page.locator("#main").innerText(),/[Оо]ткройте приложение через Telegram-бота/);
    assert.equal(guest.errors.length,0);
    await guest.context.close();
    // Master must land on dashboard and can operate schedule and manual bookings.
    const master=await createContext(browser,ids.master);errors.push(master.errors);
    await master.page.getByRole("heading",{name:"Кабинет мастера"}).waitFor();
    await navigate(master.page,"Календарь");
    await master.page.locator("#manualName").fill("Тестовый посетитель");
    await master.page.locator("#manualService").selectOption("5");
    await master.page.locator("#manualDate").fill(d);
    await master.page.locator("#manualTime").fill("15:00");
    await master.page.screenshot({path:new URL("master-calendar.png",screenshots).pathname,fullPage:true});
    await master.page.getByRole("button",{name:"Добавить запись"}).click();
    await master.page.getByText("Тестовый посетитель").waitFor();
    await noHorizontalOverflow(master.page);
    assert.equal(master.errors.length,0,"Master page errors: "+master.errors.join("; "));
    await master.context.close();
    await client.context.close();
    console.log("REAL_BROWSER_E2E_PASS: onboarding, 2 services, no-year calendar, booking, reschedule, guest, master manual booking, mobile layout");
  }finally{await browser.close();}
});
