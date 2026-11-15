import test from "node:test";
import assert from "node:assert/strict";
import {createHarness,ids} from "./harness.mjs";

const photoBuffer=()=>{
  const bytes=Buffer.alloc(192);
  bytes[0]=0xff;bytes[1]=0xd8;bytes[2]=0xff;
  return bytes.toString("base64");
};

test("BOOKCORE location can be edited only by a master",async()=>{
  const h=createHarness();
  const input={address:"Город, улица Примерная, 12",landmark:"Вход с торца",latitude:53.35,longitude:83.76};
  const blocked=await h.post("/api/master/location",input,ids.a);
  assert.equal(blocked.status,403);
  const saved=await h.post("/api/master/location",input,ids.master);
  assert.equal(saved.status,200);
  const publicView=await h.request("/api/public");
  assert.equal(publicView.body.location.address,input.address);
  assert.equal(publicView.body.location.landmark,input.landmark);
  assert.equal(publicView.body.location.latitude,input.latitude);
});

test("BOOKCORE private image upload is master-only and JPEG-validated",async()=>{
  const h=createHarness();
  const upload={mime:"image/jpeg",data:photoBuffer()};
  assert.equal((await h.post("/api/master/photo",upload,ids.a)).status,403);
  assert.equal((await h.post("/api/master/photo",{mime:"image/svg+xml",data:photoBuffer()},ids.master)).status,400);
  const result=await h.post("/api/master/photo",upload,ids.master);
  assert.equal(result.status,200);
  assert.match(result.body.url,/private\.blob\.vercel-storage\.com/);
  assert.equal(h.photoAssets.size,1);
});

test("BOOKCORE photos are visible through versioned URLs only when attached to a service",async()=>{
  const h=createHarness();
  const created=await h.post("/api/master/photo",{mime:"image/jpeg",data:photoBuffer()},ids.master);
  assert.equal(created.status,200);
  const service=await h.post("/api/service",{id:1,title:"Наращивание ресниц",description:"Классическая процедура",
    minutes:120,price:1700,photos:[created.body.url],details:"Как проходит процедура"},ids.master);
  assert.equal(service.status,200);
  const publicView=await h.request("/api/public");
  const image=publicView.body.services.find(s=>s.id===1).photos[0];
  assert.match(image,/route=%2Fapi%2Fphoto/);
  const url=new URL(image,"https://bookcore-test.invalid");
  const query=new URLSearchParams(url.searchParams);
  query.delete("route");
  const photo=await h.request("/api/photo?"+query.toString());
  assert.equal(photo.status,200);
  assert.equal(photo.headers.get("content-type"),"image/jpeg");
  assert.equal((await h.request("/api/photo?service=1&index=0&v=wrong")).status,404);
  assert.equal((await h.request("/api/photo?service=1&index=4")).status,404);
});

test("BOOKCORE hides a service without removing history or master access",async()=>{
  const h=createHarness();
  const hidden=await h.post("/api/master/service/visibility",{id:1,active:false},ids.master);
  assert.equal(hidden.status,200);
  const client=await h.request("/api/public");
  assert.equal(client.body.services.some(s=>s.id===1),false);
  const master=await h.request("/api/master",{user:ids.master});
  assert.equal(master.body.services.find(s=>s.id===1).active,false);
  assert.equal((await h.post("/api/master/service/visibility",{id:1,active:true},ids.a)).status,403);
  assert.equal((await h.post("/api/master/service/visibility",{id:1,active:true},ids.master)).status,200);
});
