const test=require('node:test'),assert=require('node:assert/strict');
const V=require('../js/checkout-workflow-v2.js'),{createCheckoutStore}=require('../js/checkout-core-v1.js');
test('detecta préstamos concretos, conserva cantidades dudosas y no suma notas repetidas',()=>{
 const loans=V.detectLoans(['Se prestaron 2 batas y un sacacorcho; cenicero','Se prestaron 2 batas y un sacacorcho; cenicero']);
 assert.deepEqual(loans.map(l=>[l.id,l.cantidad]),[['sacacorchos',1],['batas',2],['cenicero',null]]);
 assert.equal(V.loanSummary(loans).total,3);assert.equal(V.loanSummary(loans).unknown,1);
 assert.equal(V.detectLoans(['No se prestaron batas; sin préstamos; vasos limpios']).length,0);
 assert.equal(V.detectLoans([]).length,0,'No hay una lista fija de artículos prestados');
 assert.equal(V.detectLoans(['2 batas','3 batas'])[0].cantidad,null);
});
test('los ajustes manuales y descartes prevalecen aunque se relean las notas',()=>{
 const manual={cenicero:{id:'cenicero',label:'Cenicero',area:'cocina',cantidad:1,devueltos:1,origen:'manual'},batas:{id:'batas',label:'Batas',area:'bano',cantidad:3,devueltos:2,origen:'notas'},sacacorchos:{descartado:true}};
 const loans=V.loansFor(['2 batas y un sacacorcho'],manual);
 assert.equal(loans.length,2);assert.equal(loans.find(l=>l.id==='batas').cantidad,3);assert.equal(loans.find(l=>l.id==='batas').devueltos,2);assert.equal(loans.find(l=>l.id==='cenicero').origen,'manual');
 assert.equal(V.loansFor([],manual).find(l=>l.id==='batas').cantidad,3,'Un préstamo ajustado se conserva si se retira la nota');
});
test('el mensaje incluye cantidades de amenities y excluye observaciones y préstamos',()=>{
 const text=V.housekeepingMessage(3,{reposiciones:{te:3,cafe:2,champu:2,jabon:1,balsamo:2,lena:1},observaciones:{a:{texto:'Mantención privada'}}});
 assert.equal(text,'CAB 3 · Reponer\nCocina: Té × 3 · Café × 2\nBaño: Champú × 2 · Jabón × 1 · Bálsamo × 2\nLiving: Leña');
 assert.equal(V.replenishmentLabel('amenities',{champu:2,jabon:1,balsamo:2}),'Amenities · 5 un.');
 assert.equal(V.selectedSupply('amenities',{}),false);
});
test('valida cantidades enteras, áreas y límites en ambos clientes',()=>{
 for(const q of [-1,100,2.5,'2',null])assert.throws(()=>V.validateMutation('reposicion',{items:{cafe:q}}));
 assert.throws(()=>V.validateMutation('reposicion',{items:{aceite:2}}));
 assert.doesNotThrow(()=>V.validateMutation('reposicion',{items:{champu:2,jabon:1,balsamo:0}}));
 assert.throws(()=>V.validateMutation('prestamo',{id:'constructor',cantidad:1,label:'x',area:'cocina',origen:'manual'}));
 assert.throws(()=>V.validateMutation('devolucion',{id:'batas',label:'Batas',area:'bano',cantidad:3,total:2,origen:'manual'}));
});
test('recibe cambios en tiempo real sin volver a consultar la operación',async()=>{
 const t={day:'2026-11-05',cabinId:'cab3',stayId:'stay3'};let reads=0;
 const store=createCheckoutStore({day:t.day,isCurrent:()=>true,read:async()=>{reads++;return{fecha:t.day,puede_editar:true,revisiones:[]};},write:async()=>{throw Error('No debe escribir');}});
 await store.ensure();
 const r={fecha_operativa:t.day,cabana_id:t.cabinId,estadia_id:t.stayId,hora_out:null,hora_out_definida:false,encargado:'Felipe',chequeados:['cocina'],recuperados:[],revision:2,reposiciones:{cafe:2},observaciones:{}};
 assert.equal(store.receive(r),true);assert.equal(store.receiveLoans({estadia_id:t.stayId,items:{batas:{cantidad:2,devueltos:1}},revision:3}),true);
 assert.equal(store.view(t).reposiciones.cafe,2);assert.equal(store.view(t).prestamos.batas.devueltos,1);assert.equal(reads,1);
 assert.equal(store.receive({...r,fecha_operativa:'2026-11-06'}),false);store.dispose();assert.equal(store.receive({...r,revision:3}),false);
});
test('coalesce las lecturas simultáneas y conserva los cambios por insumo',async()=>{
 const t={day:'2026-11-05',cabinId:'cab3',stayId:'stay3'};let resolve,reads=0;
 let row={fecha_operativa:t.day,cabana_id:t.cabinId,estadia_id:t.stayId,hora_out:'12:35',hora_out_definida:true,encargado:'Felipe',chequeados:[],recuperados:[],revision:1,reposiciones:{},observaciones:{}};
 const store=createCheckoutStore({day:t.day,isCurrent:()=>true,read:()=>{reads++;return new Promise(r=>{resolve=r;});},write:async(_,field,value)=>{row={...V.patchWorkflow(row,field,value),revision:row.revision+1};return row;}});
 const first=store.ensure(),second=store.refresh(),third=store.ensure();assert.equal(reads,1);resolve({fecha:t.day,puede_editar:true,revisiones:[row]});await Promise.all([first,second,third]);
 await Promise.all([store.set(t,'reposicion',{items:{cafe:2}}),store.set(t,'reposicion',{items:{te:3}})]);
 assert.deepEqual(store.view(t).reposiciones,{cafe:2,te:3});assert.equal(store.view(t).hora_out,'12:35');assert.equal(store.view(t).encargado,'Felipe');
 await store.set(t,'reposicion',{items:{cafe:0}});assert.equal(V.selectedSupply('cafe',store.view(t).reposiciones),false);assert.equal(store.view(t).reposiciones.te,3);
});
