// DOM aislado: nunca usa la base ni una reserva real.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {parseHTML}=require('linkedom');
const source=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const tick=async()=>{for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));};
function fixture(){
 const {window}=parseHTML(source('index.html')),document=window.document,root=document.querySelector('#seccion-cabanas');
 // LinkeDOM sólo expone el getter de select.value; emula la selección nativa.
 const selectProto=window.HTMLSelectElement.prototype, valueDescriptor=Object.getOwnPropertyDescriptor(selectProto,'value');
 Object.defineProperty(selectProto,'value',{...valueDescriptor,set(value){for(const option of this.querySelectorAll('option')){if(option.value===value)option.setAttribute('selected','');else option.removeAttribute('selected');}}});
 const rows=new Map(),writes=[],supplies={}; let day='2026-11-04',owner='staff',nextWrite=null;
 const data={cabanas:{1:{titular:'Entrante',solicitudesTipos:[{categoria:'aseo_express',descripcion:'Entrada',estado:'pendiente',reserva_id:'in-1'},{categoria:'recambio_toallas',descripcion:'Retirar',estado:'pendiente',reserva_id:'out-1'}]},2:{solicitudesTipos:[]}},notasOperativas:[{cabana:1,texto:'General'},{cabana:1,reservaId:'out-1',estadiaId:'stay-1',texto:'Salida'},{cabana:1,reservaId:'in-1',texto:'Ingreso'}]};
 const departures=[1,2].map(n=>({fecha:day,cabana_id:'cab-'+n,numero:n,salida_estadia_id:'stay-'+n,salida_reserva_id:'out-'+n,salida_titular:n===1?'Titular saliente':'Otra salida'}));
 window.HAIKU_ASEO_OPERACION_V1={tiposSolicitud:{aseo_express:'Solicita Express',recambio_toallas:'Recambio de Toallas'}};
 window.haikuSupabase={async rpc(name,p){if(name==='haiku_operacion_dia')return{data:departures};if(name==='haiku_revisiones_checkout_dia_v1')return{data:{fecha:p.p_fecha,puede_editar:true,revisiones:[...rows.values()]}};
 writes.push({...p});if(nextWrite){const wait=nextWrite;nextWrite=null;await wait;}const key=p.p_cabana_id+':'+p.p_estadia_id,r={...(rows.get(key)||{fecha_operativa:p.p_fecha,cabana_id:p.p_cabana_id,estadia_id:p.p_estadia_id,hora_out:null,hora_out_definida:false,encargado:'',recuperados:[],chequeados:[],revision:0})};
 if(p.p_campo==='hora_out'){r.hora_out=p.p_valor||null;r.hora_out_definida=true;}else if(p.p_campo==='encargado')r.encargado=p.p_valor;else{const c=p.p_campo==='recuperado'?'recuperados':'chequeados';r[c]=p.p_valor.checked?[...new Set([...r[c],p.p_valor.id])]:r[c].filter(id=>id!==p.p_valor.id);}r.revision++;rows.set(key,r);return{data:r};},channel(){return{on(){return this},subscribe(){return this}}},removeChannel(){}};
 const supply=n=>supplies[n]??={listo:true,lena:{cantidad:0,pesoKg:0},carbon:{cantidad:0}};
 window.HAIKU_INSUMOS_ASEO_V1={obtener:(_,n)=>supply(n),hidratar:async()=>{},agregarSaco:async(d,n,w,to)=>{writes.push({supply:'lena',d,n,w,to});supply(n).lena.cantidad++;supply(n).lena.pesoKg+=w;},cambiar:async(d,n,t,q,to)=>{writes.push({supply:t,d,n,q,to});supply(n).carbon.cantidad+=q;}};
 const ctx=vm.createContext({window,document,console,Intl,setTimeout,clearTimeout,globalThis:null});ctx.globalThis=ctx;
 for(const p of ['js/checkout-core-v1.js','js/checkout-profile-v1.js']){vm.runInContext(source(p),ctx);if(p.includes('core'))window.HAIKU_CHECKOUT_CORE_V1=ctx.HAIKU_CHECKOUT_CORE_V1;}
 vm.runInContext(source('js/cabanas-espacios-v1.js'),ctx);
 const app=window.HAIKU_CABANAS_ESPACIOS_V1.create({root,date:()=>day,user:()=>owner,dayData:()=>data,afterSupply:()=>{}});
 for(const el of root.querySelectorAll('*'))el.scrollIntoView=()=>{};
 const event=(el,type)=>el.dispatchEvent(new window.Event(type,{bubbles:true}));
 const field=async(el,value)=>{event(el,'focusin');el.value=value;event(el,'input');event(el,'focusout');await tick();};
 return{window,root,app,writes,rows,supplies,event,field,delayNextWrite(){let release;nextWrite=new Promise(r=>{release=r});return release;},setDay:d=>{day=d},setOwner:o=>{owner=o}};
}
test('navegación ofrece Operación, Insumos y Check out; el resumen de insumos vive en su apartado',()=>{
 const f=fixture();assert.deepEqual([...f.root.querySelectorAll('[data-cab-tab]')].map(b=>b.textContent),['Operación de hoy','Insumos','Check out']);
 assert.equal(f.root.querySelector('#cabinsSuppliesSummary').closest('section').id,'cabinsSupplies');
 assert.equal(f.root.querySelector('#cabinsOperation #cabinsSuppliesSummary'),null);
});
test('salidas, contexto, edición por campo y marcas se mantienen al abrir y volver',async()=>{
 const f=fixture();f.app.render('checkout','2026-11-04');await tick();const cards=f.root.querySelectorAll('[data-checkout-card]');assert.equal(cards.length,2);
 assert.equal(cards[0].querySelector('[data-checkout-guest]').textContent,'Titular saliente');
 assert.equal(cards[0].querySelector('[data-checkout-context]').textContent,'Recambio de ToallasGeneralSalida');
 assert.equal(cards[1].querySelector('[data-checkout-context]').textContent,'');
 assert.equal(cards[0].querySelectorAll('input').length,2);
 const out=cards[0].querySelector('[data-checkout-field="hora_out"]'),person=cards[0].querySelector('[data-checkout-field="encargado"]');
 await f.field(out,'1145');await f.field(person,' Elena ');assert.equal(f.rows.get('cab-1:stay-1').hora_out,'11:45');assert.equal(f.rows.get('cab-1:stay-1').encargado,'Elena');
 const checkbox=cards[0].querySelector('[data-checkout-item="batas"]');checkbox.click();await tick();assert.equal(checkbox.getAttribute('aria-checked'),'true');
 cards[0].querySelector('[data-checkout-open]').click();await tick();const detail=f.root.querySelector('#cabinsCheckoutDetail');assert.equal(detail.hidden,false);assert.equal(detail.querySelector('[data-checkout-item="batas"]').getAttribute('aria-checked'),'true');
 detail.querySelector('[data-checkout-item="llaves"]').click();await tick();detail.querySelector('[data-checkout-back]').click();assert.equal(f.root.querySelector('#cabinsCheckoutList').hidden,false);assert.deepEqual([...f.rows.get('cab-1:stay-1').chequeados],['llaves']);
 const count=f.writes.length;await f.field(out,'25:10');assert.equal(f.writes.length,count);assert.match(f.root.querySelector('#cabinsCheckoutError').textContent,/hora válida/);
 assert.ok(f.writes.every(w=>!w.p_campo||['hora_out','encargado','recuperado','chequeado'].includes(w.p_campo)));
});
test('+ Insumo fija cabaña y fecha, exige destino/peso y actualiza sin abrir una ficha',async()=>{
 const f=fixture();f.app.render('supplies','2026-11-04');assert.equal(f.root.querySelectorAll('#cabinsSuppliesCabins article').length,11);
 await f.app.openSupply('2');await tick();assert.equal(f.root.querySelector('#cabinsSupplyTitle').textContent,'Insumos · Cabaña 2');
 const save=f.root.querySelector('#cabinsSupplySave');save.click();await tick();assert.match(f.root.querySelector('#cabinsSupplyError').textContent,/destino/);assert.equal(f.writes.length,0);
 f.root.querySelector('#cabinsSupplyDestination').value='aseo_full';save.click();await tick();assert.match(f.root.querySelector('#cabinsSupplyError').textContent,/peso/);
 f.root.querySelector('#cabinsSupplyWeight').value='8,5';save.click();save.click();await tick();assert.equal(f.writes.length,1);assert.deepEqual(f.writes[0],{supply:'lena',d:'2026-11-04',n:'2',w:8.5,to:'aseo_full'});
 assert.match(f.root.querySelector('#cabinsSuppliesCabins').textContent,/1 sacos · 8.5 kg/);
 f.root.querySelector('#cabinsSupplyType').value='carbon';f.event(f.root.querySelector('#cabinsSupplyType'),'change');save.click();await tick();assert.equal(f.supplies[2].carbon.cantidad,1);
 f.setDay('2026-11-05');f.app.render('supplies','2026-11-05');assert.equal(f.root.querySelector('#cabinsSupplyPanel').classList.contains('activo'),false);
});

test('una confirmación atrasada no borra el nombre que todavía se está escribiendo', async()=>{
 const f=fixture();f.app.render('checkout','2026-11-04');await tick();
 const input=f.root.querySelector('[data-checkout-field="encargado"]'),release=f.delayNextWrite();
 f.event(input,'focusin');input.value='Ana';f.event(input,'input');f.event(input,'focusout');await tick();
 f.event(input,'focusin');input.value='María';f.event(input,'input');release();await tick();
 assert.equal(input.value,'María');f.event(input,'focusout');await tick();
 assert.equal(f.rows.get('cab-1:stay-1').encargado,'María');
});
