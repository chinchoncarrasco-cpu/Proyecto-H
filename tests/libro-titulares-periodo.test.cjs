const assert = require("node:assert/strict");
const test = require("node:test");
require("../js/haiku-libro-semantica-v1.js");
const Q = require("../js/haiku-libro-consultas-v1.js");

const entrada = (hoja, celda, titular, cabana, fecha_checkin, fecha_checkout, extra = {}) => ({
    id:`${hoja}!${celda}`, titular, cabana, fecha_checkin, fecha_checkout,
    tipo_estadia:fecha_checkin === fecha_checkout ? "full_day" : "alojamiento",
    coordenadas_origen:{hoja,celda}, texto_original:titular,
    pagos:[], pagos_sin_asociacion:[], pagos_pendientes:[], servicios:[], notas_importantes:[], advertencias:[],
    ...extra
});

function libro(hojas, lecturas = []) {
    return {
        listo:async () => {},
        estado:() => ({cargado:true,nombre:"Libro.xlsx",generacion:1}),
        listarHojas:() => Object.keys(hojas),
        consultarHoja:async h => {
            lecturas.push(h);
            return {cobertura:{geometria:true},reservas:hojas[h],anotaciones:[]};
        }
    };
}

function proyecto(estadias, lecturas) {
    return {
        auth:{getSession:async () => ({data:{session:{user:{id:"usuario"}}}})},
        from(tabla) {
            lecturas.push(tabla);
            assert.equal(tabla,"reserva_estadias");
            const q = {
                select:() => q, order:() => q, lte:() => q, gte:() => q,
                range:async () => ({data:estadias.map((r,i) => ({
                    id:`estadia-${i}`, reserva_id:`reserva-${i}`, cabanas:{numero:r.cabana},
                    fecha_ingreso:r.fecha_checkin, fecha_salida:r.fecha_checkout, tipo_estadia:r.tipo_estadia,
                    estado_estadia:r.estado || "confirmada",
                    reservas:{titular_nombre:r.titular,correo_contacto:r.correo,estado_reserva:r.estado || "confirmada"}
                }))})
            };
            return q;
        }
    };
}

const anterior = entrada("Oct26","L3","Luz Pardo",1,"2026-10-30","2026-11-01");
const nov = entrada("Nov26","D4","Marta Vera",2,"2026-11-01","2026-11-02");
const fullDay = entrada("Nov26","D5","Marta Vera",3,"2026-11-01","2026-11-01");
const salidaDudosa = entrada("Nov26","P6","Elena Vega",4,"2026-11-04","2026-11-05",{
    noches:1,noches_texto_efectivas:2
});

test("interpreta mes de Chile, fechas escritas y rangos sin capturar pagos ni versiones", t => {
    t.mock.timers.enable({apis:["Date"], now:new Date("2026-12-01T02:30:00Z")});
    const hojas = ["Oct26","Nov26","Dic26"];
    const q = Q.interpretar("Haku, titulares y cabañas del mes actual",hojas);
    assert.deepEqual([q.desde,q.hasta,q.hojas],["2026-11-01","2026-11-30",["Oct26","Nov26"]]);
    const rango = Q.interpretar("Titulares del 30 de noviembre al 2 de diciembre de 2026",hojas);
    assert.deepEqual([rango.desde,rango.hasta,rango.hojas],["2026-11-30","2026-12-02",hojas]);
    const cabana = Q.interpretar("Titular de la cabaña 4 entre el 13 y el 15 de noviembre",hojas);
    assert.deepEqual([cabana.desde,cabana.hasta,cabana.cabana],["2026-11-13","2026-11-15",4]);
    assert.equal(Q.interpretar("Titulares el 15/11",hojas).desde,"2026-11-15");
    assert.equal(Q.interpretar("Titulares mañana",hojas).desde,"2026-12-01");
    assert.throws(() => Q.interpretar("Titulares el 31-11-2026",hojas),/Revisa las fechas/);
    assert.throws(() => Q.interpretar("Titulares del 15 al 13 de noviembre",hojas),/fecha final/);
    assert.equal(Q.interpretar("Libro: compara pagos de noviembre 2026 con Proyecto H",hojas).solo_pagos,true);
    assert.equal(Q.interpretar("Libro: cambios de titulares de noviembre 2026",hojas).versiones,true);
});

