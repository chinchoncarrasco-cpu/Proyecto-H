// HAIKU · Confirmaciones asíncronas y avisos contextuales. Diseño Figma 95:865.
(function (root) {
    'use strict';
    if (root.HAIKU_DIALOGOS) return;
    const doc = root.document;
    let abierto = null, secuencia = 0;
    const validaciones = new Map();
    const identidad = () => root.haikuSesion?.auth?.id || root.haikuSesion?.usuario?.id || null;
    const bloqueado = () => doc?.documentElement.classList.contains('haiku-privacidad-bloqueada');
    function el(tag, clase, texto) {
        const n = doc.createElement(tag);
        if (clase) n.className = clase;
        if (texto !== undefined) n.textContent = String(texto);
        return n;
    }
    function boton(texto, clase = '') {
        const b = el('button', 'hk-boton ' + clase, texto); b.type = 'button'; return b;
    }
    function contenido(mensaje, opciones) {
        const partes = String(mensaje || '').trim().split(/\n\s*\n/);
        let titulo = opciones.titulo || 'Confirmar operación', cuerpo = String(mensaje || '');
        if (partes.length > 1 && /^¿/.test(partes[0]) && partes[0].length < 120) {
            titulo = opciones.titulo || partes[0];
            partes.shift();
            cuerpo = partes.join('\n\n');
        } else if (/^¿[^\n]+\?$/.test(cuerpo) && cuerpo.length < 100 && !opciones.titulo) {
            titulo = cuerpo; cuerpo = '';
        }
        return { ...opciones, titulo, cuerpo: opciones.cuerpo ?? cuerpo };
    }
    function preguntar(config) {
        // Una segunda invocación nunca comparte una aceptación ni ejecuta otra escritura.
        if (!doc?.body || abierto || bloqueado()) return Promise.resolve(null);
        return new Promise(resolve => {
            const origen = doc.activeElement, usuario = identidad(), id = 'hk-dialogo-' + (++secuencia);
            const dialogo = el('dialog', 'hk-dialogo');
            dialogo.setAttribute('aria-modal', 'true'); dialogo.setAttribute('role', 'dialog');
            dialogo.setAttribute('aria-labelledby', id + '-titulo');
            const form = el('form', 'hk-dialogo-form'); form.noValidate = true;
            const cuerpo = el('div', 'hk-dialogo-contenido');
            const cabecera = el('header', 'hk-dialogo-cabecera');
            const indicador = el('span', 'hk-dialogo-indicador' + (config.peligro ? ' es-peligro' : ''), config.simbolo || (config.peligro ? '!' : 'H'));
            indicador.setAttribute('aria-hidden', 'true');
            const titulos = el('div', 'hk-dialogo-titulos');
            titulos.append(el('p', 'hk-dialogo-contexto', config.contexto || 'HAIKU'));
            const titulo = el('h2', '', config.titulo); titulo.id = id + '-titulo'; titulos.append(titulo);
            cabecera.append(indicador, titulos); cuerpo.append(cabecera);
            if (config.cuerpo) {
                const p = el('p', 'hk-dialogo-texto', config.cuerpo); p.id = id + '-descripcion';
                dialogo.setAttribute('aria-describedby', p.id); cuerpo.append(p);
            }
            if (config.resumen?.length) {
                const resumen = el('dl', 'hk-dialogo-resumen');
                for (const [nombre, valor] of config.resumen) {
                    const dato = el('div'); dato.append(el('dt', '', nombre), el('dd', '', valor)); resumen.append(dato);
                }
                cuerpo.append(resumen);
            }
            if (config.detalles?.length) {
                const detalles = el('dl', 'hk-dialogo-detalles');
                for (const [nombre, valor] of config.detalles) {
                    const dato = el('div'); dato.append(el('dt', '', nombre), el('dd', '', valor)); detalles.append(dato);
                }
                cuerpo.append(detalles);
            }
            const entradas = new Map(), campos = el('div', 'hk-dialogo-campos' + (config.campos?.length > 1 ? ' varios' : ''));
            const errorGeneral = el('p', 'hk-campo-error'); errorGeneral.hidden = true; errorGeneral.setAttribute('role', 'alert');
            for (const campo of config.campos || []) {
                const wrap = el('div', 'hk-dialogo-campo'), label = el('label', '', campo.etiqueta);
                const input = el(campo.multilinea ? 'textarea' : 'input'); input.id = id + '-' + campo.nombre;
                input.name = campo.nombre; label.htmlFor = input.id;
                if (!campo.multilinea) input.type = campo.tipo || 'text';
                if (campo.tipo === 'number') { input.inputMode = 'numeric'; input.step = String(campo.paso || 1); }
                if (campo.min !== undefined) input.min = String(campo.min);
                if (campo.max !== undefined) input.max = String(campo.max);
                input.required = Boolean(campo.obligatorio); input.value = String(campo.valor ?? '');
                if (campo.placeholder) input.placeholder = campo.placeholder;
                const error = el('p', 'hk-campo-error'); error.id = input.id + '-error'; error.hidden = true;
                input.setAttribute('aria-describedby', error.id);
                wrap.append(label);
                if (campo.tipo === 'number' && config.campos.length > 1) {
                    const control = el('div', 'hk-numero');
                    const menos = boton('−', 'hk-paso'), mas = boton('+', 'hk-paso');
                    menos.setAttribute('aria-label', 'Disminuir ' + campo.etiqueta);
                    mas.setAttribute('aria-label', 'Aumentar ' + campo.etiqueta);
                    for (const [b, paso] of [[menos, -1], [mas, 1]]) b.addEventListener('click', () => {
                        if (paso < 0) input.stepDown(); else input.stepUp();
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                    });
                    control.append(menos, input, mas); wrap.append(control);
                } else wrap.append(input);
                wrap.append(error); campos.append(wrap); entradas.set(campo.nombre, { input, error, campo });
                input.addEventListener('input', () => { input.removeAttribute('aria-invalid'); error.hidden = true; errorGeneral.hidden = true; });
            }
            if (entradas.size) cuerpo.append(campos);
            if (config.aviso) cuerpo.append(el('p', 'hk-dialogo-aviso' + (config.advertencia ? ' advertencia' : ''), config.aviso));
            cuerpo.append(errorGeneral);
            const pie = el('footer', 'hk-dialogo-acciones');
            const cancelar = boton(config.cancelar || 'Cancelar');
            const aceptar = boton(config.accion || 'Confirmar', config.peligro ? 'peligro' : 'principal'); aceptar.type = 'submit';
            pie.append(cancelar, aceptar); form.append(cuerpo, pie); dialogo.append(form); doc.body.append(dialogo);
            let terminado = false;
            function terminar(valor, restaurar = true) {
                if (terminado) return; terminado = true;
                abierto = null; if (dialogo.open) dialogo.close(); dialogo.remove();
                if (restaurar && !bloqueado() && origen?.isConnected) origen.focus({ preventScroll: true });
                resolve(valor);
            }
            abierto = { terminar, usuario };
            cancelar.addEventListener('click', () => terminar(null));
            dialogo.addEventListener('cancel', e => { e.preventDefault(); terminar(null); });
            dialogo.addEventListener('close', () => terminar(null));
            // Escape no debe cerrar el panel situado detrás del diálogo.
            dialogo.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); terminar(null); } });
            form.addEventListener('submit', e => {
                e.preventDefault();
                if (terminado || bloqueado() || usuario !== identidad()) { terminar(null, false); return; }
                const valores = {}, errores = [];
                for (const [nombre, { input, campo }] of entradas) {
                    valores[nombre] = input.value;
                    if ((campo.obligatorio && !input.value.trim()) || !input.validity.valid) {
                        errores.push([nombre, campo.error || (campo.tipo === 'number' ? 'Ingresa una cantidad válida.' : 'Completa este dato.')]);
                    }
                }
                const extra = !errores.length && config.validar?.(valores);
                if (extra) errores.push([extra.campo || '', extra.mensaje || String(extra)]);
                for (const [nombre, mensaje] of errores) {
                    const item = entradas.get(nombre);
                    if (item) { item.error.textContent = mensaje; item.error.hidden = false; item.input.setAttribute('aria-invalid', 'true'); }
                    else { errorGeneral.textContent = mensaje; errorGeneral.hidden = false; }
                }
                if (errores.length) { (entradas.get(errores[0][0]) || entradas.values().next().value)?.input.focus(); return; }
                aceptar.disabled = true; terminar(valores);
            });
            try { dialogo.showModal(); cancelar.focus({ preventScroll: true }); }
            catch (_) { terminar(null); }
        });
    }
    async function confirmar(mensaje, opciones = {}) { return (await preguntar(contenido(mensaje, opciones))) !== null; }
    function formulario(opciones) { return preguntar(opciones); }
    function ocupacion(valores, capacidad, contexto = 'Reserva') {
        const limite = Number(capacidad) || 0;
        return preguntar({ titulo: 'Editar ocupación', contexto, accion: 'Guardar ocupación',
            campos: [['adultos', 'Adultos', 1], ['ninos', 'Niños', 0], ['mascotas', 'Mascotas', 0]].map(([nombre, etiqueta, min]) => ({
                nombre, etiqueta, valor: valores[nombre] ?? min, tipo: 'number', min, obligatorio: true,
                ...(nombre !== 'mascotas' && limite > 0 ? { max: limite } : {})
            })),
            aviso: 'Al menos 1 adulto.' + (limite > 0 ? ` Máximo: ${limite} personas entre adultos y niños.` : ''),
            validar: v => limite > 0 && Number(v.adultos) + Number(v.ninos) > limite
                ? { campo: 'adultos', mensaje: `La cabaña admite un máximo de ${limite} personas entre adultos y niños.` } : null
        });
    }
    async function solicitar(mensaje, valor = '', opciones = {}) {
        const noches = /noches/i.test(mensaje), pegar = /portapapeles|pega aquí/i.test(mensaje);
        const nombre = /titular/i.test(mensaje), motivo = /motivo/i.test(mensaje);
        const resultado = await preguntar({
            titulo: noches ? 'Cambiar las noches' : pegar ? 'Pegar detalles' : motivo ? 'Reabrir el cierre' : nombre ? 'Editar titular' : 'Completar datos',
            contexto: pegar ? 'Cabañas · Revisión' : 'HAIKU',
            cuerpo: pegar ? 'El navegador no pudo leer el portapapeles. Puedes pegar el texto aquí.' : noches ? 'HAIKU comprobará la disponibilidad antes de guardar.' : motivo ? 'Los controles volverán a quedar editables.' : '',
            accion: pegar ? 'Pegar en detalles' : motivo ? 'Reabrir cierre' : noches ? 'Guardar noches' : 'Guardar',
            campos: [{ nombre: 'valor', etiqueta: noches ? 'Cantidad de noches' : pegar ? 'Texto de la revisión' : motivo ? 'Motivo de reapertura' : nombre ? 'Titular' : mensaje,
                valor, obligatorio: !pegar, multilinea: pegar || motivo, tipo: noches ? 'number' : 'text', ...(noches ? { min: 1, max: 365, error: 'Ingresa un número entero entre 1 y 365.' } : {}) }],
            aviso: motivo ? 'Obligatorio · quedará registrado con la reapertura.' : '', ...opciones
        });
        return resultado === null ? null : resultado.valor;
    }
    function visible(n) { return Boolean(n?.isConnected && !n.closest('[hidden],[inert]') && n.getClientRects().length); }
    function aviso(mensaje, opciones = {}) {
        if (!doc?.body || bloqueado()) return;
        const texto = String(mensaje || '');
        const exito = opciones.tipo === 'exito' || (!/\bno\b|fall|error/i.test(texto) && /correctamente|actualizada|reactivada|creado|liberada|turno cerrado|bloqueo.*registrad/i.test(texto));
        const permiso = /permiso|iniciar sesión/i.test(texto);
        const origen = doc.activeElement;
        const contexto = exito ? null : origen?.closest?.('dialog[open],form,[role="dialog"],.ficha-reserva,.ficha-reserva-modal,.haiku-asistente-panel');
        const campoBuscado = texto.match(/glosa|correo|titular|bovtar|bove|codaut|folio|monto|medio|noches/i)?.[0];
        const candidatos = contexto ? [...contexto.querySelectorAll('input:not([type="hidden"]),select,textarea')].filter(visible) : [];
        const campo = opciones.campo ? doc.querySelector(opciones.campo) : campoBuscado && candidatos.find(n =>
            (n.id + ' ' + n.name + ' ' + (n.getAttribute('aria-label') || '')).toLowerCase().includes(campoBuscado.toLowerCase()));
        if (campo && visible(campo) && !exito && !permiso) {
            validaciones.get(campo)?.();
            const n = el('p', 'hk-validacion', texto); n.id = 'hk-aviso-' + (++secuencia); n.setAttribute('role', 'alert');
            const descripcion = campo.getAttribute('aria-describedby'), invalido = campo.getAttribute('aria-invalid');
            campo.after(n); campo.setAttribute('aria-invalid', 'true'); campo.setAttribute('aria-describedby', [descripcion, n.id].filter(Boolean).join(' '));
            const limpiar = () => {
                n.remove(); campo.removeEventListener('input', limpiar); validaciones.delete(campo);
                if (descripcion) campo.setAttribute('aria-describedby', descripcion); else campo.removeAttribute('aria-describedby');
                if (invalido) campo.setAttribute('aria-invalid', invalido); else campo.removeAttribute('aria-invalid');
            };
            validaciones.set(campo, limpiar); campo.addEventListener('input', limpiar, { once: true });
            campo.focus(); return;
        }
        let host = visible(contexto) ? contexto.querySelector(':scope > .hk-avisos-contexto') : null;
        if (!host && visible(contexto)) { host = el('div', 'hk-avisos-contexto'); contexto.append(host); }
        if (!host) {
            host = doc.getElementById('hk-avisos');
            if (!host) { host = el('div', 'hk-avisos'); host.id = 'hk-avisos'; doc.body.append(host); }
        }
        if ([...host.children].some(n => n.dataset.mensaje === texto)) return;
        const n = el('div', 'hk-aviso ' + (exito ? 'exito' : permiso ? 'advertencia' : 'error'));
        n.dataset.mensaje = texto; n.setAttribute('role', exito ? 'status' : 'alert');
        const copia = el('div', 'hk-aviso-copia');
        if (permiso) copia.append(el('strong', '', 'Acceso restringido'));
        copia.append(el('p', '', texto));
        const cerrar = boton('×', 'hk-aviso-cerrar'); cerrar.setAttribute('aria-label', 'Cerrar aviso'); cerrar.addEventListener('click', () => n.remove());
        n.append(copia, cerrar); host.append(n);
        if (host.classList.contains('hk-avisos-contexto')) n.scrollIntoView({ block: 'nearest' });
        if (exito) root.setTimeout(() => n.remove(), 6500);
    }
    function cancelarPendiente() {
        abierto?.terminar(null, false);
        for (const limpiar of validaciones.values()) limpiar();
        doc?.querySelectorAll('.hk-aviso').forEach(n => n.remove());
    }
    root.addEventListener?.('haiku:privacidad-cambio', e => { if (e.detail?.bloqueada) cancelarPendiente(); });
    root.addEventListener?.('haiku:auth-ready', () => { if (abierto && abierto.usuario !== identidad()) cancelarPendiente(); });
    root.addEventListener?.('pagehide', cancelarPendiente);
    doc?.addEventListener?.('keydown', e => {
        if (abierto && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); abierto.terminar(null); }
    }, true);
    root.HAIKU_DIALOGOS = Object.freeze({ confirmar, solicitar, formulario, ocupacion, aviso, cancelar: cancelarPendiente });
})(typeof window !== 'undefined' ? window : globalThis);
