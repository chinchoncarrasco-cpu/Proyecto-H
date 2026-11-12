// Plantilla de Cierre. Los códigos de respuesta y de evidencia son claves persistidas.
(() => {
    "use strict";

    const opcionesSiNo = [["si", "Sí"], ["no", "No"]];
    const controles = [
        {
            id: "recepcion", titulo: "Recepción y reservas", abrir: true, seccion: "resumen", enlace: "Ver Resumen",
            items: [
                { codigo: "salida_temprana", campo: "salidaTemprana", texto: "¿Se confirmó la hora de salida temprana?",
                    opciones: [["si", "Sí"], ["no-hay", "No hubo"]] },
                { codigo: "salio_antes", campo: "salioAntes", texto: "¿Hubo salidas antes de lo previsto?", opciones: opcionesSiNo },
                { codigo: "registro_guardado", campo: "registroGuardado", texto: "Registro de huéspedes guardado",
                    evidencia: { id: "registro", titulo: "Respaldo del registro" } },
                { codigo: "reserva_marcada", campo: "reservaMarcada", texto: "Entradas y salidas actualizadas",
                    evidencia: { id: "cloudbeds-reserva", titulo: "Respaldo de las reservas" } }
            ]
        },
        {
            id: "caja", titulo: "Caja y pagos", abrirEnEscritorio: true, seccion: "pagos", enlace: "Ver Pagos", items: [
                { codigo: "pago_registrado", campo: "pagoRegistrado", texto: "Pagos registrados con su respaldo",
                    evidencia: { id: "cloudbeds-pago", titulo: "Comprobantes de pago" } },
                { codigo: "manager_pagos", campo: "managerPagos", texto: "Pagos verificados contra el registro de caja",
                    permiso: "cierres.validar_pagos", evidencia: { id: "manager-pagos", titulo: "Respaldo de la verificación" } },
                { codigo: "manager_caja", campo: "managerCaja", texto: "Revisión de caja completada",
                    permiso: "cierres.validar_caja", evidencia: { id: "manager-caja", titulo: "Respaldo de caja" } },
                { codigo: "manager_vale_salida", campo: "managerValeSalida", texto: "Cortesías del turno respaldadas",
                    permiso: "cierres.validar_vale_salida" }
            ]
        },
        {
            id: "instalaciones", titulo: "Instalaciones", seccion: "servicios", enlace: "Ver Servicios", items: [
                { codigo: "tinaja_tonel_apagado", campo: "tinajaTonelApagado", texto: "Eyectores y luces del Tonel apagados" },
                { codigo: "tinaja_tonel_funcionamiento", campo: "tinajaTonelFuncionamiento", texto: "Temperatura y funcionamiento del Tonel revisados" },
                { codigo: "tinaja_jacuzzi_apagado", campo: "tinajaJacuzziApagado", texto: "Eyectores y luces del Jacuzzi apagados" },
                { codigo: "tinaja_jacuzzi_funcionamiento", campo: "tinajaJacuzziFuncionamiento", texto: "Temperatura y funcionamiento del Jacuzzi revisados" },
                { codigo: "tinaja_cojines_retirados", campo: "tinajaCojinesRetirados", texto: "Cojines del área de tinajas retirados" }
            ]
        }
    ];

    const entrega = {
        id: "entrega", titulo: "Entrega del turno", items: [
            { codigo: "detalles_cabanas", campo: "detallesCabanas", texto: "¿Se revisaron las cabañas y sus observaciones?",
                opciones: [["si", "Sí"], ["pendientes", "Hay pendientes"]] },
            { codigo: "pendientes_hacer", campo: "pendientesHacer", texto: "¿Quedan tareas para el siguiente turno?", opciones: opcionesSiNo },
            { codigo: "hay_novedades", campo: "hayNovedades", texto: "¿Hay novedades que informar?", opciones: opcionesSiNo }
        ]
    };

    const inventario = {
        titulo: "Llaves y accesos", codigo: "llaves_recepcion", campo: "llavesRecepcion",
        // Identificadores de las llaves de la plantilla inicial.
        llaves: [
            ["tonel", "Tonel", "Negra"], ["jacuzzi", "Jacuzzi", "Azul"],
            ["lavanderia", "Lavandería"], ["masajes", "Sala de masajes", "Verde claro"],
            ["generadores", "Generadores y camas adicionales", "Madera redonda"],
            ["jardineria", "Jardinería", "Verde claro"], ["marcelo", "Llave de Marcelo", "Verde oscuro"],
            ["cisterna", "Cisterna"], ["internet", "Caja de internet", "Naranja"],
            ["gas11", "Gas CAB 11", "Azul oscuro"], ["torreon", "Torreón", "Azul oscuro"]
        ]
    };

    const unidades = {
        titulo: "Cabañas", ocupada: ["ocupada", "Ocupada · no requiere revisión"],
        items: [
            ["perillas", "Perillas de cocina"], ["gas", "Llave de gas"], ["refri", "Nivel del refrigerador"],
            ["calefactor", "Calefactor"], ["tv", "TV"], ["ac", "Aire acondicionado"], ["luces", "Luces"]
        ],
        respaldo: Array.from({ length: 11 }, (_, i) => ({ numero: i + 1, nombre: `Cabaña ${i + 1}` }))
    };

    const campos = Object.fromEntries([
        ...controles.flatMap(grupo => grupo.items),
        ...entrega.items,
        inventario,
        { codigo: "llaves_retiradas", campo: "llavesRetiradas" }
    ].map(item => [item.codigo, item]));

    const protegidos = ["pago_registrado", "manager_pagos", "manager_caja", "manager_vale_salida", "hay_novedades"];
    const fila = (id, texto) => ({ id, texto, activo: true });
    const grupo = seccion => ({
        id: seccion.id, titulo: seccion.titulo, items: seccion.items.map(item => fila(item.codigo, item.texto))
    });
    const base = {
        titulo: "Cierre de turno",
        grupos: [
            grupo(controles[0]),
            { id: "llaves", titulo: inventario.titulo, items: inventario.llaves.map(([id, texto, detalle]) => ({
                ...fila(id, texto), detalle: detalle || ""
            })) },
            ...controles.slice(1).map(grupo)
        ],
        cabanas: { titulo: unidades.titulo, ocupada: unidades.ocupada[1],
            items: unidades.items.map(([id, texto]) => fila(`cabana_${id}`, texto)) },
        entrega: { ...grupo(entrega), novedades: "Novedades del turno", resumen: "Resumen de entrega" }
    };

    function aplicar(config = base) {
        const items = grupo => grupo.items.filter(item => item.activo).map(item => ({
            ...campos[item.id], codigo: item.id, texto: item.texto
        }));
        return {
            titulo: config.titulo,
            controles: config.grupos.map(grupo => {
                if (grupo.id === "llaves") return {
                    id: "llaves", titulo: grupo.titulo,
                    llaves: grupo.items.filter(item => item.activo).map(({ id, texto, detalle }) => [id, texto, detalle])
                };
                return { ...controles.find(base => base.id === grupo.id), id: grupo.id, titulo: grupo.titulo, items: items(grupo) };
            }).filter(grupo => grupo.llaves || grupo.items.length),
            unidades: {
                ...unidades, titulo: config.cabanas.titulo, ocupada: ["ocupada", config.cabanas.ocupada],
                items: config.cabanas.items.filter(item => item.activo).map(item => [item.id.slice(7), item.texto])
            },
            entrega: { ...config.entrega, items: items(config.entrega) }
        };
    }

    window.HAIKU_CIERRE_PLANTILLA_V1 = Object.freeze({ controles, entrega, inventario, unidades, campos, base, aplicar, protegidos });
})();
