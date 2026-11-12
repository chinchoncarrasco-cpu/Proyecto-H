const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {chromium} = require("playwright");
const raiz = path.resolve(__dirname,"..");
const leer=(carpeta,nombre)=>fs.readFileSync(path.join(raiz,carpeta,nombre),"utf8");
const scripts=[
    "haiku-libro-semantica-v1","haiku-asistente-lenguaje-v1","haiku-ayuda-v1","haiku-asistente-acciones-v1",
    "supabase-asistente-totales-v1","haiku-libro-consultas-v1","sites-resumen-servicio-v1",
    "supabase-asistente-v1","supabase-asistente-pagos-nocturnos-v1","supabase-asistente-pago-existente-v2",
    "supabase-asistente-consulta-ingresos-v1","supabase-asistente-resumen-dia-v1",
    "supabase-asistente-disponibilidad-v1","supabase-asistente-confirmadas-sin-abono-v1"
];

function fuentes(tema) {
    document.documentElement.dataset.haikuTema=tema;
    window.haikuSesion={auth:{id:"usuario"}};
    window.haikuTienePermiso=()=>true;
    window.prueba={rpc:[],edge:[],select:[],fichas:[]};
    const titular="Inés Lucía Rojas Vera";
    const uno={id:"11111111-1111-4111-8111-111111111111",titular_nombre:titular,
        codigo_haiku:"H-20261112-03-ABCDEF",estado_reserva:"confirmada",grupo_reserva_id:null};
    const dos={...uno,id:"22222222-2222-4222-8222-222222222222",codigo_haiku:"H-20261112-10-FEDCBA"};
    const estadia=(id,reserva,numero)=>({
        id,reserva_id:reserva.id,cabanas:{numero},reservas:reserva,estado_estadia:"confirmada",
        fecha_ingreso:"2026-11-12",fecha_salida:"2026-11-13",tipo_estadia:"alojamiento",
        adultos:2,ninos:0,noches:[{fecha:"2026-11-12",tarifa:160000}]
    });
    const cab3=estadia("33333333-3333-4333-8333-333333333333",uno,3);
    const cab10=estadia("44444444-4444-4444-8444-444444444444",dos,10);
    const tablas={
        reserva_estadias:[cab3,cab10],
        reservas:[{...uno,estadias:[cab3]},{...dos,estadias:[cab10]}],
        vista_saldos_alojamiento_reserva:[{reserva_id:uno.id,total_alojamiento:160000},{reserva_id:dos.id,total_alojamiento:160000}],
        cargo_ajustes:[],
        catalogo_servicios:[{codigo:"tinajaTonel",nombre:"Tinaja Tónel de Madera",categoria:"tinaja",
            requiere_horario:true,activo:true,precio_base:30000,capacidad_maxima:3,permite_cortesia:true}]
    };
    window.HAIKU_INSPECTOR_V1={abrirReserva:async (id,boton,seleccion)=>{
        prueba.fichas.push({id,seleccion});return true;
    }};
    window.haikuSupabase={
        auth:{onAuthStateChange:()=>({}),getSession:async()=>({data:{session:{user:{id:"usuario"}}}})},
        functions:{invoke:async (nombre,{body})=>{
            prueba.edge.push({nombre,body});
            return {error:{message:"Analizador aislado"}};
        }},
        rpc:async (nombre,args)=>{
            prueba.rpc.push({nombre,args});
            if (nombre==="haiku_buscar_operacion_fecha_asistente") return {data:[{
                titular_nombre:titular,cabana_numero:3,estado_estadia:"confirmada",fecha_ingreso:"2026-11-12",fecha_salida:"2026-11-13"
            }]};
            if (nombre==="haiku_operacion_dia") return {data:[{
                numero:3,estado_operativo:"libre-ingresa",ingreso_reserva_id:uno.id,ingreso_estadia_id:cab3.id
            }]};
            if (nombre==="haiku_capacidad_totales_v1") return {data:{version:"total1_financiero_v32",writer_disponible:true,servicios_separados:true}};
            if (nombre==="haiku_cabanas_disponibles" || nombre==="haiku_confirmadas_sin_abono_asistente") return {data:[]};
            throw Error("Operación inesperada: "+nombre);
        },
        from(tabla) {
            if (!Object.hasOwn(tablas,tabla)) throw Error("Tabla fuera de la prueba: "+tabla);
            prueba.select.push(tabla);
            const filtros=[];
            const valor=(fila,k)=>k.split(".").reduce((a,b)=>a?.[b],fila);
            const datos=()=>tablas[tabla].filter(f=>filtros.every(p=>p(f)));
            const q={
                select:()=>q,order:()=>q,
                eq(k,v){filtros.push(f=>valor(f,k)===v);return q;},
                lte(k,v){filtros.push(f=>valor(f,k)<=v);return q;},
                gte(k,v){filtros.push(f=>valor(f,k)>=v);return q;},
                range:async (a,b)=>({data:datos().slice(a,b+1)}),
                single:async ()=>({data:datos()[0]}),
                then(ok,no){return Promise.resolve({data:datos()}).then(ok,no);}
            };
            return q;
        }
    };
}

