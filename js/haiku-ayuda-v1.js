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
                ejemplos:["Haku, ¿quién estuvo antes que Ana Pérez en CAB 3?","Haku, ¿quién revisó el aseo después del check-out de Ana Pérez en CAB 3?"]},
            {titulo:"Registrar aseo",detalle:"Indica IN, OUT y encargado según corresponda. También puedes marcar No requiere cuando el aseo está sin horas.",
                ejemplos:["Haku, registra aseo de CAB 3 hoy IN 10:00 OUT 11:30 encargado María Paz","Haku, marca aseo no requiere de CAB 3 hoy"]},
            {titulo:"Iniciar o cambiar el estado de una revisión",detalle:"Inicia una revisión completa o un repaso. Para actualizar un ciclo existente, indica completa, express o repaso si hay más de uno.",
                ejemplos:["Haku, inicia revisión completa de CAB 3 hoy","Haku, marca revisión express lista de CAB 3 hoy"]},
            {titulo:"Guardar notas",detalle:"Pon el texto después de «:». Para asociarlo a la reserva, agrega el titular o pide una nota de reserva.",
                ejemplos:["Haku, anota nota de CAB 3 hoy: Dejar dos batas","Haku, guarda nota de reserva de Ana Pérez CAB 3 hoy: Pasa por recepción"]},
            {titulo:"Bloquear una cabaña",detalle:"Para un día, indica la fecha. Para varios días, indica desde cuándo queda bloqueada y la fecha en que vuelve a estar disponible.",
                ejemplos:["Haku, bloquea CAB 3 mañana por mantención","Haku, bloquea CAB 3 del 15 al 17 de noviembre de 2026 por mantención"]}
        ]},
        {nombre:"Reservas",acciones:[
            {titulo:"Crear una reserva o Full Day",detalle:"Prepara la vista previa con titular, ingreso, salida, cabaña y ocupación. Puedes añadir acompañantes y abonos con respaldo.",
                ejemplos:["Haku, prepara una reserva para Ana Pérez del 13 al 14 de noviembre de 2026 en CAB 3 para 2 adultos","Haku, crea un Full Day para Ana Pérez el 13/11/2026 en CAB 3 para 2 adultos"]},
            {titulo:"Crear varias reservas",detalle:"Pega las reservas en líneas separadas o adjunta capturas. La vista previa separa los datos y permite revisar el lote.",
                ejemplos:["Haku, prepara estas dos reservas. Ana Pérez, CAB 3, 13 al 14/11/2026. Rosa Vega, CAB 4, 13 al 15/11/2026."]},
            {titulo:"Abrir ficha o ubicar una reserva para editar",detalle:"Indica titular, cabaña y fecha, o el código. La ficha ofrece el editor y las acciones de estado.",
                ejemplos:["Haku, abre la ficha de Ana Pérez en CAB 3 el 13/11/2026","Haku, modifca reserva Ana Pérez CAB 3 del 13/11/2026"]},
            {titulo:"Editar fechas o cabaña",detalle:"Indica primero la reserva actual. Después de «a» o «para», escribe el destino. Revisa las fechas y el total antes de guardar.",
                ejemplos:["Haku, cambia la cabaña de Ana Pérez CAB 3 hoy a CAB 4","Haku, cambia las fechas de CAB 3 Ana Pérez hoy al 15/11/2026 hasta el 17/11/2026"]},
            {titulo:"Editar titular, contacto u ocupación",detalle:"Usa el nombre del campo y luego el valor nuevo. Para la ocupación puedes indicar adultos, niños o mascotas.",
                ejemplos:["Haku, corrige el titular de CAB 3 hoy a Ana María Pérez","Haku, cambia el correo de CAB 3 hoy a reservas@example.com","Haku, deja la ocupación de CAB 3 hoy en 2 adultos y 1 niño"]},
            {titulo:"Cambiar tarifa por noche",detalle:"Indica una noche concreta o aplica la misma tarifa a todas. Haku muestra el efecto en el total de alojamiento.",
                ejemplos:["Haku, fija la tarifa por noche de Ana Pérez CAB 3 hoy a 180 lucas","Haku, cambia la tarifa de la noche del 13/11/2026 de Ana Pérez CAB 3 a $180.000"]},
            {titulo:"Cambiar total de alojamiento",detalle:"Muestra total actual, nuevo total y fechas. Si coincide la reserva y la operación es compatible, puedes confirmar uno o varios cambios.",
                ejemplos:["Haku, cambia el precio del CAB 10 de Ana Pérez de hoy a CLP 180.000","Haku, modifca el total de CAB10 Ana Pérez hoy a 180 lucas"]},
            {titulo:"Marcar ingresos como hospedados",detalle:"Prepara el check-in de las reservas de ingreso para la fecha y cabañas solicitadas.",
                ejemplos:["Haku, marca como hospedadas las reservas que ingresan hoy en CAB 3"]},
            {titulo:"Check-out, No Show, cancelar o reactivar",detalle:"Muestra el estado anterior y el nuevo. La reactivación comprueba abonos, bloqueos y disponibilidad.",
                ejemplos:["Haku, haz el check-out de CAB 3 hoy","Haku, marca No Show de la reserva de Ana Pérez CAB 3 hoy","Haku, cancela reserva de Ana Pérez CAB 3 hoy","Haku, reactiva reserva de Ana Pérez CAB 3 hoy"]}
        ]},
        {nombre:"Servicios",acciones:[
            {titulo:"Horarios libres de tinajas",detalle:"Consulta ambos tipos o elige Tónel o Jacuzzi para una fecha.",
                ejemplos:["Haku, ¿qué horas tiene libres el Tónel mañana?","Haku, pásame los horarios de las tinajas de hoy"]},
            {titulo:"Consultar agenda de masajes y servicios",detalle:"Muestra las citas registradas. Confirma los horarios libres de masaje con el profesional.",
                ejemplos:["Haku, dame los horarios de masajes de mañana","Haku, consulta la agenda de servicios del 15/11/2026"]},
            {titulo:"Reprogramar un servicio",detalle:"Identifica el servicio programado por cabaña, día y hora original si hay varios. Conserva duración e importe.",
                ejemplos:["Haku, mueve el Tónel de CAB 3 hoy a las 20:45","Haku, reprograma el masaje de CAB 3 hoy de las 11:00 para mañana a las 12:00"]},
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
            {titulo:"Corregir un pago",detalle:"Identifica el pago con folio, CodAut o referencia. En abonos puedes corregir monto o fecha. También puedes corregir el medio y sus referencias.",
                ejemplos:["Haku, corrige el abono folio 00123 de CAB 3 hoy a $90.000","Haku, cambia el pago folio 00123 de CAB 3 hoy a folio 00124"]},
            {titulo:"Anular un registro de pago",detalle:"Incluye el motivo si ya estaba confirmado. El movimiento se conserva en el historial.",
                ejemplos:["Haku, anula el pago folio 00123 de CAB 3 hoy motivo: Registro duplicado","Haku, anula WebPay pendiente CodAut 001234"]},
            {titulo:"Preparar y registrar un reembolso",detalle:"Para reembolsar, prepara los datos del pago y devuelve el dinero en el medio original. Registra luego la devolución completa con su comprobante.",
                ejemplos:["Haku, reembolsa el abono folio 00123 de CAB 3 hoy","Haku, registra devolución del abono folio 00123 de CAB 3 hoy, fecha 12/11/2026, medio transferencia, comprobante DEV-123, motivo: Cobro duplicado"]},
            {titulo:"Buscar, comparar y revisar BOVE",detalle:"Busca uno o varios números, consulta el último registrado, los pendientes o las diferencias con el Libro.",
                ejemplos:["Haku, busca BOVE 16989","Haku, ¿cuál es el último BOVE?","Haku, ¿qué BOVE están pendientes hoy?","Haku, compara los BOVE del Libro con Proyecto H"]},
            {titulo:"Guardar un BOVE",detalle:"Indica número y alcance. Haku comprueba la reserva, el pago completo y el Libro antes de habilitar la confirmación.",
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
            {titulo:"Informes Cloudbeds",detalle:"Adjunta uno o varios PDF de Reservas o Notas y XLSX de Transacciones o Cancelaciones. Haku compara los datos con Proyecto H y el Libro.",
                ejemplos:["Haku, contrasta estos informes Cloudbeds con el Libro","Haku, revisa las transacciones de Cloudbeds"],atajo:"informes-cloudbeds",rotulo:"Adjuntar informes"},
            {titulo:"Ingresos Manager",detalle:"Abre la guía operativa de ingreso de pagos en Manager.",atajo:"ingresos-manager",rotulo:"Abrir guía"},
            {titulo:"Proceso de reservas",detalle:"Abre la guía de recepción y registro de reservas.",atajo:"proceso-reservas",rotulo:"Abrir guía"}
        ]},
        {nombre:"Contacto con huéspedes",acciones:[
            {titulo:"Preparar un cobro de saldo",detalle:"Usa el saldo que figura en la ficha y el teléfono del titular. Haku prepara el texto para abrirlo en WhatsApp.",
                ejemplos:["Haku, cobra el saldo de Ana Pérez CAB 3 hoy"]},
            {titulo:"Redactar un WhatsApp o correo",detalle:"Indica la reserva, el canal y el texto después de «:». Revisa el destinatario y envía desde tu aplicación.",
                ejemplos:["Haku, envía WhatsApp a CAB 3 hoy: Hola, ¿a qué hora estiman llegar?","Haku, prepara correo a Ana Pérez CAB 3 hoy: Tu reserva está confirmada."]}
        ]},
        {nombre:"Casos que requieren otro canal",acciones:[
            {titulo:"Ejecutar cobros o devoluciones",detalle:"Procesa el dinero en el medio de pago. Haku prepara los datos y puede registrar el comprobante de una devolución completa."},
            {titulo:"Pagos y BOVE conjuntos",detalle:"En Pagos por titular puedes revisar la distribución entre cabañas y registrar el BOVE del grupo."},
            {titulo:"Confirmar horarios o cambiar profesional de masaje",detalle:"La disponibilidad del profesional se coordina con su agenda. Haku muestra las citas que están en Proyecto H."}
        ]}
    ];

    const normalizar=valor=>String(valor || "").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
    const cantidad=n=>n===1?"1 acción":`${n} acciones`;

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
        const boton=(texto,clase,etiqueta)=>{
            const el=crear("button",texto,clase);
            el.type="button";
            if (etiqueta) el.setAttribute("aria-label",etiqueta);
            return el;
        };
        const indicador=texto=>{
            const el=crear("span",texto,"haku-ayuda__indicador");
            el.setAttribute("aria-hidden","true");
            return el;
        };
        const encabezado=crear("div","","haku-ayuda__encabezado");
        const cabecera=crear("header","","haku-ayuda__cabecera");
        const identidad=crear("div","","haku-ayuda__identidad");
        const titulo=crear("h2","Ayuda");
        titulo.tabIndex=-1;
        identidad.append(titulo,crear("p","Elige un ejemplo para llevarlo al borrador."));
        const cerrar=boton("×","haku-ayuda__icono","Cerrar Ayuda");
        const cerrarAyuda=()=>{panel.remove();campo.focus();};
        cerrar.addEventListener("click",cerrarAyuda);
        cabecera.append(identidad,cerrar);

        const buscador=crear("div","","haku-ayuda__buscador");
        const busqueda=crear("input");
        busqueda.type="search";
        busqueda.setAttribute("aria-label","Buscar una acción de Haku");
        busqueda.placeholder="Buscar una acción…";
        const limpiar=boton("×","haku-ayuda__limpiar","Limpiar búsqueda");
        buscador.append(busqueda,limpiar);

        const selector=crear("div","","haku-ayuda__selector");
        const categorias=crear("select");
        categorias.setAttribute("aria-label","Categoría de ayuda");
        selector.append(categorias,indicador("⌄"));
        encabezado.append(cabecera,buscador,selector);

        const contenido=crear("div","","haku-ayuda__contenido");
        const nav=crear("nav","","haku-ayuda__categorias");
        nav.setAttribute("aria-label","Categorías de ayuda");
        nav.append(crear("p","Categorías","haku-ayuda__etiqueta"));
        const resultados=crear("div","","haku-ayuda__resultados");
        const estado=crear("p","","haku-ayuda__estado");
        estado.setAttribute("role","status");
        resultados.append(estado);
        contenido.append(nav,resultados);
        panel.append(encabezado,contenido);

        let activa=0;
        const grupos=secciones.map((grupo,i)=>{
            const seccion=crear("section","","haku-ayuda__grupo");
            seccion.id=`haku-ayuda-grupo-${i}`;
            const meta=crear("header","","haku-ayuda__grupo-cabecera");
            const h3=crear("h3",grupo.nombre);
            h3.id=`haku-ayuda-categoria-${i}`;
            seccion.setAttribute("aria-labelledby",h3.id);
            const totalGrupo=crear("small");
            meta.append(h3,totalGrupo);
            const opcion=crear("option",grupo.nombre);
            opcion.value=String(i);
            categorias.append(opcion);
            const categoria=boton(grupo.nombre,"haku-ayuda__categoria");
            categoria.setAttribute("aria-controls",seccion.id);
            categoria.addEventListener("click",()=>seleccionar(i));
            nav.append(categoria);
            const lista=crear("ul","","haku-ayuda__acciones");
            const acciones=grupo.acciones.map(accion=>{
                const li=crear("li");
                const detalle=crear("details");
                detalle.setAttribute("name",seccion.id);
                const resumen=crear("summary");
                resumen.append(crear("span",accion.titulo),indicador("⌄"));
                const cuerpo=crear("div","","haku-ayuda__detalle");
                cuerpo.append(crear("p",accion.detalle));
                const usar=(texto,evento)=>{
                    const control=boton("","haku-ayuda__ejemplo");
                    control.append(crear("span",texto),indicador("↵"));
                    control.addEventListener("click",evento);
                    cuerpo.append(control);
                };
                for (const ejemplo of accion.ejemplos || []) usar(ejemplo,()=>{
                    if (campo.disabled) return;
                    campo.value=ejemplo;
                    campo.dispatchEvent(new root.Event("input",{bubbles:true}));
                    campo.focus();
                });
                if (accion.atajo) usar(accion.rotulo,()=>ejecutar(accion.atajo));
                detalle.append(resumen,cuerpo);
                li.append(detalle);
                lista.append(li);
                return {li,detalle,contenido:normalizar([grupo.nombre,accion.titulo,accion.detalle,accion.rotulo,...(accion.ejemplos || [])].join(" "))};
            });
            seccion.append(meta,lista);
            resultados.append(seccion);
            return {seccion,totalGrupo,categoria,acciones};
        });

        function actualizar() {
            const consulta=normalizar(busqueda.value).split(/\s+/).filter(Boolean);
            const buscando=Boolean(consulta.length), coincidencias=[];
            panel.classList.toggle("haku-ayuda--buscando",buscando);
            limpiar.hidden=!busqueda.value;
            estado.hidden=!buscando;
            categorias.value=String(activa);
            for (const [i,g] of grupos.entries()) {
                const visibles=g.acciones.filter(a=>consulta.every(p=>a.contenido.includes(p)));
                for (const a of g.acciones) a.li.hidden=!visibles.includes(a);
                g.seccion.hidden=buscando ? visibles.length===0 : i!==activa;
                g.categoria.setAttribute("aria-pressed",String(i===activa));
                g.totalGrupo.textContent=cantidad(visibles.length);
                if (buscando) coincidencias.push(...visibles);
            }
            estado.textContent=coincidencias.length ? cantidad(coincidencias.length)+(coincidencias.length===1?" encontrada":" encontradas") :
                "No encontré una acción con esa búsqueda.";
            if (coincidencias.length===1) coincidencias[0].detalle.open=true;
        }
        function seleccionar(i) {
            activa=i;
            busqueda.value="";
            actualizar();
        }
        function limpiarBusqueda() {
            busqueda.value="";
            actualizar();
            busqueda.focus();
        }
        categorias.addEventListener("change",()=>seleccionar(Number(categorias.value)));
        busqueda.addEventListener("input",actualizar);
        limpiar.addEventListener("click",limpiarBusqueda);
        panel.addEventListener("keydown",evento=>{
            if (evento.key!=="Escape") return;
            evento.preventDefault();
            evento.stopPropagation();
            if (busqueda.value) limpiarBusqueda();
            else cerrarAyuda();
        });
        actualizar();
        mensajes.append(panel);
        panel.scrollIntoView?.({block:"start"});
        const movil=doc.documentElement.dataset.hakuMobileAssistant==="1" ||
            root.matchMedia?.("(max-width: 700px), (pointer: coarse)")?.matches;
        (movil ? titulo : busqueda).focus({preventScroll:true});
        return panel;
    }

    const api=Object.freeze({secciones,mostrar});
    root.HAIKU_AYUDA_V1=api;
    if (typeof module!=="undefined") module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
