const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const S = require('../js/haiku-libro-semantica-v1.js');
const { entorno, consulta } = require('./fixtures/libro-servicio-manual.cjs');
const TINAJA = 'TINAJA TONEL 1 HORA PARA EL VIERNES. 23/10 A LAS 19:15 HRS';
const MASAJE = '1 MASAJE DE 1 HORA DESCONTRACTURANTE PARA EL 24/10 A LAS 11 AM SÁB 24/10 CON MÓNICA';
const INICIO = 'Rocio Leal // 2 ADL // 2 NOCHES // FC // ';
const FIN = ' // dejar batas en cab';
const run = (texto, color='FFFFFF00') => ({texto,font:{color:{rgb:color}}});
function hoja(runs, estilo={}, valor=runs.map(r=>r.texto).join('')) {
    return { estilos:[{font:{color:{rgb:'FF000000'}},fill:{fgColor:{rgb:'FFB4A7D6'}},...estilo}],
        celdas:[
            {r:1,c:2,valor:'23 oct',fechaISO:'2026-10-23'},
            {r:1,c:6,valor:'24 oct',fechaISO:'2026-10-24'},
            {r:1,c:10,valor:'25 oct',fechaISO:'2026-10-25'},
            {r:6,c:0,valor:'cabaña 5'}, {r:6,c:2,valor,estiloId:0,runs},
            {r:24,c:2,valor:'Pagos de arriendos de hoy'}
        ],combinaciones:[{s:{r:6,c:2},e:{r:6,c:8}}] };
}
const leer = data => S.normalizarHoja(data,'Oct26').reservas[0];
const tinaja = r => r.servicios.find(s=>s.concepto==='tonel');
function casoRocio() {
    return hoja([run(INICIO,'FF000000'),run(MASAJE+' // '+TINAJA),run(FIN,'FFFF0000')]);
}
function conectar(e, r) {
    e.state.reservas=[r];
    e.state.db.reservas=[{...e.state.db.reservas[0],titular_nombre:r.titular}];
    e.state.db.reserva_estadias=[{...e.state.db.reserva_estadias[0],fecha_ingreso:r.fecha_checkin,
        fecha_salida:r.fecha_checkout,tipo_estadia:r.tipo_estadia}];
    e.state.db.cabanas=[{...e.state.db.cabanas[0],numero:r.cabana}];
    e.c.haikuTienePermiso=p=>p==='pagos.ver';
    return e;
}

test('Rocio: el amarillo de la glosa de tinaja llega desde el XLSX al cobro, sin perder fecha ni hora',()=>{
    const raw=casoRocio(),before=JSON.stringify(raw),r=leer(raw),s=tinaja(r);
    assert.equal(s.intencion_cobro,'cobrable');
    assert.equal(s.pendiente,true);assert.equal(s.cortesia,false);assert.equal(s.monto,null);
    assert.equal(s.texto_original,TINAJA);assert.equal(s.hora,'19:15');assert.equal(s.cantidad,1);
    assert.equal(s.unidad_servicio.intencion_financiera,'COBRABLE');
    const evidencia=s.evidencia_origen.cobro_color;
    assert.equal(evidencia.regla,'LETRA_AMARILLA_COBRABLE');assert.equal(evidencia.color,'FFFF00');
    assert.equal(evidencia.origen.hoja,'Oct26');assert.equal(evidencia.origen.celda,'C7');
    assert.equal(r.texto_original.slice(evidencia.inicio,evidencia.fin),TINAJA);
    assert.equal(r.servicios.length,2,'la nota de batas no se convierte en servicio');
    assert.equal(JSON.stringify(raw),before,'ninguna mutación del XLSX original');
});

test('Rocio: tono amarillo prepara la tinaja normal y no solicita nuevamente el tipo de cobro',async()=>{
    const r=leer(casoRocio()),e=conectar(entorno(),r),before=JSON.stringify(r);
    const plan=await e.construir(),i=plan.items.find(i=>i.servicio?.concepto==='tonel');
    assert.equal(i.estado,'listo');assert.equal(i.payload.tipo_cobro,'normal');
    assert.equal(i.payload.codigo_servicio,'tinajaTonel');assert.equal(i.payload.precio_manual,null);
    assert.equal(i.fecha,'2026-10-23');assert.equal(i.hora,'19:15');
    assert.ok(i.inferencias.some(s=>s.includes('letra amarilla')));
    assert.ok(!i.razones.some(s=>s.includes('cobrable o cortesía')));
    const out=new e.Element('div');e.document.card=out;e.api.renderizar(plan,out,consulta);
    const fila=out.querySelectorAll('.haku-libro-servicios__item').find(f=>f.textContent.includes(TINAJA));
    assert.match(fila.textContent,/cobrable/);
    assert.doesNotMatch(fila.textContent,/Falta definir si el servicio es cobrable/);
    assert.equal(JSON.stringify(r),before);assert.equal(e.state.escrituras.length,0);
});

