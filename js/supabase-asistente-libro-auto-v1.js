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
        const detalleAbono = root.HAIKU_ASISTENTE_LIBRO_ACTUALIZACION_V1?.detalleAbono;
        const pendienteAnterior=x=>x.detectado_generacion!=null&&x.detectado_generacion!==r.libro_actual?.generacion;
        const agregar=(origen,titulo,reserva,detalles)=>{
            const caso={titulo,reserva:`${breve(reserva?.titular||'Nombre no indicado',60)} · CAB ${reserva?.cabana??'—'}`,
                detalles,fechaIngreso:reserva?.fecha_checkin,detectadoEn:origen.detectado_en||r.generado_en};
            casos.push(caso);porOrigen.set(origen,caso);
        };
        for(const x of lista(r.nuevas)) {
            const abonos = lista(r.abonos).filter(a => a.nueva && a.nueva === x.actual?.id);
            const detalles = [{etiqueta:'Estadía',texto:`${fechaCorta(x.actual?.fecha_checkin,true)} → ${fechaCorta(x.actual?.fecha_checkout,true)}`}];
            const asociados = abonos.filter(a => ['reserva_nueva','asociado'].includes(a.estado)).length;
            const titulo = asociados ? `Reserva nueva · ${asociados} ${asociados === 1 ? 'abono asociado' : 'abonos asociados'}` :
                pendienteAnterior(x)?'Reserva pendiente de incorporar':'Se agregó una reserva';
            for (const a of abonos.slice(0,2)) {
                const d = detalleAbono?.(a);
                if (d) detalles.push({etiqueta:d.titulo,texto:d.monto});
            }
            if (abonos.length > 2) detalles.push({etiqueta:'Abonos',texto:`${abonos.length - 2} más en el informe.`});
            agregar(x,titulo,x.actual,detalles);
        }
        for(const x of lista(r.modificadas)) {
            const cambios=lista(x.cambios),detalles=cambios.slice(0,3).map(detalleCambio);
            if(cambios.length>3)detalles.push({etiqueta:'Además',texto:`${cambios.length-3} ${cambios.length===4?'cambio':'cambios'} más en el informe.`});
            agregar(x,pendienteAnterior(x)?'Cambio pendiente':'Cambió una reserva',x.actual,
                detalles.length?detalles:[{etiqueta:'Reserva',texto:'Cambió la información de la reserva.'}]);
        }
        for (const abono of lista(r.abonos).filter(a => !a.nueva)) {
            const detalle = detalleAbono?.(abono);
            if (!detalle) continue;
            const caso = {...detalle,detectadoEn:r.generado_en};
            casos.push(caso); porOrigen.set(abono,caso);
        }
        for(const x of lista(r.cancelaciones_confirmadas)) agregar(x,'Cancelada en el Libro',x.anterior,[{etiqueta:'Estado',texto:'Figura en CANCELACIONES. Falta confirmarla en Proyecto H.'}]);
        for(const x of lista(r.ya_no_aparecen)) agregar(x,'Una reserva ya no aparece',x.anterior,[{etiqueta:'Libro',texto:'No aparece en la versión actual.'}]);
        const avisos=[];
        if(r.pendientesSinVerificar)avisos.push('Conservé los pendientes. Falta comprobarlos en Proyecto H.');
        if(['parcial','no_comparable'].includes(r.estado))avisos.push('No pude revisar todo el Libro.');
        const ambiguas=lista(r.ambiguas).length,advertencias=lista(r.advertencias).length;
        if(ambiguas)avisos.push(`${ambiguas} ${ambiguas===1?'caso por':'casos por'} aclarar.`);
        if(advertencias)avisos.push(`${advertencias} ${advertencias===1?'dato por':'datos por'} revisar.`);
        const {detalleAviso:formatearAviso,detalleTitularAmbiguo}=root.HAIKU_ASISTENTE_LIBRO_ACTUALIZACION_V1||{};
        const grupos=root.HAIKU_ASISTENTE_LIBRO_PRIORIDAD_V1?.clasificar?.(r,{incluirOrigen:true,formatearAviso})?.grupos;
        const describirCaso=x=>{
            const conocido=porOrigen.get(x.origen);
            if(conocido)return x.tipo==='modificada'&&lista(x.origen.cambios).length
                ? {...conocido,detalles:x.origen.cambios.map(detalleCambio)}:conocido;
            const titular=detalleTitularAmbiguo?.(x.origen);
            if(titular)return titular;
            const reservas=[...new Set(lista(x.segmentos).filter(s=>s.titular||s.cabana!=null)
                .map(s=>`${breve(s.titular||'Nombre no indicado',60)} · CAB ${s.cabana??'—'}`))];
            const motivo=x.detalleAviso||(formatearAviso&&x.origen?.motivo?formatearAviso(x.origen.motivo):'No pude identificar con certeza a qué reserva corresponde.');
            return {titulo:x.tipo==='ambigua'?'Reserva por aclarar':x.tipo==='cobertura'?'Lectura incompleta':'Dato por revisar',
                reserva:[x.versionAviso,...reservas].filter(Boolean).join(' · '),
                detalles:[{etiqueta:'Motivo',texto:notaBreve(motivo,600)}]};
        };
        const prioridades=grupos?[['hoy','Hoy'],['manana','Mañana'],['proximos','Próximos'],['informativos','Info']]
            .map(([clave,nombre])=>({clave,nombre,total:lista(grupos[clave]).length,casos:lista(grupos[clave]).map(describirCaso)})):[];
        const advertenciasClasificadas=new Map(Object.values(grupos||{}).flat().filter(x=>x.tipo==='advertencia').map(x=>[x.origen,x]));
        const datosPorRevisar=lista(r.advertencias).map(origen=>describirCaso(advertenciasClasificadas.get(origen)||{
            tipo:'advertencia',origen,detalleAviso:formatearAviso?.(origen),
            versionAviso:origen?.version==='anterior'?'Versión anterior':origen?.version==='actual'?'Versión actual':null
        }));
        const sinCambios=r.pendientesResueltos?'Sin cambios pendientes':'Sin cambios entre copias';
        return {titulo:casos.length>1?`${casos.length} cambios en el Libro`:casos.length?'':avisos.length?'Actualización por revisar':sinCambios,
            casos:casos.slice(0,3),restantes:Math.max(0,casos.length-3),avisos,prioridades,datosPorRevisar,
            detalle:!casos.length&&!avisos.length&&!r.pendientesResueltos?'Esto no compara con Proyecto H.':''};
    }
    function resumir(r) {
        const n=lista(r.nuevas).length,m=lista(r.modificadas).length,b=lista(r.ya_no_aparecen).length,a=lista(r.ambiguas).length;
        const c=lista(r.cancelaciones_confirmadas).length;
        const abonos=lista(r.abonos).filter(a=>!a.nueva).length;
        const total=n+m+b+c+abonos, avisos=lista(r.advertencias).length;
        let texto, revision=a>0 || avisos>0 || r.pendientesSinVerificar===true;
        if (lista(r.abonos).some(x => !x.estado)) revision=true;
        if (['parcial','no_comparable'].includes(r.estado)) {
            texto='Comparé la actualización, pero una parte requiere revisión.'; revision=true;
        } else if (!['ok','sin_cambios'].includes(r.estado)) {
            return {texto:'No pude completar el informe de esta actualización. Puedes solicitarlo en Haku.',revision:true};
        } else if (!total && a) texto=`La actualización contiene ${a} ${a===1?'caso que requiere':'casos que requieren'} revisión.`;
        else if (!total) texto=r.pendientesResueltos?'No quedan cambios por incorporar de este aviso.':
            'Las reservas no cambiaron respecto de la copia anterior del Libro. Esto no comprueba si quedan diferencias con Proyecto H; usa Comparar Libro para revisarlas.';
        else if (total===abonos) texto=`Detecté ${abonos} ${abonos===1?'abono':'abonos'} en la actualización del Libro.`;
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
        } else texto=`Encontré ${total} ${total===1?'cambio':'cambios'} en el Libro: ${n} reservas agregadas · ${m} con cambios · ${b} ${b===1?'ya no aparece':'ya no aparecen'}${abonos ? ` · ${abonos} ${abonos===1?'abono':'abonos'}` : ''}.`;
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
    function horaAviso(valor,etiqueta='Detectado por Haku') {
        // Formatea el instante aportado, sin sustituir una fecha ausente por la hora actual.
        if(typeof valor!=='string' || !Number.isFinite(Date.parse(valor)))return null;
        const instante=new Date(valor),ahora=new Date(),timeZone='America/Santiago';
        const partes=fecha=>Object.fromEntries(new Intl.DateTimeFormat('es-CL',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
            .formatToParts(fecha).map(p=>[p.type,p.value]));
        const d=partes(instante),hoy=partes(ahora),hora=`${d.hour}:${d.minute}`;
        const mismoDia=['year','month','day'].every(k=>d[k]===hoy[k]);
        const fecha=`${d.day}/${d.month}${d.year===hoy.year?'':'/'+d.year}`;
        return {iso:instante.toISOString(),texto:mismoDia?hora:`${fecha} · ${hora}`,
            descripcion:`${etiqueta} el ${d.day}/${d.month}/${d.year} a las ${hora} (hora de Chile)`};
    }
    const frasesPendientes=motivos=>lista(motivos).flatMap(x=>String(x??'').split(' · ')).map(x=>x.trim()).filter(Boolean);
    const camposServicio=[
        ['Fecha del servicio','la fecha','Falta la fecha',/^Falta (?:una fecha inequívoca del servicio|la fecha del (?:masaje|servicio)|indicar el día)\b/],
        ['Horario','la hora','Falta el horario',/^Falta (?:horario del masaje|un horario inequívoco del servicio|indicar la hora)\b/],
        ['Duración','la duración','Falta la duración',/^Falta (?:la )?duración del masaje\b/]
    ];
    function razonesPendiente(motivos,servicio) {
        const frases=frasesPendientes(motivos), datos=new Set(), otros=new Set();
        for(const frase of frases){
            const campo=servicio&&camposServicio.find(x=>x[3].test(frase));
            if(campo)datos.add(campo);
            else if(frase!=='Falta fecha u hora para comprobar el servicio existente sin adivinar.'||!servicio)
                otros.add(notaBreve(frase,220));
        }
        const faltaFechaOHora=frases.includes('Falta fecha u hora para comprobar el servicio existente sin adivinar.');
        if(servicio&&faltaFechaOHora&&!datos.has(camposServicio[0])&&!datos.has(camposServicio[1])){
            if(servicio.fecha&&!servicio.hora)datos.add(camposServicio[1]);
            else if(servicio.hora&&!servicio.fecha)datos.add(camposServicio[0]);
            else otros.add('Confirma la fecha y el horario del servicio.');
        }
        return {datos:camposServicio.filter(c=>datos.has(c)),otros:[...otros]};
    }
    function motivoCortoPendiente({datos,otros}) {
        if(datos.length>1)return `Faltan ${datos.length} datos`;
        if(datos.length)return datos[0][2];
        const motivo=otros[0];
        if(/^No hay una equivalencia segura/.test(motivo))return 'Confirma el tipo';
        if(/(?:cortesía para Late Check-out|cortesía.+salida tardía)/i.test(motivo))return 'Confirma la cortesía';
        if(/contradictoria.+fecha/i.test(motivo))return 'Revisa la fecha';
        if(/^Elige cómo tratar esta reserva/.test(motivo))return 'Elige cómo incorporarla';
        if(/(?:asociar de forma|a qué reserva corresponde)/i.test(motivo))return 'Confirma la asociación';
        return breve(motivo,38).replace(/\.$/,'');
    }
    function casoPendiente(p) {
        const legado=String(p.reserva||'').match(/^(.*) · CAB (.+)$/);
        const esServicio=p.tipo==='servicio';
        const servicios=lista(p.servicios);
        const vistos=new Set(), bloques=[];
        for(const s of servicios){
            const nombre=notaBreve(s.nombre,60)||'Servicio';
            const titulo=[nombre,s.fecha?fechaCorta(s.fecha):'',s.hora?String(s.hora).slice(0,5):''].filter(Boolean).join(' · ');
            const {datos,otros}=razonesPendiente(s.motivos,s);
            const texto=notaBreve(s.texto,140);
            const clave=JSON.stringify([titulo,datos.map(d=>d[0]),otros,texto]);
            if(vistos.has(clave))continue;
            vistos.add(clave);
            bloques.push({titulo,nombre,datos,otros:datos.length||otros.length?otros:['Revisa los datos del servicio.'],texto});
        }
        const causasDeServicios=new Set(servicios.flatMap(s=>frasesPendientes(s.motivos)).map(normalizar));
        const motivoGeneral=frasesPendientes(p.motivos).filter(x=>!causasDeServicios.has(normalizar(x)));
        const general=razonesPendiente(motivoGeneral,esServicio?{}:null);
        const datos=general.datos.filter(campo=>!bloques.some(b=>b.datos.includes(campo)));
        const otros=general.otros;
        const nombreGeneral=esServicio?nombreServicio({concepto:p.concepto}):'Reserva';
        if(datos.length||otros.length||!bloques.length){
            bloques.push({titulo:bloques.length?'Otros datos por revisar':nombreGeneral,nombre:nombreGeneral,datos,
                otros:datos.length||otros.length?otros:[esServicio?'Revisa los datos del servicio.':'Revisa a qué reserva corresponde.']});
        }
        const principal=bloques[0];
        const fechaIngreso=/^\d{4}-\d{2}-\d{2}$/.test(p.fechaIngreso||'')?p.fechaIngreso:null;
        const origen=[p.origen?.hoja,p.origen?.celda].filter(Boolean).map(v=>notaBreve(v,24)).join(', ');
        return {titular:notaBreve(p.titular||legado?.[1]||p.reserva,100)||'Reserva',
            cabana:`CAB ${p.cabana??legado?.[2]??'—'}`,fechaIngreso,esServicio,
            origen,resumen:`${principal.nombre} · ${motivoCortoPendiente(principal)}`,bloques};
    }
    function crearVistaPendientes({toast,estadoGuardado,pendientes,nodo,id,botonInforme,cerrar,revisar,posicionar}) {
        const casos=pendientes.map(casoPendiente);
        const deServicios=casos.filter(c=>c.esServicio).length;
        const deReservas=casos.length-deServicios;
        const recuento=[deServicios&&`${deServicios} de servicios`,deReservas&&`${deReservas} de reservas`].filter(Boolean).join(' · ');
        const icono=(padre,nombre)=>nodo(padre,'span',`haku-libro-casos__icono haku-libro-casos__icono--${nombre}`).setAttribute('aria-hidden','true');
        const boton=(padre,clase,texto)=>{const el=nodo(padre,'button',clase,texto);el.type='button';return el;};
        const abrir=boton(estadoGuardado,'haku-libro-casos__abrir');
        const rotulo=nodo(abrir,'span','haku-libro-casos__rotulo');
        nodo(rotulo,'strong','',`${casos.length} ${casos.length===1?'caso pendiente':'casos pendientes'}`);
        nodo(rotulo,'span','haku-libro-casos__meta',recuento);
        icono(abrir,'siguiente');
        abrir.setAttribute('aria-controls',id);
        abrir.setAttribute('aria-expanded','false');

        const anteriores=Array.from(toast.children);
        const aviso=nodo(toast,'div','haku-libro-auto__aviso-incorporado');
        for(const hijo of anteriores)aviso.appendChild(hijo);
        const panel=nodo(toast,'section','haku-libro-casos');
        panel.hidden=true;panel.id=id;panel.setAttribute('aria-labelledby',id+'-titulo');
        panel.setAttribute('aria-live','off');
        const cabecera=nodo(panel,'header','haku-libro-casos__cabecera');
        const volver=boton(cabecera,'haku-libro-casos__volver');
        volver.setAttribute('aria-label','Volver al aviso');icono(volver,'volver');
        const encabezado=nodo(cabecera,'div','haku-libro-casos__encabezado');
        const titulo=nodo(encabezado,'h2','','Casos pendientes');titulo.id=id+'-titulo';
        nodo(titulo,'span','haku-libro-casos__total',String(casos.length));
        nodo(encabezado,'p','haku-libro-casos__meta',recuento);
        const salir=boton(cabecera,'haku-libro-casos__cerrar');
        salir.setAttribute('aria-label','Cerrar burbuja');icono(salir,'cerrar');
        salir.addEventListener('click',cerrar);

        const cuerpo=nodo(panel,'div','haku-libro-casos__cuerpo');
        const listaCasos=nodo(cuerpo,'div','haku-libro-casos__lista');
        const detalle=nodo(cuerpo,'section','haku-libro-casos__detalle');
        detalle.id=id+'-detalle';
        const pie=nodo(panel,'footer','haku-libro-casos__pie');
        botonInforme(pie).className='haku-libro-casos__informe';
        const completar=boton(pie,'haku-libro-casos__completar','Completar pendientes');
        completar.addEventListener('click',revisar);
        let indice=0, desplazamiento=0;
        const movil=()=>root.matchMedia?.('(max-width: 719px)').matches===true;
        const filas=casos.map((c,i)=>{
            const fila=nodo(listaCasos,'div','haku-libro-casos__caso');
            const control=boton(fila,'haku-libro-casos__fila');
            const texto=nodo(control,'span','haku-libro-casos__rotulo');
            nodo(texto,'strong','',c.titular);
            nodo(texto,'span','haku-libro-casos__meta',`${c.cabana} · ${c.resumen}`);
            icono(control,'desplegar');
            control.setAttribute('aria-controls',detalle.id);
            control.setAttribute('aria-expanded','false');
            control.addEventListener('click',()=>{
                const esMovil=movil();
                seleccionar(esMovil&&indice===i?-1:i);
                if(esMovil&&indice>=0){
                    const exceso=detalle.getBoundingClientRect().bottom-listaCasos.getBoundingClientRect().bottom;
                    if(exceso>0)listaCasos.scrollTop+=exceso;
                }
            });
            return {fila,control};
        });
        function ubicarDetalle() {
            const destino=movil()&&indice>=0?filas[indice].fila:cuerpo;
            if(detalle.parentElement!==destino)destino.appendChild(detalle);
        }
        function seleccionar(i) {
            indice=i;
            for(const [j,{control}] of filas.entries())control.setAttribute('aria-expanded',String(i===j));
            ubicarDetalle();
            detalle.replaceChildren();
            detalle.hidden=i<0;
            if(i<0)return;
            const c=casos[i];
            const simple=c.bloques.length===1&&c.bloques[0].titulo===c.bloques[0].nombre;
            detalle.className='haku-libro-casos__detalle'+(simple?' haku-libro-casos__detalle--simple':'');
            const reserva=nodo(detalle,'div','haku-libro-casos__reserva');
            nodo(reserva,'h3','haku-libro-casos__titular',c.titular);
            const info=nodo(reserva,'div','haku-libro-casos__identidad');
            nodo(info,'strong','haku-libro-casos__cabana',c.cabana);
            if(c.fechaIngreso){
                const ingreso=nodo(info,'time','',`IN ${fecha(c.fechaIngreso).replaceAll('-','/')}`);
                ingreso.setAttribute('datetime',c.fechaIngreso);
            }
            for(const bloque of c.bloques){
                const grupo=nodo(detalle,'div','haku-libro-casos__grupo');
                nodo(grupo,'h4','haku-libro-casos__servicio',bloque.titulo);
                if(bloque.datos.length){
                    nodo(grupo,'p','haku-libro-casos__meta haku-libro-casos__datos-titulo','Datos por confirmar');
                    const datos=nodo(grupo,'ul','haku-libro-casos__datos');
                    for(const campo of bloque.datos)nodo(datos,'li','',campo[0]);
                    const faltantes=new Intl.ListFormat('es-CL').format(bloque.datos.map(campo=>campo[1]));
                    nodo(grupo,'p','haku-libro-casos__datos-movil',`Confirma ${faltantes}.`);
                }
                for(const motivo of bloque.otros)nodo(grupo,'p','haku-libro-casos__motivo',motivo);
            }
            const fuentes=[...new Set(c.bloques.map(b=>b.texto).filter(Boolean))];
            if(fuentes.length||c.origen){
                const fuente=nodo(detalle,'div','haku-libro-casos__fuente');
                nodo(fuente,'span','haku-libro-casos__meta',`En el Libro${c.origen?' · '+c.origen:''}`);
                for(const texto of fuentes)nodo(fuente,'p','',`«${texto}»`);
            }
            detalle.scrollTop=0;
        }
        const adaptar=()=>{
            if(panel.hidden)return;
            if(!movil()&&indice<0)seleccionar(0);
            else ubicarDetalle();
        };
        function cambiarVista(abierta) {
            if(abierta)desplazamiento=toast.scrollTop;
            panel.hidden=!abierta;aviso.hidden=abierta;
            abrir.setAttribute('aria-expanded',String(abierta));
            toast.classList.toggle('haku-libro-auto--casos-abiertos',abierta);
            posicionar();
            toast.scrollTop=abierta?0:desplazamiento;
            (abierta?volver:abrir).focus?.({preventScroll:true});
        }
        toast.classList.add('haku-libro-auto--con-pendientes');
        abrir.addEventListener('click',()=>cambiarVista(true));
        volver.addEventListener('click',()=>cambiarVista(false));
        panel.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();cambiarVista(false);}});
        seleccionar(0);
        return adaptar;
    }
    function instalar() {
        let toast, estadoConsulta, acciones=[],avisoProtegido=false,avisoDiferido,numeroAviso=0,adaptarPendientes;
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
                const margen=12;
                const anchoAviso=toast.classList?.contains('haku-libro-auto--con-pendientes')?toast.offsetWidth:Math.min(340,ancho-2*margen);
                if(caja.left>=anchoAviso+2*margen) {
                    toast.style.right=`${ancho-caja.left+margen}px`;
                    toast.style.bottom=`${Math.max(margen,alto-caja.bottom)}px`;
                    toast.dataset.juntoHaku='1';
                } else {
                    // Pantallas estrechas: aviso compacto sobre el panel, siempre
                    // cerrable y sin cambiar el tamaño ni el scroll de la consulta.
                    const abajo=Math.max(margen,alto-caja.bottom);
                    toast.style.right=`${margen}px`;toast.style.bottom=`${abajo}px`;
                    const abierto=toast.classList?.contains('haku-libro-auto--casos-abiertos');
                    const altura=abierto?Math.min(alto-abajo-margen,650,Math.max(240,caja.height)):
                        Math.max(120,Math.min(alto*.38,caja.height-24));
                    toast.style.maxHeight=`${altura}px`;
                    toast.dataset.juntoHaku='compacto';
                }
            } else delete toast.dataset.juntoHaku;
            adaptarPendientes?.();
        }
        root.addEventListener('haiku:panel-estado',posicionarAviso);
        root.addEventListener('resize',posicionarAviso);
        function limpiar() {
            if(avisoProtegido)return;
            toast?.remove();toast=null;estadoConsulta=null;adaptarPendientes=null;
            for (const boton of acciones) {
                boton.informeAnterior=true;boton.disabled=true;
                if (!boton.prioridadLocal) boton.textContent=boton.avisoCompacto?'Informe anterior':'Informe de una versión anterior';
                boton.title='Informe de una versión anterior';
            }
            acciones=[];
        }
        function cerrarAviso(){
            avisoProtegido=false;toast?.remove();toast=null;adaptarPendientes=null;
            if(!avisoDiferido)return;
            const siguiente=avisoDiferido;avisoDiferido=null;
            const api=root.HAIKU_ASISTENTE_LIBRO_ACTUALIZACION_V1;
            if(!siguiente.resultado||!api?.obtenerResultadoAviso){mostrar(siguiente);return;}
            // El siguiente aviso pudo compararse mientras aún se estaba guardando.
            const generacion=root.HAIKU_LIBRO_RESERVA_V1?.estado?.().generacion;
            const vigente=()=>!toast&&root.HAIKU_LIBRO_RESERVA_V1?.estado?.().generacion===generacion;
            void api.obtenerResultadoAviso().then(resultado=>{
                if(vigente())mostrar({...resumir(resultado),resultado});
            },()=>{if(vigente())mostrar(siguiente);});
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
            toast?.remove();adaptarPendientes=null;toast=doc.createElement('aside');toast.className='haku-libro-auto'+(revision?' haku-libro-auto--revision':'');toast.setAttribute('role','status');toast.setAttribute('aria-live','polite');
            const nodo=(padre,tag,clase,contenido)=>{const el=doc.createElement(tag);el.className=clase;if(contenido)el.textContent=contenido;padre.appendChild(el);return el;};
            const mostrarCaso=(padre,caso)=>{
                const bloque=nodo(padre,'section','haku-libro-auto__caso');
                const cabecera=nodo(bloque,'div','haku-libro-auto__cabecera');
                nodo(cabecera,'strong','haku-libro-auto__titulo',caso.titulo);
                const ingreso=/^\d{4}-\d{2}-\d{2}$/.test(caso.fechaIngreso||'')?caso.fechaIngreso:null;
                const deteccion=horaAviso(caso.detectadoEn);
                const fechas=ingreso||deteccion?nodo(cabecera,'span','haku-libro-auto__fechas'):null;
                if(ingreso){
                    const visible=fecha(ingreso).replaceAll('-','/');
                    const entrada=nodo(fechas,'time','haku-libro-auto__ingreso',`IN: ${visible}`);
                    entrada.setAttribute('datetime',ingreso);
                    entrada.setAttribute('aria-label',`Fecha de ingreso ${visible}`);
                }
                if(deteccion){
                    const hora=nodo(fechas,'time','haku-libro-auto__hora',deteccion.texto);
                    hora.setAttribute('datetime',deteccion.iso);
                    hora.setAttribute('title',deteccion.descripcion);
                    hora.setAttribute('aria-label',deteccion.descripcion);
                }
                if(caso.reserva)nodo(bloque,'p','haku-libro-auto__reserva',caso.reserva);
                const detalles=nodo(bloque,'dl','haku-libro-auto__detalles');
                for(const d of caso.detalles){nodo(detalles,'dt','',d.etiqueta);nodo(detalles,'dd','',d.texto);}
            };
            nodo(toast,'strong','haku-libro-auto__marca','Haku');
            if (burbuja) {
                const resumen=nodo(toast,'div','haku-libro-auto__resumen');
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
                return boton;
            }
            function mensajeCompacto(mensaje) {
                const nuevas=lista(resultado.nuevas).length,modificadas=lista(resultado.modificadas).length;
                const ausentes=lista(resultado.ya_no_aparecen).length,canceladas=lista(resultado.cancelaciones_confirmadas).length;
                const abonos=lista(resultado.abonos), total=nuevas+modificadas+ausentes+canceladas+abonos.filter(a=>!a.nueva).length;
                if(!total && !burbuja.avisos.length)return false;
                mensaje.className+=' haku-libro-resumen';
                const cabecera=nodo(mensaje,'div','haku-libro-resumen__cabecera');
                const encabezado=nodo(cabecera,'div','haku-libro-resumen__encabezado');
                const parcial=['parcial','no_comparable'].includes(resultado.estado);
                nodo(encabezado,'strong','haku-libro-resumen__titulo',parcial?'Lectura parcial del Libro':total?`${total} ${total===1?'cambio':'cambios'} en el Libro`:'Actualización por revisar');
                // Este sello pertenece al mensaje emitido, no a la detección del cambio en el Libro.
                const emision=horaAviso(new Date().toISOString(),'Informe emitido por Haku');
                const hora=nodo(encabezado,'time','haku-libro-auto__hora haku-libro-resumen__hora',emision.texto);
                hora.setAttribute('datetime',emision.iso);
                hora.setAttribute('title',emision.descripcion);
                hora.setAttribute('aria-label',emision.descripcion);
                const informe=botonInforme(cabecera);informe.className='haku-libro-resumen__informe';informe.avisoCompacto=true;
                const cifras=nodo(mensaje,'div','haku-libro-resumen__cifras');
                for(const [cantidad,uno,varios] of [[nuevas,'agregada','agregadas'],[modificadas,'modificada','modificadas'],[ausentes,'no aparece','no aparecen'],...(canceladas?[[canceladas,'cancelada en el Libro','canceladas en el Libro']]:[])]) {
                    if (abonos.length && !cantidad) continue;
                    nodo(cifras,'span',cantidad?'':'haku-libro-resumen__cero',`${cantidad} ${cantidad===1?uno:varios}`);
                }
                if (abonos.length) nodo(cifras,'span','',`${abonos.length} ${abonos.length===1?'abono':'abonos'}`);
                let casoPrincipal=null,seleccion=null,botonDatos=null;
                const controles=[];
                if(total===1 && burbuja.casos[0]){
                    casoPrincipal=nodo(mensaje,'div','haku-libro-resumen__caso');mostrarCaso(casoPrincipal,burbuja.casos[0]);
                }
                const contenido=nodo(mensaje,'div','haku-libro-auto__filtrado');
                contenido.id='haku-resumen-categoria-'+(++numeroAviso);contenido.hidden=true;contenido.setAttribute('role','region');
                const cantidadDatos=burbuja.datosPorRevisar.length;
                const etiquetaDatos=`${cantidadDatos} ${cantidadDatos===1?'dato por':'datos por'} revisar`;
                function alternarDetalle(clave,nombre,casos){
                    seleccion=seleccion===clave?null:clave;
                    for(const control of controles)control.boton.setAttribute('aria-expanded',String(seleccion===control.clave));
                    if(casoPrincipal)casoPrincipal.hidden=seleccion!==null;
                    contenido.replaceChildren();contenido.hidden=seleccion===null;
                    if(botonDatos)botonDatos.textContent=seleccion==='revision'?'Volver al resumen':etiquetaDatos;
                    if(seleccion!==null){
                        contenido.setAttribute('aria-label',nombre+' · '+casos.length);
                        for(const caso of casos)mostrarCaso(contenido,caso);
                        if(!casos.length)nodo(contenido,'p','haku-libro-auto__aviso','No hay cambios ni avisos en esta categoría.');
                    }
                }
                if(burbuja.avisos.length || canceladas){
                    const avisos=[...burbuja.avisos];
                    if(canceladas)avisos.push('Cancelación en el Libro pendiente de confirmar en Proyecto H.');
                    const aviso=nodo(mensaje,'div','haku-libro-resumen__aviso');
                    nodo(aviso,'span','','!').setAttribute('aria-hidden','true');
                    const textos=nodo(aviso,'span','haku-libro-resumen__avisos-texto');
                    for(const texto of avisos){
                        if(cantidadDatos && texto===etiquetaDatos+'.'){
                            botonDatos=nodo(textos,'button','haku-libro-resumen__ver-datos',etiquetaDatos);botonDatos.type='button';
                            botonDatos.setAttribute('aria-controls',contenido.id);botonDatos.setAttribute('aria-expanded','false');
                            controles.push({boton:botonDatos,clave:'revision'});
                            // Sólo muestra la instantánea del aviso, incluso cuando el informe ya es anterior.
                            botonDatos.addEventListener('click',()=>alternarDetalle('revision','Datos por revisar',burbuja.datosPorRevisar));
                        }else nodo(textos,'span','',texto.replace(/\.$/,''));
                    }
                }
                if(burbuja.prioridades.length){
                    const franja=nodo(mensaje,'div','haku-libro-resumen__prioridades');
                    franja.setAttribute('role','group');franja.setAttribute('aria-label','Cambios y avisos por fecha');
                    for(const p of burbuja.prioridades){
                        const item=nodo(franja,'button','haku-libro-resumen__prioridad');item.type='button';item.prioridadLocal=true;
                        item.setAttribute('title',p.clave==='proximos'?'Próximos 2 a 7 días':p.clave==='informativos'?'Informativos, incluidos casos sin fecha':p.nombre);
                        item.setAttribute('aria-controls',contenido.id);item.setAttribute('aria-expanded','false');
                        controles.push({boton:item,clave:p.clave});
                        for(const tema of ['claro','oscuro']){
                            const icono=nodo(item,'img','haku-libro-resumen__punto haku-libro-resumen__punto--'+tema);
                            icono.src=`assets/icons/haku-libro-resumen/${p.clave}-${tema}.svg`;icono.alt='';icono.width=6;icono.height=6;
                        }
                        nodo(item,'span','',p.nombre);nodo(item,'strong','',String(p.total));
                        item.addEventListener('click',()=>{
                            if(item.disabled || consultando())return;
                            alternarDetalle(p.clave,p.nombre,p.casos);
                        });
                        acciones.push(item);
                    }
                }
                return true;
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
                        const pendientes=lista(fin?.pendientes);finalizado=true;
                        const confirmacion=resumen?`Incorporado: ${resumen}.`:pendientes.length?'No hay cambios completos para incorporar.':'Estos cambios ya están guardados.';
                        estadoGuardado.textContent=confirmacion;
                        if(pendientes.length){
                            if(resumen){
                                estadoGuardado.textContent='';
                                const confirmado=nodo(estadoGuardado,'p','haku-libro-casos__confirmado');
                                nodo(confirmado,'span','haku-libro-casos__icono haku-libro-casos__icono--confirmado').setAttribute('aria-hidden','true');
                                nodo(confirmado,'span','',confirmacion);
                            }
                            adaptarPendientes=crearVistaPendientes({toast,estadoGuardado,pendientes,nodo,botonInforme,
                                id:'haku-casos-pendientes-'+(++numeroAviso),cerrar:cerrarAviso,posicionar:posicionarAviso,
                                revisar:()=>{api.revisarDesdeAviso(resultado);root.HAIKU_ASISTENTE?.abrir?.();cerrarAviso();}});
                            posicionarAviso();
                            toast.scrollTop=toast.scrollHeight;
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
            const api = root.HAIKU_ASISTENTE_LIBRO_ACTUALIZACION_V1;
            if (resultado && api?.puedeRevisarAbonos?.(resultado)) {
                const boton = nodo(pie,'button','','Revisar abonos');
                boton.type = 'button'; boton.disabled = consultando(); acciones.push(boton);
                boton.addEventListener('click',()=>{
                    if (boton.disabled || consultando() || !api.revisarAbonosDesdeAviso(resultado)) return;
                    root.HAIKU_ASISTENTE?.abrir?.();
                    mensajeInforme?.remove();
                    cerrarAviso();
                });
            }
            if (resultado) botonInforme(pie);
            const cerrar=doc.createElement('button');cerrar.type='button';cerrar.textContent=conservarConsulta?'Seguir con mi consulta':'Cerrar';cerrar.addEventListener('click',()=>{if(!guardando)cerrarAviso();});pie.appendChild(cerrar);
            doc.body.appendChild(toast);
            posicionarAviso();
            // Un aviso de fondo no inserta respuestas ni desplaza una consulta abierta.
            if (!pendiente && !conservarConsulta) {
                const mensajes=doc.getElementById('haiku-asistente-mensajes');
                if (mensajes) {
                    const mensaje=doc.createElement('div');mensaje.className='haiku-asistente-mensaje haiku-asistente-mensaje--asistente';
                    if(!resultado || !burbuja || !mensajeCompacto(mensaje)){
                        mensaje.textContent=texto;
                        if (resultado) botonInforme(mensaje);
                    }
                    mensajes.appendChild(mensaje);
                    if (resultado) mensajeInforme=mensaje;
                }
            }
        }
        const control=crearControlador({generacion:()=>root.HAIKU_LIBRO_RESERVA_V1?.estado().generacion,
            obtener:()=>{
                const api=root.HAIKU_ASISTENTE_LIBRO_ACTUALIZACION_V1;
                return api.obtenerResultadoAviso?.() ?? api.obtenerResultado();
            },mostrar,limpiar});
        root.addEventListener('haiku:libro-version-cargada',e=>{void control.cargar(e.detail);});
        // Sólo invalida; nunca inicia comparación desde limpieza, restauración ni F5.
        root.addEventListener('haiku:libro-cambio',()=>control.invalidar());
    }
    root.HAIKU_ASISTENTE_LIBRO_AUTO_V1=Object.freeze({resumir,crearControlador});
    if (typeof module!=='undefined') module.exports=root.HAIKU_ASISTENTE_LIBRO_AUTO_V1;
    if (root.document) instalar();
})(typeof window!=='undefined'?window:globalThis);

