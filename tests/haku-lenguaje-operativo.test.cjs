const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
require("../js/haiku-libro-semantica-v1.js");
const L = require("../js/haiku-asistente-lenguaje-v1.js");
const A = require("../js/haiku-asistente-acciones-v1.js");
const ayuda = require("../js/haiku-ayuda-v1.js");
const Q = require("../js/haiku-libro-consultas-v1.js");
const diaActual = "2026-11-12";
const contexto = {diaActual};
const cabanas = ["cab 10","CAB10","cabaña 10","cba 10"];
const fechas = ["de hoy","del 12/11/2026","para el 12 de noviembre de 2026","2026-11-12"];

test("576 combinaciones de cambio de total conservan titular, cabaña, fecha y CLP", () => {
    for (const verbo of ["cambia","cámbiame","camvia","modifca","edita","déjame"])
        for (const cab of cabanas) for (const fecha of fechas)
            for (const monto of ["$180.000","CLP 180.000","180000 pesos","180 lucas","180 mil","180k"]) {
                const frase = "Haku, " + verbo + " el precio de " + cab + " de Inés Rojas " + fecha + " a " + monto;
                assert.deepEqual(L.interpretarTotal(frase,contexto),{entradas:[{
                    titular:"Inés Rojas",cabana:10,fecha:diaActual,modoFecha:"estadia",total_objetivo:180000,origen:"chat"
                }]},frase);
            }
});

test("180 combinaciones de agenda resuelven Tónel, cabaña, hora y día", () => {
    for (const verbo of ["ingresaservicio","agrgea el servicio","agéndame una","programa una","resérvame la","registra servicio"])
        for (const hora of ["20:45","20.45","20h45","8:45 pm","20 45"])
            for (const fecha of ["hoy","del 12/11/26",""])
                for (const destino of ["tinaja tonel a las "+hora+" en CAB3", "tinaja las "+hora+" tonel en cba 3"]) {
                    const frase="Haku "+verbo+" "+destino+" "+fecha;
                    const q=A.interpretarServicio(frase,contexto);
                    assert.deepEqual([q?.codigo,q?.cabana,q?.fecha,q?.hora],["tinajaTonel",3,diaActual,"20:45"],frase);
                }
});

test("72 lecturas informales preservan la fecha y el tipo de consulta", () => {
    const entidades=[["ingrseos","ingresos"],["salidass","salidas"],["continuaciones","reservas que continúan"],["titualres","titulares"]];
    for (const verbo of ["dame","pásame","muéstrame","tráeme","muestame","dime"])
        for (const [original,esperada] of entidades)
            for (const fecha of ["de hoy","de mañana","del 12 de noviembre de 2026"]) {
                const frase="Haku, "+verbo+" "+original+" "+fecha;
                assert.match(L.adaptarOrden(frase),new RegExp("muestra (?:las )?"+esperada+" "+fecha+"$"),frase);
            }
});

test("84 órdenes de pago conservan fecha, folio, glosa y ceros iniciales", () => {
    const evidencia=" de Inés Rojas, CAB 3, 12/11/2026, CLP 30.000, Folio 000123, Glosa 0012 Transf de A.";
    for (const verbo of ["ingresa","ingesa","mete","carga","regístrame","rejistra","agrega"])
        for (const tipo of ["pago","abono","pagos","abonos"])
            for (const prefijo of ["Haku, ","oye Haku ",""]) {
                const frase=prefijo+verbo+" "+tipo+evidencia;
                assert.equal(L.adaptarOrden(frase),"Haku, registra "+tipo+evidencia,frase);
            }
    assert.equal(L.adaptarOrden("Haku, ingresa un pago. Glosa: 0012 No separar, por favor!"),
        "Haku, registra un pago. Glosa: 0012 No separar, por favor!");
});

test("60 búsquedas de ficha separan intención, titular, cabaña y fecha", () => {
    for (const verbo of ["modifca","edítame","corrige","abre","búscame"])
        for (const cab of cabanas) for (const fecha of fechas.slice(0,3)) {
            const frase="Haku, "+verbo+" reserva de Inés Rojas "+cab+" "+fecha;
            const q=A.interpretarFicha(frase,contexto);
            assert.deepEqual([q?.editar,q?.titular,q?.cabana,q?.fecha],
                [!["abre","búscame"].includes(verbo),"Inés Rojas",10,diaActual],frase);
        }
});