async function abrir(browser,ancho,tema) {
    const page=await browser.newPage({timezoneId:"America/Santiago",viewport:{width:ancho,height:850}});
    const errores=[];
    page.on("pageerror",error=>errores.push(error.message));
    const url="https://haku-ayuda.test/";
    await page.route("**/*",r=>r.request().url()===url
        ? r.fulfill({contentType:"text/html",body:'<!doctype html><html lang="es"><meta name="viewport" content="width=device-width, initial-scale=1"><body></body></html>'})
        : r.abort());
    await page.clock.install({time:new Date("2026-11-12T14:00:00Z")});
    await page.goto(url);
    await page.evaluate(fuentes,tema);
    await page.evaluate(html=>{
        const fuente=new DOMParser().parseFromString(html,"text/html");
        document.body.append(document.importNode(fuente.getElementById("resumen-servicio-modal"),true));
    },leer("","index.html"));
    for (const css of ["supabase-asistente-v1","haiku-paleta-v1","sites-asistente-v1","haiku-tema-oscuro-v1","haiku-tema-v1"])
        await page.addStyleTag({content:leer("css",css+".css")});
    for (const script of scripts) await page.addScriptTag({content:leer("js",script+".js")});
    await page.getByRole("button",{name:"Abrir Haku",exact:true}).click();
    return {page,errores};
}

async function ayuda(browser,ancho,tema) {
    const {page,errores}=await abrir(browser,ancho,tema);
    try {
        const campo=page.locator("#haiku-asistente-texto");
        await campo.fill("Borrador para revisar");
        await page.locator("#haiku-asistente-rapidas summary").click();
        await page.getByRole("button",{name:"Ayuda",exact:true}).click();
        const panel=page.getByRole("region",{name:"Ayuda de Haku"});
        assert.equal(await campo.inputValue(),"Borrador para revisar");
        assert.equal(await panel.locator("summary").count(),7);
        const estilos=await panel.evaluate(el=>({
            desborde:el.scrollWidth>el.clientWidth+1,
            columnas:getComputedStyle(el.querySelector("details[open] ul")).gridTemplateColumns,
            fondo:getComputedStyle(el).backgroundColor
        }));
        assert.equal(estilos.desborde,false);
        assert.equal(estilos.columnas.split(" ").length,ancho>=701?2:1);
        assert.equal(estilos.fondo,tema==="oscuro"?"rgb(27, 38, 33)":"rgb(251, 252, 251)");
        const buscador=panel.getByRole("searchbox");
        await buscador.fill("remboso inexistente");
        assert.equal(await panel.getByText("No encontré una acción con esa búsqueda.").isVisible(),true);
        await buscador.fill("reembolsar");
        assert.equal(await panel.getByText("Editar, anular o reembolsar un pago",{exact:true}).isVisible(),true);
        await buscador.fill("ingresaservicio");
        const ejemplo=panel.getByRole("button",{name:/ingresaservicio tinaja/});
        const frase=await ejemplo.innerText();
        await ejemplo.click();
        assert.equal(await campo.inputValue(),frase);
        assert.equal(await page.locator(".haiku-asistente-mensaje--usuario").count(),0);
        assert.deepEqual(await page.evaluate(()=>prueba.rpc),[]);
        await panel.getByRole("button",{name:"Cerrar Ayuda"}).click();
        assert.equal(await panel.count(),0);
        await campo.fill("Haku, ¿qué te puedo pedir?");
        await campo.press("Control+Enter");
        assert.equal(await panel.isVisible(),true);
        assert.deepEqual(errores,[]);
    } finally {await page.close();}
}

