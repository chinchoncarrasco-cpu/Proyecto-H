/* ETAPA 2: informe solicitado, sólo lectura. ETAPA 1 es la única fuente. */
(function(root) {
    'use strict';
    if (root.HAIKU_ASISTENTE_LIBRO_ACTUALIZACION_V1) return;
    const generacionesResultado = new WeakMap();
    const normalizar = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
        .replace(/^\s*haku\b[\s,;:!¡¿?—-]*/,'').replace(/[¿?¡!.,;:]/g,'').replace(/\s+/g,' ').trim();
    function esConsulta(texto) {
        const t = normalizar(texto).replace(/^(?:dame|muestrame)\s+(?:el\s+|los\s+)?/,'').replace(/\s+por favor$/,'');
        return /^(?:informe de actualizacion(?: del libro)?|que cambio en el libro|cambios del libro|cambios de la ultima actualizacion(?: del libro)?|ultima actualizacion del libro|que cambio desde la ultima carga)$/.test(t);
    }
    const escapar = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const lista = v => Array.isArray(v) ? v : [];
    const esAdministrador=()=>root.haikuSesion?.usuario?.activo===true&&lista(root.haikuSesion.roles).some(r=>
        /^(administrador|admin)$/.test(normalizar(typeof r==='string'?r:r?.codigo||r?.nombre)));
    const fecha = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v.split('-').reverse().join('-') : (v || 'Sin fecha indicada');
    const etiquetas = {cabana:'Cabaña',fecha_checkin:'Entrada',fecha_checkout:'Salida',noches:'Noches',titular:'Titular',adultos:'Adultos',ninos:'Niños',mascotas:'Mascotas',estado_confirmacion:'Confirmación',estado_operativo:'Estado de la estadía',operador:'Responsable de la reserva',telefono:'Teléfono',correo:'Correo',rut_documento:'RUT o documento',notas_importantes:'Notas',pagos_pendientes:'Pagos pendientes',servicios:'Servicios',tipo_estadia:'Tipo de estadía'};
    const estados = {sin_checkin:'Aún no ingresa',hospedada:'Huéspedes alojados',checked_in:'Huéspedes alojados',checked_out:'Huéspedes ya salieron',check_out:'Huéspedes ya salieron',confirmada:'Confirmada',pendiente:'Pendiente de confirmar',confirmada_por_color:'Confirmada según el color del Libro',pendiente_por_color:'Pendiente según el color del Libro',cancelada:'Cancelada',no_show:'No se presentó',alojamiento:'Alojamiento',full_day:'Full Day'};
    // Traducciones de presentación: conservar las decisiones y los motivos originales.
    const explicaciones = {
        'Geometría no reconocida o lectura incompleta.':'No pude leer todas las reservas o sus fechas en esta hoja.',
        'La cobertura de fechas cambió entre versiones.':'Las dos versiones del Libro no incluyen las mismas fechas.',
        'Cobertura incompleta: no se concluye alta o desaparición.':'Falta información para saber si se agregó o se quitó esta reserva.',
        'Identidad no concluyente o múltiples candidatos.':'Hay que revisar cuáles reservas corresponden a la misma persona.',
        'Campo no determinado en ambas versiones.':'Falta este dato en una de las versiones del Libro.',
        'Se requieren arrays de hojas semánticas.':'No pude leer las hojas del Libro. Vuelve a cargarlo e intenta de nuevo.',
        'Las noches escritas no coinciden con las fechas combinadas; confirmar ingreso/salida.':'La cantidad de noches escrita no coincide con las fechas del Libro. Revisa la entrada y la salida.',
        'No se pudo asociar de forma segura':'No pude identificar con certeza la reserva en Proyecto H.',
        'No se pudo asociar de forma única':'Hay que revisar a qué reserva corresponde.',
        'Requiere la revisión operativa de servicios y notas; la comparación preliminar no acredita un faltante.':'Abre «Revisar servicios y notas» para comprobar si ya están registrados.',
        'El operador no tiene un campo propio de actualización; falta verificar su código en la glosa del Libro.':'Revisa si el código del responsable ya está anotado en los comentarios de la reserva.',
        'Aún no contiene la información detectada':'Falta guardar esta información',
        'Ya contiene la información':'Esta información ya está guardada',
        'No se puede comprobar automáticamente':'Este dato necesita una revisión manual'
    };
    const explicar = v => Object.hasOwn(explicaciones,v) ? explicaciones[v] : v;
    function valor(v, campo) {
        if (v == null || v === '' || v === 'no_determinado') return 'Sin dato';
        if (campo === 'fecha_checkin' || campo === 'fecha_checkout') return fecha(v);
        if (Array.isArray(v)) return v.length ? v.map(x=>valor(x,campo)).join(' · ') : 'Ninguno';
        if (typeof v === 'object') return [v.concepto,v.hora,v.estado,v.pendiente === true ? 'Pendiente' : v.pendiente === false ? 'Sin pendiente' : null,v.cortesia ? 'Cortesía' : null,v.monto != null ? `${v.monto} CLP` : null].filter(x=>x != null && x !== '').join(' · ') || 'Sin detalle disponible';
        if (typeof v === 'boolean') return v ? 'Sí' : 'No';
        if (['estado_operativo','estado_confirmacion','tipo_estadia'].includes(campo) && Object.hasOwn(estados,v)) return estados[v];
        return String(explicar(v)).replace(/_/g,' ');
    }
    function reserva(r = {}) {
        return `<strong>${escapar(r.titular || 'Nombre no indicado')}</strong><p>CAB ${escapar(r.cabana ?? '—')} · Entrada: ${escapar(fecha(r.fecha_checkin))} · Salida: ${escapar(fecha(r.fecha_checkout))}${r.noches != null ? ` · ${escapar(r.noches)} ${Number(r.noches) === 1 ? 'noche' : 'noches'}` : ''}${r.tipo_estadia === 'full_day' ? ' · Full Day' : ''}</p>`;
    }
    function detalleAviso(aviso) {
        if (typeof aviso === 'string') return explicar(aviso);
        if (!aviso || typeof aviso !== 'object') return 'Sin detalle disponible.';
        const nombres = {
            advertencia_de_origen_conservada:'Este dato sigue necesitando revisión',
            hoja_historica_modificada:'Cambió una hoja de fechas anteriores',
            huella_no_disponible:'No pude comprobar si cambió esta hoja',
            fechas_no_validas:'Revisa las fechas de la reserva',
            checkout_anterior_al_checkin:'La salida figura antes de la entrada',
            full_day_inconsistente:'Revisa las fechas: un Full Day empieza y termina el mismo día, sin noches',
            alojamiento_sin_noche:'La entrada y la salida son el mismo día, pero la reserva figura como alojamiento'
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
        const detalles = [explicar(texto(aviso.motivo)),
            ...lista(aviso.detalles).map(detalleAviso),
            ...lista(aviso.validacion).map(detalleAviso)].filter(Boolean);
        return [contexto.join(' · '), detalles.join(' · ')].filter(Boolean).join(': ') || 'Sin detalle disponible.';
    }
    function renderizar(r) {
        let html = '<article class="haku-libro-actualizacion haiku-asistente-preview haku-actualizacion-sites">' +
            '<header class="haku-actualizacion-sites__head"><div><span>LIBRO · ACTUALIZACIÓN</span><strong>Informe de actualización</strong></div>' +
            '<div class="haku-actualizacion-sites__head-actions"><span class="haku-actualizacion-sites__chip">Solo lectura</span><button type="button" class="haku-actualizacion-sites__cerrar" data-haku-cerrar-actualizacion aria-label="Cerrar Haku">×</button></div></header>';
        const resumenReal = root.HAIKU_ASISTENTE_LIBRO_AUTO_V1?.resumir?.(r)?.texto?.split(' Para organizar la revisión:')[0];
        if (resumenReal) html += `<div class="haku-actualizacion-sites__mensaje">${escapar(resumenReal)}</div>`;
        html += '<section class="haku-actualizacion-sites__tarjeta"><header class="haku-actualizacion-sites__tarjeta-head"><div><span>LIBRO · ACTUALIZACIÓN</span><strong>Qué cambió en el Libro</strong></div><span class="haku-actualizacion-sites__chip">Sin guardar cambios</span></header>';
        const aviso = text => {html += `<p class="haku-libro-aviso">${escapar(text)}</p>`;};
        if (r.estado === 'sin_linea_base') {
            aviso('Esta es la primera versión del Libro que reviso. Cuando llegue una nueva actualización, podré mostrarte qué cambió.');
            return html + '</section></article>';
        }
        if (['parcial','no_comparable'].includes(r.estado)) aviso('No pude revisar todo el Libro. Más abajo puedes ver qué datos necesitan revisión.');
        if (!['ok','sin_cambios','parcial','no_comparable'].includes(r.estado)) {
            aviso('No pude completar la comparación del Libro. Puedes volver a intentarlo.');
            return html + '</section></article>';
        }
        const seccion = (titulo, items) => {
            const clase = {'Agregadas al Libro':'nuevas','Reservas con cambios':'modificadas','Ya no aparecen':'ausentes','Necesitan revisión':'revision','Canceladas en el Libro':'cancelaciones'}[titulo];
            if(items.length) html += `<details class="haku-actualizacion-sites__grupo haku-actualizacion-sites__grupo--${clase}"><summary><span>${titulo} (${items.length})</span><span aria-hidden="true">⌄</span></summary><div class="haku-actualizacion-sites__grupo-contenido">${items.join('')}</div></details>`;
        };
        if (root.HAIKU_ASISTENTE_LIBRO_PRIORIDAD_V1) {
            html += root.HAIKU_ASISTENTE_LIBRO_PRIORIDAD_V1.renderizar(r,{formatearAviso:detalleAviso});
        }
        if (r.estado === 'sin_cambios') html += '<p class="haku-actualizacion-sites__sin-cambios"><strong>Sin cambios nuevos</strong> No encontré cambios en las reservas entre estas dos versiones del Libro. Aún pueden quedar cambios anteriores por guardar en Proyecto H.</p>';
        html += '<div class="haku-libro-contadores haku-actualizacion-sites__metricas">' + [['nuevas','Agregadas al Libro'],['modificadas','Con cambios'],['ya_no_aparecen','Ya no aparecen'],['ambiguas','Por revisar']].map(([k,t])=>`<div><strong>${lista(r[k]).length}</strong><span>${t}</span></div>`).join('') + '</div>';
        seccion('Agregadas al Libro',lista(r.nuevas).map(x=>`<div class="haku-libro-item"><small>AGREGADA AL LIBRO</small>${reserva(x.actual)}</div>`));
        seccion('Reservas con cambios',lista(r.modificadas).map(x=>`<details class="haku-libro-item haku-pregunta-caso"><summary><small>CON CAMBIOS · CAB ${escapar(x.actual?.cabana ?? '—')}</small><strong>${escapar(x.actual?.titular || 'Nombre no indicado')}</strong></summary><dl>${lista(x.cambios).map(c=>`<dt>${escapar(etiquetas[c.campo] || 'Otro dato')}</dt><dd>${['rut_documento','telefono','correo'].includes(c.campo) ? 'Este dato cambió en el Libro. No se muestra aquí por privacidad.' : `Antes: ${escapar(valor(c.antes,c.campo))}<br>Ahora: ${escapar(valor(c.ahora,c.campo))}`}</dd>`).join('')}</dl></details>`));
        seccion('Ya no aparecen',lista(r.ya_no_aparecen).map(x=>`<div class="haku-libro-item"><small>YA NO APARECE</small>${reserva(x.anterior)}<p>Esta reserva estaba en la versión anterior y no aparece en la actual.</p></div>`));
        seccion('Canceladas en el Libro',lista(r.cancelaciones_confirmadas).map(x=>`<div class="haku-libro-item"><small>CANCELADA EN EL LIBRO</small>${reserva(x.anterior)}<p>${escapar(x.anterior?.titular)} aparece en CANCELACIONES de ${escapar(x.evidencia?.origen?.hoja)} · ${escapar(x.evidencia?.origen?.celda)}. Revisa la reserva y confirma la cancelación antes de guardarla en Proyecto H.</p></div>`));
        seccion('Necesitan revisión',lista(r.ambiguas).map(x=>`<div class="haku-libro-item"><strong>Necesita revisión</strong><p>${escapar(explicar(x.motivo) || 'No puedo confirmar cuáles reservas corresponden al mismo caso. Revisa los datos de ambas versiones.')}</p>${[['anteriores','Versión anterior'],['actuales','Versión actual']].map(([k,t])=>`<details><summary>${t} · ${lista(x[k]).length} reservas por revisar</summary>${lista(x[k]).map(reserva).join('')}</details>`).join('')}</div>`));
        const inicioAvisos = html.length;
        const especiales = new Set([...lista(r.diagnostico?.hojas_especiales_modificadas),...lista(r.advertencias).filter(a=>a.tipo === 'hoja_especial_modificada').map(a=>a.hoja)]);
        for (const hoja of especiales) aviso(`También cambió la hoja ${hoja}. Haku todavía no puede revisar su contenido en detalle; ábrela en el Libro para revisarla.`);
        const otras = lista(r.advertencias).filter(a=>a.tipo !== 'hoja_especial_modificada');
        if (otras.length) {
            aviso(otras.length === 1 ? 'Hay 1 aviso sobre datos que no pude leer o comparar bien.' : `Hay ${otras.length} avisos sobre datos que no pude leer o comparar bien.`);
            for (const item of otras) html += `<p>${escapar(detalleAviso(item))}</p>`;
        }
        if (lista(r.no_comparables).length) {
            aviso('No pude revisar por completo algunas hojas. En esos casos no puedo confirmar si se agregaron o quitaron reservas.');
            for (const item of r.no_comparables) html += `<p>${escapar(detalleAviso(item))}</p>`;
        }
        const cantidadAvisos = especiales.size + otras.length + lista(r.no_comparables).length;
        if (cantidadAvisos) html = html.slice(0,inicioAvisos) + `<details class="haku-actualizacion-sites__grupo haku-actualizacion-sites__grupo--revision"><summary><span>Datos del Libro por revisar (${cantidadAvisos})</span><span aria-hidden="true">⌄</span></summary><div class="haku-actualizacion-sites__grupo-contenido">${html.slice(inicioAvisos)}</div></details>`;
        return html + '</section></article>';
    }
    const sensible = campo => /rut|documento|correo|tel[eé]fono/i.test(String(campo || ''));
    const resumenNota=v=>String(v||'').replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi,'[correo oculto]').replace(/\+?\d[\d .()-]{7,}/g,'[dato personal oculto]').slice(0,180);
    const hash=texto=>{let h=2166136261;for(const c of texto){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return (h>>>0).toString(36);};
    const firmaReservaCambio=r=>JSON.stringify(['titular','rut_documento','correo','telefono','cabana','fecha_checkin','fecha_checkout','tipo_estadia','adultos','ninos','mascotas','estado_operativo','notas_importantes','pagos_pendientes','servicios'].map(k=>r?.[k]??null));
    const idCambio=x=>'cambio:'+hash(JSON.stringify([x.tipo,firmaReservaCambio(x.anterior),firmaReservaCambio(x.actual),x.cambios||[],x.evidencia||null]));
    function extraerCambiosDetectados(resultado={},generacion=null){
        const meta={detectado_generacion:generacion,detectado_en:resultado.generado_en||new Date().toISOString()};
        return [
            ...lista(resultado.modificadas).map(x=>({...meta,tipo:'modificacion',anterior:structuredClone(x.anterior),actual:structuredClone(x.actual),cambios:structuredClone(x.cambios)})),
            ...lista(resultado.nuevas).map(x=>({...meta,tipo:'nueva',anterior:null,actual:structuredClone(x.actual),cambios:[]})),
            ...lista(resultado.cancelaciones_confirmadas).map(x=>({...meta,tipo:'cancelacion',anterior:structuredClone(x.anterior),actual:null,cambios:[],evidencia:structuredClone(x.evidencia)}))
        ].map(x=>({...x,id:idCambio(x)}));
    }
    function mismaInstantanea(a,b){return firmaReservaCambio(a)===firmaReservaCambio(b);}
    function fusionarHistorialCambios(registro,resultado,generacion){
        const cambios=lista(registro?.cambios).map(x=>structuredClone(x)),nuevos=extraerCambiosDetectados(resultado,generacion);
        for(const nuevo of nuevos){
            if(cambios.some(x=>x.id===nuevo.id))continue;
            const indice=cambios.findIndex(x=>x.actual&&nuevo.anterior&&mismaInstantanea(x.actual,nuevo.anterior));
            if(indice<0){cambios.push(nuevo);continue;}
            const anterior=cambios[indice];
            if(nuevo.tipo==='cancelacion'){cambios[indice]=nuevo;continue;}
            if(anterior.tipo==='nueva'){
                const fusion={...anterior,actual:nuevo.actual,detectado_generacion:nuevo.detectado_generacion};
                fusion.id=idCambio(fusion);cambios[indice]=fusion;continue;
            }
            const porCampo=new Map(lista(anterior.cambios).map(x=>[x.campo,structuredClone(x)]));
            for(const cambio of lista(nuevo.cambios)){
                const previo=porCampo.get(cambio.campo);
                porCampo.set(cambio.campo,previo?{...cambio,antes:previo.antes}:structuredClone(cambio));
            }
            const fusion={...anterior,actual:nuevo.actual,cambios:[...porCampo.values()],detectado_generacion:nuevo.detectado_generacion};
            fusion.id=idCambio(fusion);cambios[indice]=fusion;
        }
        return {version:1,actualizado_en:new Date().toISOString(),cambios};
    }
    function cambioPendiente(cambio={}){
        const campo=cambio.campo||'Dato',antes=cambio.antes,ahora=cambio.ahora;
        const etiqueta=etiquetas[campo]||campo.replace(/_/g,' ');
        if(/notas|pagos_pendientes|servicios/i.test(campo))return `<dt>${escapar(etiqueta)}</dt><dd>Antes en el Libro: ${escapar(resumenNota(valor(antes)))}<br>Ahora en el Libro: ${escapar(resumenNota(valor(ahora)))}<br>En Proyecto H: ${escapar(resumenNota(explicar(cambio.proyecto)))}</dd>`;
        return `<dt>${escapar(etiqueta)}</dt><dd>${sensible(campo)?'Este dato cambió en el Libro. No se muestra aquí por privacidad.':`Antes en el Libro: ${escapar(valor(antes,campo))}<br>Ahora en el Libro: ${escapar(valor(ahora,campo))}<br>En Proyecto H: ${escapar(valor(cambio.proyecto,campo))}`}</dd>`;
    }
    function detallePendiente(item){
        if(item.tipo==='nueva'){
            // Sólo afirmar que falta cuando la revisión ya permite preparar el alta.
            if(item.accionable)return '<p>Falta incorporar esta reserva en Proyecto H.</p>';
            const motivo=item.proyecto&&!['sin_coincidencia','sin coincidencia','ambigua'].includes(item.proyecto)
                ?`<p>${escapar(explicar(item.proyecto))}</p>`:'';
            return '<p>Hay que revisar si esta reserva ya está registrada en Proyecto H.</p>'+motivo;
        }
        if(item.tipo==='cancelacion')return `<p>Esta reserva figura cancelada en el Libro. Revisa su estado en Proyecto H antes de confirmar la cancelación.</p><p>En Proyecto H: ${escapar(valor(item.proyecto,'estado_operativo'))}.</p>`;
        return `<dl>${lista(item.cambios).map(cambioPendiente).join('')}</dl>`;
    }
    function renderizarPendientes(pendientes={}){
        const items=lista(pendientes.items),accionables=items.filter(x=>x.accionable).length;
        let html='<section class="haku-libro-pendientes haku-pendientes-compactos haku-actualizacion-sites__historial" aria-label="Qué falta resolver en Proyecto H"><header class="haku-actualizacion-sites__historial-head"><div><span>DEL LIBRO A PROYECTO H</span><strong>Qué falta resolver en Proyecto H</strong></div><span class="haku-actualizacion-sites__chip">Revisado en Proyecto H</span></header>';
        if(!items.length)html+='<p class="haku-libro-sin-pendientes"><strong>No quedan cambios pendientes en este informe.</strong></p>';
        else{
            html+=`<div class="haku-actualizacion-sites__historial-metricas"><div><span>Casos pendientes</span><strong>${items.length}</strong></div><div><span>Listos para tu revisión</span><strong>${accionables}</strong></div></div>`;
            html+=`<p class="haku-pendientes-resumen">Hay ${items.length} caso${items.length===1?'':'s'} por resolver. ${accionables?`Puedes revisar ${accionables} con «Revisar cambios» antes de guardarlos.`:'Revisa los detalles de cada caso.'} Nada se guarda sin tu confirmación.${pendientes.revisionServicios?.reservas?.length?' Para los servicios y las notas, pulsa «Revisar servicios y notas».':''}</p>`;
            for(const [indice,registro] of items.entries()){
                const item=registro.tipo==='modificacion'&&registro.proyecto&&!registro.sistema?
                    {...registro,cambios:lista(registro.cambios).map(c=>({...c,proyecto:registro.proyecto}))}:registro;
                const r=item.actual||item.anterior||{};
                const etiqueta=item.detectado_generacion===pendientes.generacion?'DE ESTA ACTUALIZACIÓN':'PENDIENTE DE UNA ACTUALIZACIÓN ANTERIOR';
                html+=`<details class="haku-pendiente-item haku-actualizacion-sites__pendiente ${item.accionable?'':'haku-actualizacion-sites__pendiente--revision'}"><summary><span>CAB ${escapar(r.cabana??'—')} · ${escapar(r.titular||'Nombre no indicado')}</span><span aria-hidden="true">⌄</span></summary><div class="haku-pendiente-detalle"><small>${etiqueta}</small><p>Entrada: ${escapar(fecha(r.fecha_checkin))} · Salida: ${escapar(fecha(r.fecha_checkout))}${r.tipo_estadia==='full_day'?' · Full Day':''}</p>${detallePendiente(item)}<p class="haku-pendiente-estado"><strong>${item.estado==='pendiente'?'Pendiente de confirmar':'Necesita revisión'}</strong></p><div class="haku-actualizacion-sites__historial-acciones" style="padding:0;border:0">${item.sistema?.reserva_id?`<button type="button" class="haku-actualizacion-sites__boton" data-haku-ver-reserva="${indice}">Ver reserva</button>`:''}${esAdministrador()&&item.preparacion?`<button type="button" class="haku-actualizacion-sites__boton haiku-incorporacion-manual-accion" data-haku-aprobar-pendiente="${indice}">Aprobación manual</button>`:''}</div></div></details>`;
            }
        }
        html+='<div class="haku-libro-pendientes-acciones haku-actualizacion-sites__historial-acciones"><button type="button" class="haku-libro-revalidar haku-actualizacion-sites__boton" data-haku-revalidar-proyecto>Volver a revisar</button>';
        if(items.some(x=>x.accionable)&&pendientes.preparacion?.reservas?.length)html+='<button type="button" class="haku-libro-preparar haku-actualizacion-sites__boton haku-actualizacion-sites__boton--primario" data-haku-preparar-pendientes>Revisar cambios</button>';
        if(pendientes.revisionServicios?.reservas?.length)html+='<button type="button" class="haku-actualizacion-sites__boton" data-haku-revisar-servicios>Revisar servicios y notas</button>';
        return html+'</div></section>';
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
                    generacionesResultado.set(resultado, g);
                    if (g != null && ['ok','sin_cambios','sin_linea_base','parcial'].includes(resultado.estado)) cache = {generacion:g,resultado};
                    return resultado;
                });
                try { return await pendiente; } finally { pendiente = undefined; }
            }
        };
    }
    function crearCachePendientes(dependencias = {}) {
        let cache, pendiente, revision = 0;
        const generacionActual = dependencias.generacion || (()=>root.HAIKU_LIBRO_RESERVA_V1?.estado?.().generacion);
        const leer = dependencias.leer || (()=>root.HAIKU_LIBRO_RESERVA_V1?.leerCambiosDetectados?.());
        const guardar = dependencias.guardar || (registro=>root.HAIKU_LIBRO_RESERVA_V1?.guardarCambiosDetectados?.(registro));
        const revalidarCambios = dependencias.revalidarCambios || ((cambios,opciones)=>root.HAIKU_LIBRO_CONSULTAS?.revalidarCambiosDetectados?.(cambios,root.haikuSupabase,opciones));
        const generacionResultado = resultado => resultado?.libro_actual?.generacion ?? generacionesResultado.get(resultado);
        const validar = g => {
            if (g == null) throw new Error('No puedo comprobar a qué versión del Libro corresponde este informe. Pide uno nuevo.');
            if (generacionActual?.() !== g) throw new Error('El Libro cambió desde este informe. Genera el informe nuevamente.');
        };
        return {
            invalidar() { revision++; cache = undefined; },
            async obtener(resultado,{revalidar=false}={}) {
                const g=generacionResultado(resultado),rev=revision; validar(g);
                if (!revalidar && cache?.generacion===g) return cache.resultado;
                if (pendiente) return pendiente;
                pendiente=(async()=>{
                    const previo=await leer()||{version:1,cambios:[]};
                    let registro=fusionarHistorialCambios(previo,resultado,g);
                    if(JSON.stringify(registro.cambios)!==JSON.stringify(lista(previo.cambios)))await guardar(registro);
                    validar(g);
                    const resultadoPendientes=await revalidarCambios(registro.cambios,{generacion:g});
                    if(!resultadoPendientes)throw new Error('No pude revalidar los cambios detectados contra Proyecto H.');
                    if(resultadoPendientes.resueltos?.length){
                        const resueltos=new Set(resultadoPendientes.resueltos);
                        registro={...registro,actualizado_en:new Date().toISOString(),cambios:registro.cambios.filter(x=>!resueltos.has(x.id))};
                        await guardar(registro);
                    }
                    resultadoPendientes.generacion=g;
                    if(resultadoPendientes.reservas?.length)Object.defineProperty(resultadoPendientes,'preparacion',{value:{
                        reservas:resultadoPendientes.reservas,comparacion:resultadoPendientes.comparacion,generacion:g,q:resultadoPendientes.q
                    },enumerable:false});
                    validar(g);
                    if (rev!==revision) throw new Error('El Libro cambió durante la comparación. Genera el informe nuevamente.');
                    cache={generacion:g,resultado:resultadoPendientes};
                    return resultadoPendientes;
                })();
                try{return await pendiente;}finally{pendiente=undefined;}
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
        const cache = crearCache(async()=> {
            if (!root.HAIKU_LIBRO_DIFERENCIAS_V1) throw new Error('El comparador del Libro todavía no está disponible.');
            const resultado=await root.HAIKU_LIBRO_DIFERENCIAS_V1.compararUltimasVersiones();
            try{
                const libro=root.HAIKU_LIBRO_RESERVA_V1,g=libro?.estado?.().generacion;
                if(libro?.leerCambiosDetectados&&libro?.guardarCambiosDetectados){
                    const previo=await libro.leerCambiosDetectados()||{version:1,cambios:[]};
                    const fusion=fusionarHistorialCambios(previo,resultado,g);
                    if(JSON.stringify(fusion.cambios)!==JSON.stringify(lista(previo.cambios)))await libro.guardarCambiosDetectados(fusion);
                }
            }catch(error){console.warn('HAIKU · No se pudo conservar el historial local de cambios:',error);}
            return resultado;
        },()=>root.HAIKU_LIBRO_RESERVA_V1?.estado().generacion);
        cacheCompartida = cache;
        const cachePendientes=crearCachePendientes();
        root.addEventListener('haiku:libro-cambio',()=>{cache.invalidar();cachePendientes.invalidar();});
        function mensaje(tipo,texto) {
            const el = doc.createElement('div'); el.className = `haiku-asistente-mensaje haiku-asistente-mensaje--${tipo}`; el.textContent = texto; mensajes.appendChild(el); mensajes.scrollTop = mensajes.scrollHeight; return el;
        }
        function enlazarCabecera(contenedor) {
            const cerrar=contenedor.querySelector?.('[data-haku-cerrar-actualizacion]');
            cerrar?.addEventListener?.('click',()=>doc.getElementById('haiku-asistente-cerrar')?.click());
        }
        function adjuntarPendientes(contenedor,resultado) {
            const zona=doc.createElement('div');zona.className='haku-libro-pendientes-zona';
            (contenedor.querySelector?.('.haku-actualizacion-sites__tarjeta')||contenedor).appendChild(zona);
            const cargar=async revalidar=>{
                zona.innerHTML='<section class="haku-libro-pendientes"><p>Revisando qué falta guardar en Proyecto H…</p></section>';
                try{
                    const pendientes=await cachePendientes.obtener(resultado,{revalidar});
                    zona.innerHTML=renderizarPendientes(pendientes);
                    for(const ver of zona.querySelectorAll?.('[data-haku-ver-reserva]')||[]){
                        ver.addEventListener('click',()=>{
                            const item=pendientes.items[Number(ver.dataset.hakuVerReserva)];
                            if(item?.sistema?.reserva_id)(root.HAIKU_INSPECTOR_V1||root.HAIKU_PANELES_V1)?.abrirReserva?.(item.sistema.reserva_id,ver);
                        });
                    }
                    for(const manual of zona.querySelectorAll?.('[data-haku-aprobar-pendiente]')||[]){
                        manual.addEventListener('click',async()=>{
                            if(manual.disabled)return;
                            const item=pendientes.items[Number(manual.dataset.hakuAprobarPendiente)];
                            if(!esAdministrador()||!item?.preparacion)return;
                            manual.disabled=true;manual.setAttribute?.('aria-busy','true');
                            const destino=manual.closest('.haku-pendiente-detalle');
                            destino.querySelector?.('.haku-libro-preparacion-zona')?.remove?.();
                            const vista=doc.createElement('div');vista.className='haku-libro-preparacion-zona';
                            vista.textContent='Comprobando este cambio antes de pedir tu confirmación…';destino.appendChild(vista);
                            try{
                                if(!root.HAIKU_LIBRO_CONSULTAS?.abrirPreparacionComparacion)throw Error('Recarga Proyecto H para abrir la revisión.');
                                await root.HAIKU_LIBRO_CONSULTAS.abrirPreparacionComparacion(vista,item.preparacion);
                                vista.scrollIntoView?.({block:'nearest'});
                            }catch(error){
                                if(error?.haikuSinCambiosPreparables){await cargar(true);return;}
                                vista.textContent=error?.message||'No se pudo abrir la revisión.';vista.setAttribute?.('role','alert');
                            }finally{manual.disabled=false;manual.removeAttribute?.('aria-busy');}
                        });
                    }
                    const boton=zona.querySelector?.('[data-haku-revalidar-proyecto]');
                    boton?.addEventListener?.('click',async()=>{
                        if(boton.disabled)return;
                        boton.disabled=true;boton.setAttribute?.('aria-busy','true');boton.textContent='Revisando…';
                        await cargar(true);
                    });
                    const preparar=zona.querySelector?.('[data-haku-preparar-pendientes]');
                    const servicios=zona.querySelector?.('[data-haku-revisar-servicios]');
                    servicios?.addEventListener?.('click',async()=>{
                        if(servicios.disabled)return;servicios.disabled=true;servicios.setAttribute?.('aria-busy','true');
                        zona.querySelector?.('.haku-libro-revision-servicios-zona')?.remove?.();
                        const vista=doc.createElement('div');vista.className='haku-libro-revision-servicios-zona';
                        const card=doc.createElement('div');card.textContent='Revisando los servicios y las notas en el Libro y en Proyecto H…';vista.appendChild(card);zona.appendChild(vista);
                        try{
                            const api=root.HAIKU_LIBRO_SERVICIOS_SCOPE_V2;
                            if(!api?.abrirRevisionHistorial)throw Error('No está disponible la revisión de servicios y notas. Recarga Proyecto H.');
                            await api.abrirRevisionHistorial(card,pendientes.revisionServicios);vista.scrollIntoView?.({block:'nearest'});
                        }catch(error){card.textContent=error?.message||'No se pudo revisar servicios y notas.';card.setAttribute?.('role','alert');}
                        finally{servicios.disabled=false;servicios.removeAttribute?.('aria-busy');}
                    });
                    preparar?.addEventListener?.('click',async()=>{
                        preparar.disabled=true;
                        preparar.setAttribute?.('aria-busy','true');
                        const anterior=zona.querySelector?.('.haku-libro-preparacion-zona');anterior?.remove?.();
                        const vista=doc.createElement('div');vista.className='haku-libro-preparacion-zona';vista.textContent='Comprobando los datos y preparando los cambios para tu revisión…';zona.appendChild(vista);
                        vista.scrollIntoView?.({block:'nearest'});
                        try{
                            if(!root.HAIKU_LIBRO_CONSULTAS?.abrirPreparacionComparacion)throw new Error('No pude abrir la revisión de cambios. Recarga Proyecto H e inténtalo de nuevo.');
                            await root.HAIKU_LIBRO_CONSULTAS.abrirPreparacionComparacion(vista,pendientes.preparacion);
                            vista.scrollIntoView?.({block:'nearest'});
                        }catch(error){
                            if(error?.haikuSinCambiosPreparables){await cargar(true);return;}
                            vista.classList?.add?.('haku-libro-pendientes-error');vista.textContent=error?.message||'No se pudo preparar la incorporación.';preparar.disabled=false;
                        }
                        finally{preparar.removeAttribute?.('aria-busy');mensajes.scrollTop=mensajes.scrollHeight;}
                    });
                }catch(error){
                    zona.innerHTML=`<section class="haku-libro-pendientes"><header class="haiku-asistente-preview-cabecera"><div><span>DEL LIBRO A PROYECTO H</span><strong>Qué falta resolver en Proyecto H</strong></div></header><p class="haku-libro-pendientes-error">No pude comprobar qué cambios siguen pendientes en Proyecto H.${error?.message ? ` ${escapar(error.message)}` : ''}</p></section>`;
                    const boton=doc.createElement('button');boton.type='button';boton.className='haku-libro-revalidar';boton.textContent='Volver a revisar';
                    boton.addEventListener?.('click',async()=>{boton.disabled=true;await cargar(true);});zona.appendChild(boton);
                }
                mensajes.scrollTop=mensajes.scrollHeight;
            };
            void cargar(false);
            return zona;
        }
        insertarResultado = resultado => {
            const el = mensaje('asistente','');
            el.innerHTML = renderizar(resultado);
            enlazarCabecera(el);
            root.HAIKU_ASISTENTE_LIBRO_INCORPORACION_V1?.adjuntar(el, resultado, generacionesResultado.get(resultado));
            adjuntarPendientes(el,resultado);
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
                enlazarCabecera(espera);
                root.HAIKU_ASISTENTE_LIBRO_INCORPORACION_V1?.adjuntar(espera, resultado, generacionesResultado.get(resultado));
                adjuntarPendientes(espera,resultado);
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
    const api = Object.freeze({esConsulta,renderizar,renderizarPendientes,extraerCambiosDetectados,fusionarHistorialCambios,
        crearCache,crearCachePendientes,instalar,obtenerResultado,mostrarResultado});
    root.HAIKU_ASISTENTE_LIBRO_ACTUALIZACION_V1 = api;
    if (typeof module !== 'undefined') module.exports = api;
    if (root.document && !instalar()) {
        const observer = new root.MutationObserver(()=>{if(instalar()) observer.disconnect();});
        observer.observe(root.document.documentElement,{childList:true,subtree:true});
        root.addEventListener('load',()=>{if(instalar()) observer.disconnect();},{once:true});
    }
})(typeof window !== 'undefined' ? window : globalThis);
