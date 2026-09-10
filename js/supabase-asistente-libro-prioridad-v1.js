/* ETAPA 4A: proyección temporal del resultado existente. Sin lecturas ni persistencia. */
(function(root){
    'use strict';
    const lista=x=>Array.isArray(x)?x:[];
    const hoy=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const dia=f=>typeof f==='string' && /^\d{4}-\d{2}-\d{2}$/.test(f) && Number.isFinite(Date.parse(f)) && new Date(f).toISOString().slice(0,10)===f ? Date.parse(f)/86400000 : null;
    const grupos=['hoy','manana','proximos','informativos'];
    const nombres=['🔴 Hoy','🟠 Mañana','🟡 Próximos días','🟢 Informativos'];
    const tipos={nueva:'Reserva nueva',modificada:'Reserva modificada',ausencia:'Ya no aparece',ambigua:'Requiere revisión',advertencia:'Advertencia',cobertura:'Cobertura no comparable'};
    function clasificar(resultado,{fechaActual=hoy()}={}) {
        const base=dia(fechaActual);if(base===null)throw Error('Fecha de referencia no válida.');
        const salida={fechaActual,horizonte:'2–7 días',grupos:Object.fromEntries(grupos.map(k=>[k,[]]))};
        // Sólo referencias explícitas; no vincular por nombre, celda próxima ni continuidad supuesta.
        const referencias=new Map();
        const recordar=(s,version)=>{if(!s?.id)return;const key=version+':'+s.id;const values=referencias.get(key)||[];values.push(s);referencias.set(key,values);};
        for(const x of lista(resultado.nuevas))recordar(x.actual,'actual');
        for(const x of lista(resultado.modificadas)){recordar(x.anterior,'anterior');recordar(x.actual,'actual');}
        for(const x of lista(resultado.ya_no_aparecen))recordar(x.anterior,'anterior');
        for(const x of lista(resultado.ambiguas))for(const version of ['anteriores','actuales'])for(const s of lista(x[version]))recordar(s,version==='anteriores'?'anterior':'actual');
        function evaluar(s) {
            const a=dia(s.fecha_checkin),b=dia(s.fecha_checkout);
            if ((a!==null&&b!==null&&b<a) || (s.tipo_estadia==='full_day'&&a!==null&&b!==null&&a!==b)) return {nivel:3,razon:'Fechas inconsistentes; no se puede determinar la proximidad.'};
            if(a===null || b===null)return {nivel:3,razon:'Fechas insuficientes; no se puede determinar la proximidad.'};
            // Intervalo operativo inclusivo: ingreso, permanencia y salida. No es ocupación nocturna.
            const primero=Math.max(a,base), distancia=primero-base;
            if(b<base)return {nivel:3,razon:'La estadía terminó antes de hoy.'};
            const nivel=distancia===0?0:distancia===1?1:distancia<=7?2:3;
            const cuando=distancia===0?'hoy':distancia===1?'mañana':`en ${distancia} días`;
            const accion=s.tipo_estadia==='full_day'?'Full Day':primero===a?'Ingreso':primero===b?'Salida':'Estadía en curso';
            return {nivel,razon:`${accion} ${cuando}${nivel===3?' · fuera del horizonte de 7 días':''}.`};
        }
        const segmento=(s,version)=>({version,titular:s?.titular||null,cabana:s?.cabana??null,fecha_checkin:s?.fecha_checkin??null,fecha_checkout:s?.fecha_checkout??null,tipo_estadia:s?.tipo_estadia??null});
        function agregar(tipo,partes,referencia) {
            const segmentos=partes.filter(x=>x[0] && typeof x[0]==='object').map(([s,v])=>({...segmento(s,v),...evaluar(s)}));
            const nivel=segmentos.length?Math.min(...segmentos.map(s=>s.nivel)):3;
            salida.grupos[grupos[nivel]].push({tipo,referencia:typeof referencia==='string'?referencia:null,segmentos,
                explicacion:segmentos.length?segmentos.filter(s=>s.nivel===nivel).map(s=>`${s.version}: ${s.razon}`).join(' '):'Sin fechas de estadía disponibles; prioridad temporal no determinada.'});
        }
        for(const x of lista(resultado.nuevas))agregar('nueva',[[x.actual,'Actual']]);
        for(const x of lista(resultado.modificadas))agregar('modificada',[[x.anterior,'Anterior'],[x.actual,'Actual']]);
        for(const x of lista(resultado.ya_no_aparecen))agregar('ausencia',[[x.anterior,'Anterior']]);
        for(const x of lista(resultado.ambiguas))agregar('ambigua',[...lista(x.anteriores).map(s=>[s,'Candidato anterior']),...lista(x.actuales).map(s=>[s,'Candidato actual'])]);
        for(const [campo,tipo] of [['advertencias','advertencia'],['no_comparables','cobertura']])for(const x of lista(resultado[campo])) {
            const partes=[];
            for(const v of ['anterior','actual']) {
                const ref=x?.[v] || (x?.version===v?x.segmento:null);
                for(const s of referencias.get(v+':'+ref)||[])partes.push([s,v==='actual'?'Actual':'Anterior']);
            }
            if(x?.fecha_checkin || x?.fecha_checkout)partes.push([x,'Aviso']);
            for(const validacion of lista(x?.validacion))partes.push([validacion,'Validación']);
            agregar(tipo,partes,x?.hoja || x?.segmento || x?.actual || x?.anterior || x?.tipo || x?.codigo);
        }
        return salida;
    }
    const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const fecha=v=>dia(v)===null?'Fecha no determinada':v.split('-').reverse().join('-');
    function resumen(resultado,opciones) {
        const p=clasificar(resultado,opciones);
        return 'Prioridad operativa: '+grupos.map((k,i)=>`${nombres[i]} · ${p.grupos[k].length}`).join(' · ');
    }
    function renderizar(resultado,opciones) {
        const p=clasificar(resultado,opciones);
        return `<section class="haku-libro-prioridad"><h4>Prioridad de los cambios detectados</h4><p>Esta sección clasifica únicamente los cambios de esta actualización. No representa todas las reservas, ingresos o salidas de los próximos días.</p><p>Referencia: ${fecha(p.fechaActual)} · America/Santiago · próximos días: 2–7 días. Incluye el día de salida.</p><p>Se cuentan casos, incluidos avisos; los segmentos y candidatos se conservan por separado. Informativos incluye casos sin fechas suficientes.</p>${grupos.map((k,i)=>`<details><summary>${nombres[i]} · ${p.grupos[k].length}</summary>${p.grupos[k].map(x=>`<div class="haku-libro-item"><strong>${tipos[x.tipo]}</strong>${x.referencia?`<p>${esc(x.referencia)}</p>`:''}${x.segmentos.length?x.segmentos.map(s=>`<p>${esc(s.version)} · ${esc(s.titular||'Titular no disponible')} · CAB ${esc(s.cabana??'—')} · ${fecha(s.fecha_checkin)} → ${fecha(s.fecha_checkout)}</p>`).join(''):'<p>Titular no disponible · CAB — · Fechas no determinadas</p>'}<p>${esc(x.explicacion)}</p></div>`).join('') || '<p>Sin elementos.</p>'}</details>`).join('')}</section>`;
    }
    const api=Object.freeze({clasificar,renderizar,resumen});root.HAIKU_ASISTENTE_LIBRO_PRIORIDAD_V1=api;
    if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