for(const rgb of ['FFFFFF00','FFFF00','ffffff00'])test('Color de letra RGB/ARGB amarillo: '+rgb,()=>{
    const s=tinaja(leer(hoja([run(INICIO,'FF000000'),run(TINAJA,rgb)])));
    assert.equal(s.intencion_cobro,'cobrable');
});
for(const indexed of [5,13])test('Amarillo de la paleta indexada: '+indexed,()=>{
    const r=hoja([run(INICIO,'FF000000'),{texto:TINAJA,font:{color:{indexed}}}]);
    assert.equal(tinaja(leer(r)).intencion_cobro,'cobrable');
});
test('Color heredado del estilo de fuente y celda sin rich text se reconoce, no depende del relleno',()=>{
    const raw=hoja([],{font:{color:{rgb:'FFFFFF00'}}},INICIO+TINAJA);
    assert.equal(tinaja(leer(raw)).intencion_cobro,'cobrable');
    raw.celdas.find(c=>c.estiloId===0).runs=[{texto:INICIO+TINAJA,font:null}];
    assert.equal(tinaja(leer(raw)).intencion_cobro,'cobrable');
});
test('Cambios de negrita o de tramo no interrumpen una misma glosa amarilla',()=>{
    const runs=[run(INICIO,'FF000000'),...Array.from(TINAJA,c=>run(c))];
    assert.equal(tinaja(leer(hoja(runs))).intencion_cobro,'cobrable');
});
test('El masaje amarillo no contagia una tinaja negra de la misma celda',()=>{
    const r=leer(hoja([run(INICIO,'FF000000'),run(MASAJE+' // '),run(TINAJA,'FF000000')]));
    assert.equal(tinaja(r).intencion_cobro,'no_determinada');
    assert.equal(r.servicios.find(s=>s.concepto==='masaje').intencion_cobro,'cobrable');
});
test('Sólo nombre, fecha o espacios amarillos no convierten el servicio negro en cobrable',()=>{
    for(const runs of [
        [run(INICIO),run(TINAJA,'FF000000')],
        [run(INICIO,'FF000000'),run(TINAJA.slice(0,-9),'FF000000'),run(TINAJA.slice(-9))],
        [run(INICIO,'FF000000'),run('   '),run(TINAJA,'FF000000')]
    ])assert.equal(tinaja(leer(hoja(runs))).intencion_cobro,'no_determinada');
});
test('Dos glosas idénticas con distinto color conservan su ubicación: no copiar color de otra ocurrencia',()=>{
    const r=leer(hoja([run(INICIO,'FF000000'),run(TINAJA),run(' // ','FF000000'),run(TINAJA,'FF000000')]));
    assert.equal(r.servicios.length,2);assert.equal(r.servicios[0].intencion_cobro,'cobrable');
    assert.equal(r.servicios[1].intencion_cobro,'no_determinada');
});
for(const color of [{rgb:'FFFF0000'},{rgb:'FFFFFFFF'},{rgb:'FF000000'},{theme:4},{auto:true},{rgb:'FFFFFF00',tint:0.5}])
    test('Una fuente no amarilla o no resuelta no se adivina: '+JSON.stringify(color),()=>{
        const r=leer(hoja([run(INICIO,'FF000000'),{texto:TINAJA,font:{color}}]));
        assert.equal(tinaja(r).intencion_cobro,'no_determinada');
    });
