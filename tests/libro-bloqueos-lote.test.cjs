const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
class El{
 constructor(tag){this.tag=tag;this.children=[];this.textContent='';this.events={};this.disabled=false;}
 append(...xs){this.children.push(...xs)}replaceChildren(...xs){this.children=xs}setAttribute(){}addEventListener(k,fn){this.events[k]=fn}
}
const nodes=n=>[n,...n.children.flatMap(nodes)],text=n=>nodes(n).map(x=>x.textContent).join('\n');
function env(n=3){
 let generation=1,accept=true;const events={},calls=[],confirmations=[],blocks=[],stays=[];
 const fecha=d=>`2026-09-${d}`;
 const libroBloqueos=Array.from({length:n},(_,i)=>({id:'Sep26!B'+i,cabana:10,fecha_inicio:fecha(14+i),fecha_fin:fecha(15+i),nota:i===n-1?'FULL DAY':'BLOQUEO ROJO '+i,origen:{hoja:'Sep26',rango:'B'+i},evidencia:{geometria:'disponibilidad_completa',...(i===n-1?{tipo:'marcador_full_day'}:{fondo:'FF0000'})}}));
 const h={bloqueos:libroBloqueos,cobertura:{geometria:true},reservas:[],pagos:[{id:'untouched-payment'}],servicios:[{id:'untouched-service'}],cancelaciones:[{id:'untouched-cancellation'}],evidencias_bove:[{numero:'16968'}]};
 const libro={estado:()=>({generacion:generation,cargado:true}),consultarHoja:async()=>structuredClone(h)};
 const db={auth:{getSession:async()=>({data:{session:{user:{id:'test'}}}})},from(table){
  calls.push(['select',table]);const filters=[];const q={select(){return q},eq(k,v){filters.push([k,v]);return q},order(){return q},range:async(a,z)=>{
   const rows=table==='cabanas'?[{id:'cab10',numero:10,activa:true}]:table==='bloqueos_cabana'?blocks:table==='reserva_estadias'?stays:[];
   return {data:rows.filter(r=>filters.every(([k,v])=>r[k]===v)).slice(a,z+1)};
  }};return q;
 },rpc:async(name,args)=>{calls.push(['rpc',name,structuredClone(args)]);const id='created-'+blocks.length;blocks.push({id,cabana_id:'cab10',estado:'activo',desde:args.p_desde+'T03:00:00Z',hasta:args.p_hasta+'T03:00:00Z',motivo:args.p_motivo});return {data:{bloqueo_id:id,ya_existia:false}};}};
 const context={Date,Intl,structuredClone,haikuSupabase:db,HAIKU_LIBRO_RESERVA_V1:libro,haikuTienePermiso:()=>true,confirm:message=>{confirmations.push(message);return accept;},document:{createElement:t=>new El(t)},addEventListener(k,f){(events[k]||=[]).push(f);}};
 vm.runInNewContext(fs.readFileSync('js/haiku-libro-bloqueos-v1.js','utf8'),context);
 const api=context.HAIKU_LIBRO_BLOQUEOS_V1,casos=libroBloqueos.map(bloqueo=>({bloqueo,estado:'no_existe',mensaje:'No existe'}));
 return {api,context,casos,h,libro,db,blocks,stays,calls,confirmations,decline:()=>accept=false,change:()=>{generation++;(events['haiku:libro-cambio']||[]).forEach(f=>f());},writes:()=>calls.filter(c=>c[0]==='rpc'),existing(b){blocks.push({id:'existing-'+blocks.length,cabana_id:'cab10',estado:'activo',desde:b.fecha_inicio+'T03:00:00Z',hasta:b.fecha_fin+'T03:00:00Z',motivo:b.nota});},render(){const out=new El('div');api.renderizar(out,casos,1);return out;}};
}
test('8 Libro blocks count 7 new dynamically; existing, review and inverse-only cannot enter preparation',async()=>{
 const x=env(8);x.casos[0].estado='ya_coincide';x.existing(x.casos[0].bloqueo);
 x.casos.solo_proyecto_h=[{cabana:2,fecha_inicio:'2026-09-01',fecha_fin:'2026-09-02',nota:'Inverse only'}];
 const out=x.render();assert.match(text(out),/Preparar todos los bloqueos nuevos \(7\)/);
 x.casos[1].estado='revision';const p=await x.api.prepararTodos(x.casos,1);
 assert.equal(p.cantidad,6);assert.equal(p.items.length,6);assert.ok(p.items.every(x=>x.bloqueo.cabana===10));assert.equal(x.writes().length,0);
});
test('UI prepare lists compact candidates without RPC; global cancellation leaves 0 writes',async()=>{
 const x=env(),out=x.render(),button=nodes(out).find(n=>n.textContent.startsWith('Preparar todos'));
 const accordion=nodes(out).find(n=>n.tag==='details');assert.equal(accordion.open,false);assert.equal(accordion.children[0].tag,'summary');assert.equal(accordion.children[0].textContent,'Bloqueos del Libro (3)');
 assert.ok(!accordion.children[0].children.some(n=>n.tag==='button'),'actions stay outside native toggle header');
 await button.events.click();assert.equal(x.writes().length,0);assert.equal(x.confirmations.length,0);
 assert.equal(accordion.open,true);accordion.open=false;
 assert.match(text(out),/Se prepararon 3 bloqueos nuevos/);assert.match(text(out),/2026-09-14 → 2026-09-15/);assert.match(text(out),/FULL DAY/);
 x.decline();await button.events.click();assert.equal(x.writes().length,0);assert.equal(x.confirmations.length,1);
 assert.equal(accordion.open,true,'confirmation feedback reopens the section');
 assert.match(x.confirmations[0],/secuencial y no atómica/);assert.match(text(out),/Confirmación cancelada/);
});
test('global confirmation revalidates each: existing first omitted, unsafe second omitted, safe FULL DAY third created',async()=>{
 const x=env(),before=JSON.stringify(x.h),p=await x.api.prepararTodos(x.casos,1);
 x.context.confirm=message=>{x.confirmations.push(message);x.existing(x.casos[0].bloqueo);x.stays.push({id:'stay',cabana_id:'cab10',fecha_ingreso:'2026-09-15',fecha_salida:'2026-09-16',tipo_estadia:'alojamiento',estado_estadia:'confirmada'});return true;};
 const r=await x.api.confirmarTodos(p);
 assert.equal(r.estado,'completado');assert.equal(r.omitidos.length,2);assert.equal(r.omitidos[0].estado,'ya_coincide');assert.equal(r.omitidos[1].estado,'revision');
 assert.equal(r.creados.length,1);assert.equal(r.creados[0].nota,'FULL DAY');assert.equal(r.pendientes.length,0);assert.equal(x.writes().length,1);assert.equal(x.confirmations.length,1);
 assert.equal(JSON.stringify(x.h),before);assert.equal(x.writes()[0][1],'haiku_registrar_bloqueo_calendario');
});
test('RPC failure stops sequence and reports created, omitted, failed and untouched pending; consumed preview cannot retry',async()=>{
 const x=env(4),p=await x.api.prepararTodos(x.casos,1),original=x.db.rpc;x.existing(x.casos[0].bloqueo);
 x.db.rpc=async(name,args)=>{if(args.p_desde==='2026-09-16'){x.calls.push(['rpc',name,args]);throw Error('connection lost');}return original(name,args);};
 const r=await x.api.confirmarTodos(p);
 assert.equal(r.estado,'detenido');assert.equal(r.creados.length,1);assert.equal(r.omitidos.length,1);assert.equal(r.pendientes.length,1);
 assert.equal(r.fallo.bloqueo.fecha_inicio,'2026-09-16');assert.equal(r.pendientes[0].fecha_inicio,'2026-09-17');assert.equal(x.writes().length,2);
 assert.ok(!x.writes().some(c=>c[2].p_desde==='2026-09-17'));await assert.rejects(x.api.confirmarTodos(p),/consumido/);
});
test('successful UI run creates red and FULL DAY blocks sequentially, once confirmed, then refreshes to Ya coincide',async()=>{
 const x=env(),out=x.render(),button=nodes(out).find(n=>n.textContent.startsWith('Preparar todos')),original=x.db.rpc;
 let active=0,max=0;x.db.rpc=async(...args)=>{active++;max=Math.max(max,active);await Promise.resolve();const r=await original(...args);active--;return r;};
 await button.events.click();await button.events.click();
 assert.equal(x.confirmations.length,1);assert.equal(max,1);assert.equal(x.writes().length,3);assert.equal(x.blocks.length,3);
 assert.match(text(out),/Proceso completado/);assert.match(text(out),/Creados: 3/);assert.match(text(out),/Fallos: 0/);
 const accordion=nodes(out).find(n=>n.tag==='details');assert.equal(accordion.open,true);assert.match(text(accordion),/Proceso completado/);
 assert.equal(nodes(out).filter(n=>n.textContent==='✓ Ya coincide').length,3);
 assert.ok(!nodes(out).some(n=>n.tag==='button'&&n.textContent==='Preparar bloqueo'));
 assert.ok(x.writes().every(c=>c[1]==='haiku_registrar_bloqueo_calendario'));
});
test('partial failure UI preserves exact result and never offers an automatic retry',async()=>{
 const x=env(),out=x.render(),button=nodes(out).find(n=>n.textContent.startsWith('Preparar todos')),original=x.db.rpc;
 x.db.rpc=async(name,args)=>{if(args.p_desde==='2026-09-15'){x.calls.push(['rpc',name,args]);return {error:Error('fallo de prueba')};}return original(name,args);};
 await button.events.click();await button.events.click();assert.equal(x.writes().length,2);assert.equal(button.disabled,true);
 assert.match(text(out),/Creados: 1/);assert.match(text(out),/Pendientes por procesar: 1/);assert.match(text(out),/Falló: CAB 10 · 2026-09-15/);assert.match(text(out),/resultado incierto/);
 await button.events.click();assert.equal(x.writes().length,2);
});
test('changed generation invalidates pending preview; change during execution keeps prior success and omits the rest',async()=>{
 const x=env(),p=await x.api.prepararTodos(x.casos,1);x.change();await assert.rejects(x.api.confirmarTodos(p),/Libro cambió/);assert.equal(x.writes().length,0);
 const y=env(),q=await y.api.prepararTodos(y.casos,1),original=y.db.rpc;y.db.rpc=async(...a)=>{const r=await original(...a);y.change();return r;};
 const r=await y.api.confirmarTodos(q);assert.equal(r.creados.length,1);assert.equal(r.omitidos.length,2);assert.equal(y.writes().length,1);
});
test('tampering with public batch preview cannot change stored targets or cause repeated concurrent writes',async()=>{
 const x=env(),p=await x.api.prepararTodos(x.casos,1);p.items[0].bloqueo.nota='Tampered';p.cantidad=99;
 const running=x.api.confirmarTodos(p);await assert.rejects(x.api.confirmarTodos(p),/curso|consumido/);await running;
 assert.equal(x.writes().length,3);assert.equal(x.writes()[0][2].p_motivo,'BLOQUEO ROJO 0');assert.match(x.confirmations[0],/crear 3 bloqueos/);
});
