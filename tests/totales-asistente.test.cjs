const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const api=require('../js/supabase-asistente-totales-v1.js');
const r=(id='r1',nombre='Bruno Borge',cab=5)=>({id,titular_nombre:nombre,estado_reserva:'checked_out',grupo_reserva_id:null,estadias:[{id:'e'+id,cabanas:{numero:cab},fecha_ingreso:'2026-09-04',fecha_salida:'2026-09-07',tipo_estadia:'alojamiento',estado_estadia:'checked_out',noches:['04','05','06'].map(d=>({fecha:'2026-09-'+d,tarifa:150000}))}]});
const frase='Haku cambia el precio total reserva Bruno Borge a 459.000';
for(const version of ['total1_financiero_v3','total1_financiero_v31'])test('capacidad '+version+' usa la misma confirmación y RPC de lote',async()=>{const e=entorno(),rpc=e.cliente.rpc.bind(e.cliente);e.cliente.rpc=(n,p)=>n==='haiku_capacidad_totales_v1'?Promise.resolve({data:{version,writer_disponible:true}}):rpc(n,p);const propuesta=await e.preparar();assert.equal(propuesta.estado,'propuesta');assert.equal(e.calls.length,0);assert.equal((await api.confirmar(propuesta)).estado,'completada');assert.equal(e.calls.length,1);assert.equal(e.calls[0].n,'haiku_cambiar_totales_lote_v1');});
test('V3 no disponible sigue bloqueando escritura',async()=>{const e=entorno();e.cliente.rpc=async()=>({data:{version:'total1_financiero_v3',writer_disponible:false}});const p=await e.preparar();assert.equal(p.estado,'previsualizacion');assert.equal((await api.confirmar(p)).estado,'bloqueada');assert.equal(e.calls.length,0);});
function entorno(rs=[r()]){
 const tablas={reservas:rs,vista_saldos_alojamiento_reserva:rs.map(r=>({reserva_id:r.id,total_alojamiento:450000})),cargo_ajustes:[],vista_estado_cargos:[]},calls=[];let permiso=true;
 const cliente={from(t){const filtros=[];const q={select(){return q;},order(){return q;},eq(k,v){filtros.push(r=>r[k]===v);return q;},async range(a,b){return {data:JSON.parse(JSON.stringify(tablas[t].filter(r=>filtros.every(f=>f(r))).slice(a,b+1))) };}};return q;},async rpc(n,p){if(n==='haiku_capacidad_totales_v1')return {data:{writer_disponible:true,version:'total1_financiero_v2'}};calls.push({n,p});return {data:{ok:true,resultados:p.p_cambios.map(e=>({reserva_id:e.reserva_id,total_nuevo:e.total_objetivo}))}};}};
 return {tablas,calls,cliente,revocar(){permiso=false;},preparar:(t=frase)=>api.preparar(t,{cliente,permiso:()=>permiso})};
}
for(const n of ['459000','459.000','$459.000','CLP 459.000','CLP$459.000'])test('monto '+n,()=>assert.equal(api.interpretar('Haku cambia el total de la reserva Bruno Borge a '+n).entradas[0].total_objetivo,459000));
test('nombre y CAB con total de CAB',()=>{const e=api.interpretar('Haku cambia el total de CAB 5 Bruno Borge a CLP$459.000').entradas[0];assert.equal(e.cabana,5);assert.equal(e.titular,'Bruno Borge');});
for(const sep of [' y ', ', ', '\n'])test('dos entradas separadas por '+JSON.stringify(sep),()=>{assert.equal(api.interpretar('Haku cambia el total de la reserva de CAB 5 · Bruno Borge a CLP$459.000'+sep+'CAB 9 · Constanza Kutscher a CLP$160.000').entradas.length,2);});
test('diez y veinte entradas; límite explícito',()=>{for(const n of [10,20,21]){const p=api.interpretar('cambia el total '+Array.from({length:n},(_,i)=>`CAB ${i+1} Juan Pérez a 459000`).join(' y '));assert.equal(p.entradas?.length,n<=20?n:undefined);if(n>20)assert.ok(p.error);}});
for(const texto of ['¿cuál es el total de Bruno?','muéstrame las reservas','cuánto debe CAB 5','busca el BOVE 16989','no cambia el total de Bruno Borge a 1'])test('no captura consulta '+texto,()=>assert.equal(api.interpretar(texto),null));
for(const n of ['0','-459000','459,50','459.00','9007199254740992'])test('rechaza monto '+n,()=>assert.ok(api.interpretar('cambia el total Bruno Borge a '+n).error));
test('prepara por nombre sin RPC; confirmación única revalida y usa lote',async()=>{const e=entorno(),p=await e.preparar();assert.equal(p.estado,'propuesta');assert.equal(e.calls.length,0);assert.equal((await api.confirmar(p)).estado,'completada');assert.equal(e.calls.length,1);assert.equal(e.calls[0].n,'haiku_cambiar_totales_lote_v1');assert.equal(e.calls[0].p.p_cambios[0].total_actual,450000);await api.confirmar(p);assert.equal(e.calls.length,1);});
test('tildes, mayúsculas y espacios se normalizan sin fuzzy',async()=>{const e=entorno([r('r1','Juán   Pérez')]);assert.equal((await e.preparar('cambia el total JUAN PEREZ a 459000')).estado,'propuesta');assert.equal((await e.preparar('cambia el total Juan Peres a 459000')).estado,'bloqueada');});
test('duplicado bloquea, CAB exacta desambigua, CAB contradictoria bloquea',async()=>{const e=entorno([r(),r('r2','Bruno Borge',9)]);assert.equal((await e.preparar()).estado,'bloqueada');assert.equal((await e.preparar('cambia el total CAB 5 Bruno Borge a 459000')).estado,'propuesta');assert.equal((await e.preparar('cambia el total CAB 3 Bruno Borge a 459000')).estado,'bloqueada');assert.equal(e.calls.length,0);});
test('inexistente y misma reserva repetida bloquean',async()=>{const e=entorno();assert.equal((await e.preparar('cambia el total Otra Persona a 459000')).estado,'bloqueada');assert.equal((await e.preparar('cambia el total Bruno Borge a 459000 y CAB 5 Bruno Borge a 480000')).estado,'bloqueada');});
test('mismo total es no-op sin RPC',async()=>{const e=entorno(),p=await e.preparar(frase.replace('459.000','450.000'));assert.equal(p.estado,'sin_cambios');await api.confirmar(p);assert.equal(e.calls.length,0);});
test('lote inválido entero, multiestadía, ajustes y tarifas variables bloqueados',async()=>{const e=entorno();assert.equal((await e.preparar(frase+' y Otra Persona a 480000')).estado,'bloqueada');e.tablas.reservas[0].estadias.push(r().estadias[0]);assert.equal((await e.preparar()).estado,'bloqueada');e.tablas.reservas[0]=r();e.tablas.reservas[0].estadias[0].noches[0].tarifa=140000;assert.equal((await e.preparar()).estado,'bloqueada');e.tablas.reservas[0]=r();e.tablas.cargo_ajustes.push({id:'a',reserva_id:'r1',estado:'activo'});assert.equal((await e.preparar()).estado,'bloqueada');assert.equal(e.calls.length,0);});
test('cambio entre preview y confirmación aborta TODO',async()=>{const e=entorno([r(),r('r2','Constanza Kutscher',9)]),p=await e.preparar(frase+' y CAB 9 Constanza Kutscher a 480000');assert.equal(p.estado,'propuesta');e.tablas.vista_saldos_alojamiento_reserva[1].total_alojamiento=460000;assert.equal((await api.confirmar(p)).estado,'bloqueada');assert.equal(e.calls.length,0);});
test('dos y diez cambios usan exactamente UNA llamada',async()=>{for(const n of [2,10]){const e=entorno(Array.from({length:n},(_,i)=>r('r'+i,'Juan Pérez',i+1)));const p=await e.preparar('cambia el total '+Array.from({length:n},(_,i)=>`CAB ${i+1} Juan Pérez a 459000`).join(' y '));assert.equal(p.estado,'propuesta');assert.equal((await api.confirmar(p)).estado,'completada');assert.equal(e.calls.length,1);assert.equal(e.calls[0].p.p_cambios.length,n);}});
test('permiso revocado y cancelación impiden RPC',async()=>{const e=entorno(),p=await e.preparar();e.revocar();assert.equal((await api.confirmar(p)).estado,'bloqueada');assert.equal(e.calls.length,0);const e2=entorno(),p2=await e2.preparar();api.cancelar(p2);await api.confirmar(p2);assert.equal(e2.calls.length,0);});
test('propuesta fabricada rechazada, snapshot no se altera desde la tarjeta',async()=>{assert.equal((await api.confirmar({items:[]})).estado,'bloqueada');const e=entorno(),p=await e.preparar();p.items[0].total_objetivo=1;await api.confirmar(p);assert.equal(e.calls[0].p.p_cambios[0].total_objetivo,459000);});
test('writer fallido no muestra éxito ni fallback después de capacidad válida',async()=>{const e=entorno();const rpc=e.cliente.rpc;e.cliente.rpc=async(n,p)=>{if(n==='haiku_capacidad_totales_v1')return rpc(n,p);e.calls.push(1);return {error:{message:'RPC no desplegada'}};};const p=await e.preparar();const x=await api.confirmar(p);assert.equal(x.estado,'bloqueada');assert.match(x.mensaje,/no desplegada/);assert.equal(e.calls.length,1);});
test('todas las reservas bloquean Confirmar sin capacidad, con error o versión desconocida',async()=>{
 for(const respuesta of [{error:{message:'no existe'}},{data:{writer_disponible:false,version:'total1_financiero_v2'}},{data:{writer_disponible:true,version:'otra'}}]){const e=entorno();e.cliente.rpc=async()=>respuesta;const p=await e.preparar();assert.equal(p.estado,'previsualizacion');assert.doesNotMatch(api.renderizar(p),/data-total-confirmar/);assert.equal((await api.confirmar(p)).estado,'bloqueada');}
});
test('capacidad retirada entre preview y confirmar aborta sin writer',async()=>{
 const e=entorno(),p=await e.preparar();e.cliente.rpc=async()=>({data:{writer_disponible:false,version:'total1_financiero_v2'}});assert.equal((await api.confirmar(p)).estado,'bloqueada');assert.equal(e.calls.length,0);
});
test('writer remoto anterior no habilita confirmar aunque anuncie disponible',async()=>{
 const e=entorno();e.cliente.rpc=async()=>({data:{writer_disponible:true,version:'total1_atomico_v1'}});
 const p=await e.preparar();assert.equal(p.estado,'previsualizacion');assert.doesNotMatch(api.renderizar(p),/data-total-confirmar/);assert.equal((await api.confirmar(p)).estado,'bloqueada');assert.equal(e.calls.length,0);
});
test('entrada estructurada usa misma vista previa y writer',async()=>{const e=entorno(),p=await e.preparar([{reserva_id:'r1',total_actual:450000,total_objetivo:459000,origen:'pdf_cloudbeds'}]);assert.equal(p.estado,'propuesta');await api.confirmar(p);assert.equal(e.calls.length,1);assert.equal((await e.preparar([{reserva_id:'r1',total_actual:3,total_objetivo:459000}])).estado,'bloqueada');});
test('cliente sólo usa plan IVA de lectura y único writer de lote',()=>{const s=fs.readFileSync('js/supabase-asistente-totales-v1.js','utf8');assert.doesNotMatch(s,/\.update\(|\.delete\(|\.insert\(|haiku_modificar_reserva_completa|precio_total\s*=/);assert.equal((s.match(/\.rpc\(/g)||[]).length,3);assert.equal((s.match(/\.rpc\(RPC,/g)||[]).length,1);assert.match(s,/haiku_previsualizar_total_iva_v1/);assert.doesNotMatch(s,/1\.19/);});
test('routing captura sólo órdenes claras antes de otros handlers',async()=>{
 const nodos=new Map(),listeners=[];const el=()=>({children:[],value:'',appendChild(x){this.children.push(x);},addEventListener(){},dispatchEvent(){},querySelector(){return null;}});const doc={head:el(),createElement:el,getElementById:id=>nodos.get(id)};
 const w={document:doc,Event:class{},addEventListener:(t,f)=>listeners.push({t,f}),haikuTienePermiso:()=>false};vm.runInNewContext(fs.readFileSync('js/supabase-asistente-totales-v1.js','utf8'),{window:w});
 const campo=el(),mensajes=el();nodos.set('haiku-asistente-texto',campo);nodos.set('haiku-asistente-mensajes',mensajes);
 for(const t of ['¿cuál es el total de Bruno?',frase]){campo.value=t;const ev={type:'click',target:{closest:()=>({})},preventDefault(){},stopImmediatePropagation(){this.stopped=true;}};listeners.find(e=>e.t==='click').f(ev);await new Promise(r=>setImmediate(r));assert.equal(!!ev.stopped,t===frase);}
 assert.equal(mensajes.children.length,2);assert.match(mensajes.children[1].innerHTML,/permisos/);
 const panel=fs.readFileSync('panel.html','utf8');assert.ok(panel.indexOf("'supabase-asistente-totales-v1'")<panel.indexOf("'haiku-libro-consultas-v1'"));
});

test('Full Day y división no exacta respetan límites; contenido se escapa',async()=>{
 const e=entorno();assert.equal((await e.preparar(frase.replace('459.000','459.001'))).estado,'propuesta');
 Object.assign(e.tablas.reservas[0].estadias[0],{tipo_estadia:'fullday',fecha_salida:'2026-09-04',noches:[]});assert.equal((await e.preparar()).estado,'propuesta');
 const html=api.renderizar({estado:'bloqueada',mensaje:'<img src=x onerror=alert(1)>'});assert.doesNotMatch(html,/<img/);
});
test('éxito refresca fuentes normales, fallo RPC no refresca',async()=>{
 const eventos=[];global.haikuSincronizarReservasSupabase=()=>eventos.push('sync');global.HAIKU_RESERVAS_V1={recargar:()=>eventos.push('reservas')};global.HAIKU_OPERACION_RESUMEN_FIX_V1={refrescar:()=>eventos.push('resumen')};
 global.document={getElementById:()=>({hidden:false,dataset:{reservaId:'r1'}})};global.haikuRefrescarFichaSupabaseV2=id=>eventos.push('ficha:'+id);
 try{const e=entorno();await api.confirmar(await e.preparar());assert.deepEqual(eventos.sort(),['ficha:r1','reservas','resumen','sync']);eventos.length=0;e.cliente.rpc=async()=>({error:{message:'falló'}});await api.confirmar(await e.preparar());assert.deepEqual(eventos,[]);}
 finally{delete global.document;delete global.haikuSincronizarReservasSupabase;delete global.HAIKU_RESERVAS_V1;delete global.HAIKU_OPERACION_RESUMEN_FIX_V1;delete global.haikuRefrescarFichaSupabaseV2;}
});

function ajuste(e,{signo=1,monto=42000,estado='activo',op='op1',id='a1',cargo='c1',base=420000,final=462000,tipo='cargo_modificacion'}={}){
 e.tablas.cargo_ajustes.push({id,operacion_id:op,reserva_id:'r1',cargo_id:cargo,tipo_ajuste:tipo,signo,monto,concepto:signo===1?'Cargo 10% · Modificación':'IVA exento',porcentaje:10,base_calculo:base,estado});
 e.tablas.vista_estado_cargos.push({cargo_id:cargo,reserva_id:'r1',tipo_cargo:'alojamiento',estado:'activo',monto:base,monto_ajustado:final});
 e.tablas.vista_saldos_alojamiento_reserva[0].total_alojamiento=final;
}
function entornoIva(){
 const e=entorno();e.tablas.reservas[0].estadias[0].noches.forEach(n=>n.tarifa=170000);
 ajuste(e,{signo:-1,monto:81429,base:510000,final:428571,tipo:'iva_exento'});e.tablas.cargo_ajustes[0].porcentaje=19;
 e.plan={reserva_id:'r1',total_actual:428571,total_objetivo:459000,base_actual:510000,iva_actual:81429,base_nueva:546210,iva_nuevo:87210,total_final_esperado:459000,firma:'plan-original',filas:[{fecha:'2026-09-04',base_nueva:182070,iva_nuevo:29070}]};
 const writer=e.cliente.rpc;e.cliente.rpc=async(n,p)=>{if(n==='haiku_previsualizar_total_iva_v1'){e.calls.push({n,p});return {data:JSON.parse(JSON.stringify(e.plan))};}return writer(n,p);};return e;
}
test('IVA preview confirma total final del servidor y conserva datos sin escritura',async()=>{
 const e=entornoIva(),antes=JSON.stringify(e.tablas),p=await e.preparar(),h=api.renderizar(p);
 assert.equal(p.estado,'propuesta');for(const valor of ['510.000','546.210','81.429','87.210','428.571','459.000'])assert.ok(h.includes(valor));
 assert.match(h,/Confirmas el <b>total final/);assert.equal(e.calls.length,1);assert.equal(e.calls[0].n,'haiku_previsualizar_total_iva_v1');assert.equal(JSON.stringify(e.tablas),antes);
 assert.equal((await api.confirmar(p)).estado,'completada');assert.deepEqual(e.calls.map(c=>c.n),['haiku_previsualizar_total_iva_v1','haiku_previsualizar_total_iva_v1','haiku_cambiar_totales_lote_v1']);assert.equal(e.calls[2].p.p_cambios[0].firma_iva,'plan-original');
});
test('IVA admite residuo autorizado por servidor y bloquea plan cambiado',async()=>{
 const e=entornoIva();Object.assign(e.plan,{total_objetivo:459001,base_nueva:546211,total_final_esperado:459001});
 const p=await e.preparar(frase.replace('459.000','459.001'));assert.equal(p.estado,'propuesta');e.plan.firma='cambio';assert.equal((await api.confirmar(p)).estado,'bloqueada');assert.ok(e.calls.every(c=>c.n==='haiku_previsualizar_total_iva_v1'));
});
test('IVA sin RPC desplegada o plan verificable nunca permite confirmar',async()=>{
 for(const respuesta of [{error:{message:'RPC no desplegada'}},{data:{}}]){const e=entornoIva();e.cliente.rpc=async(n)=>{e.calls.push({n});return respuesta;};const p=await e.preparar();assert.equal(p.estado,'bloqueada');assert.doesNotMatch(api.renderizar(p),/data-total-confirmar/);await api.confirmar(p);assert.equal(e.calls.length,1);}
});
test('preview remoto sólo lectura muestra importes sin botón ni acceso al writer, incluso en lote',async()=>{
 const e=entornoIva();e.plan.solo_lectura=true;
 e.tablas.reservas.push(r('r2','Constanza Kutscher',9));e.tablas.vista_saldos_alojamiento_reserva.push({reserva_id:'r2',total_alojamiento:450000});
 const p=await e.preparar(frase+' y CAB 9 Constanza Kutscher a 480000');assert.equal(p.estado,'previsualizacion');
 const html=api.renderizar(p);assert.match(html,/546.210/);assert.match(html,/Guardar totales permanece bloqueado/);assert.doesNotMatch(html,/data-total-confirmar/);
 assert.equal((await api.confirmar(p)).estado,'bloqueada');assert.equal(e.calls.length,1);assert.equal(e.calls[0].n,'haiku_previsualizar_total_iva_v1');
});
test('IVA combinado y otros ajustes siguen bloqueando lote completo',async()=>{
 for(const tipo of ['cargo_modificacion','cargo_cancelacion','iva_exento']){const e=entornoIva();e.tablas.cargo_ajustes.push({...e.tablas.cargo_ajustes[0],id:'a2',operacion_id:'otra',tipo_ajuste:tipo});const p=await e.preparar();assert.equal(p.estado,'bloqueada');assert.equal(e.calls.length,0);}
});
for(const signo of [1,-1])test('diagnóstico sólo lectura: ajuste '+signo,async()=>{
 const e=entorno();ajuste(e,{signo,final:signo===1?462000:378000,tipo:signo===1?'cargo_modificacion':'iva_exento'});
 const antes=JSON.stringify(e.tablas),p=await e.preparar(),html=api.renderizar(p);
 assert.equal(p.estado,'bloqueada');assert.equal(p.items[0].diagnostico.total_base,420000);
 assert.match(html,/Total base de alojamiento: <b>CLP \$420.000/);assert.match(html,signo===1?/\+CLP \$42.000/:/−CLP \$42.000/);
 assert.match(html,signo===1?/CLP \$462.000/:/CLP \$378.000/);assert.match(html,/Nuevo total solicitado: <b>CLP \$459.000/);
 assert.match(html,/Porcentaje: 10%/);assert.match(html,/Base: CLP \$420.000/);assert.match(html,/definir tratamiento del ajuste/);
 assert.doesNotMatch(html,/data-total-confirmar/);await api.confirmar(p);assert.equal(e.calls.length,0);assert.equal(JSON.stringify(e.tablas),antes);
});
test('operación repartida no se duplica; varias operaciones se distinguen',async()=>{
 const e=entorno();ajuste(e,{monto:10000,base:100000,final:110000});ajuste(e,{id:'a2',cargo:'c2',monto:32000,base:320000,final:352000});
 e.tablas.cargo_ajustes.push({id:'a3',operacion_id:'op2',reserva_id:'r1',cargo_id:'c2',tipo_ajuste:'iva_exento',signo:-1,monto:20000,concepto:'IVA exento',estado:'activo'});
 e.tablas.vista_estado_cargos[1].monto_ajustado=332000;e.tablas.vista_saldos_alojamiento_reserva[0].total_alojamiento=442000;
 const p=await e.preparar(),d=p.items[0].diagnostico;assert.equal(d.operaciones.length,2);assert.equal(d.operaciones[0].partes[0].monto,42000);assert.equal(d.total_base,420000);assert.equal(d.total_ajustado,442000);assert.equal(d.discrepancia,false);
 const h=api.renderizar(p);assert.match(h,/Operación de ajuste activa 2/);assert.match(h,/−CLP \$20.000/);assert.equal(e.calls.length,0);
});
test('ajuste anulado no bloquea ni aparece como activo',async()=>{
 const e=entorno();ajuste(e,{estado:'anulado',base:450000,final:450000});const p=await e.preparar();assert.equal(p.estado,'propuesta');assert.equal(p.items[0].diagnostico,undefined);assert.doesNotMatch(api.renderizar(p),/Cargo 10%/);assert.equal(e.calls.length,0);
});
test('lote muestra entrada viable y reserva bloqueante sin permitir confirmación parcial',async()=>{
 const e=entorno([r(),r('r2','Constanza Kutscher',9)]);ajuste(e);
 const p=await e.preparar(frase+' y CAB 9 Constanza Kutscher a 480000'),h=api.renderizar(p);assert.equal(p.estado,'bloqueada');assert.equal(p.items.length,2);
 assert.match(h,/Bruno Borge/);assert.match(h,/Cargo 10%/);assert.match(h,/Constanza Kutscher/);assert.match(h,/Sin bloqueo detectado en esta entrada/);assert.match(h,/No se aplicará ningún cambio/);assert.doesNotMatch(h,/data-total-confirmar/);
 await api.confirmar(p);assert.equal(e.calls.length,0);
});
test('totales se leen de las vistas, no se reconstruyen desde porcentaje; omite servicios',async()=>{
 const e=entorno();ajuste(e,{final:460000});e.tablas.cargo_ajustes[0].porcentaje=99;
 e.tablas.vista_estado_cargos.push({cargo_id:'serv',reserva_id:'r1',tipo_cargo:'servicio',estado:'activo',monto:999999,monto_ajustado:999999});
 const d=(await e.preparar()).items[0].diagnostico;assert.equal(d.total_base,420000);assert.equal(d.total_ajustado,460000);assert.equal(d.discrepancia,false);assert.equal(e.calls.length,0);
});
test('error del detalle mantiene identidad, bloqueo y cero RPC',async()=>{
 const e=entorno();ajuste(e);const from=e.cliente.from;e.cliente.from=t=>{if(t==='vista_estado_cargos')throw Error('lectura no disponible');return from(t);};
 const p=await e.preparar(),h=api.renderizar(p);assert.equal(p.estado,'bloqueada');assert.match(h,/Bruno Borge/);assert.match(h,/No disponible/);assert.match(h,/lectura no disponible/);assert.doesNotMatch(h,/data-total-confirmar/);assert.equal(e.calls.length,0);
});