test('Fondo amarillo NO equivale a letra amarilla',()=>{
    const r=leer(hoja([run(INICIO+TINAJA,'FF000000')],{fill:{fgColor:{rgb:'FFFFFF00'}}}));
    assert.equal(tinaja(r).intencion_cobro,'no_determinada');
});
test('Formato ajeno, incompleto o sin correspondencia exacta no establece un cobro',()=>{
    const r=leer(hoja([run('OTRO TEXTO')],{},INICIO+TINAJA));
    assert.equal(tinaja(r).intencion_cobro,'no_determinada');
    assert.equal(S.servicios(TINAJA,{origen_campo:'notas_reserva'})[0].intencion_cobro,'no_determinada');
});
test('Cortesía explícita o cobro/cortesía contradictorios no se sobreescriben por color',()=>{
    for(const [txt,tipo] of [[TINAJA+' CORTESÍA','cortesia'],[TINAJA+' CORTESÍA X PAGAR','no_determinada']]){
        const s=tinaja(leer(hoja([run(INICIO,'FF000000'),run(txt)])));
        assert.equal(s.intencion_cobro,tipo);assert.equal(s.evidencia_origen.cobro_color,undefined);
    }
});
test('Nota/consulta/cancelación/pendiente de coordinar no se convierten en prestaciones por ser amarillas',()=>{
    for(const t of ['dejar batas en cab','consultó por tinaja tonel','no confirmó tinaja tonel',
        'tinaja tonel por coordinar','tinaja tonel por confirmar']){
        assert.equal(leer(hoja([run(INICIO,'FF000000'),run(t)])).servicios.length,0,t);
    }
});
for(const [aplicado,saldo,estado] of [[0,30000,'pendiente'],[10000,20000,'parcial'],[30000,0,'pagado']])
    test('Amarillo no vuelve a crear ni cobrar una tinaja ya registrada: '+estado,async()=>{
        const e=conectar(entorno(),leer(casoRocio())),est=e.state.db.reserva_estadias[0];
        const s={id:'tinaja-existente',reserva_id:est.reserva_id,estadia_id:est.id,
            fecha_servicio:'2026-10-23',hora_inicio:'19:15:00',hora_fin:'20:15:00',
            cantidad:1,personas:2,tipo_cobro:'normal',total:30000,estado_servicio:'programado',
            catalogo_servicios:{codigo:'tinajaTonel',nombre:'Tinaja Tonel de Madera'}};
        e.state.db.servicios=[s];e.state.db.vista_estado_cargos=[{cargo_id:'cargo-tinaja',reserva_id:s.reserva_id,
            estadia_id:s.estadia_id,servicio_id:s.id,monto:30000,monto_ajustado:30000,
            aplicado_neto:aplicado,saldo_cargo:saldo,estado:'activo'}];
        const i=(await e.construir()).items.find(i=>i.servicio?.concepto==='tonel');
        assert.equal(i.estado,'existente');assert.equal(i.payload,null);
        assert.equal(i.finanzas_existente.estado,estado);assert.equal(i.finanzas_existente.saldo,saldo);
        assert.equal(e.state.escrituras.length,0);assert.equal(e.state.db.servicios.length,1);
    });
test('Cambiar sólo la letra en el XLSX actualiza el cobro en la siguiente lectura, sin editar su texto',()=>{
    const raw=hoja([run(INICIO,'FF000000'),run(TINAJA,'FF000000')]);
    assert.equal(tinaja(leer(raw)).intencion_cobro,'no_determinada');
    raw.celdas.find(c=>c.estiloId===0).runs[1].font.color.rgb='FFFFFF00';
    assert.equal(tinaja(leer(raw)).intencion_cobro,'cobrable');
    raw.celdas.find(c=>c.estiloId===0).runs[1].font.color.rgb='FF000000';
    assert.equal(tinaja(leer(raw)).intencion_cobro,'no_determinada');
});
test('La letra amarilla procede del parser OOXML canónico de rich text, sin usar captura ni OCR',()=>{
    const context={self:{addEventListener(){}},Map,Date,TextDecoder};vm.createContext(context);
    vm.runInContext(fs.readFileSync('js/supabase-libro-reserva-worker-v1.js','utf8'),context);
    const runs=context.self.parsearTextoEnriquecido('<r><rPr><color rgb="FFFFFF00"/></rPr><t>TINAJA TONEL 1 HORA</t></r>');
    const t='TINAJA TONEL 1 HORA';const parsed=leer(hoja([run(INICIO,'FF000000'),...JSON.parse(JSON.stringify(runs))]));
    assert.equal(tinaja(parsed).texto_original,t);assert.equal(tinaja(parsed).intencion_cobro,'cobrable');
});
