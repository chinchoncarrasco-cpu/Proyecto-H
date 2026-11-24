// Áreas comunes: Supabase confirma los cambios; no utiliza el caché de reservas.
(() => {
    'use strict';
    if (window.HAIKU_TAREAS_GENERALES_V1) return;
    const raiz = document.getElementById('cabinsGeneralTasks');
    if (!raiz) return;
    const dias = new Map(), abiertos = new Set(), borradores = new Map(), pendientes = new Set();
    const intentos = new Map(), mensajes = new Map(), historias = new Map();
    const etiquetas = { pendiente: 'Pendiente', en_curso: 'En curso', realizada: 'Realizada', verificada: 'Verificada', con_detalles: 'Con detalles' };
    const acciones = { asignar: 'Asignación guardada', iniciar: 'Tarea iniciada', realizar: 'Tarea realizada: queda por verificar', verificar: 'Tarea verificada', corregir: 'Corrección solicitada', nota: 'Nota guardada' };
    let fechaVista = '', usuario = '', generacion = 0, canal = null, temporizador = null, historialAbierto = false;
    let aviso = '', authInstalado = false, anterioresAbiertos = true;
    const cliente = () => window.haikuSupabase;
    const usuarioActual = () => String(window.haikuSesion?.auth?.id || '');
    const fechaActual = () => typeof fechaSeleccionada === 'undefined' ? '' : String(fechaSeleccionada || '').slice(0, 10);
    const clave = t => `${t.fecha_operativa}:${t.tipo}`;
    const escapar = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const textoFecha = f => /^\d{4}-\d{2}-\d{2}$/.test(f) ? f.split('-').reverse().join('/') : '—';
    function hora(valor) {
        if (!valor || !Number.isFinite(Date.parse(valor))) return '—';
        return new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(valor));
    }
    const estadoDia = fecha => {
        if (!dias.has(fecha)) dias.set(fecha, { datos: null, error: '', fresco: false, lectura: null });
        return dias.get(fecha);
    };
    const filas = () => {
        const datos = dias.get(fechaVista)?.datos;
        return [...(datos?.tareas || []), ...(datos?.anteriores || [])];
    };
    const buscar = id => filas().find(t => clave(t) === id);
    function reiniciar() {
        generacion++;
        if (canal) cliente()?.removeChannel?.(canal);
        canal = null;
        clearTimeout(temporizador);
        dias.clear(); abiertos.clear(); borradores.clear(); pendientes.clear(); intentos.clear(); mensajes.clear(); historias.clear();
        historialAbierto = false; aviso = ''; usuario = usuarioActual();
    }
    function instalarSesion() {
        if (usuario !== usuarioActual()) reiniciar();
        if (!cliente() || !usuario) return;
        if (!authInstalado && cliente().auth?.onAuthStateChange) {
            authInstalado = true;
            cliente().auth.onAuthStateChange(evento => {
                if (evento === 'SIGNED_OUT') {
                    reiniciar(); usuario = ''; renderizar(true);
                }
            });
        }
        if (!canal && cliente().channel) {
            canal = cliente().channel(`haku-tareas-generales:${usuario}`)
                .on('postgres_changes', { event: '*', schema: 'public', table: 'tareas_generales' }, () => {
                    clearTimeout(temporizador);
                    temporizador = setTimeout(() => { void cargar(fechaVista, { forzar: true }); }, 180);
                }).subscribe();
        }
    }
    async function cargar(fecha = fechaActual(), { forzar = false } = {}) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return;
        instalarSesion();
        if (fechaVista !== fecha) { fechaVista = fecha; historialAbierto = false; aviso = ''; renderizar(true); }
        if (!cliente()?.rpc || !usuario) { renderizar(); return; }
        const dia = estadoDia(fecha);
        if (dia.lectura) { if (forzar) dia.lectura.repetir = true; return dia.lectura.promesa; }
        if (!forzar && dia.fresco) { renderizar(); return; }
        const sesion = generacion, identidad = usuario;
        const lectura = { repetir: false, promesa: null };
        dia.lectura = lectura;
        lectura.promesa = (async () => {
            do {
                lectura.repetir = false;
                let limite;
                try {
                    let consulta = cliente().rpc('haiku_tareas_generales_dia_v1', { p_fecha: fecha });
                    if (typeof consulta.abortSignal === 'function' && globalThis.AbortSignal?.timeout) {
                        limite = globalThis.AbortSignal.timeout(20_000);
                        consulta = consulta.abortSignal(limite);
                    }
                    const { data, error, status } = await consulta;
                    if (sesion !== generacion || identidad !== usuarioActual()) return;
                    if (error) throw status >= 500 ? new Error('El servicio de tareas no respondió.') : error;
                    if (!data || data.fecha !== fecha || !Array.isArray(data.tareas) || !Array.isArray(data.anteriores)) throw new Error('No se pudo comprobar la fecha de las tareas.');
                    dia.datos = data; dia.error = ''; dia.fresco = true;
                } catch (error) {
                    if (sesion !== generacion || identidad !== usuarioActual()) return;
                    dia.error = limite?.aborted ? 'La consulta de tareas tardó demasiado.' : error?.message || 'No se pudieron cargar las tareas.';
                    lectura.repetir = false;
                    dia.fresco = true;
                }
                if (fechaVista === fecha) renderizar();
            } while (lectura.repetir && sesion === generacion);
        })().finally(() => {
            if (sesion === generacion && dia.lectura === lectura) { dia.lectura = null; if (fechaVista === fecha) renderizar(); }
        });
        renderizar();
        return lectura.promesa;
    }
    async function guardar(id, accion, datos = {}, reintentar = false) {
        const tarea = buscar(id), dia = estadoDia(fechaVista);
        if (!tarea || pendientes.has(id) || !dia.datos?.puede_editar || dia.error || usuario !== usuarioActual()) return false;
        if (intentos.has(id) && !reintentar) return false;
        const revisionVisible = Number(raiz.querySelector(`[data-tg-key="${id}"]`)?.dataset.tgRevision ?? tarea.revision);
        if (!reintentar && revisionVisible !== Number(tarea.revision)) {
            mensajes.set(id, { texto: 'La tarea cambió mientras la editabas. Revisa la información actualizada antes de guardar.', error: true });
            renderizar(true); return false;
        }
        const sesion = generacion, identidad = usuario;
        const intento = reintentar ? intentos.get(id) : {
            p_fecha: tarea.fecha_operativa, p_tipo: tarea.tipo, p_revision: tarea.revision,
            p_accion: accion, p_datos: datos, p_operacion: window.crypto.randomUUID()
        };
        if (!intento) return false;
        intentos.set(id, intento); pendientes.add(id); mensajes.delete(id); renderizar(true);
        try {
            const { data, error } = await cliente().rpc('haiku_guardar_tarea_general_v1', intento);
            if (sesion !== generacion || identidad !== usuarioActual()) return false;
            if (error) throw error;
            if (!data?.tarea || data.tarea.fecha_operativa !== intento.p_fecha || data.tarea.tipo !== intento.p_tipo || !Number.isFinite(Number(data.tarea.revision))) throw new Error('No se pudo confirmar el cambio. Reintenta para comprobarlo.');
            intentos.delete(id);
            const borrador = { ...borradores.get(id) };
            if (intento.p_accion === 'asignar') { delete borrador.encargado; delete borrador.revisor; }
            if (['nota', 'corregir'].includes(intento.p_accion)) delete borrador.nota;
            if (Object.keys(borrador).length) borradores.set(id, borrador); else borradores.delete(id);
            historias.clear();
            const mensaje = `${tarea.titulo} (${textoFecha(tarea.fecha_operativa)}): ${acciones[intento.p_accion]}.`;
            mensajes.set(id, { texto: mensaje, error: false }); aviso = mensaje;
            for (const d of dias.values()) d.fresco = false;
            await cargar(fechaVista, { forzar: true });
            if (historialAbierto) await historial(fechaVista);
            await Promise.all(filas().filter(t => abiertos.has(clave(t))).map(t => historial(t.fecha_operativa, t.tipo)));
            return true;
        } catch (error) {
            if (sesion !== generacion || identidad !== usuarioActual()) return false;
            // Un error SQL confirma el rechazo. Un fallo de transporte conserva el UUID
            // para comprobar el mismo intento sin duplicar movimientos.
            if (error?.code && !String(error.code).startsWith('PGRST')) intentos.delete(id);
            mensajes.set(id, { texto: error?.message || 'Resultado no confirmado. Reintenta el mismo cambio para comprobarlo.', error: true });
            await cargar(fechaVista, { forzar: true });
            return false;
        } finally {
            if (sesion === generacion) { pendientes.delete(id); renderizar(true); }
        }
    }
    async function historial(fecha, tipo = null) {
        const id = `${fecha}:${tipo || '*'}`, sesion = generacion, identidad = usuario;
        if (historias.has(id)) return;
        historias.set(id, { cargando: true }); renderizar();
        try {
            const { data, error } = await cliente().rpc('haiku_tareas_generales_historial_v1', { p_fecha: fecha, p_tipo: tipo });
            if (sesion !== generacion || identidad !== usuarioActual()) return;
            if (error) throw error;
            historias.set(id, { filas: Array.isArray(data) ? data : [] });
        } catch (error) { if (sesion === generacion) historias.set(id, { error: error?.message || 'No se pudo cargar el historial.' }); }
        if (sesion === generacion) renderizar();
    }
    function historialHTML(fecha, tipo = null) {
        const historia = historias.get(`${fecha}:${tipo || '*'}`);
        if (!historia || historia.cargando) return '<p class="tg-meta">Cargando historial…</p>';
        if (historia.error) return `<p class="tg-error">${escapar(historia.error)}</p><button type="button" class="cb-text-action" data-tg-history-retry="${escapar(`${fecha}:${tipo || '*'}`)}">Reintentar historial</button>`;
        return `<p class="tg-meta">Últimos 100 movimientos · hora de Chile</p>${historia.filas.length ? `<ol class="tg-history">${historia.filas.map(m => `<li><div><strong>${escapar(m.titulo)}</strong><span>${escapar(acciones[m.accion] || m.accion)}</span></div><small>${escapar(m.actor_nombre)} · ${escapar(new Date(m.creado_en).toLocaleDateString('es-CL', { timeZone: 'America/Santiago' }))} ${hora(m.creado_en)}</small>${m.detalle?.nota ? `<p>${escapar(m.detalle.nota)}</p>` : ''}${m.accion === 'asignar' ? `<p>${m.detalle?.encargado != null ? `Responsable: ${escapar(m.detalle.encargado || 'Sin asignar')}` : ''}${m.detalle?.revisor != null ? ` · Revisor: ${escapar(m.detalle.revisor || 'Sin asignar')}` : ''}</p>` : ''}</li>`).join('')}</ol>` : '<p class="tg-meta">Sin movimientos registrados.</p>'}`;
    }
    const asignacionPendiente = t => {
        const b = borradores.get(clave(t)) || {};
        return String(b.encargado ?? t.encargado ?? '').trim() !== (t.encargado || '') || String(b.revisor ?? t.revisor ?? '').trim() !== (t.revisor || '');
    };
    const responsableVista = t => String(borradores.get(clave(t))?.encargado ?? t.encargado ?? '').trim();
    const avisoSinResponsable = 'Asigna un responsable para iniciar o completar.';
    const ayudaEstado = t => !responsableVista(t) ? avisoSinResponsable : asignacionPendiente(t) ? 'Se guardará primero la asignación.' : '';
    async function cambiarEstado(id, accion) {
        const t = buscar(id), sesion = generacion, fecha = fechaVista;
        if (!t || !responsableVista(t)) return;
        if (asignacionPendiente(t)) {
            const b = borradores.get(id) || {};
            const confirmada = await guardar(id, 'asignar', { encargado: responsableVista(t), revisor: String(b.revisor ?? t.revisor ?? '').trim() });
            if (!confirmada || sesion !== generacion || fecha !== fechaVista) return;
        }
        await guardar(id, accion);
    }
    const bloqueada = (id, permisos) => pendientes.has(id) || !permisos.puede_editar || intentos.has(id) || Boolean(estadoDia(fechaVista).error);
    function actualizarControles(fila) {
        const id = fila?.dataset.tgKey, t = buscar(id), permisos = dias.get(fechaVista)?.datos;
        if (!t || !permisos) return;
        const bloqueo = bloqueada(id, permisos), cambios = asignacionPendiente(t), b = borradores.get(id) || {};
        const guardarAsignacion = fila.querySelector('[data-tg-save-assignment]');
        if (guardarAsignacion) guardarAsignacion.disabled = bloqueo || !cambios;
        const estado = fila.querySelector('[data-tg-state]');
        if (estado) {
            estado.disabled = bloqueo || !responsableVista(t);
            estado.title = ayudaEstado(t);
            const ayuda = fila.querySelector('[data-tg-state-hint]');
            if (ayuda) { ayuda.textContent = ayudaEstado(t); ayuda.hidden = !ayuda.textContent; }
        }
        fila.querySelectorAll('[data-tg-workflow]').forEach(boton => { boton.disabled = bloqueo || cambios; });
        const guardarNota = fila.querySelector('[data-tg-action="nota"]');
        if (guardarNota) guardarNota.disabled = bloqueo || !String(b.nota || '').trim() || String(b.nota).trim() === (t.nota || '');
    }
    function filaHTML(t, permisos, anterior = false) {
        const id = clave(t), abierto = abiertos.has(id), ocupado = pendientes.has(id), b = borradores.get(id) || {};
        const terminada = ['realizada', 'verificada'].includes(t.estado), bloqueo = bloqueada(id, permisos);
        const campos = bloqueo || terminada ? ' disabled' : '', cambios = asignacionPendiente(t);
        const revision = t.estado === 'verificada' ? `${t.verificada_por_nombre} · ${hora(t.verificada_en)}` : t.estado === 'realizada' ? 'Por verificar' : '';
        const opciones = ['pendiente', 'con_detalles'].includes(t.estado) ? '<option value="iniciar">En curso</option><option value="realizar">Realizada</option>' : t.estado === 'en_curso' ? '<option value="realizar">Realizada</option>' : '';
        const idAyuda = escapar(`tg-ayuda-${id}`), ayuda = escapar(ayudaEstado(t));
        const workflow = bloqueo || cambios ? ' disabled' : '';
        const mensaje = mensajes.get(id);
        return `<article class="tg-task${anterior ? ' tg-task-previous' : ''}" data-tg-key="${escapar(id)}" data-tg-revision="${t.revision}" aria-busy="${ocupado}">
          <form class="tg-row" data-tg-assignment aria-label="${escapar(t.titulo)}">
          <div class="tg-title"><strong>${escapar(t.titulo)}</strong><small>${escapar(t.descripcion)}</small>${anterior ? `<span class="tg-previous-label">Pendiente del ${textoFecha(t.fecha_operativa)}</span>` : ''}</div>
          <div class="tg-person"><label><span class="tg-mobile-label">Responsable</span><input name="encargado" data-tg-field="encargado" aria-label="Responsable de ${escapar(t.titulo)}" maxlength="120" list="cabinsStaff" placeholder="Sin asignar" value="${escapar(b.encargado ?? t.encargado)}"${campos}></label>${!terminada && permisos.puede_editar ? `<button type="submit" class="cb-text-action" aria-label="Guardar asignación" data-tg-save-assignment${bloqueo || !cambios ? ' disabled' : ''}>Guardar</button>` : ''}</div>
          <div class="tg-state">${permisos.puede_editar && opciones ? `<select class="tg-badge tg-${escapar(t.estado)}" data-tg-state aria-label="Estado de ${escapar(t.titulo)}" aria-describedby="${idAyuda}"${bloqueo || !responsableVista(t) ? ' disabled' : ''} title="${ayuda}"><option value="">${escapar(etiquetas[t.estado])}</option>${opciones}</select><small id="${idAyuda}" data-tg-state-hint${ayuda ? '' : ' hidden'}>${ayuda}</small>` : `<span class="tg-badge tg-${escapar(t.estado)}">${escapar(etiquetas[t.estado] || t.estado)}</span>`}${t.iniciada_en ? `<small>Inició ${hora(t.iniciada_en)}</small>` : ''}${t.realizada_en ? `<small class="tg-mobile-time">Realizada ${hora(t.realizada_en)}</small>` : ''}</div>
          <div class="tg-completed"><span class="tg-mobile-label">Realizada</span><time>${hora(t.realizada_en)}</time></div>
          <div class="tg-review"><label><span class="tg-mobile-label">Revisor</span><input name="revisor" data-tg-field="revisor" aria-label="Revisor de ${escapar(t.titulo)}" maxlength="120" list="cabinsStaff" placeholder="Sin revisor" value="${escapar(b.revisor ?? t.revisor)}"${campos}></label>${revision ? `<small>${escapar(revision)}</small>` : ''}${permisos.puede_verificar && terminada ? `<div class="tg-actions">${t.estado === 'realizada' ? `<button type="button" class="cb-text-action" aria-label="Verificar tarea" data-tg-action="verificar" data-tg-workflow${workflow}>Verificar</button>` : ''}<button type="button" class="cb-text-action" aria-label="${t.estado === 'verificada' ? 'Reabrir con detalles' : 'Solicitar corrección'}" data-tg-action="corregir" data-tg-workflow${workflow}>${t.estado === 'verificada' ? 'Reabrir' : 'Corregir'}</button></div>` : ''}</div>
          <div class="tg-notes"><label><textarea data-tg-field="nota" aria-label="Nota de ${escapar(t.titulo)}" maxlength="2000" rows="1" placeholder="Nota o motivo…"${bloqueo ? ' disabled' : ''}>${escapar(b.nota ?? t.nota ?? '')}</textarea></label><div class="tg-actions">${permisos.puede_editar ? `<button type="button" class="cb-text-action" aria-label="Guardar nota" data-tg-action="nota"${bloqueo || !String(b.nota || '').trim() || String(b.nota).trim() === (t.nota || '') ? ' disabled' : ''}>Guardar</button>` : ''}<button type="button" class="cb-text-action" data-tg-open="${escapar(id)}" aria-expanded="${abierto}" aria-label="Historial de ${escapar(t.titulo)}">${abierto ? 'Cerrar historial' : 'Historial'}</button></div></div>
          </form>
          ${ocupado ? '<p class="tg-row-feedback" role="status">Guardando…</p>' : ''}
          ${intentos.has(id) && !ocupado ? '<button type="button" class="cb-outline tg-retry" data-tg-action="reintentar">Reintentar el mismo cambio</button>' : ''}
          ${mensaje?.error ? `<p class="tg-error tg-row-feedback" role="alert">${escapar(mensaje.texto)}</p>` : ''}
          ${abierto ? `<section class="tg-task-history" aria-label="Historial de ${escapar(t.titulo)}">${historialHTML(t.fecha_operativa, t.tipo)}</section>` : ''}</article>`;
    }
    function renderizar(forzar = false) {
        const focoHistorial = document.activeElement?.dataset?.tgOpen;
        if (!forzar && !focoHistorial && !document.activeElement?.hasAttribute?.('data-tg-history-retry') && raiz.contains(document.activeElement) && document.activeElement?.matches?.('input,textarea,select,button')) return;
        const dia = dias.get(fechaVista), datos = dia?.datos;
        const encabezado = '<div class="cb-section-head"><div><h2 id="cabinsGeneralTasksTitle">Tareas generales</h2><p>Limpieza de áreas comunes y lavandería</p></div><div class="tg-header-actions"><button type="button" class="cb-text-action" data-tg-refresh>Actualizar</button><button type="button" class="cb-outline" data-tg-global-history aria-expanded="' + historialAbierto + '">Historial</button></div></div>';
        if (!usuario || usuario !== usuarioActual() || !cliente()?.rpc) {
            raiz.innerHTML = `${encabezado}<p class="tg-meta">Inicia sesión en el panel para consultar las tareas generales.</p>`; return;
        }
        const error = dia?.error ? `<p class="tg-error" role="alert">${escapar(dia.error)} Pulsa Actualizar para volver a comprobarlas.</p>` : '';
        if (!datos) { raiz.innerHTML = `${encabezado}${error || '<p class="tg-meta" role="status">Cargando tareas generales…</p>'}`; return; }
        const todas = [...datos.tareas, ...datos.anteriores], contar = estados => todas.filter(t => estados.includes(t.estado)).length;
        const requiereAsignacion = datos.puede_editar && todas.some(t => ['pendiente', 'con_detalles', 'en_curso'].includes(t.estado) && !t.encargado?.trim());
        raiz.innerHTML = `${encabezado}${error}<p class="tg-feedback" role="status">${escapar(aviso)}</p>
          <div class="tg-summary"><span><b>${contar(['pendiente', 'con_detalles'])}</b> pendientes</span><span><b>${contar(['en_curso'])}</b> en curso</span><span><b>${contar(['realizada'])}</b> por verificar</span><span><b>${contar(['verificada'])}</b> verificadas</span>${requiereAsignacion ? `<p class="tg-assignment-guide">${avisoSinResponsable}</p>` : ''}</div>
          <div class="tg-table"><div class="tg-head" aria-hidden="true"><span>Tarea</span><span>Responsable</span><span>Estado</span><span>Realizada</span><span>Revisor / verificación</span><span>Nota</span></div>${datos.tareas.map(t => filaHTML(t, datos)).join('')}</div>
          ${datos.anteriores.length ? `<details class="tg-previous"${anterioresAbiertos ? ' open' : ''}><summary>Pendientes de turnos anteriores · ${datos.anteriores.length}</summary><div class="tg-table">${datos.anteriores.map(t => filaHTML(t, datos, true)).join('')}</div></details>` : ''}
          <p class="tg-meta tg-guide">Una tarea realizada queda por verificar. Los pendientes conservan su fecha y seguimiento.</p>
          ${historialAbierto ? `<section class="tg-global-history" aria-label="Historial de tareas generales"><h3>Historial · ${textoFecha(fechaVista)}</h3>${historialHTML(fechaVista)}</section>` : ''}`;
        if (focoHistorial) raiz.querySelector(`[data-tg-open="${focoHistorial}"]`)?.focus();
    }
    raiz.addEventListener('input', evento => {
        const campo = evento.target.dataset.tgField, id = evento.target.closest('[data-tg-key]')?.dataset.tgKey;
        if (campo && id) {
            borradores.set(id, { ...borradores.get(id), [campo]: evento.target.value });
            actualizarControles(evento.target.closest('[data-tg-key]'));
        }
    });
    raiz.addEventListener('change', evento => {
        if (!evento.target.matches('[data-tg-state]')) return;
        const accion = evento.target.value, id = evento.target.closest('[data-tg-key]')?.dataset.tgKey;
        evento.target.value = '';
        if (id && ['iniciar', 'realizar'].includes(accion)) void cambiarEstado(id, accion);
    });
    raiz.addEventListener('submit', evento => {
        if (!evento.target.matches('[data-tg-assignment]')) return;
        evento.preventDefault();
        const id = evento.target.closest('[data-tg-key]').dataset.tgKey;
        const encargado = evento.target.querySelector('[name="encargado"]').value.trim(), revisor = evento.target.querySelector('[name="revisor"]').value.trim();
        if (encargado === buscar(id)?.encargado && revisor === buscar(id)?.revisor) return;
        void guardar(id, 'asignar', { encargado, revisor });
    });
    raiz.addEventListener('click', evento => {
        const boton = evento.target.closest('button');
        if (!boton || !raiz.contains(boton)) return;
        if (boton.hasAttribute('data-tg-refresh')) { void cargar(fechaVista, { forzar: true }).then(() => renderizar(true)); return; }
        if (boton.hasAttribute('data-tg-global-history')) {
            historialAbierto = !historialAbierto; renderizar(true);
            if (historialAbierto) void historial(fechaVista);
            return;
        }
        if (boton.dataset.tgHistoryRetry) {
            const id = boton.dataset.tgHistoryRetry, [fecha, tipo] = id.split(':'); historias.delete(id); void historial(fecha, tipo === '*' ? null : tipo); return;
        }
        if (boton.dataset.tgOpen) {
            const id = boton.dataset.tgOpen; if (abiertos.has(id)) abiertos.delete(id); else abiertos.add(id);
            renderizar(true); raiz.querySelector(`[data-tg-open="${id}"]`)?.focus();
            if (abiertos.has(id)) { const [fecha, tipo] = id.split(':'); void historial(fecha, tipo); }
            return;
        }
        const accion = boton.dataset.tgAction, id = boton.closest('[data-tg-key]')?.dataset.tgKey;
        if (!accion || !id) return;
        const nota = (borradores.get(id)?.nota || '').trim();
        if (['nota', 'corregir'].includes(accion) && !nota) {
            mensajes.set(id, { texto: 'Escribe una observación o motivo antes de guardar.', error: true }); renderizar(true);
            raiz.querySelector(`[data-tg-key="${id}"] textarea`)?.focus(); return;
        }
        void guardar(id, accion === 'reintentar' ? '' : accion, ['nota', 'corregir'].includes(accion) ? { nota } : {}, accion === 'reintentar');
    });
    raiz.addEventListener('toggle', evento => {
        if (!raiz.contains(evento.target)) return;
        if (evento.target.matches('.tg-previous')) anterioresAbiertos = evento.target.open;
    }, true);
    raiz.addEventListener('focusout', () => setTimeout(() => { if (!raiz.contains(document.activeElement)) renderizar(); }, 0));
    window.addEventListener('haiku:auth-ready', () => { reiniciar(); void cargar(fechaActual(), { forzar: true }); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void cargar(fechaActual(), { forzar: true }); });
    window.HAIKU_TAREAS_GENERALES_V1 = Object.freeze({ cargar, guardar, historial, hora,
        contexto: () => ({ fecha: fechaVista, usuario, datos: dias.get(fechaVista)?.datos || null, guardando: [...pendientes], error: dias.get(fechaVista)?.error || '' }) });
    void cargar();
})();
