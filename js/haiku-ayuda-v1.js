// Catálogo de los flujos que Haku puede abrir desde el panel.
(function (root) {
    "use strict";

    const completar = (rotulo, texto, predeterminados = {}) => ({ rotulo, texto, predeterminados });
    const adjuntar = (rotulo, texto, archivo = "revisar-captura") => ({ rotulo, texto, archivo });

    const secciones = [
        {nombre:"Operación del día",acciones:[
            {titulo:"Resumen del día",detalle:"Ingresos, salidas, estadías en curso, servicios, notas y cobros pendientes.",
                ejemplos:["Haku, resumen de hoy","Haku, resumen operativo de mañana"]},
            {titulo:"Ingresos",detalle:"Muestra quién llega, su cabaña y el estado de la reserva.",
                ejemplos:["Haku, dame los ingresos de hoy","Haku, ingrseos de mañana"]},
            {titulo:"Salidas y estadías que continúan",detalle:"Elige salidas o huéspedes que se quedan en la fecha que indiques.",
                ejemplos:["Haku, pásame las salidas de mañana","Haku, ¿qué reservas continúan hoy?"]},
            {titulo:"Cabañas disponibles",detalle:"Consulta disponibilidad para vender en una fecha.",
                ejemplos:[
                    "Haku, ¿qué cabañas quedan libres mañana?",
                    completar("Consultar otra fecha", "Haku, dime las cabañas disponibles el {Fecha}")
                ]},
            {titulo:"Confirmadas sin abono",detalle:"Revisa reservas confirmadas pendientes de su primer pago. Puedes incluir fechas pasadas.",
                ejemplos:["Haku, muéstrame las reservas confirmadas sin abono"]},
            {titulo:"Aseo, revisión y horarios",detalle:"Consulta quién limpió o revisó, tiempos, hora de ingreso y detalles de una cabaña.",
                ejemplos:[
                    completar("Quién hizo el aseo", "Haku, ¿quién hizo el aseo de CAB {Cabaña} el {Fecha}?"),
                    completar("Cuánto duró el aseo", "Haku, ¿cuánto duró el aseo de CAB {Cabaña} el {Fecha}?")
                ]},
            {titulo:"Checklist y aseo express",detalle:"Abre el detalle registrado del checklist o compara el aseo con el Libro.",
                ejemplos:[
                    completar("Ver checklist express", "Haku, checklist de aseo express de CAB {Cabaña} el {Fecha}"),
                    completar("Comparar aseo con el Libro", "Haku, compara el aseo de CAB {Cabaña} el {Fecha}")
                ]},
            {titulo:"Huésped anterior y revisión tras la salida",detalle:"Ubica la estadía anterior o quién revisó después del check-out. Puedes pedir detalles de esa revisión en el mismo chat.",
                ejemplos:[
                    completar("Buscar al huésped anterior", "Haku, ¿quién estuvo antes que {Titular} en CAB {Cabaña}?"),
                    completar("Quién revisó tras el check-out", "Haku, ¿quién revisó el aseo después del check-out de {Titular} en CAB {Cabaña}?")
                ]},
            {titulo:"Registrar aseo",detalle:"Indica IN, OUT y encargado según corresponda. También puedes marcar No requiere cuando el aseo está sin horas.",
                ejemplos:[
                    completar("Registrar horario y encargado", "Haku, registra aseo de CAB {Cabaña} el {Fecha} IN {Hora de inicio} OUT {Hora de término} encargado {Encargado}"),
                    completar("Marcar aseo como No requiere", "Haku, marca aseo no requiere de CAB {Cabaña} el {Fecha}")
                ]},
            {titulo:"Iniciar o cambiar el estado de una revisión",detalle:"Inicia una revisión completa o un repaso. Para actualizar un ciclo existente, indica completa, express o repaso si hay más de uno.",
                ejemplos:[
                    completar("Iniciar revisión completa", "Haku, inicia revisión completa de CAB {Cabaña} el {Fecha}"),
                    completar("Marcar revisión express lista", "Haku, marca revisión express lista de CAB {Cabaña} el {Fecha}")
                ]},
            {titulo:"Guardar notas",detalle:"Pon el texto después de «:». Para asociarlo a la reserva, agrega el titular o pide una nota de reserva.",
                ejemplos:[
                    completar("Escribir nota operativa", "Haku, anota nota de CAB {Cabaña} el {Fecha}: {Nota}"),
                    completar("Escribir nota de reserva", "Haku, guarda nota de reserva de {Titular} CAB {Cabaña} el {Fecha}: {Nota}")
                ]},
            {titulo:"Bloquear una cabaña",detalle:"Para un día, indica la fecha. Para varios días, indica desde cuándo queda bloqueada y la fecha en que vuelve a estar disponible.",
                ejemplos:[
                    completar("Bloquear un día", "Haku, bloquea CAB {Cabaña} el {Fecha} por {Motivo}"),
                    completar("Bloquear por un período", "Haku, bloquea CAB {Cabaña} del {Fecha de inicio} al {Fecha de liberación} por {Motivo}")
                ]}
        ]},
        {nombre:"Reservas",acciones:[
            {titulo:"Crear una reserva o Full Day",detalle:"Prepara la vista previa con titular, ingreso, salida, cabaña y ocupación. Puedes añadir acompañantes y abonos con respaldo.",
                ejemplos:[
                    completar("Preparar reserva", "Haku, prepara una reserva para {Titular} del {Fecha de ingreso} al {Fecha de salida} en CAB {Cabaña} para {Adultos} adultos"),
                    completar("Preparar Full Day", "Haku, crea un Full Day para {Titular} el {Fecha} en CAB {Cabaña} para {Adultos} adultos")
                ]},
            {titulo:"Crear varias reservas",detalle:"Pega las reservas en líneas separadas o adjunta capturas. La vista previa separa los datos y permite revisar el lote.",
                ejemplos:[
                    completar("Escribir las reservas", "Haku, prepara estas reservas:\n{Reservas}")
                ]},
            {titulo:"Abrir ficha o ubicar una reserva para editar",detalle:"Indica titular, cabaña y fecha, o el código. La ficha ofrece el editor y las acciones de estado.",
                ejemplos:[
                    completar("Buscar por titular o código", "Haku, abre la ficha {Titular o código de reserva}"),
                    completar("Buscar por titular, cabaña y fecha", "Haku, abre la ficha de {Titular} en CAB {Cabaña} el {Fecha}")
                ]},
            {titulo:"Editar fechas o cabaña",detalle:"Indica primero la reserva actual. Después de «a» o «para», escribe el destino. Revisa las fechas y el total antes de guardar.",
                ejemplos:[
                    completar("Cambiar de cabaña", "Haku, cambia la cabaña de {Titular} CAB {Cabaña actual} el {Fecha de la reserva} a CAB {Cabaña nueva}"),
                    completar("Cambiar las fechas de la estadía", "Haku, cambia las fechas de CAB {Cabaña} {Titular} el {Fecha de la reserva} del {Nuevo ingreso} al {Nueva salida}")
                ]},
            {titulo:"Editar titular, contacto u ocupación",detalle:"Usa el nombre del campo y luego el valor nuevo. Para la ocupación puedes indicar adultos, niños o mascotas.",
                ejemplos:[
                    completar("Corregir titular", "Haku, corrige el titular de CAB {Cabaña} el {Fecha} a {Nuevo titular}"),
                    completar("Cambiar correo", "Haku, cambia el correo de CAB {Cabaña} el {Fecha} a {Correo}"),
                    completar("Cambiar ocupación", "Haku, deja la ocupación de CAB {Cabaña} el {Fecha} en {Adultos} adultos y {Niños} niños")
                ]},
            {titulo:"Cambiar tarifa por noche",detalle:"Indica una noche concreta o aplica la misma tarifa a todas. Haku muestra el efecto en el total de alojamiento.",
                ejemplos:[
                    completar("Fijar tarifa para toda la estadía", "Haku, fija la tarifa por noche de {Titular} CAB {Cabaña} el {Fecha de la reserva} a ${Tarifa CLP}"),
                    completar("Cambiar la tarifa de una noche", "Haku, cambia la tarifa de la noche del {Fecha de la noche} de {Titular} CAB {Cabaña} a ${Tarifa CLP}")
                ]},
            {titulo:"Cambiar total de alojamiento",detalle:"Muestra total actual, nuevo total y fechas. Si coincide la reserva y la operación es compatible, puedes confirmar uno o varios cambios.",
                ejemplos:[
                    completar("Indicar el nuevo total", "Haku, cambia el total de {Titular} CAB {Cabaña} el {Fecha} a CLP {Total CLP}")
                ]},
            {titulo:"Marcar ingresos como hospedados",detalle:"Prepara el check-in de las reservas de ingreso para la fecha y cabañas solicitadas.",
                ejemplos:[
                    completar("Preparar el check-in", "Haku, marca como hospedadas las reservas que ingresan el {Fecha} en CAB {Cabaña}")
                ]},
            {titulo:"Check-out, No Show, cancelar o reactivar",detalle:"Muestra el estado anterior y el nuevo. La reactivación comprueba abonos, bloqueos y disponibilidad.",
                ejemplos:[
                    completar("Preparar check-out", "Haku, haz el check-out de CAB {Cabaña} el {Fecha}"),
                    completar("Marcar No Show", "Haku, marca No Show de la reserva de {Titular} CAB {Cabaña} el {Fecha}"),
                    completar("Cancelar reserva", "Haku, cancela reserva de {Titular} CAB {Cabaña} el {Fecha}"),
                    completar("Reactivar reserva", "Haku, reactiva reserva de {Titular} CAB {Cabaña} el {Fecha}")
                ]}
        ]},
        {nombre:"Servicios",acciones:[
            {titulo:"Horarios libres de tinajas",detalle:"Consulta ambos tipos o elige Tónel o Jacuzzi para una fecha.",
                ejemplos:["Haku, ¿qué horas tiene libres el Tónel mañana?","Haku, pásame los horarios de las tinajas de hoy"]},
            {titulo:"Consultar agenda de masajes y servicios",detalle:"Muestra las citas registradas. Confirma los horarios libres de masaje con el profesional.",
                ejemplos:[
                    "Haku, dame los horarios de masajes de mañana",
                    completar("Consultar agenda en otra fecha", "Haku, consulta la agenda de servicios del {Fecha}")
                ]},
            {titulo:"Reprogramar un servicio",detalle:"Identifica el servicio programado por cabaña, día y hora original si hay varios. Conserva duración e importe.",
                ejemplos:[
                    completar("Cambiar la hora del Tónel", "Haku, mueve el Tónel de CAB {Cabaña} el {Fecha} a las {Nueva hora}"),
                    completar("Reprogramar un masaje", "Haku, reprograma el masaje de CAB {Cabaña} el {Fecha actual} de las {Hora actual} para el {Nueva fecha} a las {Nueva hora}")
                ]},
            {titulo:"Agendar o agregar un servicio",detalle:"Indica cabaña, tipo y hora. Usa hoy si omites el día. El formulario permite revisar catálogo, titular, personas y cobro.",
                ejemplos:[
                    completar("Agendar tinaja", "Haku, agenda una tinaja {Tipo de tinaja} para {Fecha} a las {Hora} en CAB {Cabaña}", { Fecha: "hoy" }),
                    completar("Agendar masaje terapéutico", "Haku, agenda un masaje terapéutico {Minutos} min para {Fecha} a las {Hora} en CAB {Cabaña}", { Fecha: "hoy" })
                ]},
            {titulo:"Cambiar tinaja a cortesía o cobro normal",detalle:"Indica la tinaja existente, titular y datos de horario. El cobro normal prepara el cargo del servicio.",
                ejemplos:[
                    completar("Pasar tinaja a cortesía", "Haku, pasa la tinaja {Tipo de tinaja} de {Titular} CAB {Cabaña} del {Fecha} a las {Hora} a cortesía"),
                    completar("Pasar tinaja a cobro normal", "Haku, cambia la tinaja {Tipo de tinaja} de {Titular} CAB {Cabaña} del {Fecha} a las {Hora} a cobro normal")
                ]},
            {titulo:"Cancelar o reactivar un servicio",detalle:"Identifica el servicio existente por cabaña, fecha y hora. Haku muestra el cambio para revisar.",
                ejemplos:[
                    completar("Cancelar tinaja", "Haku, cancela la tinaja {Tipo de tinaja} de CAB {Cabaña} del {Fecha} a las {Hora}"),
                    completar("Reactivar tinaja", "Haku, reactiva la tinaja {Tipo de tinaja} de CAB {Cabaña} del {Fecha} a las {Hora}")
                ]},
            {titulo:"Marcar un servicio realizado",detalle:"Identifica el servicio por tipo, cabaña, fecha y hora. La vista previa comprueba el horario y el estado.",
                ejemplos:[
                    completar("Marcar masaje realizado", "Haku, marca como realizado el masaje de CAB {Cabaña} del {Fecha} a las {Hora}")
                ]}
        ]},
        {nombre:"Pagos y BOVE",acciones:[
            {titulo:"Registrar un pago en una reserva existente",detalle:"Adjunta el comprobante o escribe titular, cabaña, fecha de pago, monto, medio y referencia del medio. Revisa el destino antes de confirmar.",
                ejemplos:[
                    adjuntar("Adjuntar comprobante", "Haku, ingresa este pago"),
                    completar("Escribir los datos del abono", "Haku, registra un abono de ${Monto CLP} en {Medio y referencia del pago} pagado el {Fecha del pago} por {Titular}, CAB {Cabaña}")
                ]},
            {titulo:"Registrar varios abonos",detalle:"Pega cada pago en su línea o adjunta los comprobantes. Haku separa importes y reservas para la confirmación.",
                ejemplos:[
                    completar("Escribir los abonos", "Haku, carga estos pagos a reservas existentes:\n{Pagos}"),
                    adjuntar("Adjuntar comprobantes", "Haku, carga estos pagos a reservas existentes")
                ]},
            {titulo:"Corregir un pago",detalle:"Identifica el pago con folio, CodAut o referencia. En abonos puedes corregir monto o fecha. También puedes corregir el medio y sus referencias.",
                ejemplos:[
                    completar("Corregir monto del abono", "Haku, corrige el abono folio {Folio} de CAB {Cabaña} el {Fecha} a ${Monto CLP}"),
                    completar("Cambiar folio", "Haku, cambia el pago folio {Folio actual} de CAB {Cabaña} el {Fecha} a folio {Folio nuevo}")
                ]},
            {titulo:"Anular un registro de pago",detalle:"Incluye el motivo si ya estaba confirmado. El movimiento se conserva en el historial.",
                ejemplos:[
                    completar("Anular pago por folio", "Haku, anula el pago folio {Folio} de CAB {Cabaña} el {Fecha} motivo: {Motivo}"),
                    completar("Anular WebPay pendiente", "Haku, anula WebPay pendiente CodAut {Código de autorización}")
                ]},
            {titulo:"Preparar y registrar un reembolso",detalle:"Para reembolsar, prepara los datos del pago y devuelve el dinero en el medio original. Registra luego la devolución completa con su comprobante.",
                ejemplos:[
                    completar("Preparar reembolso", "Haku, reembolsa el abono folio {Folio} de CAB {Cabaña} el {Fecha}"),
                    completar("Registrar devolución realizada", "Haku, registra devolución del abono folio {Folio} de CAB {Cabaña} el {Fecha del abono}, fecha {Fecha de devolución}, medio {Medio de devolución}, comprobante {Comprobante}, motivo: {Motivo}")
                ]},
            {titulo:"Buscar, comparar y revisar BOVE",detalle:"Busca uno o varios números, consulta el último registrado, los pendientes o las diferencias con el Libro.",
                ejemplos:[
                    completar("Buscar por número BOVE", "Haku, busca BOVE {Números BOVE}"),
                    "Haku, ¿cuál es el último BOVE?",
                    "Haku, ¿qué BOVE están pendientes hoy?",
                    "Haku, compara los BOVE del Libro con Proyecto H"
                ]},
            {titulo:"Guardar un BOVE",detalle:"Indica número y alcance. Haku comprueba la reserva, el pago completo y el Libro antes de habilitar la confirmación.",
                ejemplos:[
                    completar("Preparar BOVE de alojamiento", "Haku, ponle BOVE {Número BOVE} de alojamiento a CAB {Cabaña} del {Fecha}")
                ]}
        ]},
        {nombre:"Libro de Reserva",acciones:[
            {titulo:"Hojas y datos de una reserva",detalle:"Consulta la copia cargada por hoja, cabaña, fecha o titular. Abre los detalles para ver notas, pagos y servicios leídos.",
                ejemplos:[
                    "Libro: lista las hojas",
                    completar("Buscar por cabaña y fecha", "Libro: CAB {Cabaña} el {Fecha}"),
                    completar("Buscar por titular y fecha", "Libro: reserva de {Titular} el {Fecha}")
                ]},
            {titulo:"Titulares y cabañas",detalle:"Pide el mes, un día o un rango. Incluye ingresos y salidas de las estadías que cruzan de mes.",
                ejemplos:[
                    "Haku, titulares y cabañas del mes actual",
                    completar("Consultar titulares por período", "Haku, titulares del {Fecha desde} al {Fecha hasta}"),
                    completar("Consultar titulares de Proyecto H", "Haku, titulares de Proyecto H el {Fecha}")
                ]},
            {titulo:"Buscar un titular en todo el año",detalle:"Recorre las hojas mensuales disponibles para un titular o varios nombres.",
                ejemplos:[
                    completar("Buscar titular por año", "Libro: busca reservas a nombre de {Titular} durante el año {Año}")
                ]},
            {titulo:"Comparar reservas, titulares y bloqueos",detalle:"Cruza el Libro con Proyecto H. Las diferencias pueden abrir la preparación de incorporación o la revisión manual.",
                ejemplos:[
                    completar("Comparar reservas de un mes", "Libro: compara las reservas de {Mes y año} con Proyecto H"),
                    "Haku, compara titulares del mes actual con Proyecto H"
                ]},
            {titulo:"Comparar pagos y abonos",detalle:"Cruza los comprobantes por fecha de pago. También puedes acotar a una reserva o a una cabaña.",
                ejemplos:[
                    "Libro: compara pagos del mes actual con Proyecto H",
                    completar("Comparar pagos por cabaña y fecha", "Libro: compara pagos de CAB {Cabaña} el {Fecha} con Proyecto H")
                ]},
            {titulo:"Comparar servicios y notas",detalle:"Revisa lo que falta, cambió o ya está en Proyecto H. Los casos que requieren datos abren revisión manual.",
                ejemplos:[
                    completar("Comparar servicios y notas de un mes", "Libro: compara servicios y notas de {Mes y año} con Proyecto H")
                ]},
            {titulo:"Cambios del Libro e incorporación pendiente",detalle:"Consulta lo que cambió entre versiones, incluidos pendientes anteriores, cancelaciones y abonos por revisar.",
                ejemplos:[
                    "Haku, informe de actualización",
                    completar("Consultar cambios de un mes", "Libro: cambios de {Mes y año}")
                ]}
        ]},
        {nombre:"Capturas, documentos y guías",acciones:[
            {titulo:"Revisar una captura",detalle:"Adjunta una imagen de reserva o comprobante y describe qué quieres extraer o preparar.",
                atajo:"revisar-captura",rotulo:"Adjuntar captura"},
            {titulo:"Importar un listado de Cloudbeds",detalle:"Adjunta capturas del listado o de Actividad de hoy. Haku prepara las reservas y muestra las filas que debes revisar.",
                ejemplos:[
                    adjuntar("Adjuntar listado de reservas", "Haku, lee este listado de reservas de Cloudbeds"),
                    adjuntar("Adjuntar captura de Actividad de hoy", "Haku, revisa la captura de Actividad de hoy")
                ]},
            {titulo:"Comparar tarifas con un PDF de Cloudbeds",detalle:"Adjunta el PDF del listado. Haku cruza importes y estadías y prepara los ajustes compatibles.",
                atajo:"consultar-documento",rotulo:"Adjuntar PDF"},
            {titulo:"Informes Cloudbeds",detalle:"Adjunta uno o varios PDF de Reservas o Notas y XLSX de Transacciones o Cancelaciones. Haku compara los datos con Proyecto H y el Libro.",
                ejemplos:[
                    adjuntar("Adjuntar transacciones", "Haku, revisa las transacciones de Cloudbeds", "informes-cloudbeds")
                ],atajo:"informes-cloudbeds",rotulo:"Adjuntar informes"},
            {titulo:"Ingresos Manager",detalle:"Abre la guía operativa de ingreso de pagos en Manager.",atajo:"ingresos-manager",rotulo:"Abrir guía"},
            {titulo:"Proceso de reservas",detalle:"Abre la guía de recepción y registro de reservas.",atajo:"proceso-reservas",rotulo:"Abrir guía"}
        ]},
        {nombre:"Contacto con huéspedes",acciones:[
            {titulo:"Preparar un cobro de saldo",detalle:"Usa el saldo que figura en la ficha y el teléfono del titular. Haku prepara el texto para abrirlo en WhatsApp.",
                ejemplos:[
                    completar("Preparar el cobro", "Haku, cobra el saldo de {Titular} CAB {Cabaña} el {Fecha}")
                ]},
            {titulo:"Redactar un WhatsApp o correo",detalle:"Indica la reserva, el canal y el texto después de «:». Revisa el destinatario y envía desde tu aplicación.",
                ejemplos:[
                    completar("Redactar WhatsApp", "Haku, envía WhatsApp a CAB {Cabaña} el {Fecha}: {Mensaje}"),
                    completar("Redactar correo", "Haku, prepara correo a {Titular} CAB {Cabaña} el {Fecha}: {Mensaje}")
                ]}
        ]},
        {nombre:"Casos que requieren otro canal",acciones:[
            {titulo:"Ejecutar cobros o devoluciones",detalle:"Procesa el dinero en el medio de pago. Haku prepara los datos y puede registrar el comprobante de una devolución completa."},
            {titulo:"Pagos y BOVE conjuntos",detalle:"En Pagos por titular puedes revisar la distribución entre cabañas y registrar el BOVE del grupo."},
            {titulo:"Confirmar horarios o cambiar profesional de masaje",detalle:"La disponibilidad del profesional se coordina con su agenda. Haku muestra las citas que están en Proyecto H."}
        ]}
    ];

    const normalizar=valor=>String(valor || "").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
    const cantidad=n=>n===1?"1 acción":`${n} acciones`;
    const marcadorCampo = /\{([^{}]+)\}/g;

    function pistaCampo(nombre) {
        if (/^(?:Fecha|Nuev[oa] (?:ingreso|salida|fecha))/.test(nombre)) return "dd/mm/aaaa";
        if (nombre.includes("hora") || nombre.startsWith("Hora")) return "HH:MM";
        if (nombre.startsWith("Cabaña")) return "Número";
        if (nombre === "Tipo de tinaja") return "Tónel o Jacuzzi";
        if (nombre === "Reservas") return "Una reserva por línea";
        if (nombre === "Pagos") return "Un abono por línea";
        return "";
    }

    function mostrar({mensajes,campo,ejecutar,enviarComando}) {
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
        identidad.append(titulo,crear("p","Elige una consulta o completa los datos de una acción."));
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

        let formulario = null;
        let controlActivo = null;

        function cerrarFormulario() {
            formulario?.remove();
            controlActivo?.setAttribute("aria-expanded", "false");
            controlActivo?.focus({ preventScroll: true });
            formulario = null;
            controlActivo = null;
        }

        function abrirFormulario(comando, control) {
            if (controlActivo === control) {
                formulario.querySelector("input, textarea").focus();
                return;
            }
            cerrarFormulario();
            formulario = crear("form", "", "haku-ayuda__formulario");
            formulario.setAttribute("aria-label", comando.rotulo);
            const campos = crear("div", "", "haku-ayuda__campos");
            const nombres = new Set([...comando.texto.matchAll(marcadorCampo)].map(m => m[1]));
            const entradas = new Map();
            for (const nombre of nombres) {
                const multilinea = ["Nota", "Mensaje", "Reservas", "Pagos"].includes(nombre);
                const etiqueta = crear("label", "", "haku-ayuda__campo");
                if (multilinea || /titular|motivo|referencia|correo/i.test(nombre)) etiqueta.classList.add("haku-ayuda__campo--ancho");
                const entrada = crear(multilinea ? "textarea" : "input");
                if (multilinea) entrada.rows = 2;
                else if (nombre === "Correo") entrada.type = "email";
                if (/^(?:Cabaña|Adultos|Niños|Minutos|Año|Folio|Número BOVE|Monto|Tarifa|Total)/.test(nombre)) entrada.inputMode = "numeric";
                entrada.required = !Object.hasOwn(comando.predeterminados, nombre);
                entrada.autocomplete = "off";
                entrada.placeholder = entrada.required ? pistaCampo(nombre) : "Hoy si la dejas vacía";
                entrada.addEventListener("input", () => entrada.setCustomValidity(""));
                etiqueta.append(crear("span", nombre), entrada);
                campos.append(etiqueta);
                entradas.set(nombre, entrada);
            }
            const acciones = crear("div", "", "haku-ayuda__formulario-acciones");
            const cancelar = boton("Cancelar");
            cancelar.addEventListener("click", cerrarFormulario);
            const enviar = boton("Enviar a Haku", "haku-ayuda__enviar");
            enviar.type = "submit";
            acciones.append(cancelar, enviar);
            const estadoEnvio = crear("p");
            estadoEnvio.setAttribute("role", "status");
            estadoEnvio.hidden = true;
            formulario.append(campos, acciones, estadoEnvio);
            formulario.addEventListener("submit", evento => {
                evento.preventDefault();
                for (const [nombre, entrada] of entradas) {
                    if (!entrada.required || entrada.value.trim()) continue;
                    entrada.setCustomValidity(`Completa ${nombre.toLowerCase()}.`);
                    entrada.reportValidity();
                    return;
                }
                const texto = comando.texto.replace(marcadorCampo, (_, nombre) =>
                    entradas.get(nombre).value.trim() || comando.predeterminados[nombre]);
                if (enviarComando(texto) === false) {
                    estadoEnvio.textContent = "Haku está atendiendo otra consulta. Vuelve a enviar en un momento.";
                    estadoEnvio.hidden = false;
                    return;
                }
                cerrarFormulario();
            });
            controlActivo = control;
            control.setAttribute("aria-expanded", "true");
            control.after(formulario);
            const primero = entradas.values().next().value;
            primero.style.scrollMarginBlockStart = `${encabezado.offsetHeight + 8}px`;
            primero.focus({ preventScroll: true });
            primero.scrollIntoView?.({ block: "nearest" });
        }

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
                const usar=(texto,marca,evento)=>{
                    const control=boton("","haku-ayuda__ejemplo");
                    const icono = indicador(marca);
                    if (marca === "Completar") icono.classList.add("haku-ayuda__completar");
                    control.append(crear("span",texto),icono);
                    control.addEventListener("click",()=>evento(control));
                    cuerpo.append(control);
                    return control;
                };
                const ejemplos = accion.ejemplos || [];
                for (const ejemplo of ejemplos) {
                    if (typeof ejemplo === "string") usar(ejemplo, "↵", () => enviarComando(ejemplo));
                    else if (ejemplo.archivo) usar(ejemplo.rotulo, "+", () => {
                        if (campo.disabled) return;
                        campo.value = ejemplo.texto;
                        campo.dispatchEvent(new root.Event("input", { bubbles: true }));
                        ejecutar(ejemplo.archivo);
                    });
                    else usar(ejemplo.rotulo, "Completar", control => abrirFormulario(ejemplo, control))
                        .setAttribute("aria-expanded", "false");
                }
                if (accion.atajo) usar(accion.rotulo,"↵",()=>ejecutar(accion.atajo));
                detalle.append(resumen,cuerpo);
                li.append(detalle);
                lista.append(li);
                const palabras = ejemplos.map(ejemplo => typeof ejemplo === "string" ? ejemplo : `${ejemplo.rotulo} ${ejemplo.texto}`);
                return {li,detalle,contenido:normalizar([grupo.nombre,accion.titulo,accion.detalle,accion.rotulo,...palabras].join(" "))};
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
            if (formulario?.contains(evento.target)) cerrarFormulario();
            else if (busqueda.value) limpiarBusqueda();
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
