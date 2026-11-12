const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {chromium} = require("playwright");
const raiz = path.resolve(__dirname,"..");
const leer=(carpeta,nombre)=>fs.readFileSync(path.join(raiz,carpeta,nombre),"utf8");
const scripts=[
    "haiku-libro-semantica-v1","haiku-reserva-estado-manual-v1","haiku-asistente-lenguaje-v1",
    "haiku-asistente-operaciones-v1","supabase-asistente-operaciones-v1","haiku-ayuda-v1","haiku-asistente-acciones-v1",
    "supabase-asistente-bove-escritura-v1","supabase-asistente-bove-consultas-v1",
    "supabase-asistente-servicios-cortesia-v1","supabase-asistente-servicios-cancelacion-v1",
    "supabase-asistente-servicios-reactivacion-v1","supabase-asistente-servicios-realizado-v1",
    "supabase-asistente-totales-v1","haiku-libro-consultas-v1","sites-resumen-servicio-v1",
    "supabase-asistente-v1","supabase-asistente-pagos-nocturnos-v1","supabase-asistente-pago-existente-v2",
    "supabase-asistente-estados-v1","supabase-asistente-aseo-v1","supabase-asistente-aseo-contexto-v1",
    "supabase-asistente-consulta-ingresos-v1","supabase-asistente-resumen-dia-v1","supabase-asistente-listado-cloudbeds-v2",
    "supabase-asistente-disponibilidad-v1","supabase-asistente-confirmadas-sin-abono-v1"
];

