// Instrumentación de pruebas existentes. Sólo fixtures; se restaura el tema tras cada lectura.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const pw=require('playwright');
const {metrics}=require('./auditoria-temas-20261110.cjs');
const output=process.env.AUDIT_OUTPUT_DIR;
if(output){
 fs.mkdirSync(output,{recursive:true});let index=0;const results=[],seen=new Set(),pages=new Set();
 const flush=()=>fs.writeFileSync(path.join(output,'resultados.json'),JSON.stringify(results,null,2));
 async function capture(page,label,force=false){
  if(page.__auditBusy||page.isClosed()||index>=20)return;page.__auditBusy=true;let before;
  try{
   const info=await page.evaluate(()=>({url:location.href,width:innerWidth,height:innerHeight,theme:document.documentElement.getAttribute('data-haiku-tema'),styles:[...document.styleSheets].map(s=>s.href||'inline'),text:document.body.innerText.slice(0,450),dialogs:[...document.querySelectorAll('dialog,[role=dialog],[role=alertdialog]')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.height&&getComputedStyle(e).visibility!=='hidden'}).map(e=>({id:e.id||e.className,text:e.innerText.slice(0,160)}))}));
   if(!info.text.trim()||(!force&&!info.dialogs.length))return;
   const hash=crypto.createHash('sha256').update(JSON.stringify([info.width,info.dialogs,force?info.text:''])).digest('hex');if(seen.has(hash))return;seen.add(hash);
   before=info.theme;const row={id:++index,label,...info,themes:{}};
   for(const theme of['claro','oscuro']){await page.evaluate(t=>document.documentElement.dataset.haikuTema=t,theme);await page.waitForTimeout(40);row.themes[theme]=await page.evaluate(metrics);await page.__auditScreenshot({path:path.join(output,`${index}-${info.width}-${theme}.png`),animations:'disabled'});}
   results.push(row);flush();
  }catch(e){results.push({label,error:e.message});flush()}finally{try{if(before!==undefined)await page.evaluate(t=>t===null?document.documentElement.removeAttribute('data-haiku-tema'):document.documentElement.setAttribute('data-haiku-tema',t),before)}catch{}page.__auditBusy=false}
 }
 function hookPage(page){if(page.__auditScreenshot)return;pages.add(page);const shot=page.screenshot.bind(page);page.__auditScreenshot=shot;page.screenshot=async function(opts){const result=await shot(opts);await capture(page,'screenshot',true);return result};
  const close=page.close.bind(page);page.close=async function(...args){await capture(page,'page.close',true);return close(...args)};
  const proto=Object.getPrototypeOf(page.locator('body'));if(!proto.__auditHook){proto.__auditHook=true;const click=proto.click;proto.click=async function(...args){const r=await click.apply(this,args);await capture(this.page(),'dialog after click');return r};const lshot=proto.screenshot;proto.screenshot=async function(...args){const r=await lshot.apply(this,args);await capture(this.page(),'locator.screenshot',true);return r};}
 }
 const launch=pw.chromium.launch.bind(pw.chromium);pw.chromium.launch=async function(opts={}){const browser=await launch({...opts,channel:undefined,executablePath:pw.chromium.executablePath(),headless:true});const nc=browser.newContext.bind(browser);browser.newContext=async function(...args){const c=await nc(...args);c.on('page',hookPage);const cc=c.close.bind(c);c.close=async function(...a){for(const p of c.pages())await capture(p,'context.close',true);return cc(...a)};return c};const np=browser.newPage.bind(browser);browser.newPage=async function(...args){const p=await np(...args);hookPage(p);return p};const close=browser.close.bind(browser);browser.close=async function(...args){for(const p of pages)await capture(p,'browser.close',true);return close(...args)};return browser};
}
