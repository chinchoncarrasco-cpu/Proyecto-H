// Cuatro renderers reales, datos sintéticos, Chromium y red exclusivamente local.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),F=require('./fixtures/libro-comparacion-readonly.cjs'),R=require('./fixtures/libro-retiros-sinteticos.cjs');
const {setup:setupServicios}=require('./fixtures/libro-servicio-manual.cjs');
const root=path.resolve(__dirname,'..'),fixture=R.crear();
const evidencia=process.env.HAIKU_RETIROS_EVIDENCIA||path.join(os.tmpdir(),'haku-libro-retiros-20261115');fs.mkdirSync(evidencia,{recursive:true});
const css=['styles','haiku-paleta-v1','supabase-asistente-v1','sites-asistente-v1','supabase-haku-reconciliacion-v1','sites-libro-comparacion-readonly-v1','haiku-tema-oscuro-v1'];
const scripts=['haiku-libro-semantica-v1','haiku-fullday-tarifa-v1','haiku-libro-diferencias-v1','haiku-libro-contexto-v1','haiku-libro-pagos-canon-v1',
 'haiku-libro-lenguaje-natural-v1','haiku-libro-pagos-destinos-v1','haiku-libro-consultas-v1','haiku-libro-cancelaciones-v1','haiku-libro-bloqueos-v1',
 'haiku-libro-comparacion-readonly-v1','sites-libro-comparacion-readonly-v1','supabase-asistente-libro-actualizacion-v1','supabase-asistente-libro-auto-v1',
 'haiku-asistente-lenguaje-v1','supabase-asistente-operaciones-v1','supabase-asistente-servicios-cortesia-v1','supabase-asistente-servicios-cancelacion-v1'];
