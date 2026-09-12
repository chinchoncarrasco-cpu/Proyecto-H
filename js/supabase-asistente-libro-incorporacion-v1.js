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
        root.HAIKU_LIBRO_CANCELACIONES_V1?.adjuntar(contenedor,resultado,generacion);
        const entrada=adaptar(resultado,generacion);
        if(!entrada.reservas.length)return;
        const doc=root.document;
        const elemento=(tag,texto)=>{const el=doc.createElement(tag);el.textContent=texto;return el;};
        const boton=elemento('button','Preparar cambios en Proyecto H');boton.type='button';boton.className='libro-reserva-boton secundario haku-4b-preparar';
        const zona=elemento('section','');zona.className='haku-4b-zona';zona.hidden=true;
        let ocupado=false,obsoleto=false;
        root.addEventListener('haiku:libro-cambio',()=>{
            obsoleto=true;boton.disabled=true;
            zona.replaceChildren(elemento('p',OBSOLETO));
        },{once:true});
        boton.addEventListener('click',async()=>{
            if(ocupado)return;
            ocupado=true;boton.disabled=true;zona.hidden=false;zona.replaceChildren(elemento('p','Revalidando los cambios contra Proyecto H…'));
            try {
                if(obsoleto)throw Error(OBSOLETO);
                vigente(generacion);
                const vista=elemento('div','');
                const preparacion=await preparar(resultado,generacion,vista);
                if(obsoleto)throw Error(OBSOLETO);
                if(!preparacion.result)throw Error('No hay cambios accionables para preparar.');
                zona.replaceChildren(elemento('h4','Preparación para Proyecto H'));
                // Contexto de diferencias sólo visual; no alimenta patches ni acciones.
                const contexto=elemento('details','');contexto.className='haku-4b-contexto';contexto.appendChild(elemento('summary','Cambios detectados que originaron esta preparación'));
                for(const x of preparacion.entrada.contexto){
                    const fechas=r=>`${r?.fecha_checkin || 'Sin fecha'} → ${r?.fecha_checkout || 'Sin fecha'}`;
                    contexto.appendChild(elemento('p',`${x.actual.titular || 'Titular no disponible'} · CAB ${x.actual.cabana ?? '—'} · ${fechas(x.actual)} · ${x.tipo==='nuevas'?'Nueva en el Libro':'Modificada en el Libro'}`));
                    if(x.tipo==='modificadas')contexto.appendChild(elemento('p',`Anterior: CAB ${x.anterior?.cabana ?? '—'} · ${fechas(x.anterior)}. Campos detectados: ${lista(x.cambios).map(c=>String(c.campo || 'Campo sin identificar').replace(/_/g,' ')).join(', ')}. La propuesta se determina al comparar el registro actual con Proyecto H.`));
                }
                zona.appendChild(contexto);
                if(preparacion.entrada.noTransferibles.length){
                    const detalles=elemento('details','');detalles.className='haku-4b-avisos';detalles.appendChild(elemento('summary',`No transferibles automáticamente / avisos · ${preparacion.entrada.noTransferibles.length}`));
                    for(const x of preparacion.entrada.noTransferibles){
                        const r=x.dato?.anterior || x.dato;
                        const ref=typeof r?.titular==='string'?r.titular:[x.dato?.hoja,x.dato?.segmento,x.dato?.actual,x.dato?.anterior].find(v=>typeof v==='string') || '';
                        detalles.appendChild(elemento('p',`${x.tipo}${ref?' · '+ref:''}: ${x.motivo}`));
                    }
                    zona.appendChild(detalles);
                }
                zona.appendChild(vista);
                const volver=elemento('button','Volver al informe');volver.type='button';volver.className='libro-reserva-boton secundario haku-4b-volver';volver.addEventListener('click',()=>{zona.hidden=true;});zona.appendChild(volver);
            }catch(e){zona.replaceChildren(elemento('p',e?.message || 'No se pudo preparar. No hay una propuesta actualizada.'));}
            finally{ocupado=false;boton.disabled=obsoleto;}
        });
        contenedor.appendChild(boton);contenedor.appendChild(zona);
    }
    const api=Object.freeze({adaptar,preparar,adjuntar});root.HAIKU_ASISTENTE_LIBRO_INCORPORACION_V1=api;
    if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
