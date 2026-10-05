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
    function adjuntar(contenedor, reservas, generacion, alConfirmar = async () => {}, comparacion = null) {
        const doc = root.document;
        if (!doc) return;
        const el = (tag,texto) => {const e=doc.createElement(tag);e.textContent=texto;e.className='haiku-versiones-meta';return e;};
        const vistos = new Set();
        const pendientes = reservas.filter(resolvers.ocupacion.necesita);
        if (!pendientes.length) return;
        // V1 sólo completa reservas nuevas sin destino/candidato existente.
        const alcance = comparacion ? Promise.resolve(comparacion)
            : root.HAIKU_LIBRO_CONSULTAS?.compararSistema(reservas,root.haikuSupabase);
        for (const r of pendientes) {
            const key=firma(r);if(vistos.has(key))continue;vistos.add(key);
            const card=el('article','');card.className='haiku-libro-resolucion';
            card.append(el('strong',`${r.titular || 'Sin titular'} · CAB ${r.cabana ?? '—'} · ${r.fecha_checkin || 'Sin fecha'} · ${r.id || 'Sin origen'}`));
            card.append(el('p','Revisión manual · Acción necesaria: no se pudo identificar una ocupación válida de esta reserva.'));
            const estado=el('p','No incorporable hasta completar la ocupación.');estado.setAttribute('role','status');
            const accion=el('button','Completar ocupación');accion.type='button';accion.className='libro-reserva-boton secundario';
            const editor=el('div','');editor.hidden=true;
            let decision=null, anteriorPersistido=null, obsoleto=false, ocupado=false, habilitada=false;
            const mostrar = d => {
                decision=d;
                anteriorPersistido=d?.id || anteriorPersistido;
                estado.textContent=d ? `✓ Resuelto manualmente · ${d.valor_confirmado.adultos} adultos · ${d.valor_confirmado.ninos} niños · ${d.valor_confirmado.mascotas} mascotas. Se volverán a validar los demás conflictos.` : 'No incorporable hasta completar la ocupación.';
                accion.textContent=d?'Editar resolución':'Completar ocupación';
            };
            accion.addEventListener('click',()=>{
                if(obsoleto||ocupado||!habilitada)return;
                editor.replaceChildren(el('strong','Ocupación de la reserva'));editor.hidden=false;accion.hidden=true;
                const inputs={};
                campos.forEach(k=>{
                    const label=el('label',k==='adultos'?'Adultos':k==='ninos'?'Niños':'Mascotas');
                    const input=doc.createElement('input');input.type='number';input.min=k==='adultos'?'1':'0';input.max='32767';input.step='1';
                    input.value=String(decision?.valor_confirmado[k] ?? r[k] ?? (k==='adultos'?'':0));
                    input.setAttribute('aria-label',label.textContent);label.append(input);editor.append(label);inputs[k]=input;
                });
                const error=el('p','');error.setAttribute('role','alert');
                const cancelar=el('button','Cancelar');cancelar.type='button';
                cancelar.addEventListener('click',()=>{if(ocupado)return;editor.hidden=true;accion.hidden=false;});
                const guardar=el('button','Confirmar datos');guardar.type='button';
                let operacion=null, ultimoValor=null;
                guardar.addEventListener('click',async()=>{
                    if(obsoleto||ocupado||!habilitada)return;
                    try {
                        const valor=Object.fromEntries(campos.map(k=>[k,inputs[k].value.trim()===''?null:Number(inputs[k].value)]));
                        validarOcupacion(valor,r);vigente(generacion);
                        ocupado=true;guardar.disabled=true;cancelar.disabled=true;accion.disabled=true;error.textContent='Confirmando…';
                        if(ultimoValor!==firma(valor)) {operacion=root.crypto.randomUUID();ultimoValor=firma(valor);}
                        const d=await confirmar(r,valor,generacion,anteriorPersistido,root.haikuSupabase,operacion);
                        mostrar(d);editor.hidden=true;accion.hidden=false;
                        await alConfirmar();
                    } catch(e) {error.textContent=e.message;}
                    finally {ocupado=false;guardar.disabled=obsoleto;cancelar.disabled=obsoleto;accion.disabled=obsoleto;}
                });
                editor.append(error,cancelar,guardar);
            });
            card.append(estado,accion,editor);contenedor.append(card);
            root.addEventListener?.('haiku:libro-cambio',()=>{
                obsoleto=true;accion.disabled=true;editor.hidden=true;
                estado.textContent='El Libro cambió. Genera el informe nuevamente antes de continuar.';
            },{once:true});
            accion.disabled=true;
            Promise.all([decisiones([r],generacion),alcance]).then(([data,comp])=>{
                if(obsoleto||ocupado||!editor.hidden)return;
                vigente(generacion);
                if(!comp)throw Error('Compara con Proyecto H antes de completar la ocupación.');
                const relacionado = i => i.sistema || i.candidatosDetalle?.length || i.candidatos?.length;
                const existente = Array.from(comp).some(i=>i.libro?.id===r.id && relacionado(i)) ||
                    (comp.grupos || []).some(g=>g.items.some(i=>i.libro?.id===r.id) && g.items.some(relacionado)) ||
                    (comp.snapshot?.estadias || []).some(s=>Number(s.cabana)===Number(r.cabana) &&
                        s.fecha_checkin===r.fecha_checkin && s.fecha_checkout===r.fecha_checkout);
                if(existente) {
                    accion.hidden=true;
                    estado.textContent='Requiere revisión manual: existe una estadía o candidato en Proyecto H. Completar ocupación V1 sólo permite crear reservas nuevas.';
                    return;
                }
                habilitada=true;
                const d=data.find(x=>firma(x.identidad)===firma(identidad(r,vigente(generacion))));
                if(d) {
                    anteriorPersistido=d.id;
                    aplicar(r,d,vigente(generacion));mostrar(d);
                }
            }).catch(e=>{if(!obsoleto)estado.textContent=e.message+' La ocupación sigue pendiente.';})
                .finally(()=>{if(!obsoleto&&!ocupado)accion.disabled=!habilitada;});
        }
    }
    const api=Object.freeze({resolvers,validarOcupacion,identidad,original,aplicar,efectivos,confirmar,adjuntar});
    root.HAIKU_LIBRO_RESOLUCIONES_V1=api;
    if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
