// Navegador real, Libro/cliente ficticios y red externa bloqueada.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');const F=require('./fixtures/libro-comparacion-readonly.cjs'),R=require('./fixtures/libro-pagos-revision.cjs');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const exportsBase='Object.freeze({ interpretar, consultar, compararSistema, respuesta, renderizarVersiones, crearPlanIncorporacion, prepararIncorporacion, serializarIncorporacion, confirmarIncorporacion })';
const source=read('js/haiku-libro-consultas-v1.js').replace(exportsBase,exportsBase.replace(' })',', renderizarIncorporacion, resolverAprobacionManualPago })'));
const server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname;
 if(pathname==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end('<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
  ['styles','supabase-asistente-v1','supabase-haku-reconciliacion-v1','sites-asistente-v1','haiku-libro-pagos-ui-v1','haiku-tema-oscuro-v1'].map(n=>`<link rel="stylesheet" href="/css/${n}.css">`).join('')+
  '<body><main style="padding:8px"><div class="ficha-pagos"><div><span>Total</span><strong id="ficha-pago-total"></strong></div><div><span>Abonos</span><strong id="ficha-pago-abono"></strong></div><div><span>Saldo neto</span><strong id="ficha-pago-saldo"></strong></div><div><span>Servicios</span><strong id="ficha-pago-servicios"></strong></div></div><div id="out"></div></main></body></html>');return;}
 const p=path.resolve(root,'.'+pathname);if(!p.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 try{res.writeHead(200,{'Content-Type':pathname.endsWith('.css')?'text/css':'image/svg+xml'}).end(fs.readFileSync(p));}catch{res.writeHead(404).end();}
});
(async()=>{await new Promise(ok=>server.listen(0,'127.0.0.1',ok));const browser=await chromium.launch({headless:true});
 const evidence=process.env.HAKU_REVISION_EVIDENCIA||path.join(process.env.LOCALAPPDATA,'ProyectoH/diagnosticos/libro-pagos-20261116-sintetico');fs.mkdirSync(evidence,{recursive:true});
 const resultados=[];try{for(const mobile of [false,true])for(const tema of ['claro','oscuro']){
 const page=await browser.newPage({viewport:{width:mobile?390:1440,height:1000}}),errors=[],external=[];
 page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():(external.push(route.request().url()),route.abort()));
 await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.evaluate(tema=>document.documentElement.dataset.haikuTema=tema,tema);
 await page.evaluate(({data})=>{window.HAIKU_LIBRO_RESERVA_V1={listo:async()=>{},estado:()=>({cargado:true,generacion:1,version:'f'.repeat(64)}),listarHojas:()=>['Nov26'],consultarHoja:async()=>structuredClone(data)};},R.caso());
 for(const n of ['haiku-libro-semantica-v1','haiku-libro-pagos-canon-v1','haiku-libro-lenguaje-natural-v1','haiku-libro-pagos-destinos-v1'])await page.addScriptTag({content:read('js/'+n+'.js')});
 await page.addScriptTag({content:source});await page.addScriptTag({content:read('js/supabase-finanzas-resumen-v1.js')});
 const ficha=read('js/supabase-ficha-v2.js');await page.addScriptTag({content:'const dinero=n=>"$"+Number(n).toLocaleString("es-CL");'+ficha.slice(ficha.indexOf('    function pintarPagos'),ficha.indexOf('    function crearItemServicio'))});
 await page.addScriptTag({content:'const copy=structuredClone;const crearCliente='+F.cliente.toString()+';'});
 await page.evaluate(async({caso,cap})=>{
  window.haikuTienePermiso=()=>true;window.haikuSesion={usuario:{activo:true},roles:[{codigo:'administrador'}]};
  const db=crearCliente(caso.db),Q=HAIKU_LIBRO_CONSULTAS;window.__writes=[];db.rpc=async(n,args)=>{
   if(n==='haiku_libro_aplicaciones_servicio_capacidad_v1')return{data:cap};
   if(n==='haiku_resumen_ajustes_unidad')return{data:{reserva_id:caso.db.reserva_estadias[0].reserva_id,ajustes:db.db.cargo_ajustes}};
   if(n==='haiku_libro_transferencias_capacidad_v2')return{data:{version:2,confirmacion_final:true,glosa_sin_nombre:true}};
   if(n==='haiku_libro_ajustar_precio_cargo_v1'){
    __writes.push(args);const p=args.p_propuesta,c=db.db.vista_estado_cargos.find(c=>c.cargo_id===p.cargo_id);const delta=p.precio_final-c.monto_ajustado;
    c.monto_ajustado=p.precio_final;c.saldo_cargo+=delta;return{data:{ok:true,cargo_id:c.cargo_id,ajuste:delta,precio_final:p.precio_final}};
   }
   throw Error('ESCRITURA BLOQUEADA: '+n);
  };
  window.haikuSupabase=db;const result={reservas:[caso.r],generacion:1,q:{desde:caso.r.fecha_checkin,hasta:caso.r.fecha_checkout,incluirFinanzas:true}};
  const decisiones=new Map(),aprobados=new Set();window.__render=p=>{window.__plan=p;Q.renderizarIncorporacion(document.getElementById('out'),p,()=>{},aprobar,()=>{throw Error('No ejecutar pagos en esta validación');});
   document.querySelectorAll('.haiku-incorporacion-seccion,.haku-pago-revisar').forEach(e=>e.open=true);pintarPagos({cargos:db.db.vista_estado_cargos,pagos:db.db.pagos});};
  const aprobar=async id=>{aprobados.add(id);__render(await Q.prepararIncorporacion(result,decisiones,aprobados,db));};
  aprobar.manualPago=async(plan,id,accion)=>__render(await Q.resolverAprobacionManualPago(result,decisiones,aprobados,plan,id,accion,db));
  __render(await Q.prepararIncorporacion(result,decisiones,aprobados,db));
  window.__serializar=()=>Q.serializarIncorporacion(__plan);
 },{caso:R.caso(),cap:R.capacidad});
 assert.match(await page.locator('#ficha-pago-saldo').innerText(),/44.400/);
 assert.match(await page.locator('#ficha-pago-aplicaciones-detalle').innerText(),/188.400.*144.000/);
 assert.equal(await page.getByText(/Origen guardado: Oct26!CI36:CL36/).count(),1);
 const tinaja=page.locator('.haiku-incorporacion-item').filter({has:page.getByText('Revisar precio final autorizado de este cargo',{exact:true})});
 assert.equal(await tinaja.count(),1);assert.match(await tinaja.innerText(),/32.500.*30.000.*2.500/s);
 await tinaja.locator('summary').click();
 const geo=await tinaja.evaluate(el=>({ancho:el.getBoundingClientRect().width,scroll:el.scrollWidth,client:el.clientWidth,cols:getComputedStyle(el.querySelector('.haku-precio-cargo-campos')).gridTemplateColumns.split(' ').length}));
 assert.ok(geo.scroll<=geo.client+1);assert.equal(geo.cols,mobile?1:2);
 const campos=await tinaja.locator('.haku-precio-cargo-campos > input').evaluateAll(xs=>xs.map(x=>({x:x.getBoundingClientRect().x,y:x.getBoundingClientRect().y})));
 if(mobile){assert.equal(campos[0].x,campos[1].x);assert.ok(campos[1].y>campos[0].y);}else{assert.equal(campos[0].y,campos[1].y);assert.ok(campos[1].x>campos[0].x);}
 await tinaja.screenshot({path:path.join(evidence,`${mobile?'movil':'escritorio'}-${tema}-tinaja.png`)});
 await page.screenshot({path:path.join(evidence,`${mobile?'movil':'escritorio'}-${tema}-antes.png`),fullPage:true});
 await tinaja.getByRole('button',{name:'Confirmar ajuste de este cargo',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.haiku-incorporacion-error'));
 assert.equal(await page.evaluate(()=>__writes.length),0);
 await tinaja.getByLabel('Motivo del ajuste de precio',{exact:true}).fill('Precio final acordado en revisión ficticia');
 await tinaja.getByLabel('Evidencia independiente de autorización del precio',{exact:true}).fill('Autorización ficticia de administración, acta 777');
 await tinaja.getByRole('checkbox').last().check();await tinaja.getByRole('button',{name:'Confirmar ajuste de este cargo',exact:true}).click();
 await page.getByText(/Ajuste confirmado en el cargo/).waitFor();assert.equal(await page.evaluate(()=>__writes.length),1);
 const despues=await page.evaluate(()=>__serializar());const pago=despues.find(i=>i.argumentos?.p_monto===32500);
 assert.ok(pago);assert.equal(pago.datos_origen.aplicaciones_servicio_v1.aplicaciones[0].monto,32500);
 await page.screenshot({path:path.join(evidence,`${mobile?'movil':'escritorio'}-${tema}-despues.png`),fullPage:true});
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);resultados.push({mobile,tema,geo,errores:errors.length,operacionesFicticias:1});await page.close();
 }fs.writeFileSync(path.join(evidence,'navegador.json'),JSON.stringify(resultados,null,2));console.log(JSON.stringify({pass:true,vistas:resultados.length,evidencia:evidence}));
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
