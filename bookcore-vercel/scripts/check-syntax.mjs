import fs from "node:fs";
import vm from "node:vm";

const html=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");
const scripts=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
if(!scripts.length)throw new Error("Missing inline BOOKCORE client script");
new vm.Script(scripts.at(-1)[1],{filename:"index.html:script"});

const api=fs.readFileSync(new URL("../api/handler.ts",import.meta.url),"utf8")
  .replace(/^import .*;\s*$/gm,"")
  .replace("export default {","globalThis.__handler = {");
new vm.Script(api,{filename:"api/handler.ts"});

console.log("BOOKCORE syntax check: client and API passed");
