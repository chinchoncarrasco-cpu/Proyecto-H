/* ETAPA 3: sólo una carga manual confirmada inicia el aviso. Sin persistencia nueva. */
(function(root) {
    'use strict';
    if (root.HAIKU_ASISTENTE_LIBRO_AUTO_V1) return;
    const lista = x => Array.isArray(x) ? x : [];
    const fecha = x => /^\d{4}-\d{2}-\d{2}$/.test(x || '') ? x.split('-').reverse().join('-') : 'Fecha no determinada';
    function resumir(r) {
        const n=lista(r.nuevas).length,m=lista(r.modificadas).length,b=lista(r.ya_no_aparecen).length,a=lista(r.ambiguas).length;
        const total=n+m+b, avisos=lista(r.advertencias).length;
        let texto, revision=a>0 || avisos>0;
        if (['parcial','no_comparable'].includes(r.estado)) {
            texto='Comparé la actualización, pero una parte requiere revisión.'; revision=true;
        } else if (!['ok','sin_cambios'].includes(r.estado)) {
            return {texto:'No pude completar el informe de esta actualización. Puedes solicitarlo en Haku.',revision:true};
        } else if (!total && a) texto=`La actualización contiene ${a} ${a===1?'caso que requiere':'casos que requieren'} revisión.`;
        else if (!total) texto='Libro actualizado. No detecté cambios operacionales.';
        else if (total===1 && n===1) {
            const x=r.nuevas[0].actual || {};
            texto=`Detecté una reserva nueva: ${x.titular || 'Titular no determinado'} · CAB ${x.cabana ?? '—'} · ${fecha(x.fecha_checkin)} → ${fecha(x.fecha_checkout)}.`;
        } else if (total===1 && m===1) {
            const x=r.modificadas[0], campos={cabana:'Cabaña',fecha_checkin:'Check-in',fecha_checkout:'Check-out',noches:'Noches',adultos:'Adultos',ninos:'Niños',mascotas:'Mascotas'};
            const cambios=lista(x.cambios).filter(c=>Object.hasOwn(campos,c.campo)).slice(0,2).map(c=>{
                const mostrar=v=>c.campo.startsWith('fecha_') ? fecha(v) : typeof v==='number' ? v : /^\d+$/.test(String(v)) ? v : 'No determinado';
                return `${campos[c.campo]} ${mostrar(c.antes)} → ${mostrar(c.ahora)}`;
            });
            texto=`Detecté un cambio en una reserva: ${x.actual?.titular || 'Titular no determinado'} · CAB ${x.actual?.cabana ?? '—'}. ${cambios.length?cambios.join(' · '):'Consulta los campos modificados en el informe.'}`;
        } else texto=`Detecté ${total} ${total===1?'cambio':'cambios'} en la última actualización: ${n} nuevas · ${m} modificadas · ${b} ${b===1?'ya no aparece':'ya no aparecen'}.`;
        if (total && a) texto+=` ${a} ${a===1?'caso requiere':'casos requieren'} revisión.`;
        if (avisos) texto+=` Además, hay ${avisos} ${avisos===1?'advertencia':'advertencias'} de interpretación.`;
        if (root.HAIKU_ASISTENTE_LIBRO_PRIORIDAD_V1) texto+=' '+root.HAIKU_ASISTENTE_LIBRO_PRIORIDAD_V1.resumen(r);
        return {texto,revision};
    }
    function crearControlador({generacion,obtener,mostrar,limpiar}) {
        let ultima=-1, token=0;
        return {
            invalidar(){token++;limpiar();},
            async cargar(detail) {
                if (!detail?.carga_manual || !detail.tenia_anterior || !Number.isInteger(detail.generacion) || detail.generacion!==generacion() || detail.generacion<=ultima) return;
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
        let toast, acciones=[];
        function limpiar() {
            toast?.remove();toast=null;
            for (const boton of acciones) {boton.disabled=true;boton.textContent='Informe de una versión anterior';}
            acciones=[];
        }
        function mostrar({texto,revision=false,pendiente=false,resultado}) {
            const doc=root.document;
            if (!doc.getElementById('haku-libro-auto-estilo')) {
                const estilo=doc.createElement('style');estilo.id='haku-libro-auto-estilo';
                estilo.textContent='.haku-libro-auto{position:fixed;right:18px;bottom:88px;width:min(340px,calc(100vw - 36px));box-sizing:border-box;z-index:10000;background:#f7faf8;color:#26342c;border:1px solid #cadfd1;border-radius:16px;padding:14px;box-shadow:0 6px 22px #183e2426;font:13px/1.5 system-ui;overflow-wrap:anywhere;max-height:45vh;overflow:auto}.haku-libro-auto--revision{background:#fffaf1;border-color:#ead8bc}.haku-libro-auto p{margin:7px 0}.haku-libro-auto button{cursor:pointer;background:white;color:#245438;border:1px solid #cadfd1;border-radius:8px;padding:6px 10px;margin:5px 6px 0 0}.haku-libro-auto button:disabled{cursor:default;opacity:.6}';
                doc.head.appendChild(estilo);
            }
            toast?.remove();toast=doc.createElement('aside');toast.className='haku-libro-auto'+(revision?' haku-libro-auto--revision':'');toast.setAttribute('role','status');toast.setAttribute('aria-live','polite');
            const titulo=doc.createElement('strong');titulo.textContent='Haku';toast.appendChild(titulo);
            const contenido=doc.createElement('p');contenido.textContent=texto;toast.appendChild(contenido);
            let insertado=false;
            function botonInforme(contenedor) {
                const boton=doc.createElement('button');boton.type='button';
                boton.textContent=typeof root.HAIKU_ASISTENTE?.abrir==='function'?'Ver informe':'Abre Haku para ver el informe';
                boton.addEventListener('click',()=>{
                    if (boton.disabled) return;
                    if (!insertado) {root.HAIKU_ASISTENTE_LIBRO_ACTUALIZACION_V1.mostrarResultado(resultado);insertado=true;}
                    root.HAIKU_ASISTENTE?.abrir?.();
                    toast?.remove();toast=null;
                });
                contenedor.appendChild(boton);acciones.push(boton);
            }
            if (resultado) botonInforme(toast);
            const cerrar=doc.createElement('button');cerrar.type='button';cerrar.textContent='Cerrar';cerrar.addEventListener('click',()=>{toast?.remove();toast=null;});toast.appendChild(cerrar);
            doc.body.appendChild(toast);
            if (!pendiente) {
                const mensajes=doc.getElementById('haiku-asistente-mensajes');
                if (mensajes) {
                    const mensaje=doc.createElement('div');mensaje.className='haiku-asistente-mensaje haiku-asistente-mensaje--asistente';mensaje.textContent=texto;
                    if (resultado) botonInforme(mensaje);
                    mensajes.appendChild(mensaje);
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
