const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const R=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function montar(){
 const fuente=fs.readFileSync(require.resolve('../js/supabase-resumen-tablero-v1.js'),'utf8');
 const opened=[],window={haikuSesion:{usuario:{id:'u'}},haikuTienePermiso:()=>true,
  HAIKU_RESUMEN_RESERVA_SITES_V1:{abrirPorId:(...a)=>{opened.push(a);return true;}}};
 const context=vm.createContext({window,document:{readyState:'loading',addEventListener(){}},console,Date,Intl,fechaSeleccionada:'2026-11-08'});
 vm.runInContext(fuente.replace(/\}\)\(\);\s*$/,`globalThis.api={configurarAccesoDia,abrirDia,historial,pintarFlujo};})();`),context);
 const node=()=>({dataset:{},attrs:{},setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];}});
 const operacion=(n,estado='continua')=>({numero:1,estado_operativo:estado,continua_reserva_id:R(n),continua_estadia_id:R(n+10),continua_titular:'Huésped '+n,
  ingreso_reserva_id:R(n),ingreso_estadia_id:R(n+10),ingreso_titular:'Huésped '+n,salida_reserva_id:R(1),salida_estadia_id:R(11),salida_titular:'Huésped 1'});
 const configurar=(dia,n,estado)=>{const e=node(),op=operacion(n,estado);context.api.historial.set(dia,new Map([['1',op]]));context.api.configurarAccesoDia(e,op,dia,'2026-11-08','1');return e;};
 return {api:context.api,window,context,opened,node,operacion,configurar};
}
test('Ayer/Hoy/Mañana abren el UUID y estadía propios sin cambiar el día del Resumen',()=>{
 const x=montar();for(const [dia,n] of [['2026-11-07',1],['2026-11-08',2],['2026-11-09',3]]){
  const e=x.configurar(dia,n,n===2?'sale-ingresa':'continua');assert.equal(e.attrs.role,'button');assert.equal(e.attrs.tabindex,'0');
  assert.equal(x.api.abrirDia(e),true);const [id,trigger,sel]=x.opened.at(-1);assert.equal(id,R(n));assert.equal(trigger,e);assert.equal(sel.estadiaId,R(n+10));assert.equal(sel.fecha,dia);
 }assert.equal(x.context.fechaSeleccionada,'2026-11-08');
});
test('salida sin nuevo ingreso abre al saliente, bloqueada/libre sin reserva no ofrecen ficha',()=>{
 const x=montar();assert.equal(x.api.abrirDia(x.configurar('2026-11-08',2,'sale-libre')),true);assert.equal(x.opened[0][0],R(1));
 for(const estado of ['libre-libre','bloqueada']){const e=x.configurar('2026-11-08',2,estado);assert.equal(e.attrs.role,undefined);assert.equal(x.api.abrirDia(e),false);}
});
test('identidad vieja, permiso perdido, cambio de fecha o de sesión no abren una reserva equivocada',()=>{
 for(const tipo of ['identidad','permiso','fecha','sesion']){
  const x=montar(),e=x.configurar('2026-11-08',1);
  if(tipo==='identidad')x.api.historial.set('2026-11-08',new Map([['1',x.operacion(2)]]));
  if(tipo==='permiso')x.window.haikuTienePermiso=()=>false;
  if(tipo==='fecha')x.context.fechaSeleccionada='2026-11-09';
  if(tipo==='sesion')x.window.haikuSesion={usuario:{id:'otro'}};
  assert.equal(x.api.abrirDia(e),false,tipo);assert.equal(x.opened.length,0,tipo);
 }
});
test('repintar una celda libre elimina el acceso anterior y sus atributos de teclado',()=>{
 const x=montar(),e=x.configurar('2026-11-08',1);x.api.configurarAccesoDia(e,{estado_operativo:'libre-libre'},'2026-11-08','2026-11-08','1');
 assert.equal(e.attrs.role,undefined);assert.equal(e.attrs.tabindex,undefined);assert.equal(e.dataset.resumenDiaAcceso,undefined);assert.equal(x.api.abrirDia(e),false);
});
test('Ya salió se apoya en la estadía de salida exacta, incluso cuando entra otro huésped',()=>{
 const x=montar(),op=x.operacion(2,'sale-ingresa');x.api.historial.set('2026-11-08',new Map([['1',op]]));
 const badge={dataset:{},textContent:'Sale + ingresa'};
 const fila={dataset:{cabana:'1'},querySelector:s=>s==='[data-campo="estado"]'?{value:'sale-ingresa'}:s==='.sites-resumen-estado-badge'?badge:null};
 x.api.pintarFlujo(fila,'2026-11-08',{estadias:new Map([[R(11),'checked_out'],[R(12),'confirmada']]),reservas:new Map()});
 assert.equal(badge.textContent,'Salió · ingresa');assert.equal(badge.dataset.estadoVisual,'salio');
});
