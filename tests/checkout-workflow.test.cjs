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
test('el mensaje de WhatsApp presenta ítems con punto medio, cantidades y uso por área',()=>{
 const text=V.housekeepingMessage(3,{reposiciones:{te:3,cafe:2,champu:2,jabon:1,balsamo:2,lena:1,diario:1,carbon:1},observaciones:{a:{texto:'Mantención privada'}}});
 assert.equal(text,'CAB 3 · Checked Out · Reponer\n\n*🍳 COCINA*\nTé x3 · Café x2\n\n*🚿 BAÑO*\nChampú x2 · Jabón x1 · Bálsamo x2\n\n*🛏️ LIVING/CAMA*\nNo usaron Salamandra · Reponer leña · Reponer diario\n\n*🌄 TERRAZA*\nNo usaron Fogón · Carbón');
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

test('reúne préstamos y notas al final, sin suministros retirados ni descartes',()=>{
 const row={chequeados:['uso_salamandra','uso_fogon'],reposiciones:{jabon_liquido:1,papel_higienico:1},detalles:{cocina:{texto:'Falta una copa',foto_path:null},living:{texto:'Sábana manchada',foto_path:'evidencia'}},notas_prestamos:['Un sacacorcho'],prestamos:{batas:{id:'batas',label:'Batas',area:'bano',cantidad:2,devueltos:2},cenicero:{descartado:true}}};
 const text=V.housekeepingMessage(10,row);
 assert.equal(text,'CAB 10 · Checked Out · Reponer\n\n*🛏️ LIVING/CAMA*\nUsaron Salamandra\n\n*🌄 TERRAZA*\nUsaron Fogón\n\n*🤝 Prestados:*\n- Sacacorcho\n- Batas x2\n\n*📝 Nota:*\nCocina: Falta una copa\nLiving: Sábana manchada\n  📷 Foto en Haku.');
 assert.doesNotMatch(text,/Jabón liq|P.H.|Cenicero|evidencia/);
 const noteOnly=V.housekeepingMessage(10,{detalles:{bano:{texto:'Revisar toallas',foto_path:null}}});
 assert.match(noteOnly,/\*📝 Nota:\*\nBaño: Revisar toallas$/);assert.doesNotMatch(noteOnly,/\*🚿 BAÑO\*|Prestados/);
});
test('mantención agrupa exclusivamente sus observaciones y señala evidencia sin exponer URLs',()=>{
 const text=V.maintenanceMessage(10,{observaciones:{a:{tipo:'dano',area:'terraza',texto:'Daño excluido'},b:{tipo:'mantencion',area:'bano',texto:'Llave de ducha suelta',foto_path:'privada'},c:{tipo:'mantencion',area:null,texto:'Revisar acceso'}}});
 assert.equal(text,'@Mantención\n\nCAB 10 · Mantención\n\n*🚿 BAÑO*\n- Llave de ducha suelta\n- Evidencia fotográfica registrada en Haku.\n\n*OBSERVACIONES*\n- Revisar acceso');assert.doesNotMatch(text,/Daño excluido|privada/);
});
test('detalles conservan la última palabra ante ACK atrasado, fallo y reintento sin releer',async()=>{
 const t={day:'2026-11-05',cabinId:'cab3',stayId:'stay3'};let release,fail=false,reads=0;
 let row={fecha_operativa:t.day,cabana_id:t.cabinId,estadia_id:t.stayId,hora_out:null,hora_out_definida:false,encargado:'',chequeados:[],recuperados:[],revision:1,detalles:{}};
 const writes=[];const store=createCheckoutStore({day:t.day,isCurrent:()=>true,read:async()=>{reads++;return{fecha:t.day,puede_editar:true,revisiones:[row]};},write:async(_,field,value)=>{writes.push(value.texto);if(writes.length===1)await new Promise(r=>{release=r;});if(fail)throw Error('Sin conexión');row={...V.patchWorkflow(row,field,value),revision:row.revision+1};return row;}});
 await store.ensure();store.editDetail(t,'living','Sábana');const first=store.flushDetails(t);await new Promise(r=>setImmediate(r));store.editDetail(t,'living','Sábana manchada');release();await first;
 assert.equal(store.view(t).detalles.living.texto,'Sábana manchada');assert.deepEqual(writes,['Sábana','Sábana manchada']);
 fail=true;store.editDetail(t,'bano','Última palabra');await assert.rejects(store.flushDetails(t),/Sin conexión/);assert.equal(store.view(t).detalles.bano.texto,'Última palabra');
 fail=false;await store.flushDetails(t);assert.match(V.housekeepingMessage(3,store.view(t)),/Baño: Última palabra/);assert.equal(reads,1);assert.equal(store.saving(t),false);
 store.receive({...row,revision:row.revision+1,detalles:{...row.detalles,cocina:{texto:'Foto ajena preservada',foto_path:null}}});assert.equal(store.view(t).detalles.cocina.texto,'Foto ajena preservada');store.dispose();
});

test('el mensaje presenta las áreas primero y un único bloque final de prestados y nota',()=>{
 const row={reposiciones:{sal:1,te:4,champu:1},detalles:{cocina:{texto:'Falta 1 copa flauta.\r\nRevisar antes del ingreso.',foto_path:null},bano:{texto:'Secador no funciona',foto_path:null},terraza:{texto:'Ordenar canasta',foto_path:null}}};
 const loans=[{id:'sacacorchos',label:'Sacacorcho',area:'cocina',cantidad:1,devueltos:1},{id:'batas',label:'Batas',area:'bano',cantidad:2,devueltos:2},{id:'asado',label:'Asado',area:'terraza',cantidad:null,devueltos:0},{id:'cenicero',label:'Cenicero',area:'cocina',cantidad:1,descartado:true}];
 const text=V.housekeepingMessage(10,row,loans);
 assert.equal(text,'CAB 10 · Checked Out · Reponer\n\n*🍳 COCINA*\nSal · Té x4\n\n*🚿 BAÑO*\nChampú x1\n\n*🛏️ LIVING/CAMA*\nNo usaron Salamandra\n\n*🌄 TERRAZA*\nNo usaron Fogón\n\n*🤝 Prestados:*\n- Sacacorcho\n- Batas x2\n- Asado\n\n*📝 Nota:*\nCocina: Falta 1 copa flauta.\n  Revisar antes del ingreso.\nBaño: Secador no funciona\nTerraza: Ordenar canasta');
 assert.equal(text.split('*🤝 Prestados:*').length,2);assert.equal(text.split('*📝 Nota:*').length,2);assert.doesNotMatch(text,/Detalle:|Artículos prestados:|Cenicero/);
 const photoOnly=V.housekeepingMessage(10,{detalles:{bano:{texto:'',foto_path:'privada'}}});
 assert.match(photoOnly,/\*📝 Nota:\*\nBaño: 📷 Foto en Haku[.]$/);assert.doesNotMatch(photoOnly,/privada|\*🚿 BAÑO\*/);
});

test('dotación por cabaña y nota automática reversible sin modificar notas humanas',()=>{
 assert.deepEqual(Array.from({length:11},(_,i)=>V.inventoryExpected(i+1)),[3,3,3,3,3,3,5,5,5,2,4]);
 assert.equal(V.inventoryExpected(12),null);assert.equal(V.inventoryExpected(7.5),null);
 let row={chequeados:[],detalles:{cocina:{texto:'Revisar el refri.',foto_path:'foto'}},conteos:{}};
 const human=row.detalles;
 for(const id of ['copas_flauta','copas_vino','cucharas_chicas'])row=V.patchWorkflow(row,'conteo',{id,encontrados:2,esperados:3});
 assert.equal(V.inventoryNote(row),'Faltan 1 copa flauta, 1 copa de vino y 1 cuchara chica.');
 assert.strictEqual(row.detalles,human);assert.match(V.housekeepingMessage(1,row),/Cocina: Faltan.*\n  Revisar el refri[.]\n  📷 Foto en Haku[.]/);
 row=V.patchWorkflow(row,'conteo',{id:'copas_vino',encontrados:0,esperados:3});assert.match(V.inventoryNote(row),/3 copas de vino/);
 row=V.patchWorkflow(row,'conteo',{id:'copas_vino',encontrados:3,esperados:3});assert.doesNotMatch(V.inventoryNote(row),/vino/);
 row=V.patchWorkflow(row,'conteo',{id:'copas_flauta',encontrados:null});
 row=V.patchWorkflow(row,'conteo',{id:'cucharas_chicas',encontrados:4,esperados:3});assert.equal(V.inventoryNote(row),'');assert.strictEqual(row.detalles,human);
});
test('una diferencia registrada cuenta como revisada; no convierte checks antiguos en comprobaciones',()=>{
 let row={chequeados:['cocina','bano','living','terraza'],conteos:{}};
 assert.equal(V.sectorProgress(row,'bano').legacy,true);
 row=V.patchWorkflow(row,'punto',{id:'bano_secador',checked:true});assert.equal(V.sectorProgress(row,'bano').checked,1);assert.equal(V.sectorProgress(row,'bano').complete,false);
 for(const point of V.points)row=V.patchWorkflow(row,'punto',{id:point.id,checked:true});
 assert.equal(V.sectorProgress(row,'cocina').complete,false);
 for(const item of V.inventory)row=V.patchWorkflow(row,'conteo',{id:item.id,encontrados:2,esperados:3});
 assert.equal(V.sectorProgress(row,'cocina').complete,true);assert.equal(V.sectorProgress(row,'cocina').missing,9);
 row=V.patchWorkflow(row,'punto',{id:'bano_secador',checked:false});assert.equal(V.sectorProgress(row,'bano').complete,false);assert.ok(!row.chequeados.includes('bano'));
 for(const value of [{id:'x',encontrados:1,esperados:3},{id:'vasos',encontrados:-1,esperados:3},{id:'vasos',encontrados:'2',esperados:3},{id:'vasos',encontrados:0}])assert.throws(()=>V.validateMutation('conteo',value));
});
test('conteos optimistas conservan notas, aíslan estadías y vuelven al valor guardado si falla',async()=>{
 const t={day:'2026-11-09',cabinId:'cab1',stayId:'stay1'};let reads=0,release,fail=false;
 let row={fecha_operativa:t.day,cabana_id:t.cabinId,estadia_id:t.stayId,hora_out:null,hora_out_definida:false,encargado:'',chequeados:[],recuperados:[],revision:1,detalles:{cocina:{texto:'Nota humana',foto_path:null}}};
 const store=createCheckoutStore({day:t.day,isCurrent:()=>true,read:async()=>{reads++;return{fecha:t.day,puede_editar:true,revisiones:[row]};},write:async(_,field,value)=>{if(release===undefined)await new Promise(r=>{release=r;});if(fail)throw Error('Sin conexión');row={...V.patchWorkflow(row,field,value),revision:row.revision+1};return row;}});
 await store.ensure();const first=store.set(t,'conteo',{id:'copas_vino',encontrados:2,esperados:3});assert.equal(V.inventoryNote(store.view(t)),'Falta 1 copa de vino.');
 assert.equal(V.inventoryNote(store.view({...t,stayId:'stay2'})),'');await new Promise(r=>setImmediate(r));
 const second=store.set(t,'conteo',{id:'copas_vino',encontrados:3,esperados:3});release();await Promise.all([first,second]);await store.flush(t);assert.equal(V.inventoryNote(store.view(t)),'');
 fail=true;await assert.rejects(store.set(t,'conteo',{id:'copas_vino',encontrados:0,esperados:3}),/Sin conexión/);assert.equal(store.view(t).conteos.copas_vino.encontrados,3);await assert.rejects(store.flush(t),/Sin conexión/);
 fail=false;await store.set(t,'conteo',{id:'copas_vino',encontrados:2,esperados:3});await store.flush(t);assert.equal(store.view(t).detalles.cocina.texto,'Nota humana');assert.equal(reads,1);store.dispose();
});
