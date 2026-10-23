const { entorno, consulta } = require('./libro-servicio-manual.cjs');

// Usable tanto en VM como en navegador. Datos sintéticos, sin Supabase real.
function configurar(color = 'FFFF0000') {
    const w=globalThis,e=w.fixtureServicios,est=e.db.reserva_estadias[0];
    e.leerColor=(nuevo=color,texto='JACUZZI 1 HORA PARA EL VIERNES. 23/10 A LAS 19:15 HRS')=>{
        const prefijo='Cliente de prueba // 2 ADL // 2 NOCHES // FC // ';
        const r=w.HAIKU_LIBRO_SEMANTICA.normalizarHoja({
            estilos:[{font:{color:{rgb:'FF000000'}},fill:{fgColor:{rgb:'FFB4A7D6'}}}],
            celdas:[{r:1,c:2,valor:'23 oct',fechaISO:'2026-10-23'},
                {r:1,c:6,valor:'24 oct',fechaISO:'2026-10-24'},
                {r:1,c:10,valor:'25 oct',fechaISO:'2026-10-25'},
                {r:6,c:0,valor:'cabaña 5'},
                {r:6,c:2,valor:prefijo+texto,estiloId:0,runs:[{texto:prefijo,font:{color:{rgb:'FF000000'}}},
                    {texto,font:{color:typeof nuevo==='string'?{rgb:nuevo}:nuevo}}]},
                {r:24,c:2,valor:'Pagos de arriendos de hoy'}],
            combinaciones:[{s:{r:6,c:2},e:{r:6,c:8}}]
        },'Oct26').reservas[0];
        e.reservas=[r];return r;
    };
    const r=e.leerColor();e.db.reservas[0].titular_nombre=r.titular;
    Object.assign(est,{fecha_ingreso:r.fecha_checkin,fecha_salida:r.fecha_checkout,tipo_estadia:r.tipo_estadia});
    e.db.cabanas[0].numero=r.cabana;
    w.haikuSesion={auth:{id:e.usuario},usuario:{activo:true},roles:[{codigo:'administrador'}]};
    w.haikuTienePermiso=()=>true;
    const c=e.db.catalogo_servicios.find(c=>c.codigo==='tinajaTonel');
    e.db.servicios=[{id:'tinaja-existente',reserva_id:est.reserva_id,estadia_id:est.id,
        catalogo_servicio_id:c.id,recurso_id:null,fecha_servicio:'2026-10-23',
        hora_inicio:'19:15:00',hora_fin:'20:15:00',cantidad:1,personas:2,total:30000,
        precio_unitario_aplicado:30000,monto_adicional:0,tipo_cobro:'normal',estado_servicio:'programado',
        actualizado_en:'2026-10-16T23:09:30Z',observaciones:'Libro: Tonel original',
        catalogo_servicios:{codigo:c.codigo,nombre:c.nombre}}];
    e.db.vista_estado_cargos=[{cargo_id:'cargo',reserva_id:est.reserva_id,estadia_id:est.id,
        servicio_id:'tinaja-existente',monto:30000,monto_ajustado:30000,aplicado_neto:0,saldo_cargo:30000,estado:'activo'}];
    e.revisiones=[];
    const base=w.haikuSupabase.rpc;
    w.haikuSupabase.rpc=async(nombre,p)=>{
        if(nombre!=='haiku_libro_revision_servicio_admin_v1')return base(nombre,p);
        e.revisiones.push(JSON.parse(JSON.stringify(p)));
        const s=e.db.servicios.find(s=>s.id===p.p_servicio_id),estado={...p.p_esperado};delete estado.actualizado_en;
        if(p.p_modo==='actualizar'){
            const c=e.db.catalogo_servicios.find(c=>c.codigo===p.p_codigo);
            Object.assign(s,{catalogo_servicio_id:c.id,catalogo_servicios:{codigo:c.codigo,nombre:c.nombre},
                hora_inicio:p.p_inicio+':00',hora_fin:p.p_fin+':00'});
            Object.assign(estado,{catalogo_servicio_id:c.id,hora_inicio:p.p_inicio,hora_fin:p.p_fin});
        }
        s.libro_revision_admin_v1={version:1,item_id:p.p_item_id,firma:p.p_firma,motivo:p.p_motivo,estado,
            modo:p.p_modo,operacion_id:p.p_operacion_id,fecha:'2026-10-23T23:00:00Z'};
        s.actualizado_en='2026-10-23T23:00:00Z';
        return {data:{ok:true,servicio_id:s.id,total:s.total,revision:s.libro_revision_admin_v1}};
    };
}

function caso(color) {
    const e=entorno(),vm=require('node:vm');
    vm.runInContext(`(${configurar.toString()})(${JSON.stringify(color)})`,e.c);
    const out=new e.Element('div');e.document.card=out;
    return {...e,out,leer:async()=> (await e.construir()).items.find(x=>x.kind==='servicio')};
}
async function abrir(e) {
    e.api.renderizar(await e.construir(),e.out,consulta);
    const b=e.out.querySelectorAll('button').find(b=>b.textContent==='Aprobación manual');
    if(!b)throw Error('Falta aprobación manual');await b.listeners.click();
    const panel=e.out.querySelector('.haku-libro-servicio-manual');
    return {panel,confirmar:panel.querySelectorAll('button').find(b=>b.dataset.hakuAccion==='confirmar-revision-admin'),
        campo:k=>panel.querySelectorAll('input,select').find(x=>x.dataset.revisionAdmin===k)};
}
module.exports={configurar,caso,abrir,consulta};