async function comandos(browser) {
    const {page,errores}=await abrir(browser,1280,"oscuro");
    try {
        const campo=page.locator("#haiku-asistente-texto");
        const enviar=async texto=>{await campo.fill(texto);await page.locator("#haiku-asistente-enviar").click();};
        await enviar("Haku dame los ingrseos de hoy");
        await page.locator(".haku-operacion-card--ingresan").waitFor();
        assert.deepEqual(await page.evaluate(()=>prueba.rpc[0]),{
            nombre:"haiku_buscar_operacion_fecha_asistente",args:{p_fecha:"2026-11-12",p_tipo:"ingresan"}
        });
        await enviar("Haku, modifca el precio de CAB10 de Inés Rojas de hoy a 180 lucas");
        const total=page.locator(".haku-totales");
        await total.locator("[data-total-confirmar]").waitFor();
        assert.match(await total.innerText(),/CAB 10.*Inés Lucía Rojas Vera/);
        assert.match(await total.innerText(),/180\.000/);
        await total.locator("[data-total-cancelar]").click();

        await enviar("Haku ingresa este pago");
        assert.equal(await page.getByText(/Adjunta el comprobante o agrega titular/).isVisible(),true);
        assert.deepEqual(await page.evaluate(()=>prueba.edge),[]);
        await enviar("Haku ingresa este pago de Inés Rojas CAB3 por $30.000 hoy en débito Folio 000123 BOVTAR 0045");
        await page.waitForFunction(()=>prueba.edge.length===1 && !document.querySelector("#haiku-asistente-texto").disabled);
        const [invocacion]=await page.evaluate(()=>prueba.edge);
        assert.equal(invocacion.nombre,"haiku-asistente-pago-existente");
        assert.match(invocacion.body.mensaje,/Folio 000123 BOVTAR 0045$/);

        await enviar("Haku ingresaservicio tinaja las 20.45 tonel en cab 3");
        const servicio=page.locator(".haku-orden").last();
        assert.match(await servicio.innerText(),/CAB 3.*20:45/s);
        await servicio.getByRole("button",{name:"Revisar servicio"}).click();
        await page.waitForFunction(()=>document.getElementById("resumen-servicio-producto").value==="tinajaTonel");
        assert.equal(await page.locator("#resumen-servicio-hora").inputValue(),"20:45");
        assert.equal(await page.locator("#resumen-servicio-fecha").inputValue(),"2026-11-12");
        assert.match(await page.locator("#resumen-servicio-contexto").innerText(),/Inés Lucía Rojas Vera/);
        await page.locator("#resumen-servicio-modal").evaluate(el=>{el.hidden=true;});

        await enviar("Haku, modifca reserva Inés Rojas de CAB3 de hoy");
        await servicio.getByRole("button",{name:/Inés Lucía Rojas Vera · CAB 3/}).click();
        const [ficha]=await page.evaluate(()=>prueba.fichas);
        assert.equal(ficha.seleccion.numeroCabana,"3");
        assert.equal(ficha.seleccion.fecha,"2026-11-12");
        assert.deepEqual(await page.evaluate(()=>prueba.rpc.filter(x=>/cambiar_totales_lote|registrar_servicio|registrar_abonos/.test(x.nombre))),[]);
        assert.deepEqual(errores,[]);
    } finally {await page.close();}
}

(async()=>{
    const browser=await chromium.launch({executablePath:process.env.HAKU_CHROMIUM_PATH || undefined,headless:true});
    try {
        await comandos(browser);
        for (const ancho of [1280,390,320]) for (const tema of ["claro","oscuro"]) await ayuda(browser,ancho,tema);
        console.log("Haku Ayuda y rutas de ingresos, total, abono, servicio y ficha verificadas");
    } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
