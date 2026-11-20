// Navegador real y PostgreSQL aislado: no utiliza cuentas ni datos de producción.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { chromium } = require('playwright');
const { PGlite } = require(process.env.HAKU_PGLITE_MODULE || '@electric-sql/pglite');
const root = path.resolve(__dirname, '..');
const scripts = new Set(['js/historial.js', 'js/calendario.js', 'js/checklist.js', 'js/app.js', 'js/cabanas.js', 'js/sites-cabanas-v1.js', 'js/haiku-tareas-generales-v1.js']);
const user = '00000000-0000-4000-8000-000000000001';
const day = '2026-01-19';
(async () => {
 const db = new PGlite();
 let browser;
 try {
  await db.exec(`create schema auth; create schema private; create role authenticated; create role anon;
   grant usage on schema public,auth,private to authenticated;
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create function private.haiku_usuario_activo() returns boolean language sql stable as $$select true$$;
   create function private.haiku_tiene_permiso(codigo text) returns boolean language sql stable as $$select codigo=any(string_to_array(current_setting('test.permisos',true),','))$$;
   create table usuarios(id uuid primary key,nombre text,apellido text);
   insert into usuarios values('${user}','Felipe','Prueba'); create publication supabase_realtime;`);
  const migration = fs.readdirSync(path.join(root, 'supabase/migrations')).find(f => f.endsWith('_tareas_generales_seguimiento_v1.sql'));
  await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations', migration), 'utf8'));
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('test.permisos','revisiones.ver,revisiones.gestionar',false)", [user]);
  await db.exec('set role authenticated');
  let cola = Promise.resolve();
  const rpc = (nombre, a) => {
   const p = cola.then(async () => {
    try {
     let sql, args;
     if (nombre === 'haiku_tareas_generales_dia_v1') { sql = 'select public.haiku_tareas_generales_dia_v1($1) d'; args = [a.p_fecha]; }
     else if (nombre === 'haiku_guardar_tarea_general_v1') { sql = 'select public.haiku_guardar_tarea_general_v1($1,$2,$3,$4,$5,$6) d'; args = [a.p_fecha,a.p_tipo,a.p_revision,a.p_accion,JSON.stringify(a.p_datos),a.p_operacion]; }
     else if (nombre === 'haiku_tareas_generales_historial_v1') { sql = 'select public.haiku_tareas_generales_historial_v1($1,$2) d'; args = [a.p_fecha,a.p_tipo]; }
     else throw new Error('RPC no permitida en esta prueba');
     return { data: (await db.query(sql, args)).rows[0].d, error: null };
    } catch (e) { return { data: null, error: { message: e.message, code: e.code || 'TEST' } }; }
   });
   cola = p.then(() => {}); return p;
  };
  const command = async (tipo, accion, revision, datos = {}, fecha = day) => {
   const r = await rpc('haiku_guardar_tarea_general_v1', { p_fecha:fecha,p_tipo:tipo,p_revision:revision,p_accion:accion,p_datos:datos,p_operacion:randomUUID() });
   if (r.error) throw new Error(r.error.message); return r.data;
  };
  async function seed() {
   await cola; await db.exec('reset role; truncate tareas_generales_movimientos,tareas_generales; set role authenticated');
   for (const tipo of ['lavanderia','cocina','recepcion','jardines_terraza','banos']) await command(tipo,'asignar',0,{encargado:'Camila',revisor:'Felipe'});
   await command('lavanderia','iniciar',1); await command('cocina','realizar',1);
   await command('recepcion','realizar',1); await command('recepcion','verificar',2);
   await command('jardines_terraza','asignar',0,{encargado:'Camila'},'2026-01-18');
   await command('jardines_terraza','nota',1,{nota:'Revisar limpieza del turno anterior.'},'2026-01-18');
  }
  browser = await chromium.launch({ headless:true });
  async function abrir(width, theme) {
   const page = await browser.newPage({ viewport:{width,height:1000},timezoneId:'America/Santiago' });
   const errores=[]; page.on('pageerror', e => errores.push(e.message));
   await page.exposeFunction('__tareasRpc', rpc);
   await page.addInitScript(user => {
    window.haikuSesion={auth:{id:user},usuario:{id:user,nombre:'Felipe'}};
    window.haikuTienePermiso=()=>true;
    window.haikuSupabase={rpc:(n,a)=>window.__tareasRpc(n,a),channel:()=>({on(_n,_f,cb){window.__taskRealtime=cb;return this},subscribe(){return this}}),removeChannel(){}};
   },user);
   await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.hostname==='cdn.jsdelivr.net')return route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:()=>({})}'});
    if(url.hostname!=='haku-tareas.test')return route.abort();
    const name=decodeURIComponent(url.pathname.slice(1)),file=path.join(root,name);
    if(name.includes('..')||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.abort();
    if(name.endsWith('.js')&&!scripts.has(name))return route.fulfill({contentType:'application/javascript',body:''});
    return route.fulfill({contentType:name.endsWith('.html')?'text/html':name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':name.endsWith('.svg')?'image/svg+xml':'application/octet-stream',body:fs.readFileSync(file)});
   });
   await page.goto('https://haku-tareas.test/panel.html');
   await page.waitForFunction(()=>window.HAIKU_CABANAS_SITES_V1&&window.HAIKU_TAREAS_GENERALES_V1);
   await page.evaluate(async ({theme,day})=>{
    fechaSeleccionada=day;
    document.documentElement.setAttribute('data-haiku-tema',theme);
    document.documentElement.classList.remove('haiku-cabanas-pendiente','haiku-privacidad-arranque','haiku-resumen-pendiente','haiku-pagos-pendiente');
    HAIKU_CABANAS_SITES_V1.pintar(); await HAIKU_TAREAS_GENERALES_V1.cargar(day,{forzar:true});
   },{theme,day});
   await page.locator('.menu-item[data-seccion="cabanas"]').click();
   return {page,errores};
  }
  for(const width of [1440,390,320])for(const theme of ['claro','oscuro']){
   await seed(); const {page,errores}=await abrir(width,theme);
   const tasks=page.locator('#cabinsGeneralTasks');
   assert.equal(await tasks.locator('.tg-task').count(),6);
   assert.ok(await page.evaluate(()=>document.querySelector('#aseo-resumen').compareDocumentPosition(document.querySelector('#cabinsGeneralTasks'))&Node.DOCUMENT_POSITION_FOLLOWING));
   const filtros=await page.locator('#cabinsFilters').evaluate(n=>({client:n.clientWidth,scroll:n.scrollWidth,buttons:n.children.length}));
   assert.equal(filtros.buttons,8); if(width<700)assert.ok(filtros.scroll<=filtros.client+1);
   const jardines=tasks.locator(`[data-tg-key="${day}:jardines_terraza"]`);
   assert.equal(await jardines.locator('.tg-detail').count(),0);
   assert.equal(await jardines.locator('.tg-row input').count(),2);
   await jardines.locator('textarea').fill('Revisar la zona de la terraza.');
   await jardines.locator('input[name="encargado"]').fill('Scarla');
   await jardines.locator('input[name="revisor"]').fill('Renata');
   assert.equal(await jardines.locator('[data-tg-state]').isDisabled(),true);
   await jardines.getByRole('button',{name:'Guardar asignación',exact:true}).click();
   await page.waitForFunction(()=>HAIKU_TAREAS_GENERALES_V1.contexto().datos.tareas.find(t=>t.tipo==='jardines_terraza').encargado==='Scarla');
   assert.equal(await jardines.locator('input[name="revisor"]').inputValue(),'Renata');
   assert.equal(await jardines.locator('textarea').inputValue(),'Revisar la zona de la terraza.');
   await jardines.getByRole('button',{name:'Guardar nota',exact:true}).click();
   await page.waitForFunction(()=>HAIKU_TAREAS_GENERALES_V1.contexto().datos.tareas.find(t=>t.tipo==='jardines_terraza').nota==='Revisar la zona de la terraza.');
   await jardines.locator('[data-tg-state]').selectOption('iniciar');
   await page.waitForFunction(()=>HAIKU_TAREAS_GENERALES_V1.contexto().datos.tareas.find(t=>t.tipo==='jardines_terraza').estado==='en_curso');
   await jardines.locator('[data-tg-state]').selectOption('realizar');
   await page.waitForFunction(()=>HAIKU_TAREAS_GENERALES_V1.contexto().datos.tareas.find(t=>t.tipo==='jardines_terraza').estado==='realizada');
   assert.equal(await jardines.locator('textarea').inputValue(),'Revisar la zona de la terraza.');
   assert.match(await jardines.locator('.tg-review').textContent(),/Por verificar/);
   await jardines.getByRole('button',{name:'Verificar tarea',exact:true}).click();
   await jardines.locator('.tg-badge').filter({hasText:'Verificada'}).waitFor();
   assert.match(await jardines.locator('.tg-review').textContent(),/Felipe Prueba/);
   await jardines.getByRole('button',{name:'Reabrir con detalles'}).click();
   assert.match(await jardines.locator('.tg-error').textContent(),/motivo/);
   await jardines.locator('textarea').fill('Falta limpiar la terraza.');
   await jardines.getByRole('button',{name:'Reabrir con detalles'}).click();
   await page.waitForFunction(()=>HAIKU_TAREAS_GENERALES_V1.contexto().datos.tareas.find(t=>t.tipo==='jardines_terraza').estado==='con_detalles');
   await jardines.getByRole('button',{name:'Historial de Limpiar jardines y terraza',exact:true}).click();
   await jardines.locator('.tg-history').waitFor();
   assert.match(await jardines.locator('.tg-history').textContent(),/Falta limpiar la terraza/);
   await jardines.locator('textarea').fill('Segunda revisión del jardín.');
   await jardines.getByRole('button',{name:'Guardar nota',exact:true}).click();
   await jardines.locator('.tg-history').filter({hasText:'Segunda revisión del jardín.'}).waitFor();
   const ancho=await tasks.evaluate(n=>({client:n.clientWidth,scroll:n.scrollWidth}));
   assert.ok(ancho.scroll<=ancho.client+1,`sin desbordamiento en ${width}/${theme}`);
   await jardines.getByRole('button',{name:'Historial de Limpiar jardines y terraza',exact:true}).click();
   const dimensiones=await jardines.locator('.tg-row').evaluate(n=>({height:n.getBoundingClientRect().height,client:n.clientWidth,scroll:n.scrollWidth}));
   assert.ok(dimensiones.scroll<=dimensiones.client+1,`controles dentro de la fila en ${width}/${theme}`);
   assert.ok(dimensiones.height<(width>1100?155:340),`fila compacta en ${width}/${theme}: ${dimensiones.height}`);
   if(process.env.HAKU_UI_SHOTS){fs.mkdirSync(process.env.HAKU_UI_SHOTS,{recursive:true});await tasks.screenshot({path:path.join(process.env.HAKU_UI_SHOTS,`tareas-${width}-${theme}.png`)});}
   assert.deepEqual(errores,[]); await page.close();
   console.log(`PASS tareas generales, filtros y revisión: ${width}px ${theme}`);
  }
  await seed();
  const {page:a}=await abrir(390,'oscuro'),{page:b}=await abrir(1440,'claro');
  const key=`${day}:jardines_terraza`;
  const garden=a.locator(`[data-tg-key="${key}"]`);
  await garden.locator('input[name="encargado"]').fill('Borrador A');
  await b.evaluate(async key=>{await HAIKU_TAREAS_GENERALES_V1.guardar(key,'asignar',{encargado:'Cambio B',revisor:'Felipe'})},key);
  await a.evaluate(()=>window.__taskRealtime());
  await a.waitForFunction(()=>HAIKU_TAREAS_GENERALES_V1.contexto().datos.tareas.find(t=>t.tipo==='jardines_terraza').encargado==='Cambio B');
  await garden.getByRole('button',{name:'Guardar asignación'}).click();
  assert.match(await garden.locator('.tg-error').textContent(),/cambió mientras/);
  assert.equal((await rpc('haiku_tareas_generales_dia_v1',{p_fecha:day})).data.tareas.find(t=>t.tipo==='jardines_terraza').encargado,'Cambio B');
  await a.close();await b.close();
  console.log('PASS dos dispositivos: avance compartido y conflicto durante la edición');
 } finally { if(browser)await browser.close(); await db.close(); }
})().catch(e=>{console.error(e);process.exitCode=1});
