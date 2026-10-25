/* ETAPA 4A: proyección temporal del resultado existente. Sin lecturas ni persistencia. */
(function(root){
    'use strict';
    const lista=x=>Array.isArray(x)?x:[];
    const hoy=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const dia=f=>typeof f==='string' && /^\d{4}-\d{2}-\d{2}$/.test(f) && Number.isFinite(Date.parse(f)) && new Date(f).toISOString().slice(0,10)===f ? Date.parse(f)/86400000 : null;
    const grupos=['hoy','manana','proximos','informativos'];
    const nombres=['🔴 Hoy','🟠 Mañana','🟡 Próximos días','🟢 Informativos'];
    const tipos={nueva:'Agregada al Libro',modificada:'Reserva con cambios',ausencia:'Ya no aparece en el Libro',cancelacion:'Cancelada en el Libro',ambigua:'Necesita revisión',advertencia:'Dato por revisar',cobertura:'No pude revisar toda la información'};
    const etiquetasCambios={cabana:'Cabaña',fecha_checkin:'Entrada',fecha_checkout:'Salida',noches:'Noches',tipo_estadia:'Tipo de estadía',titular:'Titular',adultos:'Adultos',ninos:'Niños',mascotas:'Mascotas',estado_confirmacion:'Confirmación',estado_operativo:'Estado de la estadía',operador:'Responsable de la reserva',rut_documento:'RUT o documento',correo:'Correo',telefono:'Teléfono',notas_importantes:'Notas o solicitudes',pagos_pendientes:'Pagos pendientes',servicios:'Servicios'};
    function detalleAvisoBasico(aviso){
        if(typeof aviso==='string')return aviso;
        if(!aviso||typeof aviso!=='object')return '';
        const detalle=[typeof aviso.motivo==='string'?aviso.motivo:'',
            ...lista(aviso.detalles).map(detalleAvisoBasico),...lista(aviso.validacion).map(detalleAvisoBasico)].filter(Boolean).join(' · ');
        const codigo=typeof aviso.tipo==='string'?aviso.tipo:typeof aviso.codigo==='string'?aviso.codigo:'';
        return detalle||codigo.replace(/_/g,' ')||'Aviso de interpretación sin detalle adicional.';
    }
    function clasificar(resultado,{fechaActual=hoy(),formatearAviso=detalleAvisoBasico}={}) {
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
            if ((a!==null&&b!==null&&b<a) || (s.tipo_estadia==='full_day'&&a!==null&&b!==null&&a!==b)) return {nivel:3,razon:'Revisa las fechas: no coinciden con el tipo de estadía o la salida figura antes de la entrada.'};
            if(a===null || b===null)return {nivel:3,razon:'Falta una fecha válida de entrada o salida. Revisa el Libro.'};
            // Intervalo operativo inclusivo: ingreso, permanencia y salida. No es ocupación nocturna.
            const primero=Math.max(a,base), distancia=primero-base;
            if(b<base)return {nivel:3,razon:'La estadía terminó antes de hoy.'};
            const nivel=distancia===0?0:distancia===1?1:distancia<=7?2:3;
            const cuando=distancia===0?'hoy':distancia===1?'mañana':`en ${distancia} días`;
            const accion=s.tipo_estadia==='full_day'?'Full Day':primero===a?'Ingreso':primero===b?'Salida':'Estadía en curso';
            return {nivel,razon:`${accion} ${cuando}${nivel===3?' · faltan más de 7 días':''}.`};
        }
        const segmento=(s,version)=>({version,titular:s?.titular||null,cabana:s?.cabana??null,fecha_checkin:s?.fecha_checkin??null,fecha_checkout:s?.fecha_checkout??null,tipo_estadia:s?.tipo_estadia??null});
        function agregar(tipo,partes,referencia,cambios=[],aviso=null) {
            const segmentos=partes.filter(x=>x[0] && typeof x[0]==='object').map(([s,v])=>({...segmento(s,v),...evaluar(s)}));
            const nivel=segmentos.length?Math.min(...segmentos.map(s=>s.nivel)):3;
            salida.grupos[grupos[nivel]].push({tipo,referencia:typeof referencia==='string'?referencia:null,segmentos,
                ...(aviso!=null?{detalleAviso:formatearAviso(aviso),
                    versionAviso:aviso?.version==='anterior'?'Versión anterior':aviso?.version==='actual'?'Versión actual':null}:{}),
                cambios:[...new Set(lista(cambios).map(c=>etiquetasCambios[c?.campo] || (typeof c?.campo==='string'?c.campo.replace(/_/g,' '):'Otro campo')))],
                explicacion:segmentos.length?segmentos.filter(s=>s.nivel===nivel).map(s=>`${s.version}: ${s.razon}`).join(' '):
                    aviso!=null?'Este aviso no indica una fecha; aparece en Informativos.':'No hay fechas suficientes para saber cuándo atender este caso.'});
        }
        for(const x of lista(resultado.nuevas))agregar('nueva',[[x.actual,'Actual']]);
        for(const x of lista(resultado.modificadas))agregar('modificada',[[x.anterior,'Anterior'],[x.actual,'Actual']],null,x.cambios);
        for(const x of lista(resultado.ya_no_aparecen))agregar('ausencia',[[x.anterior,'Anterior']]);
        for(const x of lista(resultado.cancelaciones_confirmadas))agregar('cancelacion',[[x.anterior,'Anterior']]);
        for(const x of lista(resultado.ambiguas))agregar('ambigua',[...lista(x.anteriores).map(s=>[s,'Candidato anterior']),...lista(x.actuales).map(s=>[s,'Candidato actual'])]);
        for(const [campo,tipo] of [['advertencias','advertencia'],['no_comparables','cobertura']])for(const x of lista(resultado[campo])) {
            const partes=[];
            for(const v of ['anterior','actual']) {
                const ref=x?.[v] || (x?.version===v?x.segmento:null);
                for(const s of referencias.get(v+':'+ref)||[])partes.push([s,v==='actual'?'Actual':'Anterior']);
            }
            if(x?.fecha_checkin || x?.fecha_checkout)partes.push([x,'Aviso']);
            for(const validacion of lista(x?.validacion))if(validacion?.fecha_checkin||validacion?.fecha_checkout||validacion?.titular||validacion?.cabana!=null)partes.push([validacion,'Validación']);
            agregar(tipo,partes,x?.hoja || x?.segmento || x?.actual || x?.anterior || x?.tipo || x?.codigo,[],x);
        }
        return salida;
    }
    const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const fecha=v=>dia(v)===null?'Fecha no determinada':v.split('-').reverse().join('-');
    function resumen(resultado,opciones) {
        const p=clasificar(resultado,opciones);
        return 'Para organizar la revisión: '+grupos.map((k,i)=>`${nombres[i]} · ${p.grupos[k].length}`).join(' · ');
    }
    function renderizar(resultado,opciones) {
        const p=clasificar(resultado,opciones);
        const caso=x=>{
            const aviso=['advertencia','cobertura'].includes(x.tipo),referencia=[x.versionAviso,x.referencia].filter(Boolean).join(' · ');
            return `<div class="haku-libro-item haku-actualizacion-sites__caso"><strong>${tipos[x.tipo]}</strong>${referencia?`<p>${esc(referencia)}</p>`:''}${x.segmentos.length?x.segmentos.map(s=>`<p>${esc(s.version.replace('Candidato','Posible reserva'))} · ${esc(s.titular||'Nombre no indicado')} · CAB ${esc(s.cabana??'—')} · Entrada: ${fecha(s.fecha_checkin)} · Salida: ${fecha(s.fecha_checkout)}</p>`).join(''):aviso?'<p>Este aviso no corresponde a una reserva identificada en el informe.</p>':'<p>Faltan el nombre, la cabaña o las fechas de la reserva.</p>'}${x.detalleAviso?`<p>${esc(x.detalleAviso)}</p>`:''}${x.cambios.length?`<p>Qué cambió: ${x.cambios.map(esc).join(' · ')}</p>`:''}<p>${esc(x.explicacion.replace(/Candidato/g,'Posible reserva'))}</p></div>`;
        };
        const filas=grupos.map((k,i)=>{
            const nombre=nombres[i].replace(/^[^A-Za-zÁÉÍÓÚáéíóú]+/,'');
            const contenido=`<span class="haku-actualizacion-sites__punto" aria-hidden="true"></span><span>${nombre}</span><strong>${p.grupos[k].length}</strong>`;
            return p.grupos[k].length
                ? `<details class="haku-prioridad-fila haku-prioridad--${k}"><summary>${contenido}<span class="haku-actualizacion-sites__flecha" aria-hidden="true">⌄</span></summary><div class="haku-actualizacion-sites__casos">${p.grupos[k].map(caso).join('')}</div></details>`
                : `<div class="haku-prioridad-fila haku-prioridad--${k} haku-prioridad-fila--vacia"><div class="haku-actualizacion-sites__fila-vacia">${contenido}</div></div>`;
        }).join('');
        return `<section class="haku-libro-prioridad haku-actualizacion-sites__prioridad"><div class="haku-actualizacion-sites__prioridad-intro"><h4>Qué revisar primero</h4><p>Aquí aparecen los cambios de esta actualización, ordenados por fecha. Para ver todas las reservas, abre el calendario.</p><p>Hoy: ${fecha(p.fechaActual)} · hora de Chile. «Próximos días» incluye del segundo al séptimo día, también las salidas.</p><p>Los números cuentan cambios y avisos, no huéspedes. En «Informativos» también aparecen los casos sin fecha.</p></div><div class="haku-actualizacion-sites__prioridad-filas">${filas}</div></section>`;
    }
    const api=Object.freeze({clasificar,renderizar,resumen});root.HAIKU_ASISTENTE_LIBRO_PRIORIDAD_V1=api;
    if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
