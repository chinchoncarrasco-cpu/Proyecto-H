/* Contexto del informe: lecturas agrupadas, sin escrituras ni llamadas a IA. */
(function(root){
    'use strict';
    const lista=x=>Array.isArray(x)?x:[];
    const texto=x=>String(x??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
    const fecha=x=>/^\d{4}-\d{2}-\d{2}$/.test(x||'')?x.split('-').reverse().join('-'):String(x||'sin fecha');
    const pesos=x=>'$'+Number(x).toLocaleString('es-CL');
    const fechas=new Set(['fecha_checkin','fecha_checkout','tipo_estadia','cabana']);
    const camposDB={fecha_checkin:'fecha_ingreso',fecha_checkout:'fecha_salida',cabana:'cabana_id',estado_operativo:'estado_estadia'};
    const dinero=x=>x!==null&&x!==undefined&&x!==''&&Number.isSafeInteger(Number(x))&&Number(x)>=0;
    const keys=x=>new Set(lista(x.cambios).map(c=>c.campo));
    const hoja=r=>r?.hoja||r?.coordenadas_origen?.hoja||String(r?.id||'').split('!').slice(0,-1).join('!');
    function evidenciaCalendario(reserva,data){
        // Las fechas resueltas desde el texto no acreditan celdas ocupadas.
        if(reserva.geometria_inequivoca!==true||reserva.geometria_resuelta_texto||reserva.tipo_estadia==='full_day')return null;
        const dias=lista(reserva.fechas_ocupadas),src=reserva.coordenadas_origen;
        if(!dias.length||!src?.celda||dias.length!==Number(reserva.noches))return null;
        const direccion=(r,c)=>{let col='';for(let n=c+1;n>0;n=Math.floor((n-1)/26))col=String.fromCharCode(65+(n-1)%26)+col;return col+(r+1);};
        const fin=src.merge?.e,libres=lista(data?.espacios).filter(x=>Number(x.cabana)===Number(reserva.cabana)&&
            x.fecha===reserva.fecha_checkout&&x.estado==='libre_explicito');
        return {hoja:hoja(reserva),rango:fin?`${src.celda}:${direccion(fin.r,fin.c)}`:src.celda,
            noches:[...dias],salida:reserva.fecha_checkout,
            siguiente_libre:libres.length===1?{fecha:libres[0].fecha,celda:libres[0].origen?.celda}:null};
    }
    function fraseCalendario(e){
        if(!e)return '';
        const dias=e.noches;
        return `Las celdas cubren ${dias.length===1?`la noche del ${fecha(dias[0])}`:`${dias.length} noches: del ${fecha(dias[0])} al ${fecha(dias.at(-1))}`}`+
            (e.siguiente_libre?`; el ${fecha(e.siguiente_libre.fecha)} figura «LIBRE».`:'.');
    }
    function mismaPersona(a,b){
        const S=root.HAIKU_LIBRO_SEMANTICA;
        const doc=x=>S?.documentoCanon?S.documentoCanon(x.rut_documento,x.tipo_documento):texto(x.rut_documento).replace(/[.\s-]/g,'');
        const da=doc(a),db=doc(b);
        if(da&&db&&da!==db)return false;
        return Boolean(da&&da===db||texto(a.titular)&&texto(a.titular)===texto(b.titular));
    }
    async function actualizarDesdeLibro(registros,libro=root.HAIKU_LIBRO_RESERVA_V1){
        if(!registros.length)return [];
        const sinFuente=x=>({...x,fuente_vigente:{estado:'no_disponible'}});
        if(!libro?.crearLectura)return registros.map(sinFuente);
        let lectura;
        try{lectura=await libro.crearLectura();}catch(_){return registros.map(sinFuente);}
        const hojas=[...new Set(registros.filter(x=>x.tipo!=='cancelacion').map(x=>hoja(x.actual||x.anterior)).filter(Boolean))];
        const disponibles=new Set(lectura.listarHojas()),resultados=new Map(),cancelaciones=new Map(),datosHojas=new Map();
        let lote;
        if(typeof lectura.consultarHojas==='function'){
            try{lote=new Map((await lectura.consultarHojas(hojas.filter(h=>disponibles.has(h)))).map(x=>[x.hoja,x]));}
            catch(_){return registros.map(sinFuente);}
        }
        // El lector conserva sus bytes durante esta consulta; sólo se leen las
        // hojas de los casos guardados, una vez por hoja, nunca el Libro completo.
        for(const h of hojas){
            if(!disponibles.has(h)){resultados.set(h,null);continue;}
            try{const data=lote?lote.get(h):await lectura.consultarHoja(h,'actual','semantica');
                resultados.set(h,data?.cobertura?.geometria===true&&Array.isArray(data.reservas)?data.reservas:null);
                cancelaciones.set(h,lista(data?.cancelaciones));
                datosHojas.set(h,data);
            }catch(_){resultados.set(h,null);}
        }
        const actualizados=registros.map(registro=>{
            if(registro.tipo==='cancelacion')return registro;
            const r=registro.actual||registro.anterior,rows=resultados.get(hoja(r));
            if(!rows)return sinFuente(registro);
            const candidatos=rows.filter(x=>mismaPersona(r,x)&&
                (x.id===r.id||Number(x.cabana)===Number(r.cabana)&&
                    (x.fecha_checkin===r.fecha_checkin||x.fecha_checkout===r.fecha_checkout)));
            const canceladas=lista(cancelaciones.get(hoja(r))).filter(c=>root.HAIKU_LIBRO_DIFERENCIAS_V1?.evidenciaCancelacion(r,c)===true);
            if(!candidatos.length&&canceladas.length===1)return {...registro,fuente_vigente:{estado:'cancelada',generacion:lectura.estado().generacion},
                evidencia_cancelacion:canceladas[0]};
            if(candidatos.length!==1)return {...registro,fuente_vigente:{estado:candidatos.length?'ambigua':'no_encontrada'}};
            const actual=structuredClone(candidatos[0]);
            return {...registro,actual,fuente_vigente:{estado:'verificada',generacion:lectura.estado().generacion,
                actualizada:JSON.stringify(actual)!==JSON.stringify(registro.actual),
                calendario:evidenciaCalendario(actual,datosHojas.get(hoja(r)))},
                cambios:lista(registro.cambios).map(c=>({...c,ahora:structuredClone(actual[c.campo])}))};
        });
        // Dos avisos de la misma ficha y la misma versión son un caso. Se
        // conservan todos sus campos e IDs para retirar sólo los avisos resueltos.
        const grupos=new Map(),salida=[];
        for(const registro of actualizados){
            if(registro.tipo!=='modificacion'||registro.fuente_vigente?.estado!=='verificada'){salida.push(registro);continue;}
            const key=JSON.stringify([hoja(registro.actual),registro.actual.id]);
            const previo=grupos.get(key);
            if(!previo){const nuevo={...registro,ids_origen:[registro.id]};grupos.set(key,nuevo);salida.push(nuevo);}
            else{
                previo.ids_origen.push(registro.id);
                const campos=new Map(previo.cambios.map(c=>[c.campo,c]));
                for(const c of registro.cambios)if(!campos.has(c.campo))campos.set(c.campo,c);
                previo.cambios=[...campos.values()];
            }
        }
        return salida;
    }
    async function leer(cliente,tabla,columnas,campo,ids,signal,limite,orden='id'){
        let q=cliente.from(tabla).select(columnas).in(campo,ids).order(orden,{ascending:false}).limit(limite);
        if(typeof q.abortSignal==='function')q=q.abortSignal(signal);
        const {data,error}=await q;
        if(error||!Array.isArray(data)||data.length>=limite)throw Error('Contexto incompleto');
        return data;
    }
    // Una sola lectura por tabla para todo el informe. Al vencer el plazo, el
    // informe termina con la limitación explícita; nunca interpreta un error como cero.
    async function cargar(items,cliente,{plazoMs=2200,puedeVerPagos=root.haikuTienePermiso?.('pagos.ver')===true}={}){
        const identificados=items.filter(x=>x.sistema?.reserva_id&&x.sistema?.id);
        const ids=[...new Set(identificados.map(x=>x.sistema.reserva_id))];
        const conFechas=identificados.filter(x=>[...keys(x)].some(k=>fechas.has(k)));
        const estadias=[...new Set(conFechas.map(x=>x.sistema.id))];
        if(!ids.length||!cliente?.from)return {};
        if(ids.length>100)return {historial:{disponible:false},finanzas:{disponible:false}};
        const control=new AbortController(),resultado={};let timer;
        const tarea=(nombre,trabajo)=>Promise.resolve().then(trabajo).then(rows=>{resultado[nombre]={disponible:true,rows};},()=>{resultado[nombre]={disponible:false};});
        const trabajos=[tarea('historial',()=>leer(cliente,'eventos_auditoria','id,reserva_id,estadia_id,entidad_tipo,tipo_evento,creado_en,cambios','reserva_id',ids,control.signal,300,'creado_en'))];
        if(estadias.length&&puedeVerPagos){
            trabajos.push(tarea('cargos',()=>leer(cliente,'vista_estado_cargos','cargo_id,reserva_id,estadia_id,estadia_noche_id,tipo_cargo,estado,monto,monto_ajustado,aplicado_neto,saldo_cargo','estadia_id',estadias,control.signal,500,'cargo_id')));
            trabajos.push(tarea('noches',()=>leer(cliente,'estadia_noches','id,estadia_id,fecha','estadia_id',estadias,control.signal,500)));
        }
        try{await Promise.race([Promise.all(trabajos),new Promise(resolve=>{timer=setTimeout(()=>{control.abort();resolve();},plazoMs);})]);}
        finally{clearTimeout(timer);}
        // Copia cerrada: una respuesta tardía no modifica el informe que ya se mostró.
        return {historial:resultado.historial||{disponible:false},
            finanzas:{disponible:resultado.cargos?.disponible===true&&resultado.noches?.disponible===true,
                cargos:resultado.cargos?.rows||[],noches:resultado.noches?.rows||[]}};
    }
    function construir(item,datos={}){
        const campos=keys(item),s=item.sistema,r=item.actual||item.anterior||{};
        const contexto={version:1,hechos:[],avisos:[],historial:null,finanzas:null};
        if(item.fuente_vigente?.estado==='cancelada'){
            contexto.avisos.push({codigo:'cancelada_en_libro',texto:'El Libro actual la incluye en Cancelaciones, pero hay una reserva compatible vigente en Proyecto H. Falta comprobar si también debe cancelarse allí.'});
            return contexto;
        }
        if(item.fuente_vigente&&item.fuente_vigente.estado!=='verificada')contexto.avisos.push({codigo:'libro_no_verificado',texto:
            item.fuente_vigente.estado==='no_encontrada'?'Esta reserva ya no aparece en su ubicación del Libro actual. Eso no demuestra que esté cancelada.':
            item.fuente_vigente.estado==='ambigua'?'Hay varias coincidencias en el Libro actual. Falta identificar cuál corresponde.':
            'No pude leer esta reserva en el Libro actual. Conservé el pendiente anterior sin darlo por vigente.'});
        if(!s)return contexto;
        const diferentes=lista(item.cambios).filter(c=>!['servicios','notas_importantes','pagos_pendientes','noches','operador','estado_confirmacion','estado_operativo'].includes(c.campo)&&
            c.proyecto!=null&&c.antes!=null&&texto(c.proyecto)!==texto(c.antes)&&texto(c.proyecto)!==texto(c.ahora));
        if(diferentes.length)contexto.avisos.push({codigo:'cambio_en_ambas_fuentes',texto:'Proyecto H tiene otro valor, distinto de las dos versiones del Libro. Hay que decidir cuál conservar.'});
        const eventos=lista(datos.historial?.rows).filter(e=>e.reserva_id===s.reserva_id&&(!e.estadia_id||e.estadia_id===s.id));
        const relevantes=eventos.flatMap(e=>lista(e.cambios).filter(c=>[...campos].some(k=>(camposDB[k]||k)===c.campo))
            .map(c=>({campo:c.campo,antes:c.anterior,ahora:c.nuevo,fecha:e.creado_en}))).sort((a,b)=>String(b.fecha).localeCompare(String(a.fecha)));
        if(relevantes.length)contexto.historial=relevantes[0];
        if(s.estado_operativo==='checked_out')contexto.hechos.push('Esta estadía ya terminó.');
        if([...campos].some(k=>fechas.has(k))){
            const calendario=item.fuente_vigente?.estado==='verificada'?item.fuente_vigente.calendario:null;
            const nochesTexto=r.noches_texto_efectivas??r.noches_texto,frase=fraseCalendario(calendario);
            if(calendario)contexto.calendario=calendario;
            if(nochesTexto!=null&&Number(nochesTexto)!==Number(r.noches))contexto.avisos.push({codigo:'noches_contradictorias',texto:
                `El texto dice ${nochesTexto} noche${Number(nochesTexto)===1?'':'s'}. ${frase||`Las fechas del Libro abarcan ${r.noches} noche${Number(r.noches)===1?'':'s'}.`} Falta aclarar la salida correcta.`});
            else if(frase)contexto.hechos.push(frase);
            const fin=datos.finanzas;
            const cargos=lista(fin?.cargos).filter(c=>c.estadia_id===s.id&&c.tipo_cargo==='alojamiento'&&c.estado==='activo');
            const noches=new Map(lista(fin?.noches).filter(n=>n.estadia_id===s.id).map(n=>[n.id,n.fecha]));
            const valido=fin?.disponible===true&&cargos.length>0&&cargos.every(c=>dinero(c.monto_ajustado)&&dinero(c.aplicado_neto)&&dinero(c.saldo_cargo));
            if(!valido)contexto.avisos.push({codigo:'cobros_no_comprobados',texto:'No pude comprobar el precio y los pagos aplicados al alojamiento. No se puede asegurar que corregir las fechas conserve el cobro.'});
            else{
                const total=cargos.reduce((n,c)=>n+Number(c.monto_ajustado),0),aplicado=cargos.reduce((n,c)=>n+Number(c.aplicado_neto),0);
                const cambioTipo=campos.has('tipo_estadia');
                const fuera=cargos.filter(c=>cambioTipo||noches.has(c.estadia_noche_id)&&(noches.get(c.estadia_noche_id)<r.fecha_checkin||noches.get(c.estadia_noche_id)>=r.fecha_checkout));
                const retirado=fuera.reduce((n,c)=>n+Number(c.monto_ajustado),0),pagadoRetirado=fuera.reduce((n,c)=>n+Number(c.aplicado_neto),0);
                contexto.finanzas={total,aplicado,retirado,pagadoRetirado};
                contexto.hechos.push(`Alojamiento: ${pesos(total)}. Pagos aplicados: ${pesos(aplicado)}.`);
                if(retirado>0)contexto.avisos.push({codigo:'noche_con_cobro',texto:`La noche que se quitaría tiene ${pesos(retirado)} de cobro${pagadoRetirado>0?` y ${pesos(pagadoRetirado)} de pagos aplicados`:''}.`});
                contexto.hechos.push('Corregir las fechas debe conservar el precio acordado y los pagos, salvo un cambio de monto indicado expresamente.');
            }
            if(/segunda\s+noche/.test(texto(r.texto_original))&&Number(r.noches)===1)
                contexto.avisos.push({codigo:'promocion_segunda_noche',texto:'El texto también menciona «segunda noche». Comprueba si esa promoción explica la diferencia de fechas.'});
        }
        if(campos.has('servicios')){
            const servicios=lista(datos.servicios).filter(x=>x.sistema?.reserva_id===s.reserva_id||x.reserva?.id===r.id);
            const notas=lista(datos.notas).filter(x=>x.reserva?.id===r.id);
            contexto.servicios=servicios.map(x=>({estado:x.estado,razon:x.razon||'',
                concepto:x.lectura?.nombre||x.servicio?.nombre||x.servicio?.concepto||x.concepto||'Servicio',
                tipo:x.servicio?.concepto, texto:x.servicio?.fragmento_original||x.servicio?.texto_original||'',
                fecha:x.estado==='en_sistema'?x.sistema?.fecha_servicio||x.lectura?.fecha:x.lectura?.fecha,
                hora:(x.estado==='en_sistema'?x.sistema?.hora_inicio:null)||x.lectura?.hora||x.servicio?.hora_inicio||x.servicio?.hora||'',
                cantidad:(x.estado==='en_sistema'?x.sistema?.cantidad:null)||x.lectura?.cantidad||x.servicio?.cantidad,
                razones:x.lectura?.razones||[]}));
            contexto.notas=notas.map(x=>({estado:x.estado,texto:x.texto||''}));
        }
        return contexto;
    }
    async function enriquecer(items,cliente,opciones={}){
        const datos=await cargar(items,cliente,opciones);
        datos.servicios=opciones.comparacion?.serviciosDetalle;datos.notas=opciones.comparacion?.notasDetalle;
        return items.map(item=>({...item,contexto:construir(item,datos)}));
    }
    function fraseHistorial(h){
        if(!h||!['fecha_ingreso','fecha_salida'].includes(h.campo))return '';
        return `Historial de Proyecto H: ${h.campo==='fecha_ingreso'?'entrada':'salida'} ${fecha(h.antes)} → ${fecha(h.ahora)}.`;
    }
    const api=Object.freeze({actualizarDesdeLibro,cargar,construir,enriquecer,fraseHistorial});
    root.HAIKU_LIBRO_CONTEXTO_V1=api;
    if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
