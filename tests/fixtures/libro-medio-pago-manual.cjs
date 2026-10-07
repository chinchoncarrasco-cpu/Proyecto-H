const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname,'../..',file),'utf8');
const S = require('../../js/haiku-libro-semantica-v1.js');
const D = require('../../js/haiku-libro-pagos-destinos-v1.js');
class Element {
    constructor(tag) {this.tag=tag;this.children=[];this.dataset={};this.style={};this.events={};this.textContent='';}
    append(...xs) {this.children.push(...xs);} appendChild(x) {this.append(x);} replaceChildren(...xs) {this.children=xs;}
    addEventListener(k,f) {this.events[k]=f;} setAttribute(k,v) {this[k]=v;} removeAttribute(k) {delete this[k];}
    querySelectorAll(s) {return this.children.flatMap(e=>[e,...e.querySelectorAll('*')]).filter(e=>s==='*'||s===e.tag||s.startsWith('.')&&(e.className||'').split(' ').includes(s.slice(1)));}
    querySelector(s) {return this.querySelectorAll(s)[0]||null;}
}
const api = 'Object.freeze({ interpretar, consultar, compararSistema, respuesta, renderizarVersiones, crearPlanIncorporacion, prepararIncorporacion, serializarIncorporacion, confirmarIncorporacion })';
const consultas = read('js/haiku-libro-consultas-v1.js').replace(api,api.replace(' })',', renderizarItemIncorporacion, renderizarIncorporacion, continuarVistaManualPago, resolucionManualDisponible, contextoVisualPlanes })'));
const source = read('tests/haiku-libro-pagos-aprobacion-manual.test.cjs');
const setup = source.slice(source.indexOf('const id ='),source.indexOf('const itemPago=plan'));
function entorno({alojamiento=true,distribuido=false,conServicios=false,signal='TDC',fuerte=true}={}) {
    const assert=require('node:assert/strict');
    const ctx={structuredClone,console:{info(){}},HAIKU_LIBRO_SEMANTICA:S,HAIKU_LIBRO_PAGOS_DESTINOS_V1:D,
        document:{readyState:'complete',getElementById:()=>null,createElement:t=>new Element(t),head:{appendChild(){}},querySelector:()=>null},
        HAIKU_LIBRO_RESERVA_V1:{consultarHoja:async x=>x},addEventListener(){},assert};
    ctx.global=ctx;
    for(const file of ['haiku-libro-pagos-canon-v1','haiku-libro-lenguaje-natural-v1']) vm.runInNewContext(read('js/'+file+'.js'),ctx);
    vm.runInNewContext(consultas,ctx);
    vm.runInNewContext('const C=HAIKU_LIBRO_PAGOS_CANON_V1,Q=HAIKU_LIBRO_CONSULTAS;'+setup+';globalThis.crear=entorno;',ctx);
    const h=ctx.crear({distribuido,conServicios}), estado=ctx.HAIKU_LIBRO_RESERVA_V1.estado;
    h.version='a'.repeat(64);h.usuario='00000000-0000-4000-8000-000000000090';h.auditoriaDisponible=true;
    ctx.HAIKU_LIBRO_RESERVA_V1={estado:()=>({...estado(),version:h.version})};
    ctx.haikuSupabase=h.db;
    h.db.auth.getSession=async()=>({data:{session:{user:{id:h.usuario}}}});
    const rpc=h.db.rpc.bind(h.db);
    h.db.rpc=async(n,a)=>{
        if(n==='haiku_libro_medio_pago_manual_capacidad_v1') {h.llamadas.push({nombre:n,args:a});return {data:{version:1,auditoria:h.auditoriaDisponible}};}
        if(n==='haiku_incorporar_libro_v1') {h.llamadas.push({nombre:n,args:a});return {data:{ok:true,pagos_creados:a.p_items.length,omitidos:0}};}
        return rpc(n,a);
    };
    const p=h.r.pagos[0];p.medio_pago=null;p.texto_original += ' // '+signal;
    if(alojamiento) {p.tipo_movimiento='alojamiento';p.concepto='cab2/1noche';}
    if(!fuerte) {p.codigo_autorizacion=null;p.folio=null;p.bovtar=null;}
    p.evidencia_financiera={sector:'pagos',columnas_ocupadas:{detalle:true,concepto:true,monto:true,fecha:true}};
    p.clasificacion_financiera=ctx.HAIKU_LIBRO_LENGUAJE_NATURAL_V1.clasificarMovimientoFinanciero(p);
    h.ctx=ctx;h.Q=ctx.HAIKU_LIBRO_CONSULTAS;h.C=ctx.HAIKU_LIBRO_PAGOS_CANON_V1;
    h.item=plan=>plan.items.find(i=>i.pagoLibro);
    h.definir=(plan,medio,extra={})=>h.Q.resolverAprobacionManualPago(h.result,h.decisiones,h.aprobados,plan,h.item(plan).id,{tipo:'definir_medio_pago',medio,...extra},h.db);
    h.render=(plan,item=h.item(plan))=>{
        const aprobar=async id=>{h.aprobados.add(id);};
        aprobar.manualPago=async(p,id,a)=>{h.next=await h.Q.resolverAprobacionManualPago(h.result,h.decisiones,h.aprobados,p,id,a,h.db);};
        return h.Q.renderizarItemIncorporacion(item,new Map(),()=>{},aprobar,h.Q.contextoVisualPlanes.get(plan),plan);
    };
    return h;
}
function agregarCasosAcumulados(h,{servicioB=true,servicioA=false,mismaReserva=false}={}) {
    const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
    const a=h.r,pa=a.pagos[0],ea=h.tablas.reserva_estadias[0];
    a.titular=pa.titular='Kyleigh Laughlan';ea.reservas.titular_nombre=a.titular;
    pa.medio_pago=null;pa.tipo_movimiento=servicioA?'servicio':'alojamiento';pa.concepto=servicioA?'Tinaja Tonel':'cab2/1noche';
    pa.evidencia_financiera={sector:'pagos',columnas_ocupadas:{detalle:true,concepto:true,monto:true,fecha:true}};
    pa.codigo_autorizacion='KYLEIGH30';pa.texto_original='Kyleigh Laughlan // TDC // CodAut KYLEIGH30 // $30.000';
    if(servicioA)h.agregar(3,30000);
    const b=mismaReserva?a:structuredClone(a),pb=structuredClone(pa);
    pb.titular=mismaReserva?a.titular:'Joseph Vargas';pb.cabana=mismaReserva?a.cabana:3;
    pb.codigo_autorizacion='JOSEPH40';pb.monto=40000;pb.tipo_movimiento=servicioB?'servicio':'alojamiento';
    pb.concepto=servicioB?(servicioA&&mismaReserva?'Leña':'Tinaja Tonel'):'cab3/1noche';pb.origen={hoja:'Oct26',celda:'G40:J40'};
    const codigoB=servicioA&&mismaReserva?'lena':'tinajaTonel';
    if(codigoB==='lena')h.tablas.catalogo_servicios.push({id:id(119),codigo:'lena',nombre:'Leña',categoria:'servicio',
        activo:true,unidad:'unidad',precio_base:40000,requiere_horario:false,capacidad_incluida:null,capacidad_maxima:null,precio_persona_adicional:null});
    pb.texto_original=pb.titular+' // PrePago / FC // CodAut JOSEPH40 // $40.000';
    if(mismaReserva)a.pagos.push(pb);
    else {
        b.id='Oct26!G6';b.titular=pb.titular;b.cabana=3;b.rut_documento='22222222-2';
        b.coordenadas_origen={hoja:'Oct26',celda:'G6'};b.pagos=[pb];
        h.result.reservas.push(b);
        const eb=structuredClone(ea);eb.id=id(102);eb.reserva_id=id(101);eb.cabanas.numero=3;
        eb.reservas={...eb.reservas,id:id(101),titular_nombre:b.titular,titular_numero_documento:b.rut_documento};
        h.tablas.reserva_estadias.push(eb);
    }
    const reservaB=mismaReserva?ea.reserva_id:id(101),estadiaB=mismaReserva?ea.id:id(102),rpc=h.db.rpc;
    h.registrados=[];
    h.db.rpc=async(n,args)=>{
        if(n==='haiku_libro_medio_pago_manual_capacidad_v1') {
            h.llamadas.push({nombre:n,args});return {data:{version:1,auditoria:h.auditoriaDisponible!==false}};
        }
        if(['haiku_incorporar_libro_v1','haiku_incorporar_pago_servicios_libro_v1'].includes(n)) {
            h.llamadas.push({nombre:n,args});let creados=0,pagoId;
            for(const i of args.p_items||[args.p_item]) {
                const existente=h.registrados.find(x=>x.item_id===i.item_id);
                if(existente){pagoId=existente.pago_id;continue;}
                pagoId=id(160+h.registrados.length);creados++;
                h.registrados.push({item_id:i.item_id,pago_id:pagoId,item:structuredClone(i)});
                h.tablas.pagos.push({id:pagoId,reserva_id:i.reserva_id,estado:'confirmado',tipo_movimiento:'pago',
                    monto:i.argumentos.p_monto,moneda:'CLP',medio_pago:i.argumentos.p_medio_pago,fecha_pago:i.argumentos.p_fecha_pago,
                    codigo_autorizacion:i.argumentos.p_codigo_autorizacion,folio:i.argumentos.p_folio,
                    datos_origen:structuredClone(i.datos_origen)});
            }
            return {data:{ok:true,pagos_creados:creados,omitidos:(args.p_items||[args.p_item]).length-creados,pago_id:pagoId}};
        }
        if(n!=='haiku_registrar_servicio'||args.p_reserva_id!==reservaB)return rpc(n,args);
        h.llamadas.push({nombre:n,args});
        let s=h.tablas.servicios.find(s=>s.id===id(130));
        if(!s){
            s={id:id(130),reserva_id:reservaB,estadia_id:estadiaB,fecha_servicio:args.p_fecha_servicio,
                hora_inicio:args.p_hora,cantidad:args.p_cantidad,personas:args.p_personas,
                precio_unitario_aplicado:args.p_precio_manual,monto_adicional:0,total:args.p_cantidad*args.p_precio_manual,
                tipo_cobro:'normal',estado_servicio:'programado',catalogo_servicios:h.tablas.catalogo_servicios.find(c=>c.codigo===args.p_codigo_servicio)};
            h.tablas.servicios.push(s);
            h.tablas.vista_estado_cargos.push({cargo_id:id(140),reserva_id:reservaB,estadia_id:estadiaB,servicio_id:s.id,
                tipo_cargo:'servicio',concepto:s.catalogo_servicios.nombre,monto:s.total,monto_ajustado:s.total,
                aplicado_neto:0,saldo_cargo:s.total,estado:'activo',estado_pago:'pendiente'});
        }
        return {data:{servicio_id:s.id,total:s.total}};
    };
    h.casos={a,b,pa,pb,reservaB,estadiaB,codigoB};
    h.itemCaso=(plan,caso)=>plan.items.find(i=>i.pagoLibro?.codigo_autorizacion===h.casos[caso==='A'?'pa':'pb'].codigo_autorizacion);
    h.definirCaso=(plan,caso,medio,extra={})=>h.resolver(plan,h.itemCaso(plan,caso),{tipo:'definir_medio_pago',medio,...extra});
    h.aprobarCaso=async(plan,caso)=>{
        const i=h.itemCaso(plan,caso);
        if(i.manualPago?.tipo==='asociacion_pago')return h.resolver(plan,i,{tipo:'asociacion_pago'});
        h.aprobados.add(i.id);return h.preparar();
    };
    return h;
}
function entornoAcumulado(opciones){return agregarCasosAcumulados(entorno(),opciones);}
module.exports={entorno,entornoAcumulado,agregarCasosAcumulados,Element,read,consultas,setup};
