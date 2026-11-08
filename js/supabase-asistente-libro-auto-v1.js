/* ETAPA 3: una versión nueva confirmada, manual o desde Google, inicia el aviso. */
(function(root) {
    'use strict';
    if (root.HAIKU_ASISTENTE_LIBRO_AUTO_V1) return;
    const lista = x => Array.isArray(x) ? x : [];
    const fecha = x => /^\d{4}-\d{2}-\d{2}$/.test(x || '') ? x.split('-').reverse().join('-') : 'Fecha no determinada';
    const normalizar = x => String(x ?? '').normalize('NFC').trim().replace(/\s+/g,' ').toLowerCase();
    const breve = (x,max=100) => { const s=String(x??'').trim().replace(/\s+/g,' '); return s.length>max?s.slice(0,max-1)+'…':s; };
    // El aviso es visible fuera del chat: no copiar contactos, documentos ni montos.
    function notaBreve(x,max=84) {
        return breve(String(x??'').replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi,'[correo]')
            .replace(/(?:\$|\bCLP\s*|\bUSD\s*)\s*\d[\d.,]*/gi,'[monto]')
            .replace(/\b\d{1,2}\.\d{3}\.\d{3}-[\dk]\b|\b\d{7,8}-[\dk]\b/gi,'[documento]')
            .replace(/\+?\d[\d ()-]{6,}\d/g,s=>/^\d{4}-\d{2}-\d{2}$/.test(s)||/^\d{2}-\d{2}-\d{4}$/.test(s)?s:s.replace(/\D/g,'').length>=8?'[dato]':s),max);
    }
    function fechaCorta(x,conAno=false) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(x||'')) return 'Sin fecha';
        const [ano,mes,dia]=x.split('-');
        const meses=['ene.','feb.','mar.','abr.','may.','jun.','jul.','ago.','sep.','oct.','nov.','dic.'];
        return `${Number(dia)} ${meses[Number(mes)-1]||mes}${conAno?' '+ano:''}`;
    }
    function cambioFecha(antes,ahora) {
        const ano=String(antes).slice(0,4)!==String(ahora).slice(0,4);
        if (/^\d{4}-\d{2}-\d{2}$/.test(antes||'') && /^\d{4}-\d{2}-\d{2}$/.test(ahora||'') && antes.slice(0,7)===ahora.slice(0,7)) return `${Number(antes.slice(-2))} → ${fechaCorta(ahora)}`;
        return `${fechaCorta(antes,ano)} → ${fechaCorta(ahora,ano)}`;
    }
    const nombreServicio = s => ({tonel:'Tonel',jacuzzi:'Jacuzzi',tinaja:'Tinaja',masaje:'Masaje',cuna:'Cuna',cama_adicional:'Cama adicional',lateout:'Salida tardía',desayuno:'Desayuno'})[normalizar(s?.concepto)] || 'Servicio';
    const horaServicio = s => /^\d{1,2}:\d{2}$/.test(s?.hora||'')?s.hora:'Sin hora';
    const servicioBreve = s => `${nombreServicio(s)} · ${horaServicio(s)}`;
    function detalleServicios(c) {
        const clave=s=>JSON.stringify([normalizar(s?.concepto),s?.hora??null,s?.pendiente??null,s?.cortesia??null,s?.monto??null]);
        const anteriores=lista(c.antes),actuales=lista(c.ahora);
        const restantes=(origen,comparar)=>{const claves=comparar.map(clave);return origen.filter(s=>{const i=claves.indexOf(clave(s));if(i<0)return true;claves.splice(i,1);return false;});};
        const antes=restantes(anteriores,actuales),ahora=restantes(actuales,anteriores);
        if (antes.length===1 && ahora.length===1) {
            const a=antes[0],b=ahora[0],na=nombreServicio(a),nb=nombreServicio(b),ha=horaServicio(a),hb=horaServicio(b);
            if (na!==nb || ha!==hb) return {etiqueta:['Tonel','Jacuzzi','Tinaja'].includes(na)&&['Tonel','Jacuzzi','Tinaja'].includes(nb)?'Tinaja':'Servicio',texto:na===nb?`${na} · ${ha} → ${hb}`:ha===hb?`${na} → ${nb} · ${hb}`:`${servicioBreve(a)} → ${servicioBreve(b)}`};
            if(normalizar(a.concepto)!==normalizar(b.concepto))return {etiqueta:'Servicio',texto:'Cambió el tipo de servicio.'};
            return {etiqueta:'Servicio',texto:`${nb}: cambió la condición de cobro.`};
        }
        const partes=[];
        if (ahora.length) partes.push(`Agregado: ${ahora.slice(0,2).map(servicioBreve).join('; ')}${ahora.length>2?` (+${ahora.length-2})`:''}`);
        if (antes.length) partes.push(`Retirado: ${antes.slice(0,2).map(servicioBreve).join('; ')}${antes.length>2?` (+${antes.length-2})`:''}`);
        return {etiqueta:'Servicios',texto:partes.join(' · ')||'Cambió la información del servicio.'};
    }
    function detalleCambio(c) {
        const numeros={cabana:'Cabaña',noches:'Noches',adultos:'Adultos',ninos:'Niños',mascotas:'Mascotas'};
        if (c.campo==='fecha_checkin'||c.campo==='fecha_checkout') return {etiqueta:'Fecha',texto:`${c.campo==='fecha_checkin'?'Entrada':'Salida'}: ${cambioFecha(c.antes,c.ahora)}`};
        if (numeros[c.campo]) {const numero=v=>/^\d+$/.test(String(v))?String(v):'Sin dato';return {etiqueta:numeros[c.campo],texto:`${numero(c.antes)} → ${numero(c.ahora)}`};}
        if (c.campo==='notas_importantes') {
            const antes=lista(c.antes).filter(n=>!lista(c.ahora).some(a=>normalizar(a)===normalizar(n))),ahora=lista(c.ahora).filter(n=>!lista(c.antes).some(a=>normalizar(a)===normalizar(n)));
            const notas=(xs,accion)=>xs.length?`${accion} «${notaBreve(xs[0])}»${xs.length>1?` (+${xs.length-1})`:''}`:'';
            return {etiqueta:'Nota',texto:[notas(antes,'Se retiró'),notas(ahora,'Se agregó')].filter(Boolean).join(' · ')||'Se modificó una nota.'};
        }
        if (c.campo==='servicios') return detalleServicios(c);
        const estados={pendiente_por_color:'Pendiente',confirmada_por_color:'Confirmada',sin_checkin:'Sin ingreso',hospedada:'Hospedada',checked_out:'Salida registrada',cancelada:'Cancelada',full_day:'Full Day',alojamiento:'Alojamiento'};
        if (['estado_confirmacion','estado_operativo','tipo_estadia'].includes(c.campo)) return {etiqueta:c.campo==='tipo_estadia'?'Estadía':'Estado',texto:`${estados[c.antes]||'Sin definir'} → ${estados[c.ahora]||'Sin definir'}`};
        const otros={titular:['Titular','Cambió el nombre del titular.'],operador:['Operador','Cambió el responsable de la reserva.'],rut_documento:['Documento','Cambió el RUT o documento.'],correo:['Contacto','Cambió el correo.'],telefono:['Contacto','Cambió el teléfono.'],pagos_pendientes:['Pagos','Cambió la información de pagos pendientes.']};
        const [etiqueta,texto]=otros[c.campo]||['Reserva','Cambió un dato de la reserva.'];return {etiqueta,texto};
    }
    function describirBurbuja(r) {
        const casos=[],porOrigen=new Map();
        const agregar=(origen,titulo,reserva,detalles)=>{
            const caso={titulo,reserva:`${breve(reserva?.titular||'Nombre no indicado',60)} · CAB ${reserva?.cabana??'—'}`,detalles};
            casos.push(caso);porOrigen.set(origen,caso);
        };
        for(const x of lista(r.nuevas)) agregar(x,'Se agregó una reserva',x.actual,[{etiqueta:'Estadía',texto:`${fechaCorta(x.actual?.fecha_checkin,true)} → ${fechaCorta(x.actual?.fecha_checkout,true)}`}]);
        for(const x of lista(r.modificadas)) {
            const cambios=lista(x.cambios),detalles=cambios.slice(0,3).map(detalleCambio);
            if(cambios.length>3)detalles.push({etiqueta:'Además',texto:`${cambios.length-3} ${cambios.length===4?'cambio':'cambios'} más en el informe.`});
            agregar(x,'Cambió una reserva',x.actual,detalles.length?detalles:[{etiqueta:'Reserva',texto:'Cambió la información de la reserva.'}]);
        }
        for(const x of lista(r.cancelaciones_confirmadas)) agregar(x,'Cancelada en el Libro',x.anterior,[{etiqueta:'Estado',texto:'Figura en CANCELACIONES. Falta confirmarla en Proyecto H.'}]);
        for(const x of lista(r.ya_no_aparecen)) agregar(x,'Una reserva ya no aparece',x.anterior,[{etiqueta:'Libro',texto:'No aparece en la versión actual.'}]);
        const avisos=[];
        if(['parcial','no_comparable'].includes(r.estado))avisos.push('No pude revisar todo el Libro.');
        const ambiguas=lista(r.ambiguas).length,advertencias=lista(r.advertencias).length;
        if(ambiguas)avisos.push(`${ambiguas} ${ambiguas===1?'caso por':'casos por'} aclarar.`);
        if(advertencias)avisos.push(`${advertencias} ${advertencias===1?'dato por':'datos por'} revisar.`);
        const formatearAviso=root.HAIKU_ASISTENTE_LIBRO_ACTUALIZACION_V1?.detalleAviso;
        const grupos=root.HAIKU_ASISTENTE_LIBRO_PRIORIDAD_V1?.clasificar?.(r,{incluirOrigen:true,formatearAviso})?.grupos;
        const describirCaso=x=>{
            const conocido=porOrigen.get(x.origen);
            if(conocido)return x.tipo==='modificada'&&lista(x.origen.cambios).length
                ? {...conocido,detalles:x.origen.cambios.map(detalleCambio)}:conocido;
            const reservas=[...new Set(lista(x.segmentos).filter(s=>s.titular||s.cabana!=null)
                .map(s=>`${breve(s.titular||'Nombre no indicado',60)} · CAB ${s.cabana??'—'}`))];
            const motivo=x.detalleAviso||(formatearAviso&&x.origen?.motivo?formatearAviso(x.origen.motivo):'No pude identificar con certeza a qué reserva corresponde.');
            return {titulo:x.tipo==='ambigua'?'Reserva por aclarar':x.tipo==='cobertura'?'Lectura incompleta':'Dato por revisar',
                reserva:[x.versionAviso,...reservas].filter(Boolean).join(' · '),
                detalles:[{etiqueta:'Motivo',texto:notaBreve(motivo,600)}]};
        };
        const prioridades=grupos?[['hoy','Hoy'],['manana','Mañana'],['proximos','Próximos'],['informativos','Info']]
            .map(([clave,nombre])=>({clave,nombre,total:lista(grupos[clave]).length,casos:lista(grupos[clave]).map(describirCaso)})):[];
        return {titulo:casos.length>1?`${casos.length} cambios en el Libro`:casos.length?'':avisos.length?'Actualización por revisar':'Sin cambios entre copias',casos:casos.slice(0,3),restantes:Math.max(0,casos.length-3),avisos,prioridades,
            detalle:!casos.length&&!avisos.length?'Esto no compara con Proyecto H.':''};
    }
    function resumir(r) {
        const n=lista(r.nuevas).length,m=lista(r.modificadas).length,b=lista(r.ya_no_aparecen).length,a=lista(r.ambiguas).length;
        const c=lista(r.cancelaciones_confirmadas).length;
        const total=n+m+b+c, avisos=lista(r.advertencias).length;
        let texto, revision=a>0 || avisos>0;
        if (['parcial','no_comparable'].includes(r.estado)) {
            texto='Comparé la actualización, pero una parte requiere revisión.'; revision=true;
        } else if (!['ok','sin_cambios'].includes(r.estado)) {
            return {texto:'No pude completar el informe de esta actualización. Puedes solicitarlo en Haku.',revision:true};
        } else if (!total && a) texto=`La actualización contiene ${a} ${a===1?'caso que requiere':'casos que requieren'} revisión.`;
        else if (!total) texto='Las reservas no cambiaron respecto de la copia anterior del Libro. Esto no comprueba si quedan diferencias con Proyecto H; usa Comparar Libro para revisarlas.';
        else if (total===1 && c===1) texto=`${r.cancelaciones_confirmadas[0].anterior?.titular || 'Una reserva'} aparece en CANCELACIONES del Libro.`;
        else if (total===1 && n===1) {
            const x=r.nuevas[0].actual || {};
            texto=`Se agregó una reserva al Libro: ${x.titular || 'Nombre no indicado'} · CAB ${x.cabana ?? '—'} · Entrada: ${fecha(x.fecha_checkin)} · Salida: ${fecha(x.fecha_checkout)}.`;
        } else if (total===1 && m===1) {
            const x=r.modificadas[0], campos={cabana:'Cabaña',fecha_checkin:'Entrada',fecha_checkout:'Salida',noches:'Noches',adultos:'Adultos',ninos:'Niños',mascotas:'Mascotas'};
            const cambios=lista(x.cambios).filter(c=>Object.hasOwn(campos,c.campo)).slice(0,2).map(c=>{
                const mostrar=v=>c.campo.startsWith('fecha_') ? fecha(v) : typeof v==='number' ? v : /^\d+$/.test(String(v)) ? v : 'Sin dato';
                return `${campos[c.campo]}: antes ${mostrar(c.antes)}, ahora ${mostrar(c.ahora)}`;
            });
            texto=`Cambió una reserva en el Libro: ${x.actual?.titular || 'Nombre no indicado'} · CAB ${x.actual?.cabana ?? '—'}. ${cambios.length?cambios.join(' · '):'Abre el informe para ver qué datos cambiaron.'}`;
        } else texto=`Encontré ${total} ${total===1?'cambio':'cambios'} en el Libro: ${n} reservas agregadas · ${m} con cambios · ${b} ${b===1?'ya no aparece':'ya no aparecen'}.`;
        if (total && a) texto+=` ${a} ${a===1?'caso requiere':'casos requieren'} revisión.`;
        if (c) texto+=` ${c} cancelación${c===1?'':'es'} confirmada${c===1?'':'s'} en el Libro; pendiente${c===1?'':'s'} de revisión y confirmación en Proyecto H.`;
        if (avisos) texto+=` Además, hay ${avisos} ${avisos===1?'aviso sobre datos que necesitan':'avisos sobre datos que necesitan'} revisión.`;
        if (root.HAIKU_ASISTENTE_LIBRO_PRIORIDAD_V1) texto+=' '+root.HAIKU_ASISTENTE_LIBRO_PRIORIDAD_V1.resumen(r);
        return {texto,revision,burbuja:describirBurbuja(r)};
    }
    function crearControlador({generacion,obtener,mostrar,limpiar}) {
        let ultima=-1, token=0;
        return {
            invalidar(){token++;limpiar();},
            async cargar(detail) {
                const cargaAdmitida = detail?.carga_manual || detail?.carga_automatica;
                if (!cargaAdmitida || !detail.tenia_anterior || !Number.isInteger(detail.generacion) || detail.generacion!==generacion() || detail.generacion<=ultima) return;
                ultima=detail.generacion;
                const turno=++token,g=detail.generacion;
                const vigente=()=>turno===token && generacion()===g;
                limpiar();mostrar({texto:'Revisando la actualización…',pendiente:true});
                try {
                    const resultado=await obtener();
                    if (!vigente()) return;
                    if (resultado.estado==='sin_linea_base') {limpiar();return;}
                    mostrar({...resumir(resultado),resultado});
                } catch (_) {
                    if (vigente()) mostrar({texto:'No pude completar el informe de esta actualización. Puedes solicitarlo en Haku.',revision:true});
                }
            }
        };
    }
    function instalar() {
        let toast, estadoConsulta, acciones=[],avisoProtegido=false,avisoDiferido,numeroAviso=0;
        const consultando = () => root.HAIKU_ASISTENTE?.procesando?.() === true || root.HAIKU_LIBRO_CONSULTAS?.procesando?.() === true || root.HAIKU_ASISTENTE_LIBRO_ACTUALIZACION_V1?.procesando?.() === true;
        const consultaVisible = () => consultando() || Boolean(root.document.querySelector?.('#haiku-asistente-mensajes [data-haiku-libro-respuesta="1"], #haiku-asistente-mensajes .haiku-asistente-preview, #haiku-asistente-mensajes .haku-guia-operativa')) || Boolean(root.document.getElementById('haiku-asistente-texto')?.value?.trim());
        root.document.getElementById('haiku-asistente-texto')?.addEventListener('input',()=>{
            for (const boton of acciones) if (!boton.informeAnterior&&!boton.incorporacionBloqueada) boton.disabled=consultando();
            if (estadoConsulta && !consultando()) estadoConsulta.textContent='Tu consulta y revisión se conservan.';
        });
        function posicionarAviso() {
            if(!toast?.style)return;
            const panel=root.document.getElementById('haiku-asistente-panel') || root.document.querySelector?.('.haiku-asistente-panel');
            const caja=panel?.hidden===false ? panel.getBoundingClientRect?.() : null;
            const ancho=root.innerWidth || root.document.documentElement?.clientWidth || 0;
            const alto=root.innerHeight || root.document.documentElement?.clientHeight || 0;
            toast.style.removeProperty('right');toast.style.removeProperty('left');
            toast.style.removeProperty('bottom');toast.style.removeProperty('max-height');
            if(caja && caja.width>0 && ancho>0) {
                const margen=12, anchoAviso=Math.min(340,ancho-2*margen);
                if(caja.left>=anchoAviso+2*margen) {
                    toast.style.right=`${ancho-caja.left+margen}px`;
                    toast.style.bottom=`${Math.max(margen,alto-caja.bottom)}px`;
                    toast.dataset.juntoHaku='1';
                } else {
                    // Pantallas estrechas: aviso compacto sobre el panel, siempre
                    // cerrable y sin cambiar el tamaño ni el scroll de la consulta.
                    toast.style.right=`${margen}px`;toast.style.bottom=`${Math.max(margen,alto-caja.bottom)}px`;
                    toast.style.maxHeight=`${Math.max(120,Math.min(alto*.38,caja.height-24))}px`;
                    toast.dataset.juntoHaku='compacto';
                }
            } else delete toast.dataset.juntoHaku;
        }
        root.addEventListener('haiku:panel-estado',posicionarAviso);
        root.addEventListener('resize',posicionarAviso);
        function limpiar() {
            if(avisoProtegido)return;
            toast?.remove();toast=null;estadoConsulta=null;
            for (const boton of acciones) {boton.informeAnterior=true;boton.disabled=true;boton.textContent='Informe de una versión anterior';}
            acciones=[];
        }
        function cerrarAviso(){
            avisoProtegido=false;toast?.remove();toast=null;
            if(avisoDiferido){const siguiente=avisoDiferido;avisoDiferido=null;mostrar(siguiente);}
        }
        function mostrar(aviso) {
            if(avisoProtegido){avisoDiferido=aviso;return;}
            const {texto,revision=false,pendiente=false,resultado,burbuja}=aviso;
            const doc=root.document;
            if (!doc.getElementById('haku-libro-auto-estilo')) {
                const estilo=doc.createElement('style');estilo.id='haku-libro-auto-estilo';
                estilo.textContent='.haku-libro-auto{position:fixed;right:18px;bottom:88px;width:min(340px,calc(100vw - 36px));box-sizing:border-box;z-index:10000;background:#f7faf8;color:#26342c;border:1px solid #cadfd1;border-radius:16px;padding:14px;box-shadow:0 6px 22px #183e2426;font:13px/1.5 system-ui;overflow-wrap:anywhere;max-height:45vh;overflow:auto}.haku-libro-auto--revision{background:#fffaf1;border-color:#ead8bc}.haku-libro-auto p{margin:7px 0}.haku-libro-auto button{cursor:pointer;background:white;color:#245438;border:1px solid #cadfd1;border-radius:8px;padding:6px 10px;margin:5px 6px 0 0}.haku-libro-auto button:disabled{cursor:default;opacity:.6}';
                doc.head.appendChild(estilo);
            }
            toast?.remove();toast=doc.createElement('aside');toast.className='haku-libro-auto'+(revision?' haku-libro-auto--revision':'');toast.setAttribute('role','status');toast.setAttribute('aria-live','polite');
            const nodo=(padre,tag,clase,contenido)=>{const el=doc.createElement(tag);el.className=clase;if(contenido)el.textContent=contenido;padre.appendChild(el);return el;};
            nodo(toast,'strong','haku-libro-auto__marca','Haku');
            if (burbuja) {
                const resumen=nodo(toast,'div','haku-libro-auto__resumen');
                const mostrarCaso=(padre,caso)=>{
                    const bloque=nodo(padre,'section','haku-libro-auto__caso');
                    nodo(bloque,'strong','haku-libro-auto__titulo',caso.titulo);
                    if(caso.reserva)nodo(bloque,'p','haku-libro-auto__reserva',caso.reserva);
                    const detalles=nodo(bloque,'dl','haku-libro-auto__detalles');
                    for(const d of caso.detalles){nodo(detalles,'dt','',d.etiqueta);nodo(detalles,'dd','',d.texto);}
                };
                if(burbuja.titulo)nodo(resumen,'strong','haku-libro-auto__titulo',burbuja.titulo);
                for(const caso of burbuja.casos)mostrarCaso(resumen,caso);
                if(burbuja.restantes)nodo(resumen,'p','haku-libro-auto__aviso',`${burbuja.restantes} ${burbuja.restantes===1?'cambio':'cambios'} más en el informe.`);
                if(burbuja.detalle)nodo(resumen,'p','haku-libro-auto__aviso',burbuja.detalle);
                if(burbuja.avisos.length)nodo(resumen,'p','haku-libro-auto__aviso',burbuja.avisos.join(' '));
                if(burbuja.prioridades.length){
                    const franja=nodo(toast,'div','haku-libro-auto__prioridades');franja.setAttribute('role','group');franja.setAttribute('aria-label','Cambios y avisos por fecha');
                    const contenido=nodo(toast,'div','haku-libro-auto__filtrado');
                    contenido.id='haku-aviso-categoria-'+(++numeroAviso);contenido.hidden=true;contenido.setAttribute('role','region');
                    let seleccion=null;
                    for(const p of burbuja.prioridades){
                        const item=nodo(franja,'button','haku-libro-auto__prioridad');item.type='button';
                        item.setAttribute('title',p.clave==='proximos'?'Próximos 2 a 7 días':p.clave==='informativos'?'Informativos, incluidos casos sin fecha':p.nombre);
                        item.setAttribute('aria-controls',contenido.id);item.setAttribute('aria-expanded','false');
                        nodo(item,'span','',p.nombre);nodo(item,'strong','',String(p.total));
                        item.addEventListener('click',()=>{
                            seleccion=seleccion===p.clave?null:p.clave;
                            for(const boton of franja.children)boton.setAttribute('aria-expanded',String(seleccion!==null&&boton===item));
                            contenido.replaceChildren();contenido.hidden=seleccion===null;resumen.hidden=seleccion!==null;
                            if(seleccion!==null){
                                contenido.setAttribute('aria-label',p.nombre+' · '+p.total);
                                for(const caso of p.casos)mostrarCaso(contenido,caso);
                                if(!p.total)nodo(contenido,'p','haku-libro-auto__aviso','No hay cambios ni avisos en esta categoría.');
                            }
                            // Sólo cambia la vista de este aviso; no relee el Libro ni toca la consulta.
                            toast.scrollTop=0;
                        });
                    }
                }
            } else nodo(toast,'p','haku-libro-auto__aviso',texto);
            const conservarConsulta=consultaVisible();
            if (conservarConsulta) {
                const aviso=doc.createElement('p');estadoConsulta=aviso;aviso.className='haku-libro-auto__aviso';
                aviso.textContent=consultando()?'Tu consulta sigue en proceso.':'Tu consulta y revisión se conservan.';
                toast.appendChild(aviso);
            }
            let insertado=false,mensajeInforme=null;
            function botonInforme(contenedor) {
                const boton=doc.createElement('button');boton.type='button';
                boton.textContent=typeof root.HAIKU_ASISTENTE?.abrir==='function'?'Ver informe':'Abre Haku para ver el informe';
                boton.disabled=consultando();
                boton.addEventListener('click',()=>{
                    if (boton.disabled || consultando()) return;
                    if (!insertado) {root.HAIKU_ASISTENTE_LIBRO_ACTUALIZACION_V1.mostrarResultado(resultado);insertado=true;}
                    root.HAIKU_ASISTENTE?.abrir?.();
                    mensajeInforme?.remove();mensajeInforme=null;
                    cerrarAviso();
                });
                contenedor.appendChild(boton);acciones.push(boton);
            }
            let guardando=false,finalizado=false,estadoGuardado;
            const botonesIncorporar=[];
            const resumenGuardado=fin=>[
                ['reservas_creadas','reserva','reservas'],['estadias_agregadas','estadía','estadías'],
                ['actualizaciones','actualización','actualizaciones'],['servicios_creados','servicio','servicios'],['notas_creadas','nota','notas']
            ].filter(([k])=>fin?.[k]>0).map(([k,uno,varios])=>`${fin[k]} ${fin[k]===1?uno:varios}`).join(' · ');
            function botonIncorporar(contenedor){
                const api=root.HAIKU_ASISTENTE_LIBRO_ACTUALIZACION_V1;
                if(!api?.puedeIncorporar?.(resultado))return;
                const boton=doc.createElement('button');boton.type='button';boton.textContent='Incorporar';
                boton.className='haku-libro-auto__incorporar';boton.title='Guardar los cambios completos de este aviso en Proyecto H';boton.disabled=consultando();
                botonesIncorporar.push(boton);
                boton.addEventListener('click',async()=>{
                    if(boton.disabled||consultando()||guardando||finalizado)return;
                    guardando=true;avisoProtegido=true;
                    if(!estadoGuardado){estadoGuardado=nodo(toast,'div','haku-libro-auto__resultado');estadoGuardado.setAttribute('role','status');}
                    estadoGuardado.textContent='Guardando estos cambios en Proyecto H…';
                    for(const b of acciones){b.disabled=true;b.incorporacionBloqueada=true;}
                    cerrar.disabled=true;
                    for(const b of botonesIncorporar){b.textContent='Incorporando…';b.setAttribute('aria-busy','true');}
                    try{
                        const fin=await api.incorporarDesdeAviso(resultado),resumen=resumenGuardado(fin);
                        const pendientes=fin?.pendientes||[];finalizado=true;
                        estadoGuardado.textContent=resumen?`Incorporado: ${resumen}.`:pendientes.length?'No hay cambios completos para incorporar.':'Estos cambios ya están guardados.';
                        if(pendientes.length){
                            const detalle=nodo(estadoGuardado,'details','haku-libro-auto__pendientes');
                            nodo(detalle,'summary','',`${pendientes.length} ${pendientes.length===1?'caso pendiente':'casos pendientes'}`);
                            for(const p of pendientes)nodo(detalle,'p','',`${p.reserva}: ${p.motivos?.[0]||'Falta resolver la asociación de esta reserva.'}`);
                            const revisar=nodo(estadoGuardado,'button','','Completar pendientes');revisar.type='button';
                            revisar.addEventListener('click',()=>{api.revisarDesdeAviso(resultado);root.HAIKU_ASISTENTE?.abrir?.();cerrarAviso();});
                        }
                        for(const b of botonesIncorporar)b.textContent=resumen?'Incorporado':pendientes.length?'Pendiente':'Ya incorporado';
                    }catch(error){
                        const confirmado=resumenGuardado(error?.incorporado);
                        estadoGuardado.textContent=(confirmado?`Incorporado: ${confirmado}. `:'')+
                            (error?.message||'No pude confirmar el guardado. Reintenta para comprobarlo sin duplicar.');
                        for(const b of botonesIncorporar)b.textContent='Reintentar';
                    }finally{
                        guardando=false;cerrar.disabled=false;
                        for(const b of acciones){b.incorporacionBloqueada=finalizado&&botonesIncorporar.includes(b);b.disabled=b.incorporacionBloqueada||consultando();}
                        for(const b of botonesIncorporar)b.removeAttribute('aria-busy');
                        if(avisoDiferido)nodo(estadoGuardado,'p','haku-libro-auto__aviso','Hay otro aviso disponible al cerrar este.');
                    }
                });
                contenedor.appendChild(boton);acciones.push(boton);
            }
            const pie=nodo(toast,'div','haku-libro-auto__acciones');
            if(resultado)botonIncorporar(pie);
            if (resultado) botonInforme(pie);
            const cerrar=doc.createElement('button');cerrar.type='button';cerrar.textContent=conservarConsulta?'Seguir con mi consulta':'Cerrar';cerrar.addEventListener('click',()=>{if(!guardando)cerrarAviso();});pie.appendChild(cerrar);
            doc.body.appendChild(toast);
            posicionarAviso();
            // Un aviso de fondo no inserta respuestas ni desplaza una consulta abierta.
            if (!pendiente && !conservarConsulta) {
                const mensajes=doc.getElementById('haiku-asistente-mensajes');
                if (mensajes) {
                    const mensaje=doc.createElement('div');mensaje.className='haiku-asistente-mensaje haiku-asistente-mensaje--asistente';mensaje.textContent=texto;
                    if (resultado) botonInforme(mensaje);
                    mensajes.appendChild(mensaje);
                    if (resultado) mensajeInforme=mensaje;
                }
            }
        }
        const control=crearControlador({generacion:()=>root.HAIKU_LIBRO_RESERVA_V1?.estado().generacion,
            obtener:()=>root.HAIKU_ASISTENTE_LIBRO_ACTUALIZACION_V1.obtenerResultado(),mostrar,limpiar});
        root.addEventListener('haiku:libro-version-cargada',e=>{void control.cargar(e.detail);});
        // Sólo invalida; nunca inicia comparación desde limpieza, restauración ni F5.
        root.addEventListener('haiku:libro-cambio',()=>control.invalidar());
    }
    root.HAIKU_ASISTENTE_LIBRO_AUTO_V1=Object.freeze({resumir,crearControlador});
    if (typeof module!=='undefined') module.exports=root.HAIKU_ASISTENTE_LIBRO_AUTO_V1;
    if (root.document) instalar();
})(typeof window!=='undefined'?window:globalThis);

