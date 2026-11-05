/* ETAPA 4B: puente de datos completos hacia la UI de reconciliación existente. */
(function(root){
    'use strict';
    if(root.HAIKU_ASISTENTE_LIBRO_INCORPORACION_V1)return;
    const lista=x=>Array.isArray(x)?x:[];
    const OBSOLETO='El Libro cambió desde este informe. Genera el informe nuevamente antes de preparar cambios en Proyecto H.';
    const canon=x=>Array.isArray(x)?x.map(canon):x && typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canon(x[k])])):x;
    function adaptar(resultado,generacion) {
        const reservas=[],contexto=[],noTransferibles=[],vistos=new Set();
        for(const [key,tipo] of [['ya_no_aparecen','Ya no aparece'],['ambiguas','Requiere revisión'],['advertencias','Advertencia'],['no_comparables','No comparable']]) {
            for(const dato of lista(resultado[key]))noTransferibles.push({tipo,dato:structuredClone(dato),motivo:key==='ya_no_aparecen'?'No se aplicará automáticamente. Que una reserva ya no aparezca en el Libro nuevo no confirma cancelación.':key==='ambiguas'?'Requiere revisión antes de poder pasar a Proyecto H.':'No genera acciones en Proyecto H.'});
        }
        if(!['ok','parcial','sin_cambios'].includes(resultado.estado))return {reservas,contexto,noTransferibles,generacion};
        for(const key of ['nuevas','modificadas'])for(const x of lista(resultado[key])) {
            if(!x.actual || typeof x.actual!=='object')continue;
            const actual=structuredClone(x.actual);
            // Sólo colapsar la repetición idéntica del mismo ID semántico. Conflictos llegan al núcleo.
            const firma=actual.id?JSON.stringify(canon(actual)):null;
            contexto.push({tipo:key,actual:structuredClone(actual),anterior:structuredClone(x.anterior),cambios:structuredClone(x.cambios || [])});
            if(firma && vistos.has(firma))continue;
            if(firma)vistos.add(firma);
            reservas.push(actual);
            if(lista(actual.servicios).length || lista(x.cambios).some(c=>c.campo==='servicios'))noTransferibles.push({tipo:'Servicios',dato:{titular:actual.titular,cabana:actual.cabana},motivo:'Cambio o dato de servicio detectado · todavía no transferible automáticamente por este flujo.'});
        }
        return {reservas,contexto,noTransferibles,generacion,continuidades:structuredClone(resultado.continuidades || [])};
    }
    function vigente(generacion){
        if(generacion===undefined || generacion!==root.HAIKU_LIBRO_RESERVA_V1?.estado?.().generacion)throw Error(OBSOLETO);
    }
    async function preparar(resultado,generacion,out) {
        vigente(generacion);
        const entrada=adaptar(resultado,generacion);
        if(!entrada.reservas.length)return {entrada,result:null};
        if(!root.HAIKU_LIBRO_CONSULTAS?.abrirComparacionEstructurada)throw Error('La reconciliación de Proyecto H todavía no está disponible.');
        const result=await root.HAIKU_LIBRO_CONSULTAS.abrirComparacionEstructurada(out,entrada);
        vigente(generacion);
        return {entrada,result};
    }
    function adjuntar(contenedor,resultado,generacion) {
        // Los cambios que se pueden incorporar se revisan en la zona de pendientes del informe.
        root.HAIKU_LIBRO_CANCELACIONES_V1?.adjuntar(contenedor,resultado,generacion);
        const entrada=adaptar(resultado,generacion);
        // Revisiones de campo junto al informe, incluso en elementos que siguen
        // fuera del lote por identidad/fechas ambiguas. Resolver no los promueve.
        root.HAIKU_LIBRO_RESOLUCIONES_V1?.adjuntar(contenedor,
            [...entrada.reservas,...lista(resultado.ambiguas).flatMap(x=>lista(x.actuales))],generacion);
    }
    const api=Object.freeze({adaptar,preparar,adjuntar});root.HAIKU_ASISTENTE_LIBRO_INCORPORACION_V1=api;
    if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
