// Catálogo de los flujos que Haku puede abrir desde el panel.
(function (root) {
    "use strict";

    const secciones = [
        {nombre:"Operación del día",acciones:[
            {titulo:"Resumen del día",detalle:"Ingresos, salidas, estadías en curso, servicios, notas y cobros pendientes.",
                ejemplos:["Haku, resumen de hoy","Haku, resumen operativo de mañana"]},
            {titulo:"Ingresos",detalle:"Muestra quién llega, su cabaña y el estado de la reserva.",
                ejemplos:["Haku, dame los ingresos de hoy","Haku, ingrseos de mañana"]},
            {titulo:"Salidas y estadías que continúan",detalle:"Elige salidas o huéspedes que se quedan en la fecha que indiques.",
                ejemplos:["Haku, pásame las salidas de mañana","Haku, ¿qué reservas continúan hoy?"]},
            {titulo:"Cabañas disponibles",detalle:"Consulta disponibilidad para vender en una fecha.",
                ejemplos:["Haku, ¿qué cabañas quedan libres mañana?","Haku, dime las cabañas disponibles el 15/11/2026"]},
            {titulo:"Confirmadas sin abono",detalle:"Revisa reservas confirmadas pendientes de su primer pago. Puedes incluir fechas pasadas.",
                ejemplos:["Haku, muéstrame las reservas confirmadas sin abono"]},
            {titulo:"Aseo, revisión y horarios",detalle:"Consulta quién limpió o revisó, tiempos, hora de ingreso y detalles de una cabaña.",
                ejemplos:["Haku, ¿quién hizo el aseo de CAB 3 hoy?","Haku, ¿cuánto duró el aseo de CAB 3 el 12/11/2026?"]},
            {titulo:"Checklist y aseo express",detalle:"Abre el detalle registrado del checklist o compara el aseo con el Libro.",
                ejemplos:["Haku, checklist de aseo express de CAB 3 hoy","Haku, compara el aseo de CAB 3 el 12/11/2026"]},
            {titulo:"Huésped anterior y revisión tras la salida",detalle:"Ubica la estadía anterior o quién revisó después del check-out. Puedes pedir detalles de esa revisión en el mismo chat.",
                ejemplos:["Haku, ¿quién estuvo antes que Ana Pérez en CAB 3?","Haku, ¿quién revisó el aseo después del check-out de Ana Pérez en CAB 3?"]}
        ]},
        {nombre:"Reservas",acciones:[
            {titulo:"Crear una reserva o Full Day",detalle:"Prepara la vista previa con titular, ingreso, salida, cabaña y ocupación. Puedes añadir acompañantes y abonos con respaldo.",
                ejemplos:["Haku, prepara una reserva para Ana Pérez del 13 al 14 de noviembre de 2026 en CAB 3 para 2 adultos","Haku, crea un Full Day para Ana Pérez el 13/11/2026 en CAB 3 para 2 adultos"]},
            {titulo:"Crear varias reservas",detalle:"Pega las reservas en líneas separadas o adjunta capturas. La vista previa separa los datos y permite revisar el lote.",
                ejemplos:["Haku, prepara estas dos reservas. Ana Pérez, CAB 3, 13 al 14/11/2026. Rosa Vega, CAB 4, 13 al 15/11/2026."]},
            {titulo:"Abrir ficha o ubicar una reserva para editar",detalle:"Indica titular, cabaña y fecha, o el código. La ficha ofrece el editor y las acciones de estado.",
                ejemplos:["Haku, abre la ficha de Ana Pérez en CAB 3 el 13/11/2026","Haku, modifca reserva Ana Pérez CAB 3 del 13/11/2026"]},
            {titulo:"Cambiar total de alojamiento",detalle:"Muestra total actual, nuevo total y fechas. Si coincide la reserva y la operación es compatible, puedes confirmar uno o varios cambios.",
                ejemplos:["Haku, cambia el precio del CAB 10 de Ana Pérez de hoy a CLP 180.000","Haku, modifca el total de CAB10 Ana Pérez hoy a 180 lucas"]},
            {titulo:"Marcar ingresos como hospedados",detalle:"Prepara el check-in de las reservas de ingreso para la fecha y cabañas solicitadas.",
                ejemplos:["Haku, marca como hospedadas las reservas que ingresan hoy en CAB 3"]}
        ]},
        {nombre:"Servicios",acciones:[
            {titulo:"Horarios libres de tinajas",detalle:"Consulta ambos tipos o elige Tónel o Jacuzzi para una fecha.",
                ejemplos:["Haku, ¿qué horas tiene libres el Tónel mañana?","Haku, pásame los horarios de las tinajas de hoy"]},
            {titulo:"Agendar o agregar un servicio",detalle:"Indica cabaña, tipo y hora. Usa hoy si omites el día. El formulario permite revisar catálogo, titular, personas y cobro.",
                ejemplos:["Haku, ingresaservicio tinaja las 20.45 tonel en cab 3","Haku, agenda un masaje terapéutico 60 min para mañana a las 11:00 en CAB 3"]},
            {titulo:"Cambiar tinaja a cortesía o cobro normal",detalle:"Indica la tinaja existente, titular y datos de horario. El cobro normal prepara el cargo del servicio.",
                ejemplos:["Haku, pasa la tinaja Tónel de Ana Pérez CAB 3 del 12/11/2026 a las 20:00 a cortesía","Haku, cambia la tinaja Tónel de Ana Pérez CAB 3 del 12/11/2026 a las 20:00 a cobro normal"]},
            {titulo:"Cancelar o reactivar un servicio",detalle:"Identifica el servicio existente por cabaña, fecha y hora. Haku muestra el cambio para revisar.",
                ejemplos:["Haku, cancela la tinaja Tónel de CAB 3 del 12/11/2026 a las 20:00","Haku, reactiva la tinaja Tónel de CAB 3 del 12/11/2026 a las 20:00"]},
            {titulo:"Marcar un servicio realizado",detalle:"Identifica el servicio por tipo, cabaña, fecha y hora. La vista previa comprueba el horario y el estado.",
                ejemplos:["Haku, marca como realizado el masaje de CAB 3 del 12/11/2026 a las 16:00"]}
        ]},
        {nombre:"Pagos y BOVE",acciones:[
            {titulo:"Registrar un pago en una reserva existente",detalle:"Adjunta el comprobante o escribe titular, cabaña, fecha de pago, monto, medio y referencia del medio. Revisa el destino antes de confirmar.",
                ejemplos:["Haku, ingresa este pago","Haku, registra un abono de $30.000 en efectivo pagado hoy por Ana Pérez, CAB 3"]},
            {titulo:"Registrar varios abonos",detalle:"Pega cada pago en su línea o adjunta los comprobantes. Haku separa importes y reservas para la confirmación.",
                ejemplos:["Haku, carga estos pagos a reservas existentes"]},
            {titulo:"Buscar, comparar y revisar BOVE",detalle:"Busca uno o varios números, consulta el último registrado, los pendientes o las diferencias con el Libro.",
                ejemplos:["Haku, busca BOVE 16989","Haku, ¿cuál es el último BOVE?","Haku, ¿qué BOVE están pendientes hoy?","Haku, compara los BOVE del Libro con Proyecto H"]},
            {titulo:"Preparar un BOVE",detalle:"Haku comprueba número, destino y posibles conflictos. El flujo de chat llega a la vista previa.",
                ejemplos:["Haku, ponle BOVE 16989 de alojamiento a CAB 6 del 12 de noviembre de 2026"]}
        ]},
        {nombre:"Libro de Reserva",acciones:[
            {titulo:"Hojas y datos de una reserva",detalle:"Consulta la copia cargada por hoja, cabaña, fecha o titular. Abre los detalles para ver notas, pagos y servicios leídos.",
                ejemplos:["Libro: lista las hojas","Libro: CAB 3 el 13/11/2026","Libro: reserva de Ana Pérez el 13/11/2026"]},
            {titulo:"Titulares y cabañas",detalle:"Pide el mes, un día o un rango. Incluye ingresos y salidas de las estadías que cruzan de mes.",
                ejemplos:["Haku, titulares y cabañas del mes actual","Haku, titulares del 13 al 15 de noviembre de 2026","Haku, titulares de Proyecto H el 13/11/2026"]},
            {titulo:"Buscar un titular en todo el año",detalle:"Recorre las hojas mensuales disponibles para un titular o varios nombres.",
                ejemplos:["Libro: busca reservas a nombre de Ana Pérez durante el año 2026"]},
            {titulo:"Comparar reservas, titulares y bloqueos",detalle:"Cruza el Libro con Proyecto H. Las diferencias pueden abrir la preparación de incorporación o la revisión manual.",
                ejemplos:["Libro: compara las reservas de noviembre de 2026 con Proyecto H","Haku, compara titulares del mes actual con Proyecto H"]},
            {titulo:"Comparar pagos y abonos",detalle:"Cruza los comprobantes por fecha de pago. También puedes acotar a una reserva o a una cabaña.",
                ejemplos:["Libro: compara pagos del mes actual con Proyecto H","Libro: compara pagos de CAB 3 el 13/11/2026 con Proyecto H"]},
            {titulo:"Comparar servicios y notas",detalle:"Revisa lo que falta, cambió o ya está en Proyecto H. Los casos que requieren datos abren revisión manual.",
                ejemplos:["Libro: compara servicios y notas de noviembre de 2026 con Proyecto H"]},
            {titulo:"Cambios del Libro e incorporación pendiente",detalle:"Consulta lo que cambió entre versiones, incluidos pendientes anteriores, cancelaciones y abonos por revisar.",
                ejemplos:["Haku, informe de actualización","Libro: cambios de noviembre de 2026"]}
        ]},
        {nombre:"Capturas, documentos y guías",acciones:[
            {titulo:"Revisar una captura",detalle:"Adjunta una imagen de reserva o comprobante y describe qué quieres extraer o preparar.",
                atajo:"revisar-captura",rotulo:"Adjuntar captura"},
            {titulo:"Importar un listado de Cloudbeds",detalle:"Adjunta capturas del listado o de Actividad de hoy. Haku prepara las reservas y muestra las filas que debes revisar.",
                ejemplos:["Haku, lee este listado de reservas de Cloudbeds","Haku, revisa la captura de Actividad de hoy"]},
            {titulo:"Comparar tarifas con un PDF de Cloudbeds",detalle:"Adjunta el PDF del listado. Haku cruza importes y estadías y prepara los ajustes compatibles.",
                atajo:"consultar-documento",rotulo:"Adjuntar PDF"},
            {titulo:"Ingresos Manager",detalle:"Abre la guía operativa de ingreso de pagos en Manager.",atajo:"ingresos-manager",rotulo:"Abrir guía"},
            {titulo:"Proceso de reservas",detalle:"Abre la guía de recepción y registro de reservas.",atajo:"proceso-reservas",rotulo:"Abrir guía"}
        ]},
        {nombre:"Pendiente por chat",acciones:[
            {titulo:"Editar campos de una reserva",detalle:"Fechas, cabaña, titular, contacto, ocupación y tarifas por noche se editan en la ficha. Haku puede localizarla."},
            {titulo:"Cambiar otros estados de reserva",detalle:"Check-out, cancelación, reactivación y no-show se realizan desde la ficha. El informe del Libro tiene su propio flujo de cancelaciones."},
            {titulo:"Editar, anular o reembolsar un pago",detalle:"Usa Pagos o la ficha. Haku puede registrar y comparar abonos."},
            {titulo:"Guardar un BOVE desde el chat",detalle:"El comando prepara la validación. Usa Pagos o Cierre para guardar."},
            {titulo:"Reprogramar un servicio existente",detalle:"El cambio directo de fecha, hora o profesional se hace en Servicios. La consulta de horarios por chat cubre tinajas."},
            {titulo:"Registrar aseo, revisión, bloqueos o notas por orden libre",detalle:"Usa el módulo operativo correspondiente. Las notas y los bloqueos del Libro se revisan desde su comparación."},
            {titulo:"Cobrar al huésped o enviar mensajes",detalle:"Haku registra comprobantes y consulta datos del panel. Los cobros y mensajes se hacen en sus canales."}
        ]}
    ];

    const normalizar=valor=>String(valor || "").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
    function mostrar({mensajes,campo,ejecutar}) {
        const doc=mensajes.ownerDocument;
        mensajes.querySelector("[data-haku-ayuda]")?.remove();
        const crear=(tag,texto,clase) => {
            const el=doc.createElement(tag);
            if (texto) el.textContent=texto;
            if (clase) el.className=clase;
            return el;
        };
        const panel=crear("section","","haku-ayuda");
        panel.dataset.hakuAyuda="1";
        panel.setAttribute("aria-label","Ayuda de Haku");
        const cab=crear("header","","haku-ayuda__cabecera");
        const cerrar=crear("button","×");
        cerrar.type="button";
        cerrar.setAttribute("aria-label","Cerrar Ayuda");
        cerrar.addEventListener("click",()=>{panel.remove();campo.focus();});
        cab.append(crear("h2","Ayuda"),cerrar);
        const descripcion=crear("p","Escribe como hablas. Para una reserva o servicio, indica la cabaña, el día y el titular si lo sabes. Revisa la vista previa o el formulario antes de guardar.");
        const busqueda=crear("input");
        busqueda.type="search";
        busqueda.setAttribute("aria-label","Buscar una acción de Haku");
        busqueda.placeholder="Buscar una acción…";
        const vacio=crear("p","No encontré una acción con esa búsqueda.");
        vacio.hidden=true;
        vacio.setAttribute("role","status");
        panel.append(cab,descripcion,busqueda,vacio);
        const grupos=secciones.map((grupo,i)=>{
            const detalle=crear("details");
            detalle.open=i===0;
            const lista=crear("ul");
            const acciones=grupo.acciones.map(accion=>{
                const li=crear("li");
                li.append(crear("strong",accion.titulo),crear("p",accion.detalle));
                const usar=(texto,evento)=>{
                    const boton=crear("button",texto);
                    boton.type="button";
                    boton.addEventListener("click",evento);
                    li.append(boton);
                };
                for (const ejemplo of accion.ejemplos || []) usar(ejemplo,()=>{
                    if (campo.disabled) return;
                    campo.value=ejemplo;
                    campo.dispatchEvent(new root.Event("input",{bubbles:true}));
                    campo.focus();
                });
                if (accion.atajo) usar(accion.rotulo,()=>ejecutar(accion.atajo));
                lista.append(li);
                return {li,contenido:normalizar([grupo.nombre,accion.titulo,accion.detalle,...(accion.ejemplos || [])].join(" "))};
            });
            detalle.append(crear("summary",grupo.nombre),lista);
            panel.append(detalle);
            return {detalle,acciones,abierto:detalle.open};
        });
        let filtrando=false;
        busqueda.addEventListener("input",()=>{
            const consulta=normalizar(busqueda.value).split(/\s+/).filter(Boolean);
            let total=0;
            for (const g of grupos) {
                if (!filtrando) g.abierto=g.detalle.open;
                for (const a of g.acciones) a.li.hidden=!consulta.every(p=>a.contenido.includes(p));
                const visibles=g.acciones.filter(a=>!a.li.hidden).length;
                g.detalle.hidden=!visibles;
                g.detalle.open=consulta.length ? Boolean(visibles) : g.abierto;
                total+=visibles;
            }
            filtrando=Boolean(consulta.length);
            vacio.hidden=Boolean(total);
        });
        mensajes.append(panel);
        panel.scrollIntoView?.({block:"nearest"});
        busqueda.focus({preventScroll:true});
        return panel;
    }

    const api=Object.freeze({secciones,mostrar});
    root.HAIKU_AYUDA_V1=api;
    if (typeof module!=="undefined") module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
