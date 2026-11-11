// Renderer real, fuentes ficticias y ningún acceso a datos operativos. Se ejecuta en CI.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),vm=require('node:vm');
const {chromium}=require('playwright'),root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const {auditarContraste:contraste}=require('./haiku-tema-browser-check.cjs');
const server=http.createServer((req,res)=>{
 const ruta=new URL(req.url,'http://localhost').pathname;
 if(ruta==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end('<!doctype html><html></html>');return;}
 const file=path.resolve(root,'.'+ruta);if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 try{const data=fs.readFileSync(file);res.writeHead(200,{'Content-Type':'text/css; charset=utf-8'}).end(data);}catch{res.writeHead(404).end();}
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,executablePath:process.env.HAKU_CHROMIUM_PATH,args:['--no-sandbox']});
 try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  const base=`http://127.0.0.1:${server.address().port}`;
  for(const width of [1280,390,320]){
   await page.setViewportSize({width,height:1000});await page.goto(base+'/');
   await page.setContent(`<!doctype html><html lang="es" data-haiku-tema="claro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    ${['styles','sites-shell-v1','supabase-asistente-v1','supabase-haku-reconciliacion-v1','sites-asistente-v1','haiku-libro-pagos-ui-v1','haiku-tema-oscuro-v1','haiku-tema-v1'].map(s=>`<link rel="stylesheet" href="${base}/css/${s}.css">`).join('')}
    </head><body><div class="haiku-asistente-root"><div class="haiku-asistente-panel" id="haiku-asistente-panel">
    <header class="haiku-asistente-cabecera">Haku Consultas</header><div class="haiku-asistente-mensajes" id="haiku-asistente-mensajes">
    <div class="haiku-asistente-preview haku-comparacion-compacta" id="resultado"></div></div></div></div></body></html>`);
   await page.evaluate(()=>{
    window.__g=1;window.__writes=[];window.__rows=[];
    const b=(id,cabana,inicio,nota)=>({id,cabana,fecha_inicio:`2026-11-0${inicio}`,fecha_fin:`2026-11-0${inicio+1}`,nota,
     origen:{hoja:'Nov26',rango:id},evidencia:{geometria:'disponibilidad_completa'}});
    window.__blocks=[b('D3:F3',1,1,'LATE CHECK OUT HASTA LAS 20 HRS X PAGAR SOLO $50.000 (FULL X HACER)'),
     b('G3:I3',1,3,'Reponer leña, carbón y amenities. Revisar calefacción y agua caliente antes de habilitar. '.repeat(4)),
     b('J4:L4',2,5,'Mantención de calefón'),b('D6:F6',4,1,'No vender · reparación de terraza')];
    const estado=()=>({generacion:window.__g,cargado:true});
    window.HAIKU_LIBRO_RESERVA_V1={estado,crearLectura:async()=>{const fijo=estado(),bloqueos=structuredClone(window.__blocks);return {estado:()=>fijo,
     consultarHoja:async()=>({bloqueos,reservas:[],cobertura:{geometria:true}})};}};
    window.haikuTienePermiso=()=>true;
    window.haikuSupabase={auth:{getSession:async()=>({data:{session:{user:{id:'ficticio'}}}})},from:tabla=>{
     const filtros=[],q={select:()=>q,eq:(k,v)=>(filtros.push([k,v]),q),order:()=>q,
      range:async()=>({data:(tabla==='cabanas'?[1,2,4].map(n=>({id:'cab'+n,numero:n,activa:true})):tabla==='bloqueos_cabana'?window.__rows:[]).filter(r=>filtros.every(([k,v])=>r[k]===v))})};return q;},
     rpc:async(n,a)=>{window.__writes.push({n,a});const id='creado-'+window.__writes.length;window.__rows.push({id,cabana_id:'cab'+a.p_cabana_numero,estado:'activo',desde:a.p_desde+'T03:00:00Z',hasta:a.p_hasta+'T03:00:00Z',motivo:a.p_motivo});return {data:{bloqueo_id:id}};}};
    window.__casos=window.__blocks.map((bloqueo,i)=>({bloqueo,estado:i===2?'ya_coincide':i===3?'revision':'no_existe',mensaje:i===3?'Existe una reserva en estas fechas. Revisa este caso.':''}));
    window.__casos.solo_proyecto_h=[{cabana:3,fecha_inicio:'2026-11-01',fecha_fin:'2026-11-02',nota:'Mantención terminada'}];
   });
   await page.addScriptTag({content:read('js/haiku-libro-bloqueos-v1.js')});
   await page.evaluate(()=>{HAIKU_LIBRO_BLOQUEOS_V1.renderizar(document.getElementById('resultado'),window.__casos,1);document.querySelector('.haiku-bloqueos-grupo > details').open=true;});
   const cards=page.locator('.haku-bloqueo-card'),first=cards.first(),group=page.locator('.haiku-bloqueos-grupo');
   await first.waitFor();
   for(const tema of ['claro','oscuro']){
    await page.evaluate(t=>document.documentElement.dataset.haikuTema=t,tema);
    assert.equal(await first.evaluate(e=>getComputedStyle(e).backgroundColor),tema==='oscuro'?'rgb(27, 36, 32)':'rgb(255, 255, 255)');
    assert.equal(await first.evaluate(e=>getComputedStyle(e).color),tema==='oscuro'?'rgb(232, 239, 234)':'rgb(32, 59, 48)');
    assert.deepEqual(await page.evaluate(contraste),[],`${width} ${tema}: contraste de texto y acciones`);
    assert.ok((await first.boundingBox()).height<190,`${width} ${tema}: ficha compacta`);
    assert.equal(await group.evaluate(e=>e.scrollWidth<=e.clientWidth+1),true,`${width} ${tema}: sin desborde`);
    assert.equal(await page.locator('.haku-bloqueo-status:empty').evaluateAll(es=>es.every(e=>getComputedStyle(e).display==='none')),true);
    if(width===1280)console.log(`BLOQUEOS_VISUAL_${tema.toUpperCase()}:`+(await page.locator('#haiku-asistente-panel').screenshot()).toString('base64'));
   }
   await first.locator('.haku-bloqueo-detalle > summary').click();
   assert.match(await first.locator('.haku-bloqueo-original').innerText(),/LATE CHECK OUT HASTA LAS 20 HRS/);
   assert.match(await first.locator('.haku-bloqueo-origen').first().innerText(),/Nov26 · D3:F3/);
   const before=await first.evaluate(e=>({h:e.getBoundingClientRect().height,open:e.querySelector('details').open,text:e.textContent}));
   await page.evaluate(()=>document.documentElement.dataset.haikuTema='claro');
   assert.deepEqual(await first.evaluate(e=>({h:e.getBoundingClientRect().height,open:e.querySelector('details').open,text:e.textContent})),before,'El tema no cierra ni mueve el detalle');
   await first.getByRole('button',{name:'Preparar bloqueo',exact:true}).click();
   await first.getByRole('button',{name:'Confirmar bloqueo',exact:true}).waitFor();
   await page.evaluate(()=>{window.__g++;dispatchEvent(new CustomEvent('haiku:libro-cambio'));dispatchEvent(new CustomEvent('haiku:libro-version-cargada'));});
   assert.equal(await first.getByRole('button',{name:'Confirmar bloqueo',exact:true}).isEnabled(),true);
   assert.doesNotMatch(await group.innerText(),/Propuesta invalidada|El Libro cambió/);
   await first.getByRole('button',{name:'Confirmar bloqueo',exact:true}).click();
   await first.getByText('Bloqueo creado.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.__writes.length),1);
   assert.equal(await first.locator('details').evaluate(e=>e.open),true,'Confirmar conserva el detalle abierto');
   console.log(`OK bloqueos ${width}: ambos temas, contraste, ficha compacta, detalle y confirmación tras actualización.`);
  }
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
