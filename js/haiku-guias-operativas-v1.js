/* Guías locales de los manuales entregados por recepción. Sólo orientación: sin escrituras operativas. */
(function(root){
    'use strict';
    if(root.HAIKU_GUIAS_OPERATIVAS_V1)return;
    const fuentes={manager:'INGRESOS MANAGER.docx',reservas:'PROCESO DE RESERVAS.docx'};
    const paso=(titulo,items,datos=[],nota='')=>({titulo,items,datos,nota});
    const numeroTarjeta='Último dígito del año del cobro + código de autorización + mes (2 dígitos). Conserva los ceros del código; sustituye cada letra por 0.';
    const ejemploNumero='Ejemplo: cobro en diciembre de 2026, autorización 001234 → 600123412. No copies la fecha ni el código de los ejemplos del manual.';
    const verificarManager=paso('Comprobar el registro',[
        'Ve a Manager → Ventas → Menú de ventas → Impresión de caja.',
        'Abre Detalle de pago y verifica que figure pagado antes de retirarlo del listado con un clic.'
    ]);
    const conflictoEfectivo='Los manuales se contradicen: Ingresos Manager indica que el alojamiento en efectivo no se ingresa en Manager y lleva sólo boleta con el RUT de la Sra. Naifi; Proceso de reservas menciona Manager sin detallar el ingreso. Confirma esta regla con administración antes de hacer un asiento.';
    function transferencia(existente){return [
        paso(existente?'Abrir el comprobante del día':'Crear el comprobante',existente?[
            'Ve a Manager → Finanzas → Comprobantes. Pulsa la flecha hacia abajo, elige tipo I y OK.',
            'Abre el comprobante de la fecha que necesitas cargar. Selecciona y abre ARE; pulsa Ingresar.'
        ]:['Ve a Manager → Finanzas → Comprobantes → Ingresar.','Completa la cabecera y pulsa OK.'],existente?[]:[
            ['Glosa','Abono Clientes Reservas [fecha que indica el banco]'],['Tipo de comprobante','I']
        ]),
        paso('Ingresar el abono ARE',['Usa el RUT del titular de la reserva, aunque haya transferido otra persona.','Completa los campos y pulsa OTRO.'],[
            ['Tipo de documento','ARE'],['N.º de documento',existente?'Fecha del banco DDMMAA + correlativo que corresponda (ej.: 0112252).':'Fecha del banco en formato DDMMAA (ej.: 011225).'],
            ['Haiku','1'],['RUT','RUT del titular de la reserva'],['Glosa','Copia y pega el detalle del movimiento bancario'],['Haber','Monto reflejado en el banco']
        ]),
        paso('Cuadrar con ABB$',['Completa la contrapartida y usa Cuadrar H=D.'],[
            ['Tipo de documento','ABB$'],['N.º de documento','Fecha del banco en formato DDMMAA']
        ],'Si el comprobante ya existía, mantén la correlación indicada por Manager; no reemplaces un movimiento anterior.'),verificarManager
    ];}
    function webpay(tipo,futuro=false){return [
        paso(futuro?'Identificar la venta directa':'Obtener la cartola Transbank',futuro?[
            'Ten a mano la fecha de venta, tipo de tarjeta, autorización y monto del pago directo para una reserva futura.',
            'El manual indica registrarlo como WebPay: TXC + AC+P, tanto con débito como con crédito.'
        ]:[
            'En Transbank entra a Mis ventas → Cartola de movimientos. Elige la fecha o semana.',
            'Selecciona todos los comercios excepto 32161154 y descarga el informe.',
            `Ubica la venta${tipo?' con tarjeta de '+tipo:''}. Revisa fecha de venta, tipo de tarjeta, terminación, autorización y monto.`
        ]),
        paso('Crear el comprobante T',['Ve a Manager → Finanzas → Comprobantes → Ingresar. Completa y pulsa OK.'],[
            ['Glosa','Abono Clientes Reservas TBK [fecha de venta]'],['Tipo de comprobante','T']
        ]),
        paso('Ingresar TXC',['Completa la primera línea con los datos de la venta.'],[
            ['Tipo de documento','TXC'],['N.º de documento',numeroTarjeta],['Haiku','1'],
            ['Glosa','Folio << **** **** **** [últimos 4 dígitos] [marca de tarjeta]'],['Debe','Monto del informe']
        ],ejemploNumero+' El ejemplo TXC del documento empieza con 5, aunque su regla escrita indica 6 para 2026.'),
        paso('Completar AC+P',['Crea o selecciona al huésped en Manager.','Cuadra D=H y pulsa OK.'],[
            ['Tipo de documento','AC+P'],['N.º de documento','El mismo número usado en TXC'],['RUT','RUT del huésped']
        ]),verificarManager
    ];}
    function booking(virtual=false){return [
        paso('Crear el comprobante T',['En Manager → Finanzas → Comprobantes, pulsa Ingresar. Completa la cabecera y OK.'],[
            ['Glosa',virtual?'Abono Cliente Reserva Extranjero (cargo virtual)':'Abono Clientes Reserva Booking [fecha del cobro]'],
            ['Tipo de comprobante','T'],['Fecha','Fecha del cobro']
        ]),
        paso('Ingresar el cobro TCR',['Usa el monto efectivamente cobrado y pulsa OTRO.'],[
            ['Tipo de documento','TCR'],['N.º de documento',numeroTarjeta],['Haiku','1'],
            ['Glosa','Detalle de la reserva: CAB + noches + fecha de check-in'],['Debe','Monto cobrado']
        ],ejemploNumero),
        paso(virtual?'Completar AC+P':'Completar AC+B',['Usa el mismo número de documento de la línea TCR.','Cuadra D=H y pulsa OK.'],[
            ['Tipo de documento',virtual?'AC+P':'AC+B'],['N.º de documento','El mismo número usado en TCR'],
            ['RUT',virtual?'Este apartado del manual no especifica qué RUT usar; confírmalo con administración.':'66.666.666-6 para cliente residente · 55.555.555-5 para cliente extranjero']
        ],virtual?'El manual señala TCR + AC+P para cargo virtual. Los RUT genéricos de Booking están indicados para AC+B; no los traslades automáticamente a este caso.':''),verificarManager
    ];}
    function checkin(tipo){return [
        paso('Abrir el pago del BOVE',['Genera el BOVE. En Detalles de pago, selecciona Cancelar Varios.',
            'Haz doble clic en el E-Bove y cierra esa ventana. En la ventana que queda, pulsa Ingresar.']),
        paso('Registrar el saldo con '+tipo,['Completa el documento con los datos del cobro.','Cuadra D=H y pulsa OK.'],[
            ['Tipo de documento',tipo==='débito'?'RECO':'TCR'],['N.º de documento',numeroTarjeta],['Haiku','1'],
            ['Glosa','Detalle de la reserva: CAB + noches + fecha de check-in']
        ],ejemploNumero),verificarManager
    ];}
    const correoInicial=paso('Verificar el correo de reserva',[
        'Revisa nombre, correo, cantidad de personas, entrada, salida, noches y precio.',
        'Identifica el origen: motor Cloudbeds, Booking, Airbnb o reserva directa en recepción.'
    ]);
    const libro=paso('Ingresar la reserva al Libro',[
        'En Cloudbeds abre el huésped → Datos de la reserva → Detalles del huésped.',
        'Transcribe nombre, RUT, correo, teléfono, personas y noches en las celdas de la estadía.',
        'Agrega fecha de procesamiento e iniciales de quien la procesa. Escribe en rojo mascotas, cama adicional y solicitudes.',
        'Reserva pendiente de pago: rosa claro. Pagada y confirmada: morado claro. WebPay sin confirmar conserva el rosa claro.'
    ]);
    const correoPrereserva=paso('Enviar el detalle de pre-reserva',[
        'Responde el correo inicial y cambia el destinatario por el correo del huésped.',
        'Usa Confirmación pre-reserva de la plantilla general. Ajusta titular, fechas, noches, cabaña, tarifa y abono.',
        'Adjunta políticas, normativas y contrato de mascotas. Relee todo antes de enviar.',
        'Deja la etiqueta Pendiente de pago 50% o 100%, según corresponda.'
    ],[],'La plantilla general y los archivos para adjuntar no están incluidos en estos dos manuales; utiliza los documentos de recepción.');
    const pagoLibro=(titulo,descripcion,color)=>paso(titulo,descripcion,[
        ['1 · Fecha','Fecha real del pago o del banco según el medio'],['2 · Detalle','Nombre + referencia del pago + iniciales + PEND. BOVE Y MANAGER'],
        ['3 · Estadía','Cabaña y cantidad de noches'],['4 · Monto','Monto efectivamente pagado'],['Color',color]
    ]);
    const webpayLibro=[
        paso('Comprobar el aviso WebPay',['Abre el correo WebPay, verifica el código de autorización, tipo de tarjeta y monto.',
            'Imprime sólo el comprobante de ese huésped: pueden llegar varios WebPay juntos.']),
        pagoLibro('Anotar WebPay en el Libro',['Ve al día de la reserva y baja a la zona de pagos.',
            'En el detalle escribe: [nombre] // WebPay por confirmar // aut. [código] // [crédito o débito] // [iniciales] // PEND. BOVE Y MANAGER.'
        ],'Azul claro'),
        paso('Distinguir recibido de confirmado',['Envía Acuse de recibo WebPay mientras se valida el pago.',
            'La captura del manual indica validación por administración en 24 a 48 horas; después se envía la confirmación.',
            'Pasa la reserva a morado claro sólo cuando el WebPay esté confirmado.'])
    ];
    const transferenciaLibro=[
        paso('Verificar la transferencia en el banco',['En Santander Office Banking abre Cuentas corrientes → Saldos y movimientos.',
            'Busca la transferencia y comprueba que esté reflejada, aunque ya haya llegado el comprobante por correo.',
            'Copia la descripción del movimiento e imprime el comprobante. Comprueba la fecha del banco: en fines de semana puede figurar el lunes siguiente.']),
        pagoLibro('Anotar la transferencia en el Libro',['En la zona de pagos del día de la reserva, usa la fecha comprobada en el banco.',
            'Detalle: [huésped] // [descripción exacta del banco] // [iniciales] // PEND. BOVE Y MANAGER.'
        ],'Blanco')
    ];
    const posLibro=[pagoLibro('Anotar el pago de recepción',['Toma los datos del voucher Transbank; se usa también para walk-in.',
        'Detalle: [huésped] // BOVTAR [código de autorización] // folio [número de operación] // [crédito o débito] // [iniciales] // PEND. BOVE Y MANAGER.'
    ],'Azul claro')];
    const efectivoLibro=[
        paso('Preparar el sobre del efectivo',['Anota nombre, RUT, cabaña, fecha de check-in y monto recibido en un sobre.']),
        paso('Anotar efectivo en el Libro',['En la zona de pagos registra fecha, huésped, efectivo, monto e iniciales; indica cabaña y noches.',
            'Deja la casilla de pago en verde claro.'],[],conflictoEfectivo)
    ];
    const airbnbLibro=[
        paso('Revisar el correo Airbnb',['Comprueba el código de confirmación y asigna la etiqueta Airbnb al correo.',
            'Copia el desglose desde “El viajero ha pagado” hasta “Ganas”: conserva total, comisiones y lo que recibe el alojamiento.']),
        paso('Anotar Airbnb en el Libro',['Pega el desglose del correo en la zona de pagos; no confundas el total del viajero con la ganancia del alojamiento.'],[
            ['Fecha','Vacía mientras no se refleje la transferencia'],['Detalle','Desglose copiado del correo Airbnb'],
            ['Estadía','Cabaña y noches'],['Monto','Monto cancelado indicado en la reserva'],['Color','Naranjo claro, como el ejemplo del manual']
        ],'El manual describe una transferencia que puede tardar 2 a 3 semanas. Comprueba su llegada; no inventes la fecha de pago. No incluye un asiento Manager específico para Airbnb.')
    ];
    const bookingLibro=[
        paso('Identificar la reserva Booking',['Revisa el correo de Booking y el del motor Cloudbeds.',
            'Etiqueta el primero como Booking; el del motor como Booking y Pendiente de pago y/o fecha de la reserva.',
            'En el portal Booking busca al huésped y abre Datos de la reserva.']),
        paso('Preparar el cobro Booking',['Según este manual, una noche se cobra al 100%; más de una noche, al 50%. Comprueba el importe de esa reserva.',
            'Consulta la tarjeta desde Ver datos de tarjeta en Booking, con el acceso autorizado. Usa sus datos directamente en el terminal.'],[],
            'El manual propone imprimir los datos de la tarjeta. Esta guía no los reproduce ni pide pegarlos en Haku; conserva el comprobante del cobro.'),
        paso('Realizar Check-in en el terminal',['Selecciona VISA-MC-AMEX-DINERS → opción 2 Hotel → opción 1 Check-in.',
            'Ingresa el monto y pulsa el botón verde. Introduce el número de tarjeta y su vencimiento cuando el terminal lo solicite.']),
        paso('Completar Check-out y recoger vouchers',['Vuelve a VISA-MC-AMEX-DINERS → opción 2 Hotel → opción 3 Check-out.',
            'Introduce nuevamente la tarjeta y confirma el mismo monto de la operación anterior. Recoge los vouchers: copia comercio y copia cliente.',
            'Check-in y Check-out son pasos del terminal descritos en el manual; no cambian el estado de la estadía en Proyecto H.']),...posLibro
    ];
    const cloudbeds=[
        paso('Abrir Añadir pago en Cloudbeds',['Busca la reserva del huésped → Datos de reservas → Folio.',
            'Selecciona Añadir o reembolsar pago → Añadir pago.']),
        paso('Completar y guardar el pago',['Comprueba huésped, habitación, cantidad y método de pago.',
            'Copia la fila del Libro, desde la fecha hasta el monto, y pégala en Notas del pago.',
            'Revisa la fecha de publicación: la captura tiene marcada “Publicar con fecha y hora actuales”. No confundas esa opción con la fecha real del comprobante.',
            'Comprueba los datos y pulsa Guardar.'])
    ];
    const tarjeta=paso('Imprimir la tarjeta de registro',['En la reserva Cloudbeds abre Acciones, arriba a la derecha.',
        'Selecciona Imprimir tarjetas de registro. También aparece en Detalles del huésped.']);
    function confirmarCorreo(webpay=false){return paso(webpay?'Enviar acuse de recibo WebPay':'Enviar confirmación del pago',[
        webpay?'Usa Acuse de recibo WebPay de la plantilla general. Si ya fue validado, usa la confirmación correspondiente.':
            'Para transferencia, Booking o Airbnb, usa Confirmación de pago de la plantilla general cuando tengas el comprobante correspondiente.',
        'Personaliza el mensaje y verifica titular, fechas, noches, tarifa y abono. Adjunta políticas, normativas y contrato de mascotas.',
        'Revisa las etiquetas. Cuando la reserva esté pagada y confirmada, retira el correo de Recibidos.'
    ]);}
    const medios={webpay:{nombre:'WebPay',pasos:webpayLibro},transferencia:{nombre:'Transferencia',pasos:transferenciaLibro},
        booking:{nombre:'Booking',pasos:bookingLibro},airbnb:{nombre:'Airbnb',pasos:airbnbLibro},
        pos:{nombre:'Tarjeta en recepción',pasos:posLibro},efectivo:{nombre:'Efectivo',pasos:efectivoLibro}};
    const guias={
        'manager-transferencia':{grupo:'manager',nombre:'Agregar transferencia',resumen:'Comprobante nuevo · ARE + ABB$',pasos:transferencia(false)},
        'manager-transferencia-existente':{grupo:'manager',nombre:'Transferencia en fecha ya creada',resumen:'Continuar el comprobante del día',pasos:transferencia(true)},
        'manager-webpay-credito':{grupo:'manager',nombre:'Agregar pago WebPay crédito',resumen:'TXC + AC+P',pasos:webpay('crédito')},
        'manager-webpay-debito':{grupo:'manager',nombre:'Agregar pago WebPay débito',resumen:'TXC + AC+P',pasos:webpay('débito')},
        'manager-booking':{grupo:'manager',nombre:'Agregar pago Booking',resumen:'Cobro de tarjeta · TCR + AC+B',pasos:booking()},
        'manager-checkin-credito':{grupo:'manager',nombre:'Saldo al check-in · crédito',resumen:'Segundo 50% · BOVE + TCR',pasos:checkin('crédito')},
        'manager-checkin-debito':{grupo:'manager',nombre:'Saldo al check-in · débito',resumen:'Segundo 50% · BOVE + RECO',pasos:checkin('débito')},
        'manager-virtual':{grupo:'manager',nombre:'Cargo virtual',resumen:'TCR + AC+P',pasos:booking(true)},
        'manager-futuro':{grupo:'manager',nombre:'Pago directo para reserva futura',resumen:'Crédito o débito · TXC + AC+P',pasos:webpay(null,true)},
        'manager-efectivo':{grupo:'manager',nombre:'Alojamiento en efectivo',resumen:'Regla por aclarar entre manuales',pasos:[paso('Aclarar el ingreso en efectivo',[
            'Consulta con administración cuál regla de efectivo corresponde aplicar.',
            'La referencia EFE8 aparece en el manual, pero no se detalla un asiento para alojamiento en efectivo.'
        ],[],conflictoEfectivo)]},
        'reserva-completa':{grupo:'reservas',nombre:'Procesar una reserva completa',resumen:'Del correo inicial a la confirmación',pasos:[]},
        'reserva-libro':{grupo:'reservas',nombre:'Registrar datos en el Libro',resumen:'Huésped, estadía, solicitudes y color',pasos:[correoInicial,libro]},
        'reserva-correo':{grupo:'reservas',nombre:'Enviar correo de pre-reserva',resumen:'Destinatario, plantilla y adjuntos',pasos:[correoPrereserva]},
        ...Object.fromEntries(Object.entries(medios).map(([id,m])=>['reserva-'+id,{grupo:'reservas',nombre:'Procesar pago '+m.nombre,resumen:'Verificación y registro en el Libro',pasos:m.pasos}])),
        'reserva-cloudbeds':{grupo:'reservas',nombre:'Subir pago a Cloudbeds',resumen:'Folio → Añadir pago',pasos:cloudbeds},
        'reserva-tarjeta':{grupo:'reservas',nombre:'Imprimir tarjeta de registro',resumen:'Desde la reserva Cloudbeds',pasos:[tarjeta]},
        'reserva-confirmar':{grupo:'reservas',nombre:'Enviar confirmación o acuse',resumen:'Elegir el mensaje según el pago',pasos:[paso('Elegir el mensaje correcto',[
            'WebPay pendiente de validación: Acuse de recibo WebPay.',
            'Transferencia, Booking o Airbnb con comprobante: Confirmación de pago.',
            'Usa la plantilla general, personaliza los datos y adjunta políticas, normativas y contrato de mascotas.',
            'Verifica etiquetas; retira de Recibidos sólo las reservas pagadas y confirmadas.'
        ])]}
    };
    const grupos={manager:{nombre:'Ingresos Manager',descripcion:'Elige qué ingreso necesitas registrar.'},
        reservas:{nombre:'Proceso de reservas',descripcion:'Sigue el proceso completo o elige una etapa.'}};
    const congelar=x=>{if(x&&typeof x==='object'&&!Object.isFrozen(x)){Object.values(x).forEach(congelar);Object.freeze(x);}return x;};
    congelar(guias);congelar(medios);congelar(grupos);
    function pasosDe(id,medio){
        if(!Object.hasOwn(guias,id))return [];
        if(id!=='reserva-completa')return guias[id].pasos;
        const elegir={titulo:'Elegir el medio de pago',items:['Selecciona cómo se paga esta reserva para continuar con sus pasos.'],datos:[],
            opciones:Object.entries(medios).map(([id,m])=>({id,nombre:m.nombre}))};
        return [correoInicial,libro,correoPrereserva,elegir,...(Object.hasOwn(medios,medio)?[
            ...medios[medio].pasos,...cloudbeds,tarjeta,confirmarCorreo(medio==='webpay')]:[])];
    }
    function estadoValido(estado={}){
        const grupo=Object.hasOwn(grupos,estado.grupo)?estado.grupo:'manager';
        const id=Object.hasOwn(guias,estado.id)&&guias[estado.id].grupo===grupo?estado.id:'';
        const medio=Object.hasOwn(medios,estado.medio)?estado.medio:'';
        const pasos=pasosDe(id,medio),indice=Number(estado.indice);
        const limite=id==='reserva-completa'&&!medio?pasos.length-1:pasos.length;
        return {grupo,id,medio,indice:Number.isInteger(indice)?Math.max(0,Math.min(indice,limite)):0};
    }
    function renderizar(card,estado,enfocar=false){
        const d=root.document,s=estadoValido(estado),g=grupos[s.grupo],guia=guias[s.id],pasos=pasosDe(s.id,s.medio);
        card.className='haku-guia-operativa';card.dataset.hakuGuiaGrupo=s.grupo;card.dataset.hakuGuiaId=s.id;
        card.dataset.hakuGuiaPaso=String(s.indice);card.dataset.hakuGuiaMedio=s.medio;card.replaceChildren();
        const nodo=(padre,tag,clase,texto)=>{const el=d.createElement(tag);el.className=clase;if(texto)el.textContent=texto;padre.appendChild(el);return el;};
        const cambiar=parche=>{renderizar(card,{...s,...parche},true);root.HAIKU_ASISTENTE_HISTORIAL_V1?.guardar?.();};
        const boton=(padre,texto,accion,clase='')=>{const b=nodo(padre,'button',clase,texto);b.type='button';b.addEventListener('click',accion);return b;};
        const head=nodo(card,'header','haku-guia__cabecera');nodo(head,'span','haku-guia__etiqueta','GUÍA · '+g.nombre);
        const titulo=nodo(head,'h3','haku-guia__titulo',guia?.nombre||g.nombre);titulo.tabIndex=-1;
        if(!guia){
            nodo(card,'p','haku-guia__intro',g.descripcion);
            const menu=nodo(card,'div','haku-guia__opciones');
            for(const [id,x] of Object.entries(guias).filter(([,x])=>x.grupo===s.grupo)){
                const b=boton(menu,'',()=>cambiar({id,indice:0,medio:''}),'haku-guia__opcion');
                nodo(b,'span','',x.nombre);nodo(b,'small','',x.resumen);
            }
        }else{
            boton(head,'← Opciones',()=>cambiar({id:'',indice:0,medio:''}),'haku-guia__volver');
            const cuerpo=nodo(card,'div','haku-guia__cuerpo');
            if(s.indice>=pasos.length){
                nodo(cuerpo,'strong','haku-guia__fin','Fin de la guía');
                nodo(cuerpo,'p','','Estos pasos son una guía. No confirman que el pago o la reserva hayan sido registrados.');
                boton(cuerpo,'Volver a los pasos',()=>cambiar({indice:0}),'haku-guia__principal');
            }else{
                const p=pasos[s.indice],total=s.id==='reserva-completa'&&!s.medio?'':` de ${pasos.length}`;
                nodo(cuerpo,'span','haku-guia__progreso',`Paso ${s.indice+1}${total}`);
                nodo(cuerpo,'h4','haku-guia__paso-titulo',p.titulo);
                if(p.items?.length){const ul=nodo(cuerpo,'ul','haku-guia__instrucciones');for(const text of p.items)nodo(ul,'li','',text);}
                if(p.datos?.length){const dl=nodo(cuerpo,'dl','haku-guia__datos');for(const [k,v] of p.datos){nodo(dl,'dt','',k);nodo(dl,'dd','',v);}}
                if(p.nota)nodo(cuerpo,'p','haku-guia__nota',p.nota);
                if(p.opciones){
                    const opciones=nodo(cuerpo,'div','haku-guia__medios');
                    for(const o of p.opciones)boton(opciones,o.nombre,()=>cambiar({medio:o.id,indice:s.indice+1}));
                }
                const nav=nodo(card,'nav','haku-guia__navegacion');nav.setAttribute('aria-label','Pasos de la guía');
                const atras=boton(nav,'Anterior',()=>cambiar({indice:s.indice-1}));atras.disabled=s.indice===0;
                if(!p.opciones)boton(nav,s.indice===pasos.length-1?'Terminar guía':'Siguiente',()=>cambiar({indice:s.indice+1}),'haku-guia__principal');
            }
        }
        nodo(card,'small','haku-guia__fuente','Fuente: '+fuentes[s.grupo]);
        if(enfocar){titulo.focus({preventScroll:true});card.scrollIntoView({block:'start',behavior:'auto'});}
        return card;
    }
    function mostrar(grupo){
        if(!Object.hasOwn(grupos,grupo))return null;
        const mensajes=root.document?.getElementById('haiku-asistente-mensajes');if(!mensajes)return null;
        // Recupera la misma guía y su paso durante la sesión, sin llenar el chat de copias.
        let card=[...mensajes.querySelectorAll('.haku-guia-operativa')].find(c=>c.dataset.hakuGuiaGrupo===grupo);
        if(!card){card=root.document.createElement('article');mensajes.appendChild(card);renderizar(card,{grupo},true);}
        else{renderizar(card,{grupo,id:card.dataset.hakuGuiaId,indice:card.dataset.hakuGuiaPaso,medio:card.dataset.hakuGuiaMedio},true);}
        root.HAIKU_ASISTENTE_HISTORIAL_V1?.guardar?.();return card;
    }
    function restaurar(contenedor){
        for(const card of contenedor?.querySelectorAll('.haku-guia-operativa')||[]){
            if(!Object.hasOwn(grupos,card.dataset.hakuGuiaGrupo)){card.remove();continue;}
            renderizar(card,{grupo:card.dataset.hakuGuiaGrupo,id:card.dataset.hakuGuiaId,indice:card.dataset.hakuGuiaPaso,medio:card.dataset.hakuGuiaMedio});
        }
    }
    const api=Object.freeze({guias,grupos,pasosDe,estadoValido,mostrar,restaurar});
    root.HAIKU_GUIAS_OPERATIVAS_V1=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