test("la comparación natural usa el mes de Chile y el lector del Libro", t => {
    t.mock.timers.enable({apis:["Date"],now:new Date("2026-12-01T02:30:00Z")});
    const hojas=["Oct26","Nov26","Dic26"];
    const pagos=Q.interpretar(L.adaptarOrden("Haku, comparame los pagso de este mes con Proyecto H"),hojas);
    assert.deepEqual([pagos.solo_pagos,pagos.desde,pagos.hasta],[true,"2026-11-01","2026-11-30"]);
    const reservas=Q.interpretar(L.adaptarOrden("compara reservas del mes siguiente con Proyecto H"),hojas);
    assert.deepEqual([reservas.comparar,reservas.hojas],[true,["Dic26"]]);
    assert.equal(L.adaptarOrden("Haku, pásame el informe de actualización"),"Haku, informe de actualizacion");
    const hoy=Q.interpretar(L.adaptarOrden("compara pagos de hoy con Proyecto H"),hojas);
    assert.deepEqual([hoy.solo_pagos,hoy.desde,hoy.hasta],[true,"2026-11-30","2026-11-30"]);
});

test("lectura, negación y ambigüedad no se convierten en escrituras", () => {
    for (const frase of [
        "no cambies el total de Inés Rojas a 180 lucas",
        "¿cuál es el precio de CAB 3 hoy?",
        "¿qué horarios tiene el Tónel hoy?",
        "cancela el servicio de CAB 3",
        "registra el servicio como realizado",
        "Libro: agrega servicios de noviembre"
    ]) {
        assert.equal(L.interpretarTotal(frase,contexto),null,frase);
        assert.equal(A.interpretarServicio(frase,contexto),null,frase);
    }
    for (const frase of [
        "cambia el precio de Inés Rojas CAB3 hoy a $180,50",
        "cambia el precio de Inés Rojas CAB3 el 31/11/2026 a $180.000",
        "cambia el precio por noche de Inés Rojas a $180.000",
        "cambia el precio de Inés Rojas CAB 3 CAB 5 a $180.000",
        "cambia el total de Inés Rojas hoy y mañana a $180.000"
    ]) assert.ok(L.interpretarTotal(frase,contexto)?.error,frase);
    for (const frase of [
        "agenda tinaja tonel y jacuzzi para CAB 3",
        "agenda tinaja CAB 3 a las 26.70",
        "agenda tinaja a las 20:45",
        "agenda tinaja y masaje CAB 3 hoy"
    ]) assert.ok(A.interpretarServicio(frase,contexto)?.error,frase);
    const gen=A.interpretarServicio("agenda una tinaja en CAB 3 a las 20.45",contexto);
    assert.equal(gen.codigo,"");
    assert.equal(gen.hora,"20:45");
    const dato=A.interpretarServicio("agenda tonel CAB3 a las 20.45 de cortesía, motivo: Aniversario hoy observaciones: No tocar Jacuzzi mañana",contexto);
    assert.deepEqual([dato.codigo,dato.fecha,dato.motivo,dato.observaciones],
        ["tinajaTonel",diaActual,"Aniversario hoy","No tocar Jacuzzi mañana"]);
});

test("el catálogo describe las acciones y los límites del chat y se carga antes de los interceptores", () => {
    const titulos=ayuda.secciones.flatMap(g=>g.acciones.map(a=>a.titulo));
    assert.equal(new Set(titulos).size,titulos.length);
    assert.ok(titulos.length>=35);
    const externos=ayuda.secciones.find(g=>g.nombre==="Casos que requieren otro canal").acciones;
    assert.ok(externos.length>=3);
    assert.equal(externos.some(a=>a.ejemplos || a.atajo),false);
    const html=fs.readFileSync("panel.html","utf8");
    const indices=["haiku-asistente-lenguaje-v1","haiku-asistente-operaciones-v1","supabase-asistente-operaciones-v1","haiku-ayuda-v1","haiku-asistente-acciones-v1","supabase-asistente-totales-v1","haiku-libro-consultas-v1"]
        .map(nombre=>html.indexOf("'"+nombre+"'"));
    assert.ok(indices.every((n,i)=>n>=0 && (!i || n>indices[i-1])));
});