test("incluye salidas del mes anterior y cada cabaña de una misma persona",async () => {
    const leidas = [];
    const fuente = libro({Oct26:[anterior],Nov26:[fullDay,nov,salidaDudosa]},leidas);
    const result = await Q.consultar("Titulares y cabañas el 1 de noviembre de 2026",fuente);
    assert.deepEqual(leidas,["Oct26","Nov26"]);
    assert.deepEqual(result.titularidad.filas.map(f => [f.cabana,f.movimiento]),[[1,"Sale"],[2,"Ingresa"],[3,"Full Day"]]);
    const ocupacion = await Q.consultar("Libro: ¿Quién está hospedado el 1 de noviembre de 2026?",fuente);
    assert.deepEqual(ocupacion.titularidad.filas.map(f => f.cabana),[2,3]);
    const salidas = await Q.consultar("Libro: ¿Quién sale el 6 de noviembre de 2026?",fuente);
    assert.equal(salidas.titularidad.filas[0].movimiento,"Salida por confirmar");
    assert.match(Q.respuesta(salidas),/Salida según las noches escritas 06\/11\/2026 · Nov26!P6/);
});

test("audita en los dos sentidos y expone las dos fechas sin leer pagos ni servicios",async () => {
    const lecturas = [];
    const otro = entrada("Nov26","L7","Adela Pino",5,"2026-11-03","2026-11-04");
    const variante = entrada("Nov26","P8","Rosa Oliva",6,"2026-11-04","2026-11-05",{correo:"identidad@example.test"});
    const fuente = libro({Oct26:[anterior],Nov26:[nov,salidaDudosa,otro,variante]});
    const cliente = proyecto([
        {...anterior,titular:"Pardo, Luz"},nov,
        {...salidaDudosa,fecha_checkout:"2026-11-06"},
        {...variante,titular:"Rosa Olvia"},
        {...otro,cabana:7,titular:"Sara Rojas"},
        {...otro,estado:"cancelada"}
    ],lecturas);
    const r = await Q.consultar("Audita titulares de noviembre 2026 contra Proyecto H",fuente,cliente);
    const {comparacion:c} = r.titularidad;
    assert.deepEqual(lecturas,["reserva_estadias"]);
    assert.equal(c.coincidencias.length,2);
    assert.equal(c.cantidad_proyecto,5);
    assert.deepEqual(c.incidencias.map(i => i.estado),[
        "Solo en el Libro","Salida distinta","Variante de nombre con identidad verificada","Solo en Proyecto H"
    ]);
    const cambio = c.incidencias.find(i => i.estado === "Salida distinta");
    assert.deepEqual([cambio.libro.salida,cambio.libro.salida_escrita,cambio.proyecto.salida],
        ["2026-11-05","2026-11-06","2026-11-06"]);
    assert.doesNotMatch(Q.respuesta(r),/identidad@example.test/);
    const directo = await Q.consultar("Titulares de Proyecto H del 4 al 5 de noviembre de 2026",undefined,cliente);
    assert.deepEqual(directo.titularidad.filas.map(f => f.cabana),[7,4,6]);
});

test("la falta de hoja anterior se informa y los titulares dudosos conservan contexto",async () => {
    const fuente = libro({Nov26:[]});
    const leer = fuente.consultarHoja;
    fuente.consultarHoja = async h => ({...await leer(h),anotaciones:[{
        tipo:"reserva_por_identificar",origen:{hoja:h,celda:"D4"},fecha:"2026-11-01",cabana:2,
        titulares_posibles:["Marta Vera","Sara Rojas"]
    }]});
    const r = await Q.consultar("Compara titulares de noviembre 2026 con Proyecto H",fuente,proyecto([anterior,nov],[]));
    assert.match(Q.respuesta(r),/Nov26!D4.*Marta Vera \/ Sara Rojas/);
    assert.match(Q.respuesta(r),/Falta la hoja del mes anterior/);
    assert.deepEqual(r.titularidad.comparacion.incidencias.map(i=>i.estado),["Por verificar en el Libro","Por verificar en el Libro"]);
});

test("la búsqueda de lectura admite orden invertido, nombre abreviado y errata",async () => {
    const e = entrada("Nov26","D4","Vera Marta Solís",2,"2026-11-01","2026-11-02");
    const fuente = libro({Nov26:[e,fullDay]});
    fuente.buscarHojas = async terminos => {
        assert.ok(terminos.includes("solis"));
        return {hojas:["Nov26"]};
    };
    const x = await Q.consultar("Libro: reserva de Marta Solís Vera",fuente);
    assert.deepEqual(x.reservas.map(r=>r.id),[e.id]);
    const y = await Q.consultar("Libro: reserva de Marta Solís el 1 de noviembre 2026",fuente);
    assert.deepEqual(y.reservas.map(r=>r.id),[e.id]);
    const z = await Q.consultar("Libro: reserva de Marta Sólis Vrea el 01-11-2026",fuente);
    assert.deepEqual(z.reservas.map(r=>r.id),[e.id]);
});
