// Genera una comparación reproducible con datos exclusivamente ficticios.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{execFileSync}=require('node:child_process');
const F=require('./fixtures/libro-comparacion-readonly.cjs'),R=require('./fixtures/libro-pagos-revision.cjs');
const root=path.resolve(__dirname,'..'),base='8431b62636a0fc224e5d2e6a982c81d2bd663e05';
async function medir(anterior){
 const caso=R.caso(),ctx=vm.createContext({structuredClone,document:{readyState:'complete',getElementById:()=>({}),querySelector:()=>null,querySelectorAll:()=>[]},addEventListener(){}});ctx.window=ctx;
 ctx.HAIKU_LIBRO_RESERVA_V1={...F.libroBase(caso.entrada),listarHojas:()=>['Nov26']};
 for(const n of ['haiku-libro-semantica-v1','haiku-libro-pagos-canon-v1','haiku-libro-lenguaje-natural-v1','haiku-libro-pagos-destinos-v1','haiku-libro-consultas-v1','supabase-finanzas-resumen-v1']){
  const p='js/'+n+'.js',src=anterior?execFileSync('git',['show',base+':'+p],{cwd:root,encoding:'utf8'}):fs.readFileSync(path.join(root,p),'utf8');vm.runInContext(src,ctx);
 }
 const data=ctx.HAIKU_LIBRO_LENGUAJE_NATURAL_V1.ajustarResultadoPagos(caso.entrada),r=data.reservas[0];
 ctx.HAIKU_LIBRO_RESERVA_V1.consultarHoja=async()=>F.copy(data);ctx.haikuTienePermiso=()=>true;
 const cliente=F.cliente(caso.db);cliente.rpc=async n=>n==='haiku_libro_aplicaciones_servicio_capacidad_v1'?{data:R.capacidad}:
  n==='haiku_resumen_ajustes_unidad'?{data:{reserva_id:R.ids.reserva,ajustes:caso.db.cargo_ajustes}}:
  n==='haiku_libro_transferencias_capacidad_v2'?{data:{version:2,confirmacion_final:true,glosa_sin_nombre:true}}:{data:null};
 ctx.haikuSupabase=cliente;const Q=ctx.HAIKU_LIBRO_CONSULTAS,result={reservas:[r],generacion:1,q:{desde:r.fecha_checkin,hasta:r.fecha_checkout,incluirFinanzas:true}};
 const aprobados=new Set(),p=await Q.prepararIncorporacion(result,new Map(),aprobados,cliente);
 const filas=p.items.filter(i=>i.pagoLibro).map(i=>({celda:i.pagoLibro.origen.celda,concepto:i.pagoLibro.concepto,monto:i.pagoLibro.monto,
  comprobanteSeparado:i.id.endsWith(':comprobante'),categoria:i.categoria,aprobable:i.aprobable===true,motivos:i.motivos,aviso:i.aviso||null,
  accion:i.etiquetaAprobacion||i.manualPago?.tipo||null,comparacionAjuste:i.penalidadComparacion||null}));
 p.items.filter(i=>i.aprobable&&i.pagoLibro?.monto!==14400).forEach(i=>aprobados.add(i.id));
 const preparado=await Q.prepararIncorporacion(result,new Map(),aprobados,cliente);
 const calcular=ctx.HAIKU_FINANZAS_RESUMEN_V1.detalle||ctx.HAIKU_FINANZAS_RESUMEN_V1.calcular;
 return {filas,propuestaConAprobacionFicticia:Q.serializarIncorporacion(preparado),ficha:calcular(caso.db.vista_estado_cargos,caso.db.pagos),mutaciones:cliente.mutaciones};
}
(async()=>{const evidencia={datos:'Exclusivamente sintéticos. No contiene extractos de huéspedes.',base,antes:await medir(true),despues:await medir(false)};
 const destino=path.join(root,'diagnosticos/libro-pagos-revision-antes-despues-sintetico.json');fs.writeFileSync(destino,JSON.stringify(evidencia,null,2)+'\n');console.log('Evidencia sintética generada: '+destino);
})().catch(e=>{console.error(e);process.exitCode=1;});
