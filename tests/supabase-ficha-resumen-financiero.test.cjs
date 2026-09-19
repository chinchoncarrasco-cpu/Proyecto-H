const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const resumenSource = fs.readFileSync(require.resolve('../js/supabase-finanzas-resumen-v1.js'),'utf8');
const fichaSource = fs.readFileSync(require.resolve('../js/supabase-ficha-v2.js'),'utf8');

class Elemento {
    constructor(){this.children=[];this.textContent='';}
    append(...items){this.children.push(...items);}
    appendChild(item){this.children.push(item);return item;}
    set innerHTML(valor){this.children=[];this.textContent=String(valor||'');}
    get innerHTML(){return this.textContent;}
}

function entornoPintores(){
    const ids={};
    for(const id of [
        'ficha-pago-total','ficha-pago-abono','ficha-pago-saldo','ficha-pago-servicios',
        'ficha-servicios-programados','ficha-servicios-realizados','ficha-servicios-pendientes',
        'ficha-servicios-programados-contador','ficha-servicios-realizados-contador','ficha-servicios-pendientes-contador'
    ]) ids[id]=new Elemento();
    const window={};
    const document={getElementById:id=>ids[id]||null,createElement:()=>new Elemento()};
    const context=vm.createContext({window,document,
        dinero:valor=>`$${Number(valor)}`,
        formatearFecha:valor=>String(valor||'')
    });
    vm.runInContext(resumenSource,context);
    const inicio=fichaSource.indexOf('    function pintarPagos');
    const fin=fichaSource.indexOf('    function pintarSolicitudes',inicio);
    vm.runInContext(`${fichaSource.slice(inicio,fin)};globalThis.pintarPagos=pintarPagos;globalThis.pintarServicios=pintarServicios;`,context);
    return {ids,pintarPagos:context.pintarPagos,pintarServicios:context.pintarServicios,resumen:window.HAIKU_FINANZAS_RESUMEN_V1};
}

function cargo(datos){
    return {reserva_id:'r1',estado:'activo',aplicado_neto:0,saldo_cargo:0,...datos};
}

function pago(monto,datos={}){
    return {monto,tipo_movimiento:'pago',estado:'confirmado',...datos};
}

test('Alejandro usa el mismo resumen completo en la barra financiera',()=>{
    const h=entornoPintores();
    const ficha={
        cargos:[
            cargo({servicio_id:null,tipo_cargo:'alojamiento',monto_ajustado:160000,aplicado_neto:160000}),
            cargo({servicio_id:'tinaja-ok',tipo_cargo:'servicio',monto_ajustado:30000,aplicado_neto:30000}),
            cargo({servicio_id:'late-ok',tipo_cargo:'servicio',monto_ajustado:20000,aplicado_neto:20000}),
            cargo({servicio_id:'late-duplicado',tipo_cargo:'servicio',estado:'anulado',monto_ajustado:20000,saldo_cargo:20000})
        ],
        pagos:[pago(160000),pago(50000),pago(99999,{estado:'anulado'})]
    };
    h.pintarPagos(ficha);
    assert.equal(h.ids['ficha-pago-total'].textContent,'$210000');
    assert.equal(h.ids['ficha-pago-abono'].textContent,'$210000');
    assert.equal(h.ids['ficha-pago-saldo'].textContent,'$0');
    assert.equal(h.ids['ficha-pago-servicios'].textContent,'$0');
});

test('la agregación compartida conserva alojamiento solo, servicio pendiente y servicio anulado',()=>{
    const {resumen}=entornoPintores();
    const alojamiento=cargo({tipo_cargo:'alojamiento',monto_ajustado:160000,aplicado_neto:160000});
    assert.deepEqual({...resumen.calcular([alojamiento],[pago(160000)])},{total:160000,abono:160000,saldo:0,servicios:0});
    const pendiente=cargo({tipo_cargo:'servicio',monto_ajustado:50000,saldo_cargo:50000});
    assert.deepEqual({...resumen.calcular([alojamiento,pendiente],[pago(160000)])},{total:210000,abono:160000,saldo:50000,servicios:50000});
    assert.deepEqual({...resumen.calcular([alojamiento,{...pendiente,estado:'anulado'}],[pago(160000)])},{total:160000,abono:160000,saldo:0,servicios:0});
});

test('servicios cancelados o anulados no se renderizan ni cuentan como pendientes',()=>{
    const h=entornoPintores();
    h.pintarServicios({
        servicios:[
            {id:'tinaja-ok',fecha_servicio:'2026-09-05',hora_inicio:'22:15',total:30000,tipo_cobro:'normal',estado_servicio:'realizado',catalogo_servicios:{nombre:'Tinaja Jacuzzi'}},
            {id:'late-ok',fecha_servicio:'2026-09-06',hora_inicio:'14:00',total:20000,tipo_cobro:'normal',estado_servicio:'realizado',catalogo_servicios:{nombre:'Late Check-out'}},
            {id:'late-duplicado',fecha_servicio:'2026-09-05',hora_inicio:'14:00',total:20000,tipo_cobro:'normal',estado_servicio:'cancelado',catalogo_servicios:{nombre:'Late Check-out'}},
            {id:'tinaja-duplicada',fecha_servicio:'2026-09-06',hora_inicio:'14:00',total:30000,tipo_cobro:'normal',estado_servicio:'anulado',catalogo_servicios:{nombre:'Tinaja Jacuzzi'}}
        ],
        cargos:[
            cargo({servicio_id:'tinaja-ok',tipo_cargo:'servicio',monto_ajustado:30000,aplicado_neto:30000}),
            cargo({servicio_id:'late-ok',tipo_cargo:'servicio',monto_ajustado:20000,aplicado_neto:20000}),
            cargo({servicio_id:'late-duplicado',tipo_cargo:'servicio',monto_ajustado:20000,saldo_cargo:20000}),
            cargo({servicio_id:'tinaja-duplicada',tipo_cargo:'servicio',estado:'anulado',monto_ajustado:30000,saldo_cargo:30000})
        ]
    });
    assert.equal(h.ids['ficha-servicios-programados-contador'].textContent,'0');
    assert.equal(h.ids['ficha-servicios-realizados-contador'].textContent,'2');
    assert.equal(h.ids['ficha-servicios-pendientes-contador'].textContent,'0');
    assert.equal(h.ids['ficha-servicios-realizados'].children.length,2);
    assert.equal(h.ids['ficha-servicios-pendientes'].children.length,0);
});

test('el resumen compartido carga antes que la ficha y el modal',()=>{
    const panel=fs.readFileSync(require.resolve('../panel.html'),'utf8');
    const resumen=panel.indexOf("'supabase-finanzas-resumen-v1'");
    assert.ok(resumen>0);
    assert.ok(resumen<panel.indexOf("'supabase-ficha-v2'"));
    assert.ok(resumen<panel.indexOf("'supabase-ficha-atajos'"));
});
