/* Decisiones de campo: evidencia inmutable + resolución persistida = copia efectiva. */
(function(root) {
    'use strict';
    const tarifa = root.HAIKU_FULLDAY_TARIFA_V1 || (typeof module !== 'undefined' ? require('./haiku-fullday-tarifa-v1.js') : null);
    const canon = x => Array.isArray(x) ? x.map(canon) : x && typeof x === 'object'
        ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canon(x[k])])) : x;
    const firma = x => JSON.stringify(canon(x));
    const campos = ['adultos','ninos','mascotas'];
    const original = r => Object.fromEntries(campos.map(k => [k, r[k] ?? null]));
    function validarOcupacion(valor, r) {
        for (const k of campos) if (!Number.isInteger(valor?.[k]) || valor[k] < (k === 'adultos' ? 1 : 0) || valor[k] > 32767)
            throw Error(`${k === 'adultos' ? 'Adultos' : k === 'ninos' ? 'Niños' : 'Mascotas'} debe ser un entero entre ${k === 'adultos' ? 1 : 0} y 32767.`);
        if (r.tipo_estadia === 'full_day') {
            const regla = tarifa?.resolverLibro({adultos:valor.adultos});
            if (!regla || regla.bloqueada) throw Error(regla?.mensaje || 'No está disponible la regla Full Day.');
        }
        return Object.fromEntries(campos.map(k => [k, valor[k]]));
    }
    // Registro extensible. Ningún otro campo tiene un resolver ni se aprueba aquí.
    const resolvers = Object.freeze({ocupacion:{
        necesita(r) {
            return !Number.isInteger(r.adultos) || r.adultos < 1 || r.adultos > 32767 ||
                ['ninos','mascotas'].some(k => r[k] != null && (!Number.isInteger(r[k]) || r[k] < 0 || r[k] > 32767)) ||
                (r.tipo_estadia === 'full_day' && (!tarifa || tarifa.resolverLibro(r).bloqueada));
        }, validar:validarOcupacion
    }});
    function vigente(generacion) {
        const estado = root.HAIKU_LIBRO_RESERVA_V1?.estado?.();
        if (generacion === undefined || estado?.generacion !== generacion) throw Error('El Libro cambió; vuelve a generar el informe.');
        return estado;
    }
    function identidad(r, estado) {
        if (!/^[a-f0-9]{64}$/.test(estado?.version || '') || !r.id || !r.coordenadas_origen?.hoja || !r.coordenadas_origen?.celda)
            throw Error('No se pudo verificar la versión y el origen del Libro. Vuelve a cargar el XLSX.');
        return {version:estado.version, elemento:r.id, origen:structuredClone(r.coordenadas_origen), evidencia:structuredClone(r)};
    }
    function aplicar(r, decision, estado) {
        const copia = structuredClone(r);
        if (!decision) return copia;
        const id = identidad(r, estado);
        if (decision.campo !== 'ocupacion' || !decision.id || firma(decision.identidad) !== firma(id)) throw Error('La resolución no corresponde a esta evidencia del Libro.');
        Object.assign(copia, validarOcupacion(decision.valor_confirmado, r));
        copia.libro_origen = id;
        copia.resolucion_manual = {id:decision.id, identidad:id, valor_confirmado:structuredClone(decision.valor_confirmado)};
        return copia;
    }
    async function rpc(cliente, nombre, args) {
        const {data,error} = await cliente.rpc(nombre,args);
        if (error) throw Object.assign(Error('No se pudo confirmar la resolución persistente: ' + error.message), {code:error.code});
        return data;
    }
    async function decisiones(reservas, generacion, cliente = root.haikuSupabase) {
        const estado = vigente(generacion);
        const revisiones = reservas.filter(resolvers.ocupacion.necesita);
        if (!revisiones.length) return [];
        const ids = revisiones.map(r => identidad(r,estado));
        const data = [];
        for(let i=0;i<ids.length;i+=50) {
            const lote=await rpc(cliente,'haiku_libro_leer_resoluciones_v1',{p_identidades:ids.slice(i,i+50)});
            if(!Array.isArray(lote))throw Error('Respuesta de resoluciones inválida.');
            data.push(...lote);vigente(generacion);
        }
        vigente(generacion);
        if (!Array.isArray(data)) throw Error('Respuesta de resoluciones inválida.');
        return data;
    }
    async function efectivos(reservas, generacion, cliente) {
        const data = await decisiones(reservas,generacion,cliente);
        const estado = vigente(generacion);
        return reservas.map(r => {
            if (!resolvers.ocupacion.necesita(r)) return structuredClone(r);
            const id = identidad(r,estado);
            return aplicar(r,data.find(d => firma(d.identidad) === firma(id)),estado);
        });
    }
    async function confirmar(r, valor, generacion, anterior = null, cliente = root.haikuSupabase, operacion = root.crypto.randomUUID()) {
        const estado = vigente(generacion), confirmado = validarOcupacion(valor,r), id = identidad(r,estado);
        const data = await rpc(cliente,'haiku_libro_confirmar_resolucion_v1',{
            p_operacion_id:operacion,p_identidad:id,p_campo:'ocupacion',p_valor:confirmado,p_anterior:anterior
        });
        vigente(generacion);
        aplicar(r,data,estado); // No mostrar resuelto ante una respuesta ajena/incompleta.
        return data;
    }
    // Si la comparación ya asoció de forma única una estadía activa con
    // ocupación válida, el dato incompleto del XLSX no es una tarea pendiente.
    // No se usan nombres/fechas aislados para decidir esta coincidencia.
    function ocupacionYaRegistrada(r, comparacion) {
        if (!r?.id || !comparacion) return false;
        const encontrados = Array.from(comparacion).filter(i => i.libro?.id === r.id);
        if (encontrados.length !== 1 || encontrados[0].estado !== 'asociada') return false;
        const s = encontrados[0].sistema;
        if (!s?.id || !s.reserva_id ||
            Number(s.cabana) !== Number(r.cabana) ||
            s.fecha_checkin !== r.fecha_checkin || s.fecha_checkout !== r.fecha_checkout ||
            /cancelad|no[_ -]?show/i.test(`${s.estado_operativo || ''} ${s.estado_reserva || ''}`) ||
            (r.tipo_estadia === 'full_day' && !['fullday','full_day'].includes(s.tipo_estadia)) ||
            (r.tipo_estadia === 'alojamiento' && ['fullday','full_day'].includes(s.tipo_estadia))) return false;
        try {
            validarOcupacion({adultos:s.adultos,ninos:s.ninos,mascotas:s.mascotas},r);
            return true;
        } catch (_) { return false; }
    }
    function adjuntar(contenedor, reservas, generacion, alConfirmar = async () => {}, comparacion = null) {
        const doc = root.document;
        if (!doc) return;
        const el = (tag,texto,clase='') => {const e=doc.createElement(tag);e.textContent=texto;e.className=clase;return e;};
        const fechaCorta = valor => {
            const partes=/^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.exec(valor || '');
            const meses=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
            return partes ? `${Number(partes[3])} ${meses[Number(partes[2])-1]} ${partes[1]}` : valor || 'Sin fecha';
        };
        const vistos = new Set();
        const pendientes = reservas.filter(r =>
            resolvers.ocupacion.necesita(r) && !ocupacionYaRegistrada(r,comparacion));
        if (!pendientes.length) return;
        // V1 sólo completa reservas nuevas sin destino/candidato existente.
        const alcance = comparacion ? Promise.resolve(comparacion)
            : root.HAIKU_LIBRO_CONSULTAS?.compararSistema(reservas,root.haikuSupabase);
        for (const r of pendientes) {
            const key=firma(r);if(vistos.has(key))continue;vistos.add(key);
            const card=el('article','','haiku-libro-resolucion haiku-ocupacion-card');
            card.dataset.ocupacionEstado='pendiente';
            // Si la comparación llega después, no mostrar un falso aviso fugaz.
            card.hidden=!comparacion;
            const cabecera=el('header','','haiku-ocupacion-cabecera');
            const identidadVisual=el('div','','haiku-ocupacion-identidad');
            identidadVisual.append(el('strong',r.titular || 'Sin titular','haiku-ocupacion-titular'),
                el('p',`Cabaña ${r.cabana ?? '—'} · ${fechaCorta(r.fecha_checkin)} · ${r.id || 'Sin origen'}`,'haiku-ocupacion-meta'));
            const badge=el('span','Por completar','haiku-ocupacion-badge');
            cabecera.append(identidadVisual,badge);
            const descripcion=el('p','No pudimos identificar cuántas personas se hospedan. Completa los datos para continuar.','haiku-ocupacion-aviso');
            const resumen=el('dl','','haiku-ocupacion-resumen');resumen.hidden=true;
            resumen.setAttribute('aria-label','Ocupación confirmada');
            const estado=el('p','','haiku-ocupacion-estado');estado.setAttribute('role','status');
            const acciones=el('div','','haiku-ocupacion-acciones');
            const accion=el('button','Completar ocupación','libro-reserva-boton haiku-ocupacion-boton haiku-ocupacion-boton--principal');accion.type='button';
            acciones.append(accion);
            const editor=el('div','','haiku-ocupacion-editor');editor.hidden=true;
            let decision=null, anteriorPersistido=null, obsoleto=false, ocupado=false, habilitada=false;
            const mostrar = d => {
                decision=d;
                anteriorPersistido=d?.id || anteriorPersistido;
                card.dataset.ocupacionEstado=d?'confirmada':'pendiente';
                badge.textContent=d?'Confirmado':'Por completar';
                descripcion.hidden=Boolean(d);
                resumen.replaceChildren();resumen.hidden=!d;
                if(d) campos.forEach(k=>{
                    const dato=el('div','','haiku-ocupacion-resumen-item');
                    dato.append(el('dt',k==='adultos'?'Adultos':k==='ninos'?'Niños':'Mascotas'),el('dd',String(d.valor_confirmado[k])));
                    resumen.append(dato);
                });
                estado.hidden=false;
                estado.textContent=d ? 'Ocupación guardada. Se revisarán los demás datos.' : '';
                accion.textContent=d?'Editar ocupación':'Completar ocupación';
                accion.className=`libro-reserva-boton haiku-ocupacion-boton${d?' secundario':' haiku-ocupacion-boton--principal'}`;
            };
            accion.addEventListener('click',()=>{
                if(obsoleto||ocupado||!habilitada)return;
                editor.replaceChildren();editor.hidden=false;accion.hidden=true;acciones.hidden=true;
                resumen.hidden=true;estado.hidden=true;
                const camposEditor=el('div','','haiku-ocupacion-campos');
                camposEditor.setAttribute('role','group');camposEditor.setAttribute('aria-label','Ocupación de la reserva');
                const inputs={};
                campos.forEach(k=>{
                    const label=el('label',k==='adultos'?'Adultos':k==='ninos'?'Niños':'Mascotas','haiku-ocupacion-campo');
                    const input=doc.createElement('input');input.type='number';input.min=k==='adultos'?'1':'0';input.max='32767';input.step='1';
                    input.value=String(decision?.valor_confirmado[k] ?? r[k] ?? (k==='adultos'?'':0));
                    input.setAttribute('aria-label',label.textContent);input.setAttribute('inputmode','numeric');
                    label.append(input);camposEditor.append(label);inputs[k]=input;
                });
                const ayuda=el('p','Al confirmar se revisarán los demás datos de la reserva.','haiku-ocupacion-ayuda');
                const error=el('p','','haiku-ocupacion-error');error.setAttribute('role','alert');
                const botones=el('div','','haiku-ocupacion-acciones haiku-ocupacion-editor-acciones');
                const cancelar=el('button','Cancelar','libro-reserva-boton secundario haiku-ocupacion-boton');cancelar.type='button';
                cancelar.addEventListener('click',()=>{if(ocupado)return;editor.hidden=true;accion.hidden=false;acciones.hidden=false;resumen.hidden=!decision;estado.hidden=false;});
                const guardar=el('button','Confirmar ocupación','libro-reserva-boton haiku-ocupacion-boton haiku-ocupacion-boton--principal');guardar.type='button';
                let operacion=null, ultimoValor=null;
                guardar.addEventListener('click',async()=>{
                    if(obsoleto||ocupado||!habilitada)return;
                    try {
                        const valor=Object.fromEntries(campos.map(k=>[k,inputs[k].value.trim()===''?null:Number(inputs[k].value)]));
                        validarOcupacion(valor,r);vigente(generacion);
                        ocupado=true;guardar.disabled=true;cancelar.disabled=true;accion.disabled=true;error.textContent='Confirmando…';
                        if(ultimoValor!==firma(valor)) {operacion=root.crypto.randomUUID();ultimoValor=firma(valor);}
                        const d=await confirmar(r,valor,generacion,anteriorPersistido,root.haikuSupabase,operacion);
                        mostrar(d);editor.hidden=true;accion.hidden=false;acciones.hidden=false;
                        await alConfirmar();
                    } catch(e) {error.textContent=e.message;}
                    finally {ocupado=false;guardar.disabled=obsoleto;cancelar.disabled=obsoleto;accion.disabled=obsoleto;}
                });
                botones.append(cancelar,guardar);editor.append(camposEditor,ayuda,error,botones);
            });
            card.append(cabecera,descripcion,resumen,estado,acciones,editor);contenedor.append(card);
            root.addEventListener?.('haiku:libro-cambio',()=>{
                obsoleto=true;accion.disabled=true;
                const confirmar=editor.querySelector?.('.haiku-ocupacion-boton--principal');
                if(confirmar)confirmar.disabled=true;
                card.dataset.ocupacionEstado='obsoleta';badge.textContent='Actualizar informe';
                estado.hidden=false;
                estado.textContent='Conservé los datos que estabas revisando. El Libro cambió; vuelve a comparar antes de confirmar.';
            },{once:true});
            accion.disabled=true;
            Promise.all([decisiones([r],generacion),alcance]).then(([data,comp])=>{
                if(obsoleto||ocupado||!editor.hidden)return;
                vigente(generacion);
                if(!comp)throw Error('Compara con Proyecto H antes de completar la ocupación.');
                if (ocupacionYaRegistrada(r,comp)) {
                    card.hidden=true;
                    card.remove?.();
                    return;
                }
                card.hidden=false;
                const relacionado = i => i.sistema || i.candidatosDetalle?.length || i.candidatos?.length;
                const existente = Array.from(comp).some(i=>i.libro?.id===r.id && relacionado(i)) ||
                    (comp.grupos || []).some(g=>g.items.some(i=>i.libro?.id===r.id) && g.items.some(relacionado)) ||
                    (comp.snapshot?.estadias || []).some(s=>Number(s.cabana)===Number(r.cabana) &&
                        s.fecha_checkin===r.fecha_checkin && s.fecha_checkout===r.fecha_checkout);
                if(existente) {
                    accion.hidden=true;acciones.hidden=true;
                    descripcion.textContent='Revisión de coincidencia con Proyecto H.';
                    const candidatos = Array.from(comp).filter(i=>i.libro?.id===r.id);
                    const asociado = candidatos.length===1 && candidatos[0].estado==='asociada';
                    const varios = candidatos.some(i=>(i.candidatosDetalle?.length || i.candidatos?.length || 0)>1);
                    estado.textContent = asociado
                        ? 'La reserva ya existe en Proyecto H, pero su ocupación allí requiere revisión desde la ficha. No se creará otra reserva.'
                        : varios
                            ? 'Hay varias estadías candidatas: revisa cuál corresponde. No se creará otra reserva ni se completará ocupación automáticamente.'
                            : 'Requiere revisión manual: existe una estadía o candidato en Proyecto H. Completar ocupación V1 sólo permite crear reservas nuevas.';
                    return;
                }
                habilitada=true;
                const d=data.find(x=>firma(x.identidad)===firma(identidad(r,vigente(generacion))));
                if(d) {
                    anteriorPersistido=d.id;
                    aplicar(r,d,vigente(generacion));mostrar(d);
                }
            }).catch(e=>{if(!obsoleto){card.hidden=false;estado.textContent=e.message+' La ocupación sigue pendiente.';}})
                .finally(()=>{if(!obsoleto&&!ocupado)accion.disabled=!habilitada;});
        }
    }
    const api=Object.freeze({resolvers,validarOcupacion,identidad,original,aplicar,efectivos,confirmar,adjuntar});
    root.HAIKU_LIBRO_RESOLUCIONES_V1=api;
    if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
