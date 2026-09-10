/* ETAPA 2: informe solicitado, sólo lectura. ETAPA 1 es la única fuente. */
(function(root) {
    'use strict';
    if (root.HAIKU_ASISTENTE_LIBRO_ACTUALIZACION_V1) return;
    const normalizar = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
        .replace(/^\s*haku\b[\s,;:!¡¿?—-]*/,'').replace(/[¿?¡!.,;:]/g,'').replace(/\s+/g,' ').trim();
    function esConsulta(texto) {
        const t = normalizar(texto).replace(/^(?:dame|muestrame)\s+(?:el\s+|los\s+)?/,'').replace(/\s+por favor$/,'');
        return /^(?:informe de actualizacion(?: del libro)?|que cambio en el libro|cambios del libro|cambios de la ultima actualizacion(?: del libro)?|ultima actualizacion del libro|que cambio desde la ultima carga)$/.test(t);
    }
    const escapar = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const lista = v => Array.isArray(v) ? v : [];
    const fecha = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v.split('-').reverse().join('-') : (v || 'No determinado');
    const etiquetas = {cabana:'Cabaña',fecha_checkin:'Check-in',fecha_checkout:'Check-out',noches:'Noches',titular:'Titular',adultos:'Adultos',ninos:'Niños',mascotas:'Mascotas',estado_confirmacion:'Confirmación',estado_operativo:'Estado',operador:'Operador',telefono:'Teléfono',correo:'Correo',rut_documento:'Documento',notas_importantes:'Notas',pagos_pendientes:'Pagos pendientes',servicios:'Servicios',tipo_estadia:'Tipo de estadía'};
    function valor(v, campo) {
        if (v == null || v === '' || v === 'no_determinado') return 'No determinado';
        if (campo === 'fecha_checkin' || campo === 'fecha_checkout') return fecha(v);
        if (Array.isArray(v)) return v.length ? v.map(x=>valor(x,campo)).join(' · ') : 'Ninguno';
        if (typeof v === 'object') return [v.concepto,v.hora,v.estado,v.pendiente === true ? 'Pendiente' : v.pendiente === false ? 'Sin pendiente' : null,v.cortesia ? 'Cortesía' : null,v.monto != null ? `${v.monto} CLP` : null].filter(x=>x != null && x !== '').join(' · ') || 'Sin detalle disponible';
        if (typeof v === 'boolean') return v ? 'Sí' : 'No';
        return String(v).replace(/_/g,' ');
    }
    function reserva(r = {}) {
        return `<strong>${escapar(r.titular || 'Titular no determinado')}</strong><p>CAB ${escapar(r.cabana ?? '—')} · ${escapar(fecha(r.fecha_checkin))} → ${escapar(fecha(r.fecha_checkout))}${r.noches != null ? ` · ${escapar(r.noches)} ${Number(r.noches) === 1 ? 'noche' : 'noches'}` : ''}${r.tipo_estadia === 'full_day' ? ' · Full Day' : ''}</p>`;
    }
    function detalleAviso(aviso) {
        if (typeof aviso === 'string') return aviso;
        if (!aviso || typeof aviso !== 'object') return 'Sin detalle disponible.';
        const nombres = {
            advertencia_de_origen_conservada:'Advertencia de origen conservada',
            hoja_historica_modificada:'Hoja histórica modificada',
            huella_no_disponible:'Huella no disponible',
            fechas_no_validas:'Fechas no válidas',
            checkout_anterior_al_checkin:'El check-out es anterior al check-in',
            full_day_inconsistente:'Fechas o noches de Full Day inconsistentes',
            alojamiento_sin_noche:'Alojamiento sin noche'
        };
        const texto = v => typeof v === 'string' && v.trim() ? v.trim() : null;
        // Usar sólo contexto explícito del aviso; no buscar ni deducir titulares.
        const contexto = [...new Set([
            texto(aviso.hoja), texto(aviso.origen?.hoja), texto(aviso.titular),
            texto(aviso.segmento), texto(aviso.anterior), texto(aviso.actual),
            texto(aviso.campo) ? etiquetas[aviso.campo] || aviso.campo : null
        ].filter(Boolean))];
        const tipo = texto(aviso.tipo) || texto(aviso.codigo);
        if (tipo) contexto.push(nombres[tipo] || tipo.replace(/_/g,' '));
        const detalles = [texto(aviso.motivo),
            ...lista(aviso.detalles).map(detalleAviso),
            ...lista(aviso.validacion).map(detalleAviso)].filter(Boolean);
        return [contexto.join(' · '), detalles.join(' · ')].filter(Boolean).join(': ') || 'Sin detalle disponible.';
    }
    function renderizar(r) {
        let html = '<article class="haku-libro-actualizacion"><header><h3>Actualización del Libro</h3><p>Comparación de sólo lectura</p></header>';
        const aviso = text => {html += `<p class="haku-libro-aviso">${escapar(text)}</p>`;};
        if (r.estado === 'sin_linea_base') {
            aviso('Esta es la primera versión del Libro que tengo como referencia. Carga una actualización posterior para que pueda comparar los cambios.');
            return html + '</article>';
        }
        if (r.estado === 'sin_cambios') aviso('Haku no detectó cambios operacionales entre ambas versiones del Libro.');
        if (['parcial','no_comparable'].includes(r.estado)) aviso('Alguna parte del Libro no pudo compararse con seguridad. Los casos inciertos requieren revisión.');
        if (!['ok','sin_cambios','parcial','no_comparable'].includes(r.estado)) {
            aviso('No pude completar la comparación del Libro. Puedes volver a intentarlo.');
            return html + '</article>';
        }
        html += '<div class="haku-libro-contadores">' + [['nuevas','Nuevas'],['modificadas','Modificadas'],['ya_no_aparecen','Ya no aparecen'],['ambiguas','Por revisar']].map(([k,t])=>`<div><strong>${lista(r[k]).length}</strong><span>${t}</span></div>`).join('') + '</div>';
        const seccion = (titulo, items) => { if(items.length) html += `<section><h4>${titulo}</h4>${items.join('')}</section>`; };
        seccion('Nuevas',lista(r.nuevas).map(x=>`<div class="haku-libro-item"><small>NUEVA</small>${reserva(x.actual)}</div>`));
        seccion('Modificadas',lista(r.modificadas).map(x=>`<div class="haku-libro-item"><small>MODIFICADA · CAB ${escapar(x.actual?.cabana ?? '—')}</small><strong>${escapar(x.actual?.titular || 'Titular no determinado')}</strong><dl>${lista(x.cambios).map(c=>`<dt>${escapar(etiquetas[c.campo] || 'Otro campo')}</dt><dd>${['rut_documento','telefono','correo'].includes(c.campo) ? 'Dato actualizado; valores personales ocultos.' : `${escapar(valor(c.antes,c.campo))} → ${escapar(valor(c.ahora,c.campo))}`}</dd>`).join('')}</dl></div>`));
        seccion('Ya no aparecen',lista(r.ya_no_aparecen).map(x=>`<div class="haku-libro-item"><small>YA NO APARECE</small>${reserva(x.anterior)}<p>Esta reserva estaba en la versión anterior y no aparece en la actual.</p></div>`));
        seccion('Requiere revisión',lista(r.ambiguas).map(x=>`<div class="haku-libro-item"><strong>Requiere revisión</strong><p>${escapar(x.motivo || 'No hay evidencia suficiente para decidir una coincidencia.')}</p>${[['anteriores','Versión anterior'],['actuales','Versión actual']].map(([k,t])=>`<details><summary>${t} · ${lista(x[k]).length} candidatos</summary>${lista(x[k]).map(reserva).join('')}</details>`).join('')}</div>`));
        const especiales = new Set([...lista(r.diagnostico?.hojas_especiales_modificadas),...lista(r.advertencias).filter(a=>a.tipo === 'hoja_especial_modificada').map(a=>a.hoja)]);
        for (const hoja of especiales) aviso(`También detecté cambios en ${hoja}. Esa hoja todavía no tiene interpretación automática detallada.`);
        const otras = lista(r.advertencias).filter(a=>a.tipo !== 'hoja_especial_modificada');
        if (otras.length) {
            aviso(otras.length === 1 ? '1 advertencia de interpretación o cobertura requiere revisión.' : `${otras.length} advertencias de interpretación o cobertura requieren revisión.`);
            for (const item of otras) html += `<p>${escapar(detalleAviso(item))}</p>`;
        }
        if (lista(r.no_comparables).length) {
            aviso('Hay hojas o cobertura que no permiten concluir altas o desapariciones con seguridad.');
            for (const item of r.no_comparables) html += `<p>${escapar(detalleAviso(item))}</p>`;
        }
        return html + '</article>';
    }
    function crearCache(comparar, generacion) {
        let cache, pendiente, pendienteGeneracion, pendienteRevision, revision = 0;
        return {
            invalidar() { revision++; cache = undefined; },
            async obtener() {
                const g = generacion(), rev = revision;
                if (pendiente) {
                    if (pendienteGeneracion === g && pendienteRevision === rev) return pendiente;
                    // Una generación nueva espera la anterior, pero nunca reutiliza su resultado.
                    try { await pendiente; } catch (_) {}
                    return this.obtener();
                }
                if (g != null && cache?.generacion === g) return cache.resultado;
                pendienteGeneracion = g; pendienteRevision = rev;
                pendiente = Promise.resolve().then(comparar).then(resultado => {
                    if (rev !== revision || g !== generacion()) throw new Error('El Libro cambió durante la comparación. Solicita nuevamente el informe.');
                    if (g != null && ['ok','sin_cambios','sin_linea_base','parcial'].includes(resultado.estado)) cache = {generacion:g,resultado};
                    return resultado;
                });
                try { return await pendiente; } finally { pendiente = undefined; }
            }
        };
    }
    let instalado = false, cacheCompartida, insertarResultado;
    function obtenerResultado() {
        if (!instalar()) return Promise.reject(new Error('Haku todavía no está disponible.'));
        return cacheCompartida.obtener();
    }
    function mostrarResultado(resultado) {
        if (!instalar()) throw new Error('Haku todavía no está disponible.');
        return insertarResultado(resultado);
    }
    function instalar() {
        if (instalado || !root.document) return instalado;
        const doc = root.document, campo = doc.getElementById('haiku-asistente-texto'), enviar = doc.getElementById('haiku-asistente-enviar'), mensajes = doc.getElementById('haiku-asistente-mensajes');
        if (!campo || !enviar || !mensajes) return false;
        instalado = true;
        const cache = crearCache(()=> {
            if (!root.HAIKU_LIBRO_DIFERENCIAS_V1) throw new Error('El comparador del Libro todavía no está disponible.');
            return root.HAIKU_LIBRO_DIFERENCIAS_V1.compararUltimasVersiones();
        },()=>root.HAIKU_LIBRO_RESERVA_V1?.estado().generacion);
        cacheCompartida = cache;
        root.addEventListener('haiku:libro-cambio',()=>cache.invalidar());
        const style = doc.createElement('style');
        style.textContent = `.haku-libro-actualizacion{border:1px solid #cadfd1;border-radius:16px;background:#f7faf8;padding:14px;color:#26342c;overflow-wrap:anywhere}.haku-libro-actualizacion h3{font-size:19px;margin:0}.haku-libro-actualizacion p{margin:5px 0;font-size:12px;line-height:1.5}.haku-libro-actualizacion h4{font-size:12px;margin:16px 0 7px}.haku-libro-contadores{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin:12px 0}.haku-libro-contadores>div{background:white;border:1px solid #dfe9e2;border-radius:10px;padding:8px;text-align:center}.haku-libro-contadores strong,.haku-libro-contadores span{display:block}.haku-libro-contadores span{font-size:10px}.haku-libro-item{border:1px solid #dfe9e2;border-radius:10px;padding:10px;background:white;margin:6px 0}.haku-libro-item>strong,.haku-libro-item>small{display:block}.haku-libro-item small{font-size:10px;color:#1f7650;margin-bottom:5px}.haku-libro-item dl{font-size:12px;margin-bottom:0}.haku-libro-item dt{font-weight:700;margin-top:7px}.haku-libro-item dd{margin:3px 0;white-space:pre-wrap}.haku-libro-item summary{cursor:pointer;font-size:12px;margin:7px 0}.haku-libro-aviso{background:#fffaf1;border:1px solid #ead8bc;padding:9px;border-radius:10px}@media(max-width:420px){.haku-libro-contadores{grid-template-columns:repeat(2,minmax(0,1fr))}}`;
        doc.head.appendChild(style);
        function mensaje(tipo,texto) {
            const el = doc.createElement('div'); el.className = `haiku-asistente-mensaje haiku-asistente-mensaje--${tipo}`; el.textContent = texto; mensajes.appendChild(el); mensajes.scrollTop = mensajes.scrollHeight; return el;
        }
        insertarResultado = resultado => {
            const el = mensaje('asistente','');
            el.innerHTML = renderizar(resultado);
            mensajes.scrollTop = mensajes.scrollHeight;
            return el;
        };
        let ocupado = false;
        async function procesar(texto) {
            if (ocupado) return;
            ocupado = true;
            let espera;
            try {
                campo.value = ''; campo.dispatchEvent(new root.Event('input',{bubbles:true}));
                mensaje('usuario',texto);
                espera = mensaje('asistente','Comparando la última actualización del Libro…');
                const resultado = await obtenerResultado();
                espera.innerHTML = renderizar(resultado);
                mensajes.scrollTop = mensajes.scrollHeight;
            } catch (e) {
                if (espera) espera.textContent = e?.message || 'No pude comparar el Libro. Puedes volver a intentarlo.';
            } finally { ocupado = false; campo.dispatchEvent(new root.Event('input',{bubbles:true})); }
        }
        function interceptar(e) {
            if (e.type === 'click' ? !e.target?.closest?.('#haiku-asistente-enviar') : e.target !== campo) return;
            if (e.type === 'keydown' && (e.key !== 'Enter' || e.shiftKey || e.isComposing)) return;
            if (doc.getElementById('haiku-asistente-adjuntos')?.querySelector('.haiku-asistente-adjunto')) return;
            const texto = campo.value.trim();
            if (!esConsulta(texto)) return;
            e.preventDefault(); e.stopImmediatePropagation(); void procesar(texto);
        }
        // Antes del interceptor general de consultas del Libro, también en window capture.
        root.addEventListener('click',interceptar,true);
        root.addEventListener('keydown',interceptar,true);
        return true;
    }
    const api = Object.freeze({esConsulta,renderizar,crearCache,instalar,obtenerResultado,mostrarResultado});
    root.HAIKU_ASISTENTE_LIBRO_ACTUALIZACION_V1 = api;
    if (typeof module !== 'undefined') module.exports = api;
    if (root.document && !instalar()) {
        const observer = new root.MutationObserver(()=>{if(instalar()) observer.disconnect();});
        observer.observe(root.document.documentElement,{childList:true,subtree:true});
        root.addEventListener('load',()=>{if(instalar()) observer.disconnect();},{once:true});
    }
})(typeof window !== 'undefined' ? window : globalThis);