const html='<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
 css.map(s=>`<link rel="stylesheet" href="/css/${s}.css">`).join('')+
 '<style>body{margin:0}main{padding:12px;min-width:0}#vista{min-width:0;width:100%}nav{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}.haku-libro-auto{position:relative!important;inset:auto!important;width:100%!important;max-width:none!important}</style>'+
 '<body><main><h1>Libro · cambios y retiros sintéticos</h1><nav>'+['Mensual','Acción rápida','Haku Chat','Haku Burbuja'].map((v,i)=>`<button data-vista="${i}">${v}</button>`).join('')+'</nav><div id="vista"></div></main></body></html>';
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://localhost');if(u.pathname==='/')return res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end(html);
 if(!/^\/(js|css)\/[a-z0-9-]+\.(js|css)$/.test(u.pathname))return res.writeHead(404).end();
 let source=fs.readFileSync(path.join(root,u.pathname),'utf8');
 if(u.pathname==='/js/haiku-libro-consultas-v1.js')source=source.replace('const apiConsultas = Object.freeze({ interpretar,','const apiConsultas = Object.freeze({ renderizarComparacion, interpretar,');
 if(u.pathname==='/js/supabase-asistente-libro-auto-v1.js')source=source.replace('Object.freeze({resumir,crearControlador})','Object.freeze({resumir,crearControlador,montarVistaPendientes})');
 if(u.pathname==='/js/supabase-asistente-libro-actualizacion-v1.js')source=source.replace('Object.freeze({esConsulta,','Object.freeze({clasificarIncorporacionAviso,esConsulta,');
 res.writeHead(200,{'Content-Type':u.pathname.endsWith('.js')?'application/javascript;charset=utf-8':'text/css;charset=utf-8'}).end(source);
});
(async()=>{
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));const origin='http://127.0.0.1:'+server.address().port;
 let browser;const resultados=[],regresiones=[];
 try{
  browser=await chromium.launch({headless:true});
  for(const width of [1440,390])for(const tema of ['claro','oscuro']){
   const context=await browser.newContext({viewport:{width,height:1000}}),externos=[],errors=[];
   await context.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();externos.push(route.request().url());return route.abort();});
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);
   await page.evaluate(({fixture,libro,cliente,tema})=>{
    document.documentElement.dataset.haikuTema=tema;globalThis.copy=structuredClone;
    globalThis.crearClientePrueba=(0,eval)('('+cliente+')');globalThis.crearLibroPrueba=(0,eval)('('+libro+')');
    globalThis.clienteLectura=db=>{const c=crearClientePrueba(db),from=c.from.bind(c),rpc=c.rpc;
     c.from=(...args)=>{const q=from(...args);q.limit=()=>q;return q;};
     c.rpc=(nombre,...args)=>nombre==='haiku_libro_aplicaciones_servicio_capacidad_v1'?Promise.resolve({data:null}):rpc(nombre,...args);return c;};
    globalThis.f=fixture;globalThis.haikuSupabase=clienteLectura(fixture.db);
    globalThis.HAIKU_LIBRO_RESERVA_V1=crearLibroPrueba(fixture.data,fixture.previa,fixture.registros);
    globalThis.haikuTienePermiso=()=>true;globalThis.haikuSesion={auth:{id:'usuario-sintetico'},usuario:{activo:true},roles:[{codigo:'administrador'}]};
   },{fixture,libro:R.libro.toString(),cliente:F.cliente.toString(),tema});
   for(const script of scripts)await page.addScriptTag({url:origin+'/js/'+script+'.js'});
   await page.evaluate(async()=>{
    const Q=HAIKU_LIBRO_CONSULTAS,A=HAIKU_ASISTENTE_LIBRO_ACTUALIZACION_V1;
    globalThis.resultado=await Q.consultar('Libro: compara reservas de octubre 2026 con Proyecto H',HAIKU_LIBRO_RESERVA_V1,haikuSupabase);
    globalThis.dto=await HAIKU_LIBRO_COMPARACION_READONLY_V1.crearNucleo().compararMes({fuente:{libro:HAIKU_LIBRO_RESERVA_V1},cliente:haikuSupabase,ahora:'2026-10-09T12:00:00Z'});
    if(!['ok','incompleto'].includes(dto.status))throw Error(JSON.stringify(dto.error));
    globalThis.pendientes=await Q.revalidarCambiosDetectados(f.registros,haikuSupabase,{generacion:1});
    globalThis.abrirVista=async index=>{
     const out=document.querySelector('#vista');out.className='';out.replaceChildren();
     if(index===0)HAIKU_LIBRO_INFORME_READONLY_V1.renderizar(document,out,dto);
     if(index===1)Q.renderizarComparacion(out,resultado);
     if(index===2){out.innerHTML=A.renderizarPendientes(pendientes);
      for(const [i,item]of pendientes.items.entries())Q.renderizarCambiosLibro(out.querySelectorAll('.haku-pendiente-detalle')[i],item.retirosServicios);
     }
     if(index===3){
      const nodo=(p,t,c,texto)=>{const e=document.createElement(t);if(c)e.className=c;if(texto!==undefined)e.textContent=texto;p.append(e);return e;};
      const boton=(p,c,texto)=>nodo(p,'button',c,texto);
      const toast=nodo(out,'aside','haku-libro-auto haku-libro-auto--con-pendientes'),aviso=nodo(toast,'div'),cuerpoAviso=nodo(aviso,'div');
      const panel=nodo(toast,'section','haku-libro-casos');panel.id='casos-retiros';
      const api=HAIKU_ASISTENTE_LIBRO_AUTO_V1.montarVistaPendientes({panel,toast,aviso,cuerpoAviso,
       pendientes:A.clasificarIncorporacionAviso(pendientes).pendientes,nodo,boton,
       botonInforme:p=>boton(p,'','Ver informe'),cerrar(){},revisar(){},posicionar(){},abrir:boton(aviso,'','Abrir'),
       icono:(p,n)=>nodo(p,'span','',n==='volver'?'←':'⌄')});api.abrir();api.adaptar();
     }
     globalThis.cambiosPlegados=Array.from(out.querySelectorAll('details.haku-retiros-libro'))
      .map(d=>({abierto:d.open,titulo:d.querySelector('summary').textContent,enRevision:!!d.closest('.haku-comparacion-sites-seccion')}));
     for(const d of out.querySelectorAll('details'))d.open=true;
    };
    document.querySelectorAll('[data-vista]').forEach(b=>b.onclick=()=>abrirVista(Number(b.dataset.vista)));
   });
   const paridad=await page.evaluate(()=>({rapida:resultado.comparacion.cambiosLibro.filter(x=>x.campo==='servicios').map(x=>[x.tipo,x.antes,x.despues]),
    mensual:dto.cambiosLibro.filter(x=>x.campo==='servicios').map(x=>[x.tipo,x.antes,x.despues])}));assert.deepEqual(paridad.rapida,paridad.mensual);
   for(let view=0;view<4;view++){
    await page.evaluate(i=>abrirVista(i),view);
    if(view===0||view===1){
     const [acordeon]=await page.evaluate(()=>cambiosPlegados);
     assert.ok(acordeon);assert.equal(acordeon.abierto,false);assert.match(acordeon.titulo,/^Cambios detectados/);
     if(view===1)assert.equal(acordeon.enRevision,true);
    }
    if(view===3){await page.locator('.haku-libro-casos__fila').first().click();await page.evaluate(()=>{for(const d of document.querySelectorAll('details'))d.open=true;});}
    const text=await page.locator('#vista').innerText();assert.match(text,/Aurora Ficción/);assert.match(text,/18:00/);assert.match(text,/19:00/);assert.match(text,/retir|continúa activo/i);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`sin desborde ${view}/${width}/${tema}`);
    await page.screenshot({path:path.join(evidencia,`vista-${view}-${width}-${tema}.png`),fullPage:true});
    resultados.push({view:['Mensual','Acción rápida','Haku Chat','Haku Burbuja'][view],width,tema,result:'PASS'});
   }
   assert.deepEqual(await page.evaluate(()=>haikuSupabase.mutaciones),[]);assert.deepEqual(externos,[]);assert.deepEqual(errors,[]);
   await page.evaluate(()=>abrirVista(1));
   const notas=page.locator('[data-haku-cambio-incorporar="revisar_notas"]').first().locator('xpath=../..');
   await notas.getByRole('button',{name:'Incorporar',exact:true}).click();
   await notas.getByRole('button',{name:'Confirmar incorporación',exact:true}).waitFor();
   assert.equal(await notas.locator('.haku-incorporacion-sites-preparacion').count(),0,'la confirmación queda en la fila');
   assert.match(await notas.innerText(),/Actualiza las notas|Adultos|Estado/);
   assert.deepEqual(await page.evaluate(()=>haikuSupabase.mutaciones),[]);
   await notas.getByRole('button',{name:'Volver',exact:true}).click();
   if(width===1440&&tema==='claro'){
    const cancelar=page.locator('[data-haku-cambio-incorporar="revisar_cancelacion_servicio"]').locator('xpath=../..');
    await cancelar.getByRole('button',{name:'Incorporar',exact:true}).click();
    await cancelar.getByRole('textbox',{name:'Motivo de la cancelación'}).waitFor();
    assert.equal(await cancelar.getByRole('button',{name:'Confirmar incorporación',exact:true}).isDisabled(),true,'cancelación requiere motivo y confirmación');
    await page.screenshot({path:path.join(evidencia,'vista-previa-cancelacion-sintetica.png'),fullPage:true});
    const horario=page.locator('[data-haku-cambio-incorporar="reprogramar_servicio"]').locator('xpath=../..');
    await horario.getByRole('button',{name:'Incorporar',exact:true}).click();
    await horario.getByRole('button',{name:'Confirmar incorporación',exact:true}).waitFor();
    assert.deepEqual(await page.evaluate(()=>haikuSupabase.mutaciones),[]);
    await page.screenshot({path:path.join(evidencia,'vista-previa-horario-sintetica.png'),fullPage:true});
    await notas.getByRole('button',{name:'Incorporar',exact:true}).click();
    await notas.getByRole('button',{name:'Confirmar incorporación',exact:true}).waitFor();
    assert.deepEqual(await page.evaluate(()=>haikuSupabase.mutaciones),[]);
    await page.screenshot({path:path.join(evidencia,'vista-previa-notas-focal-sintetica.png'),fullPage:true});
    const datos=await page.evaluate(()=>({antes:f.antes,despues:HAIKU_LIBRO_CONSULTAS.actualizacionReservaLibro(f.data.reservas[0],resultado.comparacion[0].sistema).reserva.despues.observaciones,
     cambios:resultado.comparacion.cambiosLibro.map(x=>({campo:x.campo,tipo:x.tipo,antes:x.antes,despues:x.despues,motivo:x.motivo})),paridad:true}));
    fs.writeFileSync(path.join(evidencia,'antes-despues-sintetico.json'),JSON.stringify(datos,null,2));
   }
   for(const escena of R.regresiones()){
    const datos=await page.evaluate(async f=>{
     globalThis.haikuSupabase=clienteLectura(f.db);globalThis.HAIKU_LIBRO_RESERVA_V1=crearLibroPrueba(f.data,f.previa,f.registros);
     const Q=HAIKU_LIBRO_CONSULTAS,A=HAIKU_ASISTENTE_LIBRO_ACTUALIZACION_V1,out=document.querySelector('#vista');out.replaceChildren();out.className='';
     const snapshot=JSON.stringify(haikuSupabase.db),d=await HAIKU_LIBRO_DIFERENCIAS_V1.compararUltimasVersiones({libro:HAIKU_LIBRO_RESERVA_V1,fechaReferencia:'2026-10-03'});
     const cache=A.crearCachePendientes(),p=await cache.obtener(d,{revalidar:true});out.innerHTML=A.renderizarPendientes(p);
     let notas=null,retiros=[];const servicio=f.caso==='servicio-ilegible';
     if(f.caso==='notas-respaldo'){
      const vista=document.createElement('div');out.append(vista);const {plan}=await Q.abrirPreparacionComparacion(vista,p.preparacion);
      notas=plan.items.find(x=>x.payload?.reserva?.despues?.observaciones)?.payload.reserva.despues.observaciones;
      retiros=p.items[0].vistaIncorporacion?.notas?.retiradas||[];
     }
     let ficha;
     if(servicio){
      const result=await Q.consultar('Libro: compara reservas de octubre 2026 con Proyecto H',HAIKU_LIBRO_RESERVA_V1,haikuSupabase);
      out.replaceChildren();
      Q.renderizarCambiosLibro(out,result.comparacion.cambiosLibro);
      const c=result.comparacion.cambiosLibro.find(x=>x.sistema?.id==='servicio-sintetico-0');
      ficha={id:c?.id,servicioId:c?.sistema?.id,campo:c?.campo,tipo:c?.tipo,accion:c?.accion,motivo:c?.motivo};
     }
     const retiroCerradoVisible=out.textContent.includes('AVISO DE RETIRO CERRADO');
     if(f.caso==='reaparecida-alta'){
      globalThis.QReaparecida=Q;globalThis.planReaparecida=null;
      globalThis.HAIKU_LIBRO_CONSULTAS={...Q,abrirPreparacionComparacion:async(...args)=>{
       const r=await Q.abrirPreparacionComparacion(...args);globalThis.planReaparecida=r.plan;return r;}};
      out.innerHTML='<input id="haiku-asistente-texto" hidden><button id="haiku-asistente-enviar" hidden></button><div id="haiku-asistente-mensajes"></div>';
      A.mostrarResultado(d);
     }
     const historial=(await HAIKU_LIBRO_RESERVA_V1.leerCambiosDetectados()).cambios;
     const repetido=await cache.obtener(d,{revalidar:true});
     for(const el of out.querySelectorAll('details'))el.open=true;
     return {caso:f.caso,notas,retiros,ficha,retiroCerradoVisible,items:p.items.map(x=>({tipo:x.tipo,accionable:x.accionable,cambios:x.cambios})),
      propuestasRepetidas:repetido.items.length,historial:historial.map(x=>({tipo:x.tipo,notas:x.actual?.notas_importantes})),
      resueltos:p.resueltos,antes:f.db.reserva_estadias[0]?.reservas?.observaciones,negocioIntacto:snapshot===JSON.stringify(haikuSupabase.db),mutaciones:haikuSupabase.mutaciones};
    },escena);
    if(escena.caso==='reaparecida-alta'){
     await page.getByRole('button',{name:'Revisar cambios',exact:true}).click();
     await page.waitForFunction(()=>globalThis.planReaparecida!==null);
     const preparado=await page.evaluate(()=>{
      const operaciones=QReaparecida.serializarIncorporacion(planReaparecida);
      for(const d of document.querySelectorAll('details'))d.open=true;
      globalThis.HAIKU_LIBRO_CONSULTAS=QReaparecida;
      return {operaciones,mutaciones:haikuSupabase.mutaciones};
     });
     const preview=await page.locator('.haku-incorporacion-sites-preparacion').locator('..').innerText();
     assert.equal((preview.match(/Dejar dos batas/g)||[]).length,1,'la vista previa conserva la nota una vez');
     assert.equal(preparado.operaciones.length,1);assert.equal(preparado.operaciones[0].tipo,'reserva_nueva');
     assert.equal((preparado.operaciones[0].reserva.observaciones.match(/Dejar dos batas/g)||[]).length,1,'la operación preparada conserva la nota una vez');
     assert.deepEqual(preparado.mutaciones,[]);datos.altaPreparada=preparado.operaciones[0];datos.notaEnVistaPrevia=1;
    }
    assert.equal(datos.negocioIntacto,true);assert.deepEqual(datos.mutaciones,[]);
    const texto=await page.locator('#vista').innerText();
    if(escena.caso==='notas-respaldo'){
     assert.ok(datos.retiros.includes('JACUZZI 18:30'));assert.doesNotMatch(datos.notas,/18:30/);assert.match(datos.notas,/15:30/);
     assert.equal((datos.notas.match(/Late check-out 14:00/g)||[]).length,1);assert.match(datos.notas,/Comentario manual intacto/);
     assert.match(texto,/18:30/);assert.match(texto,/15:30/);
    }else if(escena.caso==='notas-inciertas'){
     assert.equal(datos.items[0].accionable,false);assert.match(texto,/incierto/);assert.equal(datos.notas,null);
    }else if(escena.caso.startsWith('reaparecida-')){
     assert.equal(datos.retiroCerradoVisible,true);assert.doesNotMatch(texto,/Ya registrada y cancelada/);
     const total=escena.caso==='reaparecida-alta'?1:0;assert.equal(datos.items.length,total);assert.equal(datos.propuestasRepetidas,total);
     assert.equal(datos.historial.length,total);if(total)assert.deepEqual(datos.historial[0].notas,['Dejar dos batas']);
    }else{
     const encabezado=page.locator('.haku-retiros-libro__encabezado').filter({hasText:'Servicios'});
     assert.match(await encabezado.innerText(),/Servicios\s+Requiere revisión/);
     assert.match(texto,/Sin coincidencia verificada en el Libro/);assert.doesNotMatch(texto,/Sin información/);
     assert.equal(datos.ficha.id,'servicio:servicio-sintetico-0');
     assert.equal(datos.ficha.servicioId,'servicio-sintetico-0');assert.equal(datos.ficha.accion,null);
    }
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:path.join(evidencia,`regresion-${escena.caso}-${width}-${tema}.png`),fullPage:true});
    regresiones.push({...datos,width,tema,result:'PASS'});
   }
   await page.addScriptTag({url:origin+'/js/haiku-libro-servicios-scope-v2.js'});
   await page.evaluate(setup=>{
    (0,eval)('('+setup+')')();
    const r=fixtureServicios.reservas[0],e=fixtureServicios.db.reserva_estadias[0];
    r.titular=fixtureServicios.db.reservas[0].titular_nombre='Huésped Full Day de prueba';
    r.tipo_estadia='full_day';r.fecha_checkout=r.fecha_checkin;r.noches=0;
    r.texto_original='Jacuzzi 19hrs';
    r.servicios=HAIKU_LIBRO_SEMANTICA.servicios(r.texto_original,{origen_campo:'notas_reserva'});
    e.tipo_estadia='fullday';e.fecha_salida=e.fecha_ingreso;
   },setupServicios.toString());
   await page.evaluate(async()=>{
    const Q=HAIKU_LIBRO_CONSULTAS,out=document.querySelector('#vista');
    const r=fixtureServicios.reservas[0],scope={reservas:[r],generacion:1};
    const api=HAIKU_LIBRO_SERVICIOS_SCOPE_V2,plan=await api.prepararHistorial(scope),item=plan.items.find(x=>x.kind==='servicio');
    if(item?.reglaFullDay?.pagosRevisados!==true)throw Error(JSON.stringify(item?.razones));
    out.replaceChildren();
    Q.renderizarCambiosLibro(out,[{id:item.item_id,tipo:'agregado',campo:'servicios',reserva:r,sistema:item.asociacion.sistema,
     accion:'incorporar_servicio',despues:{concepto:item.mapa.nombre,fecha:item.fecha,hora:item.hora,cobro:'Cortesía Full Day · $0'}}],
     {preparar:c=>api.prepararServicioEnLinea(scope,c.id,c.sistema.id)});
    for(const d of out.querySelectorAll('details'))d.open=true;
   });
   const cortesia=page.locator('#vista');
   assert.match(await cortesia.innerText(),/Cortesía Full Day · \$0/);
   await cortesia.getByRole('button',{name:'Incorporar',exact:true}).click();
   await cortesia.getByRole('button',{name:'Confirmar incorporación',exact:true}).waitFor();
   assert.match(await cortesia.innerText(),/19:00 · Cortesía Full Day · \$0/);
   assert.deepEqual(await page.evaluate(()=>fixtureServicios.escrituras),[]);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   assert.deepEqual(externos,[]);assert.deepEqual(errors,[]);await context.close();
  }
  fs.writeFileSync(path.join(evidencia,'regresiones-sinteticas.json'),JSON.stringify(regresiones,null,2));
  fs.writeFileSync(path.join(evidencia,'navegador-resultado.json'),JSON.stringify({result:'PASS',views:resultados,regresiones:regresiones.length,previews:3,screenshots:resultados.length+regresiones.length+3,mutaciones:0,redExterna:0},null,2));
  console.log(JSON.stringify({result:'PASS',views:resultados.length,regresiones:regresiones.length,screenshots:resultados.length+regresiones.length+3,previews:3,mutaciones:0,redExterna:0,evidencia}));
 }finally{await browser?.close();await new Promise(ok=>server.close(ok));}
})().catch(e=>{console.error(e);process.exitCode=1;});