function fuentes(tema) {
    document.documentElement.dataset.haikuTema=tema;
    window.haikuSesion={auth:{id:"usuario"}};
    window.haikuTienePermiso=()=>true;
    window.prueba={rpc:[],edge:[],select:[],fichas:[],tablas:[]};
    const titular="Inés Lucía Rojas Vera";
    const uno={id:"11111111-1111-4111-8111-111111111111",titular_nombre:titular,
        codigo_haiku:"H-20261112-03-ABCDEF",estado_reserva:"confirmada",grupo_reserva_id:null,
        actualizado_en:"2026-11-12T12:00:00+00:00",telefono_contacto:"+56911110000",correo_contacto:"reserva@example.com"};
    const dos={...uno,id:"22222222-2222-4222-8222-222222222222",codigo_haiku:"H-20261112-10-FEDCBA"};
    const estadia=(id,reserva,numero)=>({
        id,reserva_id:reserva.id,cabana_id:"cab"+numero,cabanas:{numero},reservas:reserva,estado_estadia:"confirmada",
        fecha_ingreso:"2026-11-12",fecha_salida:"2026-11-13",tipo_estadia:"alojamiento",
        adultos:2,ninos:0,mascotas:0,noches:[{fecha:"2026-11-12",tarifa:160000}]
    });
    const cab3=estadia("33333333-3333-4333-8333-333333333333",uno,3);
    const cab10=estadia("44444444-4444-4444-8444-444444444444",dos,10);
    const tablas={
        reserva_estadias:[cab3,cab10],
        reservas:[{...uno,estadias:[cab3]},{...dos,estadias:[cab10]}],
        vista_saldos_alojamiento_reserva:[{reserva_id:uno.id,total_alojamiento:160000,saldo_alojamiento:0},{reserva_id:dos.id,total_alojamiento:160000,saldo_alojamiento:0}],
        vista_estado_cargos:[],
        aseos:[],
        revision_items:[{revision_id:"revision",estado:"ok",checklist_items:{nombre:"Toallas",categoria:"Baño"}}],
        solicitudes:[],usuarios:[],
        cabanas:[{id:"cab3",numero:3,activa:true,precio_base:160000},{id:"cab4",numero:4,activa:true,precio_base:170000}],
        revisiones_cabana:[{id:"revision",cabana_id:"cab3",fecha:"2026-11-12",estado:"en_proceso",resultado:null,
            tipo_revision:"aseo_express",actualizado_en:uno.actualizado_en}],
        servicios:[{id:"servicio",reserva_id:uno.id,estadia_id:cab3.id,fecha_servicio:"2026-11-12",hora_inicio:"18:00:00",
            hora_fin:"19:00:00",estado_servicio:"programado",total:30000,actualizado_en:uno.actualizado_en,
            catalogo_servicios:{codigo:"tinajaTonel",nombre:"Tinaja Tónel de Madera",categoria:"tinaja"}}],
        pagos:[{id:"pago",reserva_id:uno.id,tipo_movimiento:"pago",estado:"confirmado",etapa_operativa:"abono",
            medio_pago:"transferencia",moneda:"CLP",monto:80000,folio:"00123",fecha_pago:"2026-11-12T12:00:00+00:00",actualizado_en:uno.actualizado_en}],
        cargo_ajustes:[],
        catalogo_servicios:[{codigo:"tinajaTonel",nombre:"Tinaja Tónel de Madera",categoria:"tinaja",
            requiere_horario:true,activo:true,precio_base:30000,capacidad_maxima:3,permite_cortesia:true}]
    };
    window.HAIKU_INSPECTOR_V1={abrirReserva:async (id,boton,seleccion)=>{
        prueba.fichas.push({id,seleccion});return true;
    }};
    window.haikuLeerFichaSupabaseV2=async id=>{
        const reserva=[uno,dos].find(r=>r.id===id);
        const e=[cab3,cab10].find(f=>f.reserva_id===id);
        return reserva && {reserva,estadias:[{...e,cabana_numero:e.cabanas.numero}],huespedes:[],
            noches:e.noches.map(n=>({...n,estadia_id:e.id})),saldo:{saldo:80000},pagos:[]};
    };
    window.HAIKU_NOTAS_RESUMEN_SUPABASE_V1={guardar:async nota=>{
        prueba.tablas.push({tabla:"notas",nota});return {id:"nota"};
    }};
    window.HAIKU_ASEO_OPERACION_V1={
        fechaHoraSantiagoAISO:(dia,hora)=>dia+"T"+hora+":00-03:00",
        horaSantiago:t=>t?.slice(11,16)
    };
    const candidato = {reserva_id:uno.id,estadia_id:cab3.id,titular_nombre:titular,cabana_numero:3,
        fecha_ingreso:"2026-11-12",fecha_salida:"2026-11-13",estado_estadia:"confirmada",estado_reserva:"confirmada",
        total_alojamiento:160000,pagado_alojamiento:0,saldo_alojamiento:160000,tipo_estadia:"alojamiento",
        telefono_contacto:uno.telefono_contacto,codigo_haiku:uno.codigo_haiku,apta:true};
    const extraida = {titular_nombre:"Ana Pérez",fecha_llegada:"2026-11-13",fecha_salida:"2026-11-14",tipo_estadia:"alojamiento",
        cabana:4,adultos:2,ninos:0,noches:1,cloudbeds_id:"TEST0001",monto_total:170000};
    const pagoLeido = {monto:30000,medio:"efectivo",moneda:"CLP",fecha:"2026-11-12",detectado:true};
    window.cargarRespuestasDePrueba=()=>{
        prueba.respuestas=true;
        tablas.aseos.push({id:"aseo",fecha:"2026-11-12",cabana_id:"cab3",estado:"completado",
            encargado_nombre:"María Paz",revisor_nombre:"Rosa Vega",iniciado_en:"2026-11-12T13:00:00Z",
            completado_en:"2026-11-12T14:30:00Z",observaciones:"Dejar dos batas."});
        tablas.reservas[0].bove_cierre="16989";
        const huespedAnterior={id:"55555555-5555-4555-8555-555555555555",titular_nombre:"Persona Anterior",estado_reserva:"checked_out"};
        const estadiaAnterior={...estadia("66666666-6666-4666-8666-666666666666",huespedAnterior,3),
            estado_estadia:"checked_out",fecha_ingreso:"2026-11-11",fecha_salida:"2026-11-12"};
        tablas.reservas.push({...huespedAnterior,estadias:[estadiaAnterior]});
        tablas.reserva_estadias.push(estadiaAnterior);
        window.HAIKU_LIBRO_RESERVA_V1={
            listo:async()=>{},estado:()=>({cargado:true,nombre:"Libro de prueba.xlsx",generacion:1}),
            listarHojas:()=>["Nov26","Dic26"],
            consultarHoja:async hoja=>({reservas:hoja==="Nov26"?[{
                titular:"Ana Pérez",cabana:3,fecha_checkin:"2026-11-13",fecha_checkout:"2026-11-14",
                noches:1,fechas_ocupadas:["2026-11-13"],adultos:2,estado_confirmacion:"confirmada",
                pagos:[],pagos_pendientes:[],pagos_sin_asociacion:[],notas_importantes:["Dejar dos batas"],
                servicios:[{concepto:"Tinaja",texto_original:"Tónel 20:00"}],advertencias:[],
                coordenadas_origen:{hoja,celda:"M7"}
            }]:[],aseos:[{fecha:"2026-11-12",cabana:3,camarero:"María Paz"}],
                cobertura:{geometria:true},anotaciones:[],advertencias:[]})
        };
        window.HAIKU_SERVICIOS_TINAJAS_HORARIOS_V1={horariosDisponibles:async tipo=>{
            if (prueba.errorTinaja) throw Error("Agenda temporalmente no disponible.");
            return tipo==="tonel"?[{inicio:"18:00",fin:"19:00"},{inicio:"20:00",fin:"21:00"}]:[];
        }};
    };
    window.haikuSupabase={
        auth:{onAuthStateChange:()=>({}),getSession:async()=>({data:{session:{user:{id:"usuario"}}}})},
        functions:{invoke:async (nombre,{body})=>{
            prueba.edge.push({nombre,body});
            if (prueba.respuestas) {
                if (nombre==="haiku-asistente-reserva") {
                    const reserva=/full day/i.test(body.mensaje)?{...extraida,tipo_estadia:"full_day",fecha_salida:extraida.fecha_llegada,noches:0}:extraida;
                    const reservas=/dos reservas/i.test(body.mensaje)?[{reserva},{reserva:{...reserva,titular_nombre:"Rosa Vega",cabana:5,cloudbeds_id:"TEST0002"}}]:undefined;
                    return {data:{ok:true,preview:{confianza:"alta",reserva,reservas}}};
                }
                if (nombre.startsWith("haiku-asistente-pago-existente")) {
                    const entrada={reserva:{titular_nombre:titular,cabana:3},pagos:[pagoLeido]};
                    const reservas=/lote|estos pagos/i.test(body.mensaje)?[entrada,{...entrada,reserva:{titular_nombre:titular,cabana:10}}]:[entrada];
                    return {data:{ok:true,preview:{tipo_operacion:"registrar_pago",confianza:"alta",reservas}}};
                }
                if (nombre==="haiku-asistente-listado-reservas-cloudbeds-v2") return {data:{ok:true,lectura:{
                    aplica:true,confianza:"alta",reservas:[{nombre:"Ana",apellido:"Pérez",habitacion_codigo:"CAB 4",
                        categoria_habitacion:"Alojamiento",check_in:"2026-11-13",check_out:"2026-11-14",
                        precio_total:170000,adultos:2,estado:"Confirmada"}]
                }}};
            }
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
            if (nombre==="haiku_cabanas_disponibles") return {data:prueba.respuestas?[{numero:4},{numero:8}]:[]};
            if (nombre==="haiku_confirmadas_sin_abono_asistente") return {data:prueba.respuestas?[candidato]:[]};
            if (nombre==="haiku_buscar_checkins_fecha_asistente" || nombre==="haiku_buscar_reservas_pago_asistente") return {data:[candidato]};
            if (nombre==="haiku_editar_reserva_asistente_v1") return {data:{reserva_id:args.p_reserva_id}};
            if (nombre==="haiku_cambiar_estado_reserva_manual_v1") return {data:{ok:true,estado:args.p_estado}};
            if (nombre==="haiku_pago_asistente_v1") return {data:{ok:true,pago_id:args.p_pago_id}};
            if (nombre==="haiku_registrar_bloqueo_calendario") return {data:{bloqueo_id:"bloqueo"}};
            if (nombre==="haiku_reprogramar_servicio_asistente_v1")
                return {data:{servicio_id:args.p_servicio_id,fecha_servicio:args.p_fecha}};
            if (nombre==="haiku_guardar_bove_asistente_v1") return {data:{reserva_id:args.p_reserva_id,bove:args.p_bove}};
            throw Error("Operación inesperada: "+nombre);
        },
        from(tabla) {
            if (!Object.hasOwn(tablas,tabla)) throw Error("Tabla fuera de la prueba: "+tabla);
            prueba.select.push(tabla);
            const filtros=[];
            const valor=(fila,k)=>k.split(".").reduce((a,b)=>a?.[b],fila);
            const coincide=(f,k,p)=>{
                const [primero,...resto]=k.split(".");
                return Array.isArray(f[primero]) ? f[primero].some(r=>p(valor(r,resto.join(".")))) : p(valor(f,k));
            };
            const datos=()=>tablas[tabla].filter(f=>filtros.every(p=>p(f)));
            let mutacion;
            const q={
                select:()=>q,order:()=>q,limit:()=>q,or:()=>q,
                eq(k,v){filtros.push(f=>valor(f,k)===v);return q;},
                ilike(k,v){filtros.push(f=>String(valor(f,k)).toLowerCase().includes(v.replaceAll("%","").toLowerCase()));return q;},
                lt(k,v){filtros.push(f=>valor(f,k)<v);return q;},
                neq(k,v){filtros.push(f=>valor(f,k)!==v);return q;},
                in(k,v){filtros.push(f=>v.includes(valor(f,k)));return q;},
                lte(k,v){filtros.push(f=>coincide(f,k,x=>x<=v));return q;},
                gte(k,v){filtros.push(f=>coincide(f,k,x=>x>=v));return q;},
                range:async (a,b)=>({data:datos().slice(a,b+1)}),
                single:async ()=>({data:datos()[0]}),
                insert(parche){mutacion={tabla,parche};return q;},
                update(parche){mutacion={tabla,parche};return q;},
                maybeSingle:async ()=>{
                    if (!mutacion) return {data:datos()[0]};
                    prueba.tablas.push(mutacion);return {data:{id:"escritura-fixture"}};
                },
                then(ok,no){return Promise.resolve({data:datos()}).then(ok,no);}
            };
            return q;
        }
    };
}

async function abrir(browser,ancho,tema,webview=false) {
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
    for (const css of ["supabase-asistente-v1","supabase-haku-reconciliacion-v1","haiku-paleta-v1","sites-asistente-v1","haiku-tema-oscuro-v1","haiku-tema-v1"])
        await page.addStyleTag({content:leer("css",css+".css")});
    if (webview) {
        await page.evaluate(()=>{
            document.documentElement.dataset.hakuMobileAssistant="1";
            document.documentElement.classList.add("haku-mobile-assistant-ready");
        });
        await page.addStyleTag({content:leer("css","haku-mobile-assistant-v1.css")});
    }
    for (const script of scripts) await page.addScriptTag({content:leer("js",script+".js")});
    if (webview) await page.evaluate(()=>HAIKU_ASISTENTE.abrir());
    else await page.getByRole("button",{name:"Abrir Haku",exact:true}).click();
    return {page,errores};
}

async function ayuda(browser,ancho,tema,webview=false) {
    const {page,errores}=await abrir(browser,ancho,tema,webview);
    try {
        const campo=page.locator("#haiku-asistente-texto");
        await campo.fill("Borrador para revisar");
        await page.locator("#haiku-asistente-rapidas summary").click();
        await page.getByRole("button",{name:"Ayuda",exact:true}).click();
        const panel=page.getByRole("region",{name:"Ayuda de Haku"});
        assert.equal(await campo.inputValue(),"Borrador para revisar");
        assert.equal(await panel.locator(".haku-ayuda__grupo:visible").count(),1);
        assert.equal(await panel.locator("details[open]:visible").count(),0);
        const estilos=await panel.evaluate(el=>({
            desborde:el.scrollWidth>el.clientWidth+1,
            tapaAcciones:el.querySelector(".haku-ayuda__encabezado").getBoundingClientRect().bottom >
                el.querySelector(".haku-ayuda__contenido").getBoundingClientRect().top+1,
            columnas:getComputedStyle(el.querySelector(".haku-ayuda__contenido")).gridTemplateColumns,
            fondo:getComputedStyle(el).backgroundColor
        }));
        const escritorio=ancho>=701&&!webview;
        assert.equal(estilos.desborde,false);
        assert.equal(estilos.tapaAcciones,false);
        assert.equal(estilos.columnas.split(" ").length,escritorio?2:1);
        assert.equal(estilos.fondo,tema==="oscuro"?"rgb(27, 38, 33)":"rgb(251, 252, 251)");
        const buscador=panel.getByRole("searchbox");
        if (!escritorio) assert.equal(await buscador.evaluate(n=>n===document.activeElement),false);
        await panel.getByText("Resumen del día",{exact:true}).click();
        await panel.getByRole("button",{name:"Haku, resumen de hoy",exact:true}).waitFor();
        await panel.locator("summary").getByText("Ingresos",{exact:true}).click();
        assert.equal(await panel.locator("details[open]:visible").count(),1);
        await panel.locator("summary").getByText("Cabañas disponibles",{exact:true}).click();
        await panel.getByRole("button",{name:"Haku, ¿qué cabañas quedan libres mañana?",exact:true}).click();
        await page.locator(".haku-disponibilidad-card").waitFor({state:"visible"});
        assert.equal(await campo.inputValue(),"");
        assert.equal(await page.locator(".haiku-asistente-mensaje--usuario").count(),1);
        assert.deepEqual(await page.evaluate(()=>prueba.rpc),[{
            nombre:"haiku_cabanas_disponibles",
            args:{p_fecha_ingreso:"2026-11-13",p_fecha_salida:"2026-11-14",p_tipo_estadia:"alojamiento"}
        }]);
        if (escritorio) {
            const nav=panel.getByRole("navigation",{name:"Categorías de ayuda"});
            assert.equal(await nav.getByRole("button").count(),8);
            await nav.getByRole("button",{name:"Pagos y BOVE",exact:true}).click();
            assert.equal(await nav.getByRole("button",{name:"Pagos y BOVE",exact:true}).getAttribute("aria-pressed"),"true");
        } else {
            const categorias=panel.getByRole("combobox",{name:"Categoría de ayuda"});
            assert.equal(await categorias.locator("option").count(),8);
            await categorias.selectOption({label:"Pagos y BOVE"});
        }
        const pagos=panel.getByRole("region",{name:"Pagos y BOVE"});
        await pagos.waitFor();
        await buscador.fill("remboso inexistente");
        await panel.getByText("No encontré una acción con esa búsqueda.").waitFor({state:"visible"});
        await panel.getByRole("button",{name:"Limpiar búsqueda"}).click();
        await pagos.waitFor();
        await buscador.fill("reembolso");
        await panel.getByText("Preparar y registrar un reembolso",{exact:true}).waitFor({state:"visible"});
        await buscador.fill("ingresaservicio");
        const ejemplo=panel.getByRole("button",{name:/ingresaservicio tinaja/});
        await ejemplo.waitFor({state:"visible"});
        await ejemplo.press("Enter");
        const servicio=page.locator(".haku-orden").filter({hasText:"Agendar servicio"});
        await servicio.getByRole("button",{name:"Revisar servicio",exact:true}).waitFor();
        assert.match(await servicio.innerText(),/CAB 3[\s\S]*20:45/);
        assert.equal(await campo.inputValue(),"");
        assert.equal(await page.locator(".haiku-asistente-mensaje--usuario").count(),2);
        await buscador.fill("dejar dos batas");
        await panel.getByRole("button",{name:/anota nota de CAB 3 hoy/}).click();
        const nota=page.locator("[data-haku-operacion]").last();
        await nota.getByRole("button",{name:"Guardar nota",exact:true}).waitFor();
        assert.match(await nota.innerText(),/Dejar dos batas/);
        assert.equal(await campo.inputValue(),"");
        assert.deepEqual(await page.evaluate(()=>prueba.tablas),[]);
        assert.deepEqual(await page.evaluate(()=>prueba.edge),[]);
        await buscador.fill("informes cloudbeds");
        const selector = page.waitForEvent("filechooser");
        await panel.getByRole("button",{name:"Adjuntar informes",exact:true}).click();
        const archivos = await selector;
        assert.equal(archivos.isMultiple(),true);
        assert.match(await archivos.element().getAttribute("accept"),/\.pdf,.*\.xlsx/);
        assert.equal(await campo.inputValue(),"");
        await panel.getByRole("button",{name:"Cerrar Ayuda"}).click();
        assert.equal(await panel.count(),0);
        await campo.fill("Haku, ¿qué te puedo pedir?");
        await campo.press("Control+Enter");
        await panel.waitFor({state:"visible"});
        await buscador.fill("informes cloudbeds");
        await buscador.press("Escape");
        assert.equal(await buscador.inputValue(),"");
        await buscador.press("Escape");
        assert.equal(await panel.count(),0);
        assert.equal(await page.locator("#haiku-asistente-panel").isVisible(),true);
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

async function operaciones(browser,ancho,tema) {
    const {page,errores}=await abrir(browser,ancho,tema);
    const campo=page.locator("#haiku-asistente-texto");
    const enviar=async texto=>{
        await campo.fill(texto);
        await campo.press("Control+Enter");
        return page.locator("[data-haku-operacion]").last();
    };
    const confirmar=async (orden,boton,resultado)=>{
        const tarjeta=await enviar(orden);
        const cuenta=await page.evaluate(()=>prueba.rpc.length+prueba.tablas.length);
        await tarjeta.getByRole("button",{name:boton,exact:true}).waitFor();
        assert.equal(await page.evaluate(()=>prueba.rpc.length+prueba.tablas.length),cuenta);
        const medidas=await tarjeta.evaluate(e=>({ancho:e.clientWidth,scroll:e.scrollWidth,tema:getComputedStyle(e).backgroundColor}));
        assert.ok(medidas.scroll<=medidas.ancho+1);
        assert.equal(medidas.tema,tema==="oscuro"?"rgb(27, 38, 33)":"rgb(251, 252, 251)");
        await tarjeta.getByRole("button",{name:boton,exact:true}).click();
        await tarjeta.getByRole("status").getByText(resultado).waitFor();
        return tarjeta;
    };
    try {
        const edicion=await confirmar("Haku, modifca el correo de CAB 3 hoy a nuevo@example.com","Guardar cambios","Cambios de la reserva guardados.");
        assert.match(await edicion.innerText(),/reserva@example\.com → nuevo@example\.com/);
        await confirmar("cancela reserva de CAB 3 hoy","Confirmar cancelación","Estado guardado · Cancelada.");
        await confirmar("mueve el Tónel de CAB 3 hoy de las 18:00 a las 20.45","Confirmar horario",/Servicio reprogramado.*20:45–21:45/);
        await confirmar("corrige el abono folio 00123 de CAB 3 hoy a 90 lucas","Guardar corrección","Corrección del pago guardada.");
        await confirmar("anula el abono folio 00123 de CAB 3 hoy motivo: Duplicado","Anular registro","Registro anulado en Proyecto H.");
        await confirmar("registra devolución del abono folio 00123 de CAB 3 hoy, fecha hoy, medio transferencia, comprobante DEV-123, motivo: Duplicado",
            "Registrar devolución realizada","Devolución registrada en Proyecto H.");
        await confirmar("bloquea CAB 4 mañana por mantención","Confirmar bloqueo","Bloqueo guardado.");
        await confirmar("anota nota de CAB 3 hoy: Dejar dos batas","Guardar nota","Nota guardada.");
        await confirmar("registra aseo de CAB 3 hoy IN 10:00 OUT 11:30 encargado María Paz","Guardar aseo","Aseo guardado.");
        await confirmar("marca revisión express lista de CAB 3 hoy","Guardar estado","Estado de revisión guardado.");
        const msg=await enviar("Haku, envía WhatsApp a CAB 3 hoy: Hola, ¿a qué hora llegan?");
        const href=await msg.getByRole("link",{name:"Abrir WhatsApp"}).getAttribute("href");
        assert.equal(new URL(href).pathname,"/56911110000");
        assert.equal(new URL(href).searchParams.get("text"),"Hola, ¿a qué hora llegan?");

        await enviar("ingresa BOVE 19800 de alojamiento a CAB3");
        const bove=page.locator(".haku-bove-preparacion");
        await bove.getByRole("button",{name:"Confirmar BOVE"}).waitFor();
        assert.equal(await page.evaluate(()=>prueba.rpc.filter(x=>x.nombre==="haiku_guardar_bove_asistente_v1").length),0);
        await bove.getByRole("button",{name:"Confirmar BOVE"}).click();
        await bove.getByRole("status").getByText("BOVE 19800 de alojamiento guardado en Proyecto H.").waitFor();
        const llamadas=await page.evaluate(()=>prueba.rpc);
        assert.deepEqual(llamadas.find(x=>x.nombre==="haiku_editar_reserva_asistente_v1").args.p_datos,
            {campo:"correo_contacto",valor:"nuevo@example.com"});
        assert.equal(llamadas.find(x=>x.nombre==="haiku_reprogramar_servicio_asistente_v1").args.p_hora,"20:45");
        assert.equal(llamadas.find(x=>x.nombre==="haiku_pago_asistente_v1").args.p_datos.monto,90000);
        assert.equal(llamadas.find(x=>x.nombre==="haiku_guardar_bove_asistente_v1").args.p_estadias[0].cabana_numero,3);
        assert.deepEqual(errores,[]);
    } finally {await page.close();}
}

async function comprobarTarjeta(tarjeta, tema) {
    await tarjeta.waitFor({ state:"visible",timeout:5000 });
    const estilo=await tarjeta.evaluate(el=>{
        const rect=el.getBoundingClientRect();
        const chat=el.closest(".haiku-asistente-mensajes");
        const css=getComputedStyle(chat);
        const ancho=chat.clientWidth-parseFloat(css.paddingLeft)-parseFloat(css.paddingRight);
        const luminosidad=color=>{
            const componentes=color.match(/[\d.]+/g).slice(0,3).map(x=>Number(x)/255);
            const lineal=componentes.map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);
            return .2126*lineal[0]+.7152*lineal[1]+.0722*lineal[2];
        };
        const estilo=getComputedStyle(el);
        const titulo=el.querySelector("h3, .haiku-asistente-preview-cabecera strong");
        const texto=luminosidad(getComputedStyle(titulo || el).color);
        const fondo=luminosidad(estilo.backgroundColor);
        return {margen:Math.abs(rect.width-ancho),desborde:el.scrollWidth>el.clientWidth+1,
            fondo:estilo.backgroundColor,contraste:(Math.max(texto,fondo)+.05)/(Math.min(texto,fondo)+.05)};
    });
    assert.ok(estilo.margen<=2, `aprovecha el ancho del panel: ${estilo.margen}`);
    assert.equal(estilo.desborde,false);
    assert.equal(estilo.fondo,tema==="oscuro"?"rgb(27, 38, 33)":"rgb(251, 252, 251)");
    assert.ok(estilo.contraste>=4.5,`contraste del encabezado: ${estilo.contraste}`);
}

async function respuestas(browser, ancho, tema, webview) {
    const {page,errores}=await abrir(browser,ancho,tema,webview);
    const campo=page.locator("#haiku-asistente-texto");
    const boton=page.locator("#haiku-asistente-enviar");
    const chat=page.locator("#haiku-asistente-mensajes");
    const enviar=async orden=>{await campo.fill(orden);await boton.click();};
    const vista=async (orden,selector,texto)=>{
        const tarjetas=chat.locator(selector);
        const previas=await tarjetas.count();
        await enviar(orden);
        const tarjeta=tarjetas.nth(previas);
        await comprobarTarjeta(tarjeta,tema);
        if(texto) assert.match(await tarjeta.innerText(),texto,orden);
        return tarjeta;
    };
    const revisarCuadricula=async (tarjeta,selector,columnasWeb=2)=>{
        const columnas=await tarjeta.locator(selector).first().evaluate(el=>getComputedStyle(el).gridTemplateColumns);
        assert.equal(columnas.split(" ").length,webview?1:columnasWeb);
    };
    const png={name:"captura-de-prueba.png",mimeType:"image/png",buffer:Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC5sAAAAASUVORK5CYII=","base64")};
    try {
        await page.evaluate(()=>cargarRespuestasDePrueba());
        for (const [consulta,tipo] of [["dame los ingresos de hoy","ingresan"],["pásame las salidas de mañana","salen"],
            ["¿qué reservas continúan hoy?","continuan"]]) {
            const tarjeta=await vista(`Haku, ${consulta}`,`.haku-operacion-card--${tipo}`,/Inés Lucía Rojas Vera/);
            assert.equal(await tarjeta.locator(".haku-respuesta__fila").count(),1);
            assert.match(await tarjeta.locator(".haku-respuesta__contexto").innerText(),/1 reserva$/);
        }
        await vista("Haku, ¿qué cabañas quedan libres mañana?",".haku-disponibilidad-card",/CAB 4\s+CAB 8/);
        const tinajas=await vista("Haku, pásame los horarios de las tinajas de hoy",".haku-disponibilidad-card--servicio",/18:00–19:00/);
        await revisarCuadricula(tinajas,".haku-disponibilidad-servicios");
        assert.match(await tinajas.innerText(),/Jacuzzi[\s\S]*Sin horarios disponibles/);
        await page.evaluate(()=>{prueba.errorTinaja=true;});
        await enviar("Haku, ¿qué horas tiene libres el Tónel mañana?");
        await chat.getByText("Agenda temporalmente no disponible.",{exact:true}).waitFor({timeout:5000});
        const confirmadas=await vista("Haku, muéstrame las reservas confirmadas sin abono",".haku-confirmadas-sin-abono",/Saldo pendiente \$160\.000/);
        await confirmadas.locator("summary").click();
        assert.match(await confirmadas.innerText(),/Reserva Haiku[\s\S]*H-20261112-03-ABCDEF/);

        await vista("Haku, ¿quién hizo el aseo de CAB 3 hoy?",".haku-aseo-card",/María Paz/);
        await vista("Haku, checklist de aseo express de CAB 3 hoy",".haku-aseo-card",/Toallas/);
        await vista("Haku, compara el aseo de CAB 3 el 12/11/2026",".haku-aseo-card",/Proyecto H[\s\S]*Libro/);
        await vista("Haku, ¿quién estuvo antes que Inés Lucía Rojas Vera en CAB 3?",".haku-aseo-card",/Persona Anterior/);
        await vista("Haku, ¿quién revisó el aseo después del check-out de Persona Anterior en CAB 3?",
            "[data-haku-aseo-contexto]",/Rosa Vega/);
        await vista("Haku, dime detalles de esa revisión","[data-haku-aseo-contexto]",/Dejar dos batas/);

        await vista("Haku, busca BOVE 16989 en Proyecto H",".haku-bove-consulta",/16989[\s\S]*Inés Lucía Rojas Vera/);
        const varios=await vista("Haku, busca BOVE 16989 y 18000 en Proyecto H",".haku-bove-consulta",/2 números/);
        assert.equal(await varios.locator(":scope > details").count(),2);
        await varios.locator(":scope > details > summary").first().click();
        assert.match(await varios.innerText(),/Inés Lucía Rojas Vera/);
        await vista("Haku, ¿cuál es el último BOVE?",".haku-bove-consulta",/mayor número observado 16989/i);
        await vista("Haku, ¿qué BOVE están pendientes hoy?",".haku-bove-consulta",/BOVE pendientes/);
        await vista("Haku, compara los BOVE del Libro con Proyecto H",".haku-bove-consulta",/Libro de Reservas/);
        await vista("Libro: lista las hojas",".haku-libro-lectura",/Nov26\s+Dic26/);
        const libro=await vista("Libro: CAB 3 el 13/11/2026",".haku-libro-lectura",/Ana Pérez/);
        await revisarCuadricula(libro,".haku-respuesta__datos");
        assert.match(await libro.innerText(),/Tónel 20:00[\s\S]*Nov26!M7/);
        await vista("Libro: CAB 3 el 18/11/2026",".haku-libro-lectura",/Sin reservas identificadas/);

        const total=await vista("Haku, cambia el precio del CAB 10 de Inés Rojas de hoy a CLP 180.000",".haku-totales",/Propuesto[\s\S]*180\.000/);
        await revisarCuadricula(total,".haku-totales__montos",3);
        await total.locator("[data-total-cancelar]").click();
        assert.match(await total.innerText(),/Cambio de total cancelado/);

        const previa=".haku-propuesta-compacta";
        const reserva=await vista("Haku, prepara una reserva para Ana Pérez del 13 al 14 de noviembre de 2026 en CAB 4 para 2 adultos",previa,/Ana Pérez/);
        await revisarCuadricula(reserva,".haiku-asistente-preview-grid");
        assert.equal(await reserva.getByRole("button",{name:"Confirmar y crear"}).isEnabled(),true);
        const fullDay=await vista("Haku, crea un Full Day para Ana Pérez el 13/11/2026 en CAB 4 para 2 adultos",previa,/Full Day[\s\S]*Requisitos para guardar/);
        assert.equal(await fullDay.getByRole("button",{name:"Vista previa de Full Day"}).isDisabled(),true);
        await vista("Haku, prepara estas dos reservas. Ana Pérez, CAB 4, 13 al 14/11/2026. Rosa Vega, CAB 5, 13 al 14/11/2026.",previa,/2 reservas detectadas/);
        await vista("Haku, marca como hospedadas las reservas que ingresan hoy en CAB 3",previa,/Estado actual[\s\S]*Nuevo estado\s+Hospedado/);
        await vista("Haku, registra un abono de $30.000 en efectivo pagado hoy por Inés Rojas, CAB 3",previa,/\$30\.000/);
        await vista("Haku, carga estos pagos a reservas existentes: Inés Rojas CAB 3 $30.000 en efectivo e Inés Rojas CAB 10 $30.000 en efectivo",
            previa,/2 reservas por revisar/);

        const archivos=page.locator("#haiku-asistente-archivos");
        await archivos.setInputFiles(png);
        await vista("Haku, revisa esta captura de una reserva",previa,/Ana Pérez/);
        await archivos.setInputFiles(png);
        const listado=await vista("Haku, lee este listado de reservas de Cloudbeds","[data-haku-listado-cloudbeds-v2]",/Precio Total/);
        await listado.getByText("Reglas de importación",{exact:true}).click();
        assert.match(await listado.innerText(),/Depósito y Saldo Pendiente son sólo informativos/);

        assert.equal(await page.evaluate(()=>prueba.rpc.some(x=>/hospedar_lote|cambiar_totales_lote|registrar_abonos|crear_reserva/.test(x.nombre))),false);
        assert.deepEqual(await page.evaluate(()=>prueba.tablas),[]);
        assert.deepEqual(errores,[]);
    } finally {await page.close();}
}

(async()=>{
    const browser=await chromium.launch({executablePath:process.env.HAKU_CHROMIUM_PATH || undefined,headless:true});
    try {
        await comandos(browser);
        for (const tema of ["claro","oscuro"]) {
            await respuestas(browser,1280,tema,false);
            await respuestas(browser,390,tema,true);
        }
        for (const ancho of [1280,390,320]) for (const tema of ["claro","oscuro"]) await ayuda(browser,ancho,tema);
        for (const tema of ["claro","oscuro"]) await ayuda(browser,390,tema,true);
        for (const ancho of [1280,390,320]) for (const tema of ["claro","oscuro"]) await operaciones(browser,ancho,tema);
        console.log("Haku Ayuda, órdenes nuevas y rutas anteriores verificadas en escritorio, móvil y ambos temas");
    } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
