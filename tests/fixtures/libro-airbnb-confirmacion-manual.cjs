const fs = require('node:fs');
const vm = require('node:vm');
global.HAIKU_LIBRO_SEMANTICA = require('../../js/haiku-libro-semantica-v1.js');
global.HAIKU_LIBRO_PAGOS_DESTINOS_V1 = require('../../js/haiku-libro-pagos-destinos-v1.js');
const canonContext = {structuredClone,console:{info(){}},
    document:{readyState:'complete',getElementById:()=>null,createElement:()=>({}),head:{appendChild(){}}},
    HAIKU_LIBRO_RESERVA_V1:{consultarHoja:async data=>data}};
vm.runInNewContext(fs.readFileSync(require.resolve('../../js/haiku-libro-pagos-canon-v1.js'),'utf8'),canonContext);
global.HAIKU_LIBRO_PAGOS_CANON_V1 = canonContext.HAIKU_LIBRO_PAGOS_CANON_V1;
require('../../js/haiku-libro-consultas-v1.js');

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const AVISO = ['El viajero ha pagado ...','Comisión de servicio del viajero ...',
    'Impuesto sobre el uso de la propiedad ...','Precio de la habitación ...',
    'Comisión de servicio del anfitrión ...','Ganás ...'].join('\n');
const ACCION = {tipo:'confirmacion_airbnb',fecha:'2026-10-12',confirmacionRecibida:true};
function entorno({reservaId=id(1),estadiaId=id(2),pagoExtra={},reservaExtra={}}={}) {
    const root = globalThis, Q = root.HAIKU_LIBRO_CONSULTAS;
    let generacion=1,version='a'.repeat(64),usuario=id(90);
    const permisos = new Set(['pagos.registrar','reservas.editar','pagos.verificar']);
    root.HAIKU_LIBRO_RESERVA_V1={estado:()=>({generacion,version,cargado:true,nombre:'Libro.xlsx'})};
    root.haikuTienePermiso = permiso => permisos.has(permiso);
    const p={titular:'Agustin Rampa Spinelli',cabana:4,monto:165598,moneda:'CLP',medio_pago:'airbnb_prepaid_card',
        fecha_bloque:'2026-10-06',fecha_comprobante:null,tipo_movimiento:'alojamiento',concepto:'cab4/1noche',
        pago_recibido:true,estado_pago:'registrado_en_libro',clasificacion_financiera:'dudoso',
        texto_original:'Agustin Rampa Spinelli // '+AVISO,origen:{hoja:'Oct26',celda:'O27:R27'},...pagoExtra};
    const r={id:'Oct26!O3',titular:p.titular,cabana:4,fecha_checkin:'2026-10-06',fecha_checkout:'2026-10-07',
        tipo_estadia:'alojamiento',noches:1,adultos:2,ninos:0,mascotas:0,estado_operativo:'sin_checkin',
        rut_documento:'11111111-1',pagos:[p],pagos_sin_asociacion:[],servicios:[],advertencias:[],
        coordenadas_origen:{hoja:'Oct26',celda:'O3'},...reservaExtra};
    const estancia={id:estadiaId,reserva_id:reservaId,fecha_ingreso:r.fecha_checkin,fecha_salida:r.fecha_checkout,
        tipo_estadia:r.tipo_estadia,estado_estadia:'confirmada',adultos:2,ninos:0,mascotas:0,cabanas:{numero:4},
        reservas:{id:reservaId,titular_nombre:r.titular,titular_numero_documento:r.rut_documento,estado_reserva:'confirmada'}};
    const tablas={reserva_estadias:[estancia],pagos:[],servicios:[],vista_estado_cargos:[],pago_aplicaciones:[]};
    const llamadas=[],opciones={},operaciones=new Map();
    const db={auth:{getSession:async()=>({data:{session:{user:{id:usuario}}}})},from(tabla){
        let filtros=[];
        const b={select(){return b},eq(c,v){filtros.push(x=>x[c]===v);return b},
            in(c,vs){filtros.push(x=>vs.includes(x[c]));return b},lte(){return b},gte(){return b},order(){return b},
            async range(a,z){llamadas.push({tabla});await opciones.antesLectura?.(tabla);
                return {data:structuredClone((tablas[tabla]||[]).filter(x=>filtros.every(f=>f(x))).slice(a,z+1))};}};
        return b;
    },async rpc(nombre,args){
        llamadas.push({nombre,args});
        if (opciones.escritor) return opciones.escritor(nombre,args);
        if (nombre!=='haiku_incorporar_libro_v1') throw Error('RPC inesperado: '+nombre);
        if (operaciones.has(args.p_operacion_id)) return {data:operaciones.get(args.p_operacion_id)};
        const resultados=[],omitidos=[];
        for(const item of args.p_items) {
            if(item.tipo!=='pago') throw Error('Sólo se prueba el pago Airbnb');
            const existente=tablas.pagos.find(p=>p.datos_origen?.item_id===item.item_id);
            if(existente) {omitidos.push({item_id:item.item_id,pago_id:existente.id});continue;}
            const a=item.argumentos,pago={id:id(100+tablas.pagos.length),reserva_id:item.reserva_id,
                monto:a.p_monto,moneda:'CLP',medio_pago:a.p_medio_pago,fecha_pago:a.p_fecha_pago,
                referencia_externa:a.p_referencia_externa,folio:a.p_folio,bove:a.p_bove,
                codigo_autorizacion:a.p_codigo_autorizacion,estado:'confirmado',tipo_movimiento:'pago',
                datos_origen:{...structuredClone(item.datos_origen),item_id:item.item_id}};
            tablas.pagos.push(pago);resultados.push({item_id:item.item_id,tipo:'pago',pago_id:pago.id,reserva_id:item.reserva_id});
        }
        const data={ok:true,pagos_creados:resultados.length,resultados,omitidos:omitidos.length,omitidos_detalle:omitidos};
        operaciones.set(args.p_operacion_id,data);return {data};
    }};
    const result={reservas:[r],generacion:1,q:{desde:r.fecha_checkin,hasta:r.fecha_checkout}};
    const decisiones=new Map(),aprobados=new Set();
    return {Q,r,p,db,tablas,llamadas,opciones,result,decisiones,aprobados,permisos,
        cambiarLibro(){generacion++},cambiarVersion(){version='b'.repeat(64)},cambiarUsuario(){usuario=id(91)},
        preparar:()=>Q.prepararIncorporacion(result,decisiones,aprobados,db),
        resolver:(plan,item,accion=ACCION)=>Q.resolverAprobacionManualPago(result,decisiones,aprobados,plan,item.id,accion,db),
        incorporar:plan=>Q.confirmarIncorporacion(result,decisiones,aprobados,plan,db)};
}
module.exports={entorno,id,ACCION,AVISO};
