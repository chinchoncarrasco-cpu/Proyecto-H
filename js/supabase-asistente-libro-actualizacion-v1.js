/* ETAPA 2: informe solicitado, sólo lectura. ETAPA 1 es la única fuente. */
(function(root) {
    'use strict';
    if (root.HAIKU_ASISTENTE_LIBRO_ACTUALIZACION_V1) return;
    const generacionesResultado = new WeakMap();
    const generacionInforme = resultado => resultado?.libro_actual?.generacion ?? generacionesResultado.get(resultado);
    let ocupado = false;
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
    const formatearMonto = new Intl.NumberFormat('es-CL');
    function detalleAbono(abono) {
        const p = abono.pago, destino = abono.reservas.length === 1 ? abono.reservas[0] : null;
        const titulo = {registrado:'Abono ya registrado', asociado:'Abono nuevo', reserva_nueva:'Abono asociado'}[abono.estado] || 'Pago por vincular';
        const monto = (p.moneda && p.moneda !== 'CLP' ? `${p.moneda} ` : '$') + formatearMonto.format(p.monto);
        const reserva = [destino?.titular, `CAB ${destino?.cabana ?? p.cabana ?? '—'}`].filter(Boolean).join(' · ');
        const detalles = [{etiqueta:'Monto',texto:monto}];
        if (p.fecha_comprobante) detalles.push({etiqueta:'Fecha de pago',texto:fecha(p.fecha_comprobante)});
        return {titulo,monto,reserva,detalles,fechaIngreso:destino?.fecha_checkin};
    }
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
        if (typeof v === 'object') return [v.concepto,v.hora,v.estado,v.pendiente === true ? 'Pago pendiente' : v.pendiente === false ? 'Sin pago pendiente' : null,v.cortesia ? 'Cortesía' : null,v.monto != null ? `${v.monto} CLP` : null].filter(x=>x != null && x !== '').join(' · ') || 'Sin detalle disponible';
        if (typeof v === 'boolean') return v ? 'Sí' : 'No';
        if (['estado_operativo','estado_confirmacion','tipo_estadia'].includes(campo) && Object.hasOwn(estados,v)) return estados[v];
        return String(explicar(v)).replace(/_/g,' ');
    }
    function reserva(r = {}) {
        return `<strong>${escapar(r.titular || 'Nombre no indicado')}</strong><p>CAB ${escapar(r.cabana ?? '—')} · Entrada: ${escapar(fecha(r.fecha_checkin))} · Salida: ${escapar(fecha(r.fecha_checkout))}${r.noches != null ? ` · ${escapar(r.noches)} ${Number(r.noches) === 1 ? 'noche' : 'noches'}` : ''}${r.tipo_estadia === 'full_day' ? ' · Full Day' : ''}</p>`;
    }
    function detalleTitularAmbiguo(aviso) {
        if (aviso?.tipo !== 'titular_ambiguo') return null;
        const version={anterior:'Versión anterior',actual:'Versión actual',ambas:'Ambas versiones'}[aviso.version];
        const reserva=[aviso.hoja,aviso.celda,aviso.cabana!=null?`CAB ${aviso.cabana}`:null,version].filter(Boolean).join(' · ');
        const nombres=lista(aviso.titulares_posibles).map(nombre=>`«${nombre}»`).join(' · ');
        return {titulo:'Titular por confirmar',reserva,fechaIngreso:aviso.fecha_ingreso,detalles:[
            {etiqueta:'Posibles',texto:nombres},
            {etiqueta:'Revisar',texto:'Haku leyó estos fragmentos como nombres en la misma celda. Confirma cuál es el titular.'}
        ]};
    }
    function detalleAviso(aviso) {
        if (typeof aviso === 'string') return explicar(aviso);
        if (!aviso || typeof aviso !== 'object') return 'Sin detalle disponible.';
        const titular=detalleTitularAmbiguo(aviso);
        if (titular) {
            const ubicacion=[titular.reserva,titular.fechaIngreso?`IN ${fecha(titular.fechaIngreso).replaceAll('-','/')}`:null].filter(Boolean).join(' · ');
            return [ubicacion,...titular.detalles.map(d=>d.texto)].filter(Boolean).join('. ');
        }
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
            const clase = {'Agregadas al Libro':'nuevas','Reservas con cambios':'modificadas','Ya no aparecen':'ausentes','Necesitan revisión':'revision','Canceladas en el Libro':'cancelaciones','Abonos detectados':'modificadas'}[titulo];
            if(items.length) html += `<details class="haku-actualizacion-sites__grupo haku-actualizacion-sites__grupo--${clase}"><summary><span>${titulo} (${items.length})</span><span aria-hidden="true">⌄</span></summary><div class="haku-actualizacion-sites__grupo-contenido">${items.join('')}</div></details>`;
        };
        if (root.HAIKU_ASISTENTE_LIBRO_PRIORIDAD_V1) {
            html += root.HAIKU_ASISTENTE_LIBRO_PRIORIDAD_V1.renderizar(r,{formatearAviso:detalleAviso});
        }
        if (r.estado === 'sin_cambios') html += '<p class="haku-actualizacion-sites__sin-cambios"><strong>Sin cambios nuevos</strong> No encontré cambios en las reservas entre estas dos versiones del Libro. Aún pueden quedar cambios anteriores por guardar en Proyecto H.</p>';
        html += '<div class="haku-libro-contadores haku-actualizacion-sites__metricas">' + [['nuevas','Agregadas al Libro'],['modificadas','Con cambios'],['ya_no_aparecen','Ya no aparecen'],['ambiguas','Por revisar']].map(([k,t])=>`<div><strong>${lista(r[k]).length}</strong><span>${t}</span></div>`).join('') + '</div>';
        seccion('Agregadas al Libro',lista(r.nuevas).map(x=>`<div class="haku-libro-item"><small>AGREGADA AL LIBRO</small>${reserva(x.actual)}</div>`));
        seccion('Abonos detectados',lista(r.abonos).map(abono => {
            const d = detalleAbono(abono), p = abono.pago;
            const origen = [p.origen?.hoja, p.origen?.celda].filter(Boolean).join(' · ');
            return `<div class="haku-libro-item"><strong>${escapar(d.titulo)} · ${escapar(d.monto)}</strong><p>${escapar(d.reserva)}${p.fecha_comprobante ? ` · ${escapar(fecha(p.fecha_comprobante))}` : ''}</p>${origen ? `<small>${escapar(origen)}</small>` : ''}</div>`;
        }));
        if (puedeRevisarAbonos(r)) html += '<div class="haku-actualizacion-sites__historial-acciones"><button type="button" class="haku-actualizacion-sites__boton haku-actualizacion-sites__boton--primario" data-haku-revisar-abonos>Revisar abonos</button></div>';
        seccion('Reservas con cambios',lista(r.modificadas).map(x=>`<details class="haku-libro-item haku-pregunta-caso"><summary><small>CON CAMBIOS · CAB ${escapar(x.actual?.cabana ?? '—')}</small><strong>${escapar(x.actual?.titular || 'Nombre no indicado')}</strong></summary><dl>${lista(x.cambios).map(c=>`<dt>${escapar(etiquetas[c.campo] || 'Otro dato')}</dt><dd>${['rut_documento','telefono','correo'].includes(c.campo) ? 'Este dato cambió en el Libro. No se muestra aquí por privacidad.' : `Antes: ${escapar(valor(c.antes,c.campo))}<br>Ahora: ${escapar(valor(c.ahora,c.campo))}`}</dd>`).join('')}</dl></details>`));
        seccion('Ya no aparecen',lista(r.ya_no_aparecen).map(x=>`<div class="haku-libro-item"><small>YA NO APARECE</small>${reserva(x.anterior)}<p>Esta reserva estaba en la versión anterior y no aparece en la actual.</p></div>`));
        seccion('Canceladas en el Libro',lista(r.cancelaciones_confirmadas).map(x=>`<div class="haku-libro-item"><small>CANCELADA EN EL LIBRO</small>${reserva(x.anterior)}<p>Cancelaciones · ${escapar(x.evidencia?.origen?.hoja)} · ${escapar(x.evidencia?.origen?.celda)}</p></div>`));
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
    function firmaAvisoCancelacion(item){
        if(item?.tipo!=='cancelacion')return null;
        const r=item.anterior;
        const nombre=String(r?.titular||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
        const cabana=Number(r?.cabana);
        if(!nombre||!Number.isInteger(cabana)||cabana<1||!r.fecha_checkin||!r.fecha_checkout)return item.id||null;
        return JSON.stringify([nombre,cabana,r.fecha_checkin,r.fecha_checkout]);
    }
    async function leerCierresCancelacion(){
        return new Set(lista(await root.HAIKU_LIBRO_RESERVA_V1?.leerAvisosCancelacionCerrados?.()));
    }
    const sinAvisosCerrados=(cambios,cierres)=>cambios.filter(x=>!cierres.has(firmaAvisoCancelacion(x)));
    function extraerCambiosDetectados(resultado={},generacion=null){
        const detectado=resultado.generado_en||new Date().toISOString();
        const meta=x=>({detectado_generacion:x.detectado_generacion??generacion,detectado_en:x.detectado_en||detectado});
        return [
            ...lista(resultado.modificadas).map(x=>({...meta(x),tipo:'modificacion',anterior:structuredClone(x.anterior),actual:structuredClone(x.actual),cambios:structuredClone(x.cambios)})),
            ...lista(resultado.nuevas).map(x=>({...meta(x),tipo:'nueva',anterior:null,actual:structuredClone(x.actual),cambios:structuredClone(lista(x.cambios))})),
            ...lista(resultado.cancelaciones_confirmadas).map(x=>({...meta(x),tipo:'cancelacion',anterior:structuredClone(x.anterior),actual:null,cambios:[],evidencia:structuredClone(x.evidencia)}))
        ].map(x=>({...x,id:idCambio(x)}));
    }
    function mismaInstantanea(a,b){return firmaReservaCambio(a)===firmaReservaCambio(b);}
    function fusionarHistorialCambios(registro,resultado,generacion){
        const cambios=lista(registro?.cambios).map(x=>structuredClone(x)),nuevos=extraerCambiosDetectados(resultado,generacion);
        const previos=new Set(cambios);
        for(const nuevo of nuevos){
            if(cambios.some(x=>x.id===nuevo.id||lista(x.ids_detectados).includes(nuevo.id)))continue;
            const candidatos=cambios.filter(x=>previos.has(x)&&x.actual&&nuevo.anterior&&mismaInstantanea(x.actual,nuevo.anterior));
            if(candidatos.length!==1){cambios.push(nuevo);continue;}
            const [anterior]=candidatos,indice=cambios.indexOf(anterior);
            previos.delete(anterior);
            // Abrir otra vez el informe de una versión ya fusionada no repite su cambio.
            const ids_detectados=[...new Set([anterior.id,...lista(anterior.ids_detectados),nuevo.id])];
            if(nuevo.tipo==='cancelacion'){cambios[indice]={...nuevo,ids_detectados};continue;}
            const deteccion={detectado_en:nuevo.detectado_en,detectado_generacion:nuevo.detectado_generacion,ids_detectados};
            const porCampo=new Map(lista(anterior.cambios).map(x=>[x.campo,structuredClone(x)]));
            for(const cambio of lista(nuevo.cambios)){
                const previo=porCampo.get(cambio.campo);
                porCampo.set(cambio.campo,previo?{...cambio,antes:previo.antes}:structuredClone(cambio));
            }
            const fusion={...anterior,...deteccion,actual:nuevo.actual,cambios:[...porCampo.values()]};
            fusion.id=idCambio(fusion);cambios[indice]=fusion;
        }
        return {version:1,actualizado_en:new Date().toISOString(),cambios};
    }
    function cambioPendiente(cambio={},vigente=true){
        const campo=cambio.campo||'Dato',antes=cambio.antes,ahora=cambio.ahora;
        const etiqueta=etiquetas[campo]||campo.replace(/_/g,' ');
        const actual=vigente?'Ahora en el Libro':'Última lectura guardada';
        if(/notas|pagos_pendientes|servicios/i.test(campo))return `<dt>${escapar(etiqueta)}</dt><dd>Antes en el Libro: ${escapar(resumenNota(valor(antes)))}<br>${actual}: ${escapar(resumenNota(valor(ahora)))}<br>En Proyecto H: ${escapar(resumenNota(explicar(cambio.proyecto)))}</dd>`;
        return `<dt>${escapar(etiqueta)}</dt><dd>${sensible(campo)?'Este dato cambió en el Libro. No se muestra aquí por privacidad.':`Antes en el Libro: ${escapar(valor(antes,campo))}<br>${actual}: ${escapar(valor(ahora,campo))}<br>En Proyecto H: ${escapar(valor(cambio.proyecto,campo))}`}</dd>`;
    }
    function explicarPendiente(item,generacion){
        const cambios=lista(item.cambios),r=item.actual||item.anterior||{};
        const motivos=lista(item.revision?.motivos).filter(x=>x!=='Elige cómo tratar esta reserva en la comparación.').map(explicar);
        const candidatos=lista(item.revision?.candidatos);
        const contexto=item.proyecto&&!['sin_coincidencia','sin coincidencia','ambigua'].includes(item.proyecto)?explicar(item.proyecto):'';
        const manual=esAdministrador()&&(item.preparacion||revisionServiciosPendiente(item,generacion));
        if(item.tipo==='cancelacion')return {
            encontro:'La reserva figura cancelada en el Libro.',
            motivo:`En Proyecto H: ${valor(item.proyecto,'estado_operativo').replace(/\.+$/,'')}. La cancelación aún necesita confirmación.`,
            paso:esAdministrador()&&revisionCancelacionPendiente(item,generacion)
                ?'Abre «Aprobación manual» para revisar la reserva y confirmar la cancelación.'
                :'Revisa la reserva en Proyecto H antes de confirmar su cancelación.'
        };
        if(item.tipo==='nueva'&&item.accionable)return {
            encontro:'Falta incorporar esta reserva en Proyecto H.',motivo:'Los datos permiten preparar su registro.',
            paso:'Pulsa «Revisar cambios» al final del informe para revisarla y confirmar su incorporación.'
        };
        if(!item.sistema){
            const candidato=candidatos.length===1?candidatos[0]:null;
            const mismaUbicacion=candidato&&Number(r.cabana)===Number(candidato.cabana)&&r.fecha_checkin===candidato.fecha_checkin&&r.fecha_checkout===candidato.fecha_checkout;
            const encontro=contexto|| (mismaUbicacion
                ?item.revision?.categoria==='modificacion_titular'
                    ?'Hay otra reserva con la misma cabaña y fechas, pero los datos del huésped no coinciden.'
                    :'Encontré una reserva con la misma cabaña y fechas, pero hay datos del Libro por aclarar.'
                :candidato?'Encontré una posible reserva, pero tiene otra cabaña o fechas.'
                :candidatos.length>1?'Encontré varias reservas posibles. No puedo elegir una sin tu revisión.'
                :item.proyecto==='sin_coincidencia'?'No encontré esta reserva en Proyecto H, pero faltan datos válidos para incorporarla.'
                :'No pude identificar con certeza esta reserva en Proyecto H.');
            const detalle=candidato?`${candidato.titular||'Sin nombre'} · CAB ${candidato.cabana??'—'} · ${fecha(candidato.fecha_checkin)} al ${fecha(candidato.fecha_checkout)}.`:'';
            return {encontro,motivo:[detalle,...motivos].filter(Boolean).join(' ')||'La incorporación queda detenida hasta aclarar este caso.',
                paso:candidatos.length||contexto?'Busca esta reserva en «Reservas» y comprueba si corresponde. Después pulsa «Volver a revisar».':'Revisa los datos indicados en el Libro y pulsa «Volver a revisar».'};
        }
        const frases=[];
        for(const c of cambios){
            if(['fecha_checkin','fecha_checkout'].includes(c.campo))frases.push(`La ${c.campo==='fecha_checkin'?'entrada':'salida'} cambió del ${fecha(c.antes)} al ${fecha(c.ahora)}.`);
            else if(c.campo==='noches'&&cambios.some(x=>['fecha_checkin','fecha_checkout'].includes(x.campo)))frases.push(`Pasa de ${valor(c.antes)} noche${Number(c.antes)===1?'':'s'} a ${valor(c.ahora)}.`);
            else if(c.campo==='servicios')frases.push('Hay cambios en los servicios o sus notas.');
            else if(c.campo==='notas_importantes')frases.push('Cambió una nota de la reserva.');
            else if(c.campo==='pagos_pendientes')frases.push('Cambió una nota sobre pagos pendientes.');
            else if(sensible(c.campo))frases.push(`Cambió el dato «${etiquetas[c.campo]||c.campo}».`);
            else frases.push(`${etiquetas[c.campo]||c.campo}: ${valor(c.antes,c.campo)} → ${valor(c.ahora,c.campo)}.`);
        }
        let motivo,paso;
        if(item.accionable){
            motivo='Este cambio todavía no está guardado en Proyecto H.';
            paso=manual?'Falta tu confirmación. Abre «Aprobación manual» para revisar y guardar el cambio.':'Pulsa «Revisar cambios» al final del informe para revisar y confirmar el cambio.';
        }else if(revisionServiciosPendiente(item,generacion)){
            motivo=cambios.filter(c=>c.campo==='servicios').map(c=>explicar(c.proyecto)).filter(Boolean).join(' ')||'Falta comprobar qué servicios o notas deben guardarse.';
            paso=manual?'Abre «Aprobación manual» para revisar solo los servicios y notas de esta reserva.':'Abre «Ver reserva» para comprobar sus servicios y notas.';
        }else{
            motivo=motivos.join(' ')||cambios.filter(c=>!c.accionable).map(c=>explicar(c.proyecto)).filter(x=>typeof x==='string').join(' ')||'No puedo preparar este cambio con los datos disponibles.';
            if(cambios.some(c=>c.campo==='noches'&&!c.accionable))motivo='La cantidad de noches no coincide con las fechas o falta un cambio de entrada o salida que la explique.';
            paso='Abre «Ver reserva», comprueba estos datos con el Libro y pulsa «Volver a revisar».';
        }
        return {encontro:frases.slice(0,2).join(' ')+(frases.length>2?` Hay ${frases.length-2} cambio${frases.length===3?'':'s'} más en el detalle.`:''),motivo,paso};
    }
    function detallePendiente(item,generacion){
        const e=explicarPendiente(item,generacion);
        const c=item.contexto,avisos=lista(c?.avisos),hechos=lista(c?.hechos);
        const pendienteFuente=avisos.find(x=>['libro_no_verificado','cancelada_en_libro'].includes(x.codigo));
        const contradiccion=avisos.find(x=>['noches_contradictorias','cambio_en_ambas_fuentes','promocion_segunda_noche'].includes(x.codigo));
        const financiero=avisos.find(x=>['noche_con_cobro','cobros_no_comprobados'].includes(x.codigo));
        const historia=root.HAIKU_LIBRO_CONTEXTO_V1?.fraseHistorial(c?.historial);
        if(pendienteFuente){e.encontro=pendienteFuente.codigo==='cancelada_en_libro'?'El Libro actual la muestra cancelada.':'Hay un aviso anterior de esta reserva.';e.motivo=pendienteFuente.texto;e.paso='Comprueba dónde está esta reserva en el Libro actual y pulsa «Volver a revisar».';}
        else if(contradiccion){e.motivo=contradiccion.texto;e.paso='Aclara ese dato en el Libro antes de incorporar el cambio.';}
        else if(financiero){e.motivo=financiero.texto;e.paso='El cambio de fechas debe conservar el precio acordado. Revisa su efecto en los cobros antes de confirmarlo.';}
        const servicios=lista(c?.servicios).filter(x=>x.estado!=='en_sistema');
        const detallesServicios=servicios.slice(0,2).map(x=>`${x.concepto}${x.hora?' · '+x.hora:''}: ${x.estado==='faltante'?'falta registrar.':resumenNota(explicar(x.razon))||'falta aclarar sus datos.'}`);
        if(servicios.length>2)detallesServicios.push(`${servicios.length-2} servicio${servicios.length===3?'':'s'} más en la comparación.`);
        const principal=pendienteFuente||contradiccion||financiero;
        // Servicios, notas y la columna de cobros pueden describir la misma
        // prestación. Mostrar una sola conclusión por elemento comprobado.
        if(!principal&&lista(c?.servicios).length)return detalleOperativo(item,generacion,historia);
        if(!principal&&detallesServicios.length&&lista(item.cambios).every(x=>x.campo==='servicios'))e.motivo='';
        const contexto=[...hechos.filter(x=>!x.startsWith('Corregir las fechas')),...detallesServicios,historia,
            ...avisos.filter(x=>x!==principal).map(x=>x.texto)].filter(Boolean);
        return `<div class="haku-pendiente-explicacion"><p><strong>${escapar(e.encontro)}</strong></p>`+
            (contexto.length?`<div class="haku-pendiente-contexto">${contexto.map(x=>`<p>${escapar(x)}</p>`).join('')}</div>`:'')+
            (e.motivo?`<p>${escapar(e.motivo)}</p>`:'')+`<p class="haku-pendiente-estado">${escapar(e.paso)}</p></div>`+
            (item.tipo==='modificacion'?`<details class="haku-pendiente-comparacion"><summary>${pendienteFuente?'Ver última comparación guardada':'Ver comparación de datos'} (${lista(item.cambios).length})</summary><dl>${lista(item.cambios).map(cambio=>cambioPendiente(cambio,!pendienteFuente)).join('')}</dl>${c?.calendario?`<p>Celdas revisadas: ${escapar(c.calendario.hoja)} · ${escapar(c.calendario.rango)}${c.calendario.siguiente_libre?.celda?`. LIBRE: ${escapar(c.calendario.siguiente_libre.celda)}`:''}.</p>`:''}</details>`:'');
    }
    const razonesServicio=s=>[...new Set([...String(s.razon||'').split(' · '),...lista(s.razones)])].filter(Boolean);
    function motivoServicio(s){
        if(s.estado==='en_sistema')return 'Ya registrado.';
        if(s.estado==='faltante')return 'Falta agregarlo a Proyecto H.';
        const motivos=razonesServicio(s);
        const sinFecha=motivos.some(x=>/^Falta una fecha inequívoca del servicio/.test(x));
        const breves=motivos.map(x=>{
            if(/^Falta una fecha inequívoca del servicio/.test(x))return 'Falta indicar el día.';
            if(x==='Falta fecha u hora para comprobar el servicio existente sin adivinar.')return sinFecha?'Falta indicar el día.':
                s.hora?'Falta indicar el día.':s.fecha?'Falta indicar la hora.':'Faltan el día y la hora.';
            return explicar(x);
        }).filter(Boolean);
        return [...new Set(breves)].join(' ')||'Falta aclarar sus datos.';
    }
    function detalleOperativo(item,generacion,historia){
        const c=item.contexto,servicios=lista(c.servicios),notas=lista(c.notas);
        const operativos=new Set(['servicios','notas_importantes','pagos_pendientes']);
        const otros=lista(item.cambios).filter(x=>!operativos.has(x.campo));
        const tituloServicio=s=>[String(s.concepto||'Servicio').replace(/^./,x=>x.toUpperCase())+
            (/masaje/i.test(s.tipo||s.concepto)&&Number(s.cantidad)>1?` ×${s.cantidad}`:''),
            s.fecha?fecha(s.fecha):'',s.hora?String(s.hora).slice(0,5):''].filter(Boolean).join(' · ');
        const bloques=servicios.map(s=>`<p><strong>${escapar(tituloServicio(s))}</strong><br>${escapar(motivoServicio(s))}</p>`);
        for(const n of notas)bloques.push(`<p><strong>Nota · ${n.estado==='en_sistema'?'ya guardada':n.estado==='faltante'?'falta guardar':'por revisar'}</strong><br>${escapar(resumenNota(n.texto))}</p>`);
        // Conservar las notas independientes. La glosa de cobro no acredita un
        // pago: si ya está desglosada como servicio, no es otro pendiente.
        const canon=t=>normalizar(t).replace(/[^a-z0-9]/g,'');
        const evidencias=[...servicios.map(s=>s.texto),...notas.map(n=>n.texto)].filter(Boolean).map(canon);
        const textos=new Set();
        for(const cambio of lista(item.cambios).filter(x=>operativos.has(x.campo)&&x.campo!=='servicios')){
            for(const raw of lista(Array.isArray(cambio.ahora)?cambio.ahora:[cambio.ahora])){
                if(typeof raw!=='string'||!raw.trim())continue;
                for(const fragmento of raw.split(/\s*\/\/\s*/).filter(Boolean)){
                    const key=canon(fragmento);
                    if(!key||textos.has(key)||evidencias.some(x=>x.includes(key)||key===x))continue;
                    textos.add(key);
                    bloques.push(`<p><strong>${cambio.campo==='pagos_pendientes'?'Nota de cobro':'Nota'} · por revisar</strong><br>${escapar(resumenNota(fragmento))}</p>`);
                }
            }
        }
        const extra=[...lista(c.hechos),historia,...lista(c.avisos).map(x=>x.texto)].filter(Boolean);
        const explicacion=otros.length?explicarPendiente({...item,cambios:otros},generacion).encontro:'';
        const accion=esAdministrador()&&revisionServiciosPendiente(item,generacion)
            ?'Revisa estos datos en «Aprobación manual».' : 'Revisa estos datos en «Ver reserva».';
        // El detalle conserva la evidencia original una sola vez, sin repetir
        // diagnósticos, columnas vacías ni llamar pagos a las notas de cobro.
        const fuentes=[...new Set([...servicios.map(s=>s.texto),...notas.map(n=>n.texto),
            ...lista(item.cambios).filter(x=>operativos.has(x.campo)&&x.campo!=='servicios')
                .flatMap(x=>Array.isArray(x.ahora)?x.ahora:[x.ahora])]
            .filter(x=>typeof x==='string'&&x.trim()).flatMap(x=>x.split(/\s*\/\/\s*/)).filter(Boolean))];
        return '<div class="haku-pendiente-explicacion">'+
            (explicacion?`<p><strong>${escapar(explicacion)}</strong></p>`:'')+
            `<div class="haku-pendiente-contexto">${bloques.join('')}${extra.map(x=>`<p>${escapar(x)}</p>`).join('')}</div>`+
            `<p class="haku-pendiente-estado">${escapar(accion)}</p></div>`+
            (fuentes.length||otros.length?`<details class="haku-pendiente-comparacion"><summary>Ver detalle del Libro</summary>${fuentes.map(x=>`<p>${escapar(resumenNota(x))}</p>`).join('')}${otros.length?`<dl>${otros.map(x=>cambioPendiente(x)).join('')}</dl>`:''}</details>`:'');
    }
    function revisionServiciosPendiente(item,generacion){
        if(generacion==null||item?.tipo!=='modificacion'||!item.actual||!item.sistema?.reserva_id||
            !lista(item.cambios).some(c=>c.campo==='servicios'))return null;
        // Abrir sólo esta ficha con el lector y la confirmación de servicios existentes.
        return {reservas:[item.actual],generacion};
    }
    function revisionCancelacionPendiente(item,generacion){
        return item?.tipo==='cancelacion'&&Boolean(item.anterior)&&generacion!=null&&item.fuente_vigente?.estado!=='no_disponible';
    }
    function renderizarPendientes(pendientes={}){
        const items=lista(pendientes.items),accionables=items.filter(x=>x.accionable).length;
        let html='<section class="haku-libro-pendientes haku-pendientes-compactos haku-actualizacion-sites__historial" aria-label="Qué falta resolver en Proyecto H"><header class="haku-actualizacion-sites__historial-head"><div><span>DEL LIBRO A PROYECTO H</span><strong>Qué falta resolver en Proyecto H</strong></div><span class="haku-actualizacion-sites__chip">'+(pendientes.sinVerificar?'Por comprobar':'Revisado en Proyecto H')+'</span></header>';
        if(pendientes.sinVerificar)html+='<p class="haku-libro-pendientes-error">Conservé los pendientes. Falta comprobarlos en Proyecto H.</p>';
        if(!items.length)html+='<p class="haku-libro-sin-pendientes"><strong>No quedan cambios pendientes en este informe.</strong></p>';
        else{
            html+=`<div class="haku-actualizacion-sites__historial-metricas"><div><span>Casos pendientes</span><strong>${items.length}</strong></div><div><span>Listos para tu revisión</span><strong>${accionables}</strong></div></div>`;
            html+=`<p class="haku-pendientes-resumen">Hay ${items.length} caso${items.length===1?'':'s'} por resolver. ${accionables?`Puedes revisar ${accionables} con «Revisar cambios» antes de guardarlos.`:'Revisa los detalles de cada caso.'} Nada se guarda sin tu confirmación.${pendientes.revisionServicios?.reservas?.length?' Para los servicios y las notas, pulsa «Revisar servicios y notas».':''}</p>`;
            for(const [indice,registro] of items.entries()){
                const item=registro.tipo==='modificacion'&&registro.proyecto&&!registro.sistema?
                    {...registro,cambios:lista(registro.cambios).map(c=>({...c,proyecto:registro.proyecto}))}:registro;
                const r=item.actual||item.anterior||{};
                const revisionManual=item.preparacion||revisionServiciosPendiente(item,pendientes.generacion)||
                    revisionCancelacionPendiente(item,pendientes.generacion);
                const etiqueta=item.detectado_generacion===pendientes.generacion?'DE ESTA ACTUALIZACIÓN':'PENDIENTE DE UNA ACTUALIZACIÓN ANTERIOR';
                html+=`<details class="haku-pendiente-item haku-actualizacion-sites__pendiente ${item.accionable?'':'haku-actualizacion-sites__pendiente--revision'}"><summary><span>CAB ${escapar(r.cabana??'—')} · ${escapar(r.titular||'Nombre no indicado')}</span><span aria-hidden="true">⌄</span></summary><div class="haku-pendiente-detalle"><small>${etiqueta}</small><p>Entrada: ${escapar(fecha(r.fecha_checkin))} · Salida: ${escapar(fecha(r.fecha_checkout))}${r.tipo_estadia==='full_day'?' · Full Day':''}</p>${detallePendiente(item,pendientes.generacion)}<div class="haku-actualizacion-sites__historial-acciones" style="padding:0;border:0">${item.sistema?.reserva_id?`<button type="button" class="haku-actualizacion-sites__boton" data-haku-ver-reserva="${indice}">Ver reserva</button>`:''}${esAdministrador()&&revisionManual?`<button type="button" class="haku-actualizacion-sites__boton haiku-incorporacion-manual-accion" data-haku-aprobar-pendiente="${indice}">Aprobación manual</button>`:''}</div></div></details>`;
            }
        }
        const resueltos=lista(pendientes.resueltosDetalle);
        if(resueltos.length)html+=`<details class="haku-pendientes-resueltos"><summary>Ya resueltos (${resueltos.length})</summary>`;
        for(const [indice,item] of resueltos.entries()){
            const r=item.actual||item.anterior||{};
            html+=`<details class="haku-pendiente-item haku-actualizacion-sites__pendiente"><summary><span>CAB ${escapar(r.cabana??'—')} · ${escapar(r.titular||'Nombre no indicado')}</span><span aria-hidden="true">⌄</span></summary><div class="haku-pendiente-detalle">`;
            if(item.motivo==='aviso_cancelacion_cerrado'){
                html+=`<small>AVISO CERRADO</small><p>Reserva nunca ingresada en Proyecto H.</p><p>Entrada: ${escapar(fecha(r.fecha_checkin))} · Salida: ${escapar(fecha(r.fecha_checkout))}</p></div></details>`;
                continue;
            }
            const noShow=/no[\s_-]*show/i.test(`${item.sistema?.estado_reserva} ${item.sistema?.estado_operativo}`);
            const coincide=item.motivo==='ya_coincide',canceladaLibro=item.motivo==='cancelada_en_libro';
            html+=`<small>YA COMPROBADA EN PROYECTO H</small><p><strong>${canceladaLibro?'Cancelada en el Libro. No corresponde incorporarla.':coincide?'El Libro actual y Proyecto H ya coinciden.':noShow?'Ya registrada como «No se presentó».':'Ya registrada y cancelada.'}</strong></p><p>${canceladaLibro?'La encontré en Cancelaciones y no hay una estadía vigente compatible en Proyecto H.':coincide?`Entrada ${escapar(fecha(r.fecha_checkin))} · Salida ${escapar(fecha(r.fecha_checkout))}. El aviso anterior ya no requiere cambios.`:'Coinciden el huésped, la cabaña y las fechas. No hace falta incorporarla otra vez.'}</p><p class="haku-pendiente-estado">${coincide||canceladaLibro?'Pendiente cerrado sin modificar la reserva ni sus cobros.':'Se conserva su estado. No necesitas aprobar nada para este aviso.'}</p>${item.sistema?.reserva_id?`<div class="haku-actualizacion-sites__historial-acciones" style="padding:0;border:0"><button type="button" class="haku-actualizacion-sites__boton" data-haku-ver-resuelta="${indice}">Ver reserva</button></div>`:''}</div></details>`;
        }
        if(resueltos.length)html+='</details>';
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
                    const origen = resultado.libro_actual?.generacion ?? g;
                    generacionesResultado.set(resultado, origen);
                    // El solicitante termina su lectura; una versión antigua nunca
                    // se reutiliza como vigente ni habilita las acciones de escritura.
                    if (rev === revision && origen === generacion() && origen != null && ['ok','sin_cambios','sin_linea_base','parcial'].includes(resultado.estado)) cache = {generacion:origen,resultado};
                    return resultado;
                });
                try { return await pendiente; } finally { pendiente = undefined; }
            }
        };
    }
    function crearCachePendientes(dependencias = {}) {
        let cache, pendiente, revision = 0;
        const soloAviso=dependencias.soloAviso===true;
        const generacionActual = dependencias.generacion || (()=>root.HAIKU_LIBRO_RESERVA_V1?.estado?.().generacion);
        const leer = dependencias.leer || (()=>root.HAIKU_LIBRO_RESERVA_V1?.leerCambiosDetectados?.());
        const guardar = dependencias.guardar || (registro=>root.HAIKU_LIBRO_RESERVA_V1?.guardarCambiosDetectados?.(registro));
        const revalidarCambios = dependencias.revalidarCambios || ((cambios,opciones)=>root.HAIKU_LIBRO_CONSULTAS?.revalidarCambiosDetectados?.(cambios,root.haikuSupabase,opciones));
        const contextoActual = () => dependencias.contexto || root.HAIKU_LIBRO_CONTEXTO_V1;
        const validar = g => {
            if (g == null) throw new Error('No puedo comprobar a qué versión del Libro corresponde este informe. Pide uno nuevo.');
            if (generacionActual?.() !== g) throw Object.assign(new Error('Llegaron datos nuevos mientras comprobaba los pendientes. El informe se conserva.'),{lecturaCambiada:true});
        };
        return {
            invalidar() { revision++; cache = undefined; },
            async obtener(resultado,{revalidar=false,reintento=false}={}) {
                const origen=generacionInforme(resultado);
                if(origen==null)throw new Error('No puedo comprobar la versión de origen de este informe. Pide uno nuevo.');
                await root.HAIKU_LIBRO_RESERVA_V1?.listo?.();
                const g=generacionActual(),rev=revision; validar(g);
                const contexto=contextoActual();
                if(origen!==g&&!contexto?.actualizarDesdeLibro)throw new Error('El Libro cambió y no pude comprobar sus datos actuales. Conservé el informe; vuelve a revisar.');
                if (!revalidar && cache?.generacion===g && cache.informe===resultado) return cache.resultado;
                if (pendiente) {
                    try { await pendiente; } catch (_) {}
                    return this.obtener(resultado,{revalidar,reintento});
                }
                const tarea=(async()=>{
                    const previo=soloAviso?{version:1,cambios:[]}:await leer()||{version:1,cambios:[]};
                    const cierres=await leerCierresCancelacion();
                    validar(g);
                    let registro=fusionarHistorialCambios(previo,resultado,origen);
                    const cerrados=registro.cambios.filter(x=>cierres.has(firmaAvisoCancelacion(x)));
                    registro.cambios=sinAvisosCerrados(registro.cambios,cierres);
                    if(!soloAviso&&JSON.stringify(registro.cambios)!==JSON.stringify(lista(previo.cambios)))await guardar(registro);
                    validar(g);
                    const vigentes=contexto?await contexto.actualizarDesdeLibro(registro.cambios):registro.cambios;
                    validar(g);
                    const resultadoPendientes=await revalidarCambios(vigentes,{generacion:g});
                    if(!resultadoPendientes)throw new Error('No pude revalidar los cambios detectados contra Proyecto H.');
                    if(contexto){
                        resultadoPendientes.items=await contexto.enriquecer(resultadoPendientes.items||[],root.haikuSupabase,{comparacion:{
                            serviciosDetalle:resultadoPendientes.serviciosContexto,notasDetalle:resultadoPendientes.notasContexto}});
                        const porId=new Map(vigentes.map(x=>[x.id,x]));
                        resultadoPendientes.resueltos=[...new Set((resultadoPendientes.resueltos||[]).flatMap(id=>porId.get(id)?.ids_origen||[id]))];
                    }
                    validar(g);
                    const resueltos=new Set(lista(resultadoPendientes.resueltos));
                    if(resueltos.size){
                        registro={...registro,actualizado_en:new Date().toISOString(),cambios:registro.cambios.filter(x=>!resueltos.has(x.id))};
                        if(!soloAviso)await guardar(registro);
                    }
                    if(cerrados.length){
                        resultadoPendientes.resueltos=[...resueltos,...cerrados.map(x=>x.id)];
                        resultadoPendientes.resueltosDetalle=[...lista(resultadoPendientes.resueltosDetalle),
                            ...cerrados.map(x=>({...x,motivo:'aviso_cancelacion_cerrado'}))];
                    }
                    const porId=new Map(lista(resultadoPendientes.items).map(x=>[x.id,x]));
                    Object.defineProperty(resultadoPendientes,'registrosAviso',{configurable:true,value:vigentes
                        .filter(x=>!resueltos.has(x.id)).map(x=>porId.get(x.id)||x)});
                    resultadoPendientes.generacion=g;
                    if(resultadoPendientes.reservas?.length)Object.defineProperty(resultadoPendientes,'preparacion',{value:{
                        reservas:resultadoPendientes.reservas,comparacion:resultadoPendientes.comparacion,generacion:g,q:resultadoPendientes.q
                    },enumerable:false});
                    validar(g);
                    if (rev!==revision) throw Object.assign(new Error('La lectura se actualizó; el informe se conserva.'),{lecturaCambiada:true});
                    cache={generacion:g,informe:resultado,resultado:resultadoPendientes};
                    return resultadoPendientes;
                })();
                pendiente=tarea;
                try{return await tarea;}catch(error){
                    if(error.lecturaCambiada&&!reintento){
                        if(pendiente===tarea)pendiente=undefined;
                        return this.obtener(resultado,{revalidar:true,reintento:true});
                    }
                    throw error;
                }finally{if(pendiente===tarea)pendiente=undefined;}
            }
        };
    }
    let instalado = false, cacheCompartida, cachePendientesCompartida, insertarResultado, insertarIncorporacion, insertarRevisionAbonos;
    const origenAvisos = new WeakMap(), registroLeido = new WeakMap();
    function proyectarPendientesAviso(resultado,registros,{resueltos=false,sinVerificar=false}={}) {
        const aviso={...resultado,nuevas:[],modificadas:[],cancelaciones_confirmadas:[],
            pendientesResueltos:resueltos,pendientesSinVerificar:sinVerificar&&registros.length>0};
        const secciones={nueva:aviso.nuevas,modificacion:aviso.modificadas,cancelacion:aviso.cancelaciones_confirmadas};
        for(const x of registros)secciones[x.tipo]?.push(x);
        const altas=new Set(aviso.nuevas.map(x=>x.actual?.id));
        // El abono puede seguir pendiente aunque su reserva ya esté en Proyecto H.
        aviso.abonos=lista(resultado.abonos).map(x=>x.nueva&&!altas.has(x.nueva)?{...x,nueva:null}:x);
        origenAvisos.set(aviso,resultado);
        return aviso;
    }
    function puedeRevisarAbonos(resultado) {
        return esAdministrador() && lista(resultado?.abonos).some(x => !x.revisar && x.reservas.length) &&
            typeof root.HAIKU_LIBRO_CONSULTAS?.compararAbonosAviso === 'function';
    }
    function revisarAbonosDesdeAviso(resultado) {
        if (puedeRevisarAbonos(resultado) && instalar()) return insertarRevisionAbonos(resultado);
    }
    function puedeIncorporar(resultado){
        return esAdministrador()&&['ok','sin_cambios','parcial'].includes(resultado?.estado)&&
            Boolean(lista(resultado?.nuevas).length||lista(resultado?.modificadas).length);
    }
    function revisarDesdeAviso(resultado){
        if(!puedeIncorporar(resultado))throw new Error('La incorporación de cambios requiere una sesión de administrador.');
        if(!instalar())throw new Error('Haku todavía no está disponible.');
        return insertarIncorporacion(resultado);
    }
    function pendienteParaAviso(item) {
        const r=item.actual||item.anterior||{};
        const cambios=lista(item.cambios);
        const cambiosServicio=cambios.filter(c=>c.campo==='servicios');
        const servicios=lista(item.contexto?.servicios).filter(s=>s.estado!=='en_sistema').map(s=>{
            const motivos=razonesServicio(s);
            return {nombre:s.concepto,fecha:s.fecha,hora:s.hora,texto:s.texto,
                motivos:motivos.length?motivos:[motivoServicio(s)]};
        });
        const conceptos=[...new Set(cambiosServicio.flatMap(c=>lista(c.ahora).map(s=>s?.concepto)).filter(Boolean))];
        return {
            reserva:`${r.titular||'Reserva'} · CAB ${r.cabana??'—'}`,
            titular:r.titular,cabana:r.cabana,fechaIngreso:r.fecha_checkin,
            tipo:cambiosServicio.length||servicios.length?'servicio':'reserva',
            concepto:conceptos.length===1?conceptos[0]:null,
            origen:r.coordenadas_origen,
            servicios,
            motivos:[...new Set([...lista(item.revision?.motivos),...cambios.map(c=>c.proyecto).filter(v=>typeof v==='string'),
                typeof item.proyecto==='string'?item.proyecto:null].filter(Boolean))]
        };
    }
    const operacionesAviso=new WeakMap();
    function incorporarDesdeAviso(resultado){
        if(!puedeIncorporar(resultado))return Promise.reject(new Error('Necesitas una sesión de administrador para incorporar estos cambios.'));
        let estado=operacionesAviso.get(resultado);
        if(!estado){estado={cache:crearCachePendientes({soloAviso:true}),decisiones:new Map(),aprobados:new Set(),recibos:[]};operacionesAviso.set(resultado,estado);}
        if(estado.terminado)return Promise.resolve(estado.terminado);
        if(estado.promesa)return estado.promesa;
        const validarSesion=async()=>{
            if(!puedeIncorporar(resultado))throw Error('Necesitas una sesión de administrador para incorporar estos cambios.');
            const auth=await root.haikuSupabase?.auth?.getUser?.(),id=auth?.data?.user?.id;
            if(auth?.error||!id||estado.usuario&&estado.usuario!==id)throw Error('La sesión cambió. Revisa el aviso con tu sesión actual.');
            estado.usuario=id;
        };
        const totales=()=>estado.recibos.reduce((s,r)=>{
            for(const k of ['reservas_creadas','estadias_agregadas','actualizaciones','servicios_creados','notas_creadas'])s[k]=(s[k]||0)+(r[k]||0);
            return s;
        },{});
        const ejecutar=async()=>{
            try{
                await validarSesion();
                const api=root.HAIKU_LIBRO_CONSULTAS;
                if(!estado.inicial)estado.inicial=await estado.cache.obtener(resultado,{revalidar:true});
                if(!estado.reservasTerminadas){
                    if(!estado.plan&&estado.inicial.preparacion?.reservas?.length){
                        estado.entrada=estado.inicial.preparacion;
                        estado.plan=await api.prepararIncorporacion(estado.entrada,estado.decisiones,estado.aprobados);
                        // Los avisos de «pagos pendientes» son notas. Este acceso
                        // no confirma cobros ni decisiones manuales de pagos.
                        for(const item of estado.plan.items)item.seleccionado=Boolean(item.seleccionado&&
                            (['nuevas','estadias'].includes(item.categoria)||item.payload?.tipo==='reserva_actualizar'));
                    }
                    if(estado.plan?.items.some(x=>x.seleccionado)){
                        await validarSesion();
                        const fin=await api.confirmarIncorporacion(estado.entrada,estado.decisiones,estado.aprobados,estado.plan);
                        if(fin?.resultado?.ok!==true)throw Error('Proyecto H no confirmó la incorporación.');
                        estado.recibos.push(fin.resultado);
                    }
                    estado.reservasTerminadas=true;
                }
                if(!estado.serviciosTerminados){
                    const anteriores=lista(estado.inicial.revisionServicios?.reservas);
                    const nuevas=lista(estado.inicial.items).filter(x=>x.tipo==='nueva'&&x.accionable&&
                        (lista(x.actual?.servicios).length||lista(x.actual?.menciones_servicio).length)).map(x=>x.actual);
                    const scope={generacion:estado.inicial.generacion,reservas:[...new Map([...anteriores,...nuevas]
                        .map(r=>[JSON.stringify([r.titular,r.cabana,r.fecha_checkin,r.fecha_checkout]),r])).values()]};
                    if(scope?.reservas?.length){
                        if(!estado.guardarServicios){
                            const guard=root.HAIKU_LIBRO_CONFIRM_CANCEL_FIX_V4;
                            if(!guard?.crearIncorporacionAviso)throw Error('La incorporación de servicios todavía no está disponible.');
                            estado.guardarServicios=guard.crearIncorporacionAviso(scope);
                        }
                        await validarSesion();
                        estado.recibos.push(await estado.guardarServicios());
                    }
                    estado.serviciosTerminados=true;
                }
                let pendientes=await estado.cache.obtener(resultado,{revalidar:true});
                // Al guardar un servicio pueden quedar sus notas listas para el
                // writer de la reserva. Completar esa etapa en el mismo clic.
                if(!estado.cierreTerminado&&(estado.planFinal?.solicitudPendiente||pendientes.preparacion?.reservas?.length)){
                    if(!estado.planFinal){
                        estado.entradaFinal=pendientes.preparacion;
                        estado.planFinal=await api.prepararIncorporacion(estado.entradaFinal,estado.decisiones,estado.aprobados);
                        for(const item of estado.planFinal.items)item.seleccionado=Boolean(item.seleccionado&&
                            (['nuevas','estadias'].includes(item.categoria)||item.payload?.tipo==='reserva_actualizar'));
                    }
                    if(estado.planFinal.items.some(x=>x.seleccionado)){
                        await validarSesion();
                        const fin=await api.confirmarIncorporacion(estado.entradaFinal,estado.decisiones,estado.aprobados,estado.planFinal);
                        if(fin?.resultado?.ok!==true)throw Error('Proyecto H no confirmó la incorporación.');
                        estado.recibos.push(fin.resultado);
                    }
                    estado.cierreTerminado=true;
                    pendientes=await estado.cache.obtener(resultado,{revalidar:true});
                }
                estado.terminado={...totales(),pendientes:lista(pendientes.items).map(pendienteParaAviso)};
                return estado.terminado;
            }catch(error){
                // Un rechazo anterior al envío permite preparar datos vigentes.
                // Una solicitud enviada conserva su identidad para el reintento.
                if(!estado.reservasTerminadas&&!estado.plan?.solicitudPendiente){estado.plan=null;estado.inicial=null;}
                if(!estado.cierreTerminado&&!estado.planFinal?.solicitudPendiente)estado.planFinal=null;
                throw Object.assign(error instanceof Error?error:new Error(error?.message||'No pude confirmar la incorporación.'),{incorporado:totales()});
            }
        };
        estado.promesa=ejecutar().finally(()=>{
            if(estado.recibos.length||estado.terminado)cachePendientesCompartida?.invalidar();
            estado.promesa=null;
        });return estado.promesa;
    }
    function obtenerResultado() {
        if (!instalar()) return Promise.reject(new Error('Haku todavía no está disponible.'));
        return cacheCompartida.obtener();
    }
    async function conservarRegistros(resultado){
        const origen=generacionInforme(resultado);
        try{
            const cierres=await leerCierresCancelacion();
            if(registroLeido.has(resultado))return sinAvisosCerrados(registroLeido.get(resultado),cierres);
            const registro=await root.HAIKU_LIBRO_RESERVA_V1?.leerCambiosDetectados?.();
            return sinAvisosCerrados(fusionarHistorialCambios(registro,resultado,origen).cambios,cierres);
        }catch(_){return extraerCambiosDetectados(resultado,origen);}
    }
    async function obtenerResultadoAviso() {
        const resultado=await obtenerResultado();
        try{
            const pendientes=await cachePendientesCompartida.obtener(resultado);
            registroLeido.set(resultado,pendientes.registrosAviso);
            return proyectarPendientesAviso(resultado,pendientes.registrosAviso,{resueltos:lista(pendientes.resueltos).length>0});
        }catch(_){
            return proyectarPendientesAviso(resultado,await conservarRegistros(resultado),{sinVerificar:true});
        }
    }
    function mostrarResultado(resultado) {
        if (!instalar()) throw new Error('Haku todavía no está disponible.');
        return insertarResultado(origenAvisos.get(resultado)||resultado);
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
                if(libro?.leerCambiosDetectados&&libro?.guardarCambiosDetectados&&resultado.libro_actual?.generacion===g){
                    const previo=await libro.leerCambiosDetectados()||{version:1,cambios:[]};
                    const fusion=fusionarHistorialCambios(previo,resultado,g);
                    fusion.cambios=sinAvisosCerrados(fusion.cambios,await leerCierresCancelacion());
                    registroLeido.set(resultado,fusion.cambios);
                    if(libro.estado().generacion===g&&JSON.stringify(fusion.cambios)!==JSON.stringify(lista(previo.cambios)))await libro.guardarCambiosDetectados(fusion);
                }
            }catch(error){console.warn('HAIKU · No se pudo conservar el historial local de cambios:',error);}
            if (puedeRevisarAbonos(resultado)) {
                try {
                    const estados = await root.HAIKU_LIBRO_CONSULTAS.compararAbonosAviso(resultado.abonos, resultado.libro_actual?.generacion);
                    resultado.abonos.forEach((abono, i) => { if (estados[i]) abono.estado = estados[i]; });
                } catch (_) { /* El informe del Libro sigue disponible para revisar los abonos. */ }
            }
            return resultado;
        },()=>root.HAIKU_LIBRO_RESERVA_V1?.estado().generacion);
        cacheCompartida = cache;
        const cachePendientes=cachePendientesCompartida=crearCachePendientes();
        root.addEventListener('haiku:libro-cambio',()=>{cache.invalidar();cachePendientes.invalidar();});
        function mensaje(tipo,texto) {
            const el = doc.createElement('div'); el.className = `haiku-asistente-mensaje haiku-asistente-mensaje--${tipo}`; el.textContent = texto; mensajes.appendChild(el); mensajes.scrollTop = mensajes.scrollHeight; return el;
        }
        function enlazarCabecera(contenedor, resultado) {
            const cerrar=contenedor.querySelector?.('[data-haku-cerrar-actualizacion]');
            cerrar?.addEventListener?.('click',()=>doc.getElementById('haiku-asistente-cerrar')?.click());
            contenedor.querySelector?.('[data-haku-revisar-abonos]')?.addEventListener('click',()=>revisarAbonosDesdeAviso(resultado));
        }
        function adjuntarPendientes(contenedor,resultado,cacheActual=cachePendientes) {
            const zona=doc.createElement('div');zona.className='haku-libro-pendientes-zona';
            (contenedor.querySelector?.('.haku-actualizacion-sites__tarjeta')||contenedor).appendChild(zona);
            const cargar=async revalidar=>{
                zona.innerHTML='<section class="haku-libro-pendientes"><p>Revisando qué falta guardar en Proyecto H…</p></section>';
                try{
                    const pendientes=await cacheActual.obtener(resultado,{revalidar});
                    if(cacheActual===cachePendientes)registroLeido.set(resultado,pendientes.registrosAviso);
                    zona.innerHTML=renderizarPendientes(pendientes);
                    const pendientesVigentes=async()=>{
                        await root.HAIKU_LIBRO_RESERVA_V1?.listo?.();
                        return pendientes.generacion===root.HAIKU_LIBRO_RESERVA_V1?.estado?.().generacion
                            ? pendientes : cacheActual.obtener(resultado,{revalidar:true});
                    };
                    const claveCaso=item=>item?.id||JSON.stringify([item?.tipo,item?.actual?.id,item?.actual?.titular,
                        item?.actual?.cabana,item?.actual?.fecha_checkin,item?.anterior?.id]);
                    for(const ver of zona.querySelectorAll?.('[data-haku-ver-reserva]')||[]){
                        ver.addEventListener('click',()=>{
                            const item=pendientes.items[Number(ver.dataset.hakuVerReserva)];
                            if(item?.sistema?.reserva_id)(root.HAIKU_INSPECTOR_V1||root.HAIKU_PANELES_V1)?.abrirReserva?.(item.sistema.reserva_id,ver);
                        });
                    }
                    for(const ver of zona.querySelectorAll?.('[data-haku-ver-resuelta]')||[]){
                        ver.addEventListener('click',()=>{
                            const item=pendientes.resueltosDetalle?.[Number(ver.dataset.hakuVerResuelta)];
                            if(item?.sistema?.reserva_id)(root.HAIKU_INSPECTOR_V1||root.HAIKU_PANELES_V1)?.abrirReserva?.(item.sistema.reserva_id,ver);
                        });
                    }
                    for(const manual of zona.querySelectorAll?.('[data-haku-aprobar-pendiente]')||[]){
                        manual.addEventListener('click',async()=>{
                            if(manual.disabled)return;
                            let item=pendientes.items[Number(manual.dataset.hakuAprobarPendiente)];
                            let revisionServicios=revisionServiciosPendiente(item,pendientes.generacion);
                            let revisionCancelacion=revisionCancelacionPendiente(item,pendientes.generacion);
                            if(!esAdministrador()||(!item?.preparacion&&!revisionServicios&&!revisionCancelacion))return;
                            manual.disabled=true;manual.setAttribute?.('aria-busy','true');
                            const destino=manual.closest('.haku-pendiente-detalle');
                            destino.querySelector?.('.haku-libro-preparacion-zona')?.remove?.();
                            const vista=doc.createElement('div');vista.className='haku-libro-preparacion-zona';
                            if(revisionCancelacion){
                                vista.className+=' haku-libro-preparacion-zona--cancelacion';vista.setAttribute?.('role','status');
                            }
                            vista.textContent=revisionCancelacion?'Comprobando la cancelación…':'Comprobando este cambio antes de pedir tu confirmación…';
                            destino.appendChild(vista);
                            let cancelacionAbierta=false;
                            try{
                                const actuales=await pendientesVigentes();
                                if(actuales!==pendientes){
                                    item=actuales.items.find(x=>claveCaso(x)===claveCaso(item));
                                    revisionServicios=revisionServiciosPendiente(item,actuales.generacion);
                                    revisionCancelacion=revisionCancelacionPendiente(item,actuales.generacion);
                                    if(!item?.preparacion&&!revisionServicios&&!revisionCancelacion){await cargar(true);return;}
                                }
                                if(revisionCancelacion){
                                    const api=root.HAIKU_LIBRO_CANCELACIONES_V1;
                                    if(!api?.abrirRevisionHistorial)throw Error('No está disponible la revisión de cancelaciones. Recarga Proyecto H.');
                                    const libro=root.HAIKU_LIBRO_RESERVA_V1,firma=firmaAvisoCancelacion(item);
                                    const cerrarAviso=firma&&typeof libro?.cerrarAvisoCancelacion==='function'?async()=>{
                                        if(!esAdministrador())throw Error('Inicia sesión como administrador para cerrar este aviso.');
                                        if(libro.estado().generacion!==actuales.generacion)throw Error('El Libro cambió. Vuelve a revisar la cancelación.');
                                        await libro.cerrarAvisoCancelacion(firma);
                                        cacheActual.invalidar();
                                        if(cacheActual!==cachePendientes)cachePendientes.invalidar();
                                    }:undefined;
                                    vista.textContent='';vista.removeAttribute?.('role');
                                    await api.abrirRevisionHistorial(vista,item,actuales.generacion,resuelta=>{
                                        vista.remove();
                                        if(resuelta)return cargar(true);
                                        manual.disabled=false;manual.focus?.({preventScroll:true});
                                    },cerrarAviso);
                                    cancelacionAbierta=true;
                                }else if(item.preparacion){
                                    if(!root.HAIKU_LIBRO_CONSULTAS?.abrirPreparacionComparacion)throw Error('Recarga Proyecto H para abrir la revisión.');
                                    await root.HAIKU_LIBRO_CONSULTAS.abrirPreparacionComparacion(vista,item.preparacion);
                                }else{
                                    const api=root.HAIKU_LIBRO_SERVICIOS_SCOPE_V2;
                                    if(!api?.abrirRevisionHistorial)throw Error('No está disponible la revisión de servicios y notas. Recarga Proyecto H.');
                                    const card=doc.createElement('div');vista.textContent='';vista.appendChild(card);
                                    await api.abrirRevisionHistorial(card,{...revisionServicios,aprobacionManual:true});
                                }
                                vista.scrollIntoView?.({block:'nearest'});
                            }catch(error){
                                if(error?.haikuSinCambiosPreparables){await cargar(true);return;}
                                vista.textContent=error?.message||'No se pudo abrir la revisión.';vista.setAttribute?.('role','alert');
                            }finally{if(!cancelacionAbierta)manual.disabled=false;manual.removeAttribute?.('aria-busy');}
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
                            const actuales=await pendientesVigentes();
                            if(!actuales.revisionServicios?.reservas?.length){await cargar(true);return;}
                            await api.abrirRevisionHistorial(card,actuales.revisionServicios);vista.scrollIntoView?.({block:'nearest'});
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
                            const actuales=await pendientesVigentes();
                            if(!actuales.preparacion?.reservas?.length){await cargar(true);return;}
                            await root.HAIKU_LIBRO_CONSULTAS.abrirPreparacionComparacion(vista,actuales.preparacion);
                            vista.scrollIntoView?.({block:'nearest'});
                        }catch(error){
                            if(error?.haikuSinCambiosPreparables){await cargar(true);return;}
                            vista.classList?.add?.('haku-libro-pendientes-error');vista.textContent=error?.message||'No se pudo preparar la incorporación.';preparar.disabled=false;
                        }
                        finally{preparar.removeAttribute?.('aria-busy');mensajes.scrollTop=mensajes.scrollHeight;}
                    });
                }catch(error){
                    const guardados=cacheActual===cachePendientes?await conservarRegistros(resultado):[];
                    if(guardados.length){
                        const items=guardados.map(x=>({...x,accionable:false,estado:'revision',preparacion:null,sistema:null,
                            fuente_vigente:{estado:'no_disponible'}}));
                        zona.innerHTML=renderizarPendientes({items,generacion:root.HAIKU_LIBRO_RESERVA_V1?.estado?.().generacion,sinVerificar:true});
                        zona.querySelector?.('[data-haku-revalidar-proyecto]')?.addEventListener('click',()=>{void cargar(true);});
                        return;
                    }
                    zona.innerHTML=`<section class="haku-libro-pendientes"><header class="haiku-asistente-preview-cabecera"><div><span>DEL LIBRO A PROYECTO H</span><strong>Qué falta resolver en Proyecto H</strong></div></header><p class="haku-libro-pendientes-error">No pude comprobar qué cambios siguen pendientes en Proyecto H.${error?.message ? ` ${escapar(error.message)}` : ''}</p></section>`;
                    const boton=doc.createElement('button');boton.type='button';boton.className='haku-libro-revalidar';boton.textContent='Volver a revisar';
                    boton.addEventListener?.('click',async()=>{boton.disabled=true;await cargar(true);});zona.appendChild(boton);
                }
                mensajes.scrollTop=mensajes.scrollHeight;
            };
            void cargar(false);
            return zona;
        }
        const incorporaciones=new WeakMap();
        insertarIncorporacion=resultado=>{
            const existente=incorporaciones.get(resultado);
            if(existente&&existente.el.isConnected!==false){
                existente.el.scrollIntoView?.({block:'nearest'});return existente.el;
            }
            const el=mensaje('asistente',''),estado={el};incorporaciones.set(resultado,estado);
            el.classList.add('haku-incorporacion-aviso');
            el.innerHTML='<strong>Incorporar cambios</strong><div class="haku-incorporacion-aviso__contenido"></div>';
            const contenido=el.querySelector('.haku-incorporacion-aviso__contenido');
            // Este acceso trabaja sólo con el aviso pulsado; el historial general
            // conserva sus otros pendientes y sus resoluciones.
            const cacheAviso=crearCachePendientes({soloAviso:true});
            const ejecutar=async()=>{
                if(estado.ocupado)return;estado.ocupado=true;
                contenido.textContent='Comprobando estos cambios en Proyecto H…';
                contenido.setAttribute('aria-busy','true');
                try{
                    if(!puedeIncorporar(resultado))throw new Error('Inicia sesión como administrador para incorporar estos cambios.');
                    const pendientes=await cacheAviso.obtener(resultado,{revalidar:true});
                    if(!puedeIncorporar(resultado))throw new Error('Inicia sesión como administrador para incorporar estos cambios.');
                    contenido.textContent='';
                    if(!pendientes.items?.length){contenido.textContent='Estos cambios ya están resueltos en Proyecto H.';return;}
                    let preparadas=false,servicios=false;
                    if(pendientes.preparacion?.reservas?.length){
                        if(!root.HAIKU_LIBRO_CONSULTAS?.abrirPreparacionComparacion)throw new Error('La preparación de reservas todavía no está disponible.');
                        const vista=doc.createElement('div');vista.className='haku-libro-preparacion-zona';contenido.appendChild(vista);
                        await root.HAIKU_LIBRO_CONSULTAS.abrirPreparacionComparacion(vista,pendientes.preparacion);preparadas=true;
                    }
                    if(pendientes.revisionServicios?.reservas?.length){
                        if(!root.HAIKU_LIBRO_SERVICIOS_SCOPE_V2?.abrirRevisionHistorial)throw new Error('La preparación de servicios y notas todavía no está disponible.');
                        const vista=doc.createElement('div');vista.className='haku-libro-revision-servicios-zona';contenido.appendChild(vista);
                        const card=doc.createElement('div');vista.appendChild(card);
                        await root.HAIKU_LIBRO_SERVICIOS_SCOPE_V2.abrirRevisionHistorial(card,pendientes.revisionServicios);servicios=true;
                    }
                    if(!preparadas&&!servicios)adjuntarPendientes(contenido,resultado,cacheAviso);
                    else if(pendientes.items.some(x=>!(preparadas&&x.accionable)&&!(servicios&&revisionServiciosPendiente(x,pendientes.generacion)&&
                        lista(x.cambios).length&&lista(x.cambios).every(c=>['notas_importantes','pagos_pendientes','servicios'].includes(c.campo))))){
                        adjuntarPendientes(contenido,resultado,cacheAviso);
                    }
                }catch(error){
                    if(error?.haikuSinCambiosPreparables){contenido.textContent='';adjuntarPendientes(contenido,resultado,cacheAviso);return;}
                    const aviso=doc.createElement('p');aviso.setAttribute('role','alert');aviso.textContent=error?.message||'No pude preparar estos cambios.';contenido.appendChild(aviso);
                    const reintentar=doc.createElement('button');reintentar.type='button';reintentar.textContent='Reintentar';
                    reintentar.addEventListener('click',()=>{void ejecutar();});contenido.appendChild(reintentar);
                }finally{estado.ocupado=false;contenido.removeAttribute('aria-busy');el.scrollIntoView?.({block:'nearest'});}
            };
            void ejecutar();return el;
        };
        const revisionesAbonos = new WeakMap();
        insertarRevisionAbonos = resultado => {
            const anterior = revisionesAbonos.get(resultado);
            if (anterior?.isConnected) { anterior.scrollIntoView?.({block:'nearest'}); return anterior; }
            const el = mensaje('asistente','');
            revisionesAbonos.set(resultado, el);
            const contenido = doc.createElement('div');
            el.appendChild(contenido);
            const revisar = async () => {
                const generacion = generacionInforme(resultado);
                contenido.textContent = 'Comprobando los abonos en Proyecto H…';
                contenido.setAttribute('aria-busy','true');
                try {
                    if (!puedeRevisarAbonos(resultado)) throw new Error('Necesitas una sesión de administrador para revisar estos abonos.');
                    if (generacion !== root.HAIKU_LIBRO_RESERVA_V1?.estado?.().generacion) {
                        contenido.textContent = 'Hay una versión más reciente del Libro. Abre el aviso actual o usa Comparar Libro para comprobar los abonos.';
                        return;
                    }
                    await root.HAIKU_LIBRO_CONSULTAS.compararAbonosAviso(resultado.abonos, generacion, contenido);
                } catch (error) {
                    contenido.textContent = error?.message || 'No pude revisar los abonos.';
                    const boton = doc.createElement('button');
                    boton.type = 'button'; boton.className = 'libro-reserva-boton secundario'; boton.textContent = 'Volver a revisar';
                    boton.addEventListener('click', revisar); contenido.appendChild(boton);
                } finally {
                    contenido.removeAttribute('aria-busy'); el.scrollIntoView?.({block:'nearest'});
                }
            };
            void revisar();
            return el;
        };
        insertarResultado = resultado => {
            const el = mensaje('asistente','');
            el.innerHTML = renderizar(resultado);
            enlazarCabecera(el, resultado);
            root.HAIKU_ASISTENTE_LIBRO_INCORPORACION_V1?.adjuntar(el, resultado, generacionInforme(resultado));
            adjuntarPendientes(el,resultado);
            mensajes.scrollTop = mensajes.scrollHeight;
            return el;
        };
        async function procesar(texto) {
            if (ocupado || root.HAIKU_ASISTENTE?.procesando?.()) return;
            ocupado = true;
            let espera;
            try {
                campo.value = ''; campo.dispatchEvent(new root.Event('input',{bubbles:true}));
                mensaje('usuario',texto);
                espera = mensaje('asistente','Comparando la última actualización del Libro…');
                const resultado = await obtenerResultado();
                espera.innerHTML = renderizar(resultado);
                enlazarCabecera(espera, resultado);
                root.HAIKU_ASISTENTE_LIBRO_INCORPORACION_V1?.adjuntar(espera, resultado, generacionInforme(resultado));
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
    const api = Object.freeze({esConsulta,renderizar,renderizarPendientes,detalleAviso,detalleTitularAmbiguo,detalleAbono,extraerCambiosDetectados,fusionarHistorialCambios,
        crearCache,crearCachePendientes,instalar,obtenerResultado,obtenerResultadoAviso,mostrarResultado,puedeIncorporar,incorporarDesdeAviso,revisarDesdeAviso,
        puedeRevisarAbonos,revisarAbonosDesdeAviso,procesando:()=>ocupado});
    root.HAIKU_ASISTENTE_LIBRO_ACTUALIZACION_V1 = api;
    if (typeof module !== 'undefined') module.exports = api;
    if (root.document && !instalar()) {
        const observer = new root.MutationObserver(()=>{if(instalar()) observer.disconnect();});
        observer.observe(root.document.documentElement,{childList:true,subtree:true});
        root.addEventListener('load',()=>{if(instalar()) observer.disconnect();},{once:true});
    }
})(typeof window !== 'undefined' ? window : globalThis);
