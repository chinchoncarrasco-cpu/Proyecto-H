(() => {
    "use strict";

    const raiz = document.getElementById("seccion-inventario");
    if (!raiz) return;
    const cuerpo = raiz.querySelector("[data-inv-contenido]");
    const menu = document.querySelector('[data-seccion="inventario"]');
    const dialogo = raiz.querySelector("dialog");
    const aviso = raiz.querySelector("[data-inv-aviso]");
    const estados = ["Disponible", "Crítico", "Agotado"];
    const numero = new Intl.NumberFormat("es-CL");
    const fechas = new Intl.DateTimeFormat("en-CA", { timeZone:"America/Santiago", year:"numeric", month:"2-digit", day:"2-digit" });
    const codificar = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c]);
    const busqueda = (v) => v.normalize("NFD").replace(/\p{M}/gu,"").toLowerCase().trim();
    const fechaCorta = (v) => v ? v.split("-").reverse().join("/") : "—";
    const fechaHoy = () => {
        const partes = fechas.formatToParts(new Date());
        return ["year","month","day"].map(tipo => partes.find(p => p.type === tipo).value).join("-");
    };
    const medidaIcono = new Set(["articulos","criticos","agotados","descargar","quitar"]);
    function icono(nombre) {
        const size = medidaIcono.has(nombre) ? 16 : 18;
        return `<span class="inv-icono" aria-hidden="true" style="width:${size}px;height:${size}px;mask-image:url(assets/inventario/${nombre}.svg)"></span>`;
    }
    const vacio = (mensaje) => `<p class="inv-vacio">${codificar(mensaje)}</p>`;
    const boton = (accion, texto, extra = "", clase = "") => `<button class="inv-boton ${clase}" type="button" data-accion="${accion}" ${extra}>${texto}</button>`;
    const opcion = (v, texto, actual) => `<option value="${codificar(v)}" ${v === actual ? "selected" : ""}>${codificar(texto)}</option>`;
    const estadoChip = (estado) => `<span class="inv-estado" data-estado="${codificar(estado)}">${codificar(estado)}</span>`;
    const signo = (m) => (m.tipo === "salida" ? "−" : "+") + numero.format(m.cantidad);
    const tipoTexto = (tipo) => tipo === "salida" ? "Salida" : "Entrada";
    const puedeVer = () => window.haikuTienePermiso?.("inventario.ver") === true;
    const activo = () => raiz.classList.contains("activa");
    const cliente = () => window.haikuSupabase;
    const articulos = () => modelo.catalogo?.articulos ?? [];
    const seleccionado = () => articulos().find(a => a.codigo === modelo.seleccion);
    const gestiona = () => modelo.catalogo?.puede_gestionar === true;

    function modeloInicial() {
        return {
            vista:"existencias", catalogo:null, error:"", filtro:"", categoria:"", estado:"", pagina:0,
            seleccion:"", ficha:false, historial:null, movimientos:null, movError:"",
            filtrosMov:{ busqueda:"", tipo:"", desde:"", hasta:"", codigo:"", pagina:0, limite:25 },
            abiertas:new Set(), completas:new Set(),
        };
    }

    let modelo = modeloInicial(), sesion = null, generacion = 0;
    let catalogoId = 0, historialId = 0, movimientosId = 0, filtrarTimer, avisoTimer;
    let conectado = false, guardando = false, tipoDialogo = "", solicitud = null;

    async function consultar(vista, filtros = {}) {
        if (!cliente()) throw new Error("Conexión de Inventario no disponible.");
        const {data, error} = await cliente().rpc("haiku_inventario_leer_v1", {p_vista:vista,p_filtros:filtros});
        if (error) throw error;
        return data;
    }

    function temporal(texto) {
        clearTimeout(avisoTimer);
        aviso.textContent = texto;
        aviso.hidden = false;
        avisoTimer = setTimeout(() => { aviso.hidden = true; }, 5500);
    }
    function mensaje(error, base) {
        return ["P0001","22023","42501","23505"].includes(error?.code) ? error.message : base;
    }

    async function cargarCatalogo() {
        if (!puedeVer() || !activo()) return;
        const token = ++catalogoId, vigente = generacion;
        try {
            const catalogo = await consultar("existencias");
            if (token !== catalogoId || vigente !== generacion) return;
            modelo.catalogo = catalogo;
            modelo.error = "";
            if (!seleccionado()) {
                modelo.seleccion = articulos()[0]?.codigo ?? "";
                modelo.ficha = false;
            }
            if (modelo.abiertas.size === 0 && !modelo.catalogoMostrado) {
                modelo.abiertas.add(articulos()[0]?.categoria);
                modelo.catalogoMostrado = true;
            }
            renderizar();
            if (modelo.vista === "movimientos") cargarMovimientos();
            else cargarHistorial();
        } catch (error) {
            if (token !== catalogoId || vigente !== generacion) return;
            if (error?.code === "42501") modelo.catalogo = null;
            modelo.error = mensaje(error, "No se pudo cargar el inventario.");
            renderizar();
        }
    }

    async function cargarHistorial() {
        const articulo = seleccionado();
        const token = ++historialId, vigente = generacion;
        if (!articulo) return;
        try {
            const data = await consultar("movimientos",{codigo:articulo.codigo,limite:6});
            if (vigente !== generacion || token !== historialId) return;
            modelo.historial = {codigo:articulo.codigo,...data};
        } catch {
            if (vigente !== generacion || token !== historialId) return;
            modelo.historial = {codigo:articulo.codigo,error:"No se pudo consultar el historial."};
        }
        renderizar();
    }

    async function cargarMovimientos() {
        const token = ++movimientosId, vigente = generacion;
        try {
            const data = await consultar("movimientos",modelo.filtrosMov);
            if (vigente !== generacion || token !== movimientosId) return;
            if (data.total === 0 && modelo.filtrosMov.pagina > 0) {
                modelo.filtrosMov.pagina = 0;
                return cargarMovimientos();
            }
            modelo.movimientos = data;
            modelo.movError = "";
        } catch (error) {
            if (vigente !== generacion || token !== movimientosId) return;
            modelo.movError = mensaje(error,"No se pudieron cargar los movimientos.");
        }
        renderizar();
    }

    function metricas() {
        const tarjetas = [["Artículos","total","articulos",articulos().length],
            ...estados.map((estado,i) => [["Disponibles","Críticos","Agotados"][i],estado,["disponibles","criticos","agotados"][i],articulos().filter(a => a.estado === estado).length])];
        return `<div class="inv-metricas">${tarjetas.map(([label,estado,imagen,n]) => `
            <div class="inv-metrica" data-estado="${estado}"><span class="inv-metrica-icono">${icono(imagen)}</span>
                <div><span class="inv-subtexto">${label}</span><strong>${numero.format(n)}</strong></div></div>`).join("")}</div>`;
    }
    function paginacion(total, p, segmento, extra = "") {
        const limite = segmento === "mov" ? modelo.filtrosMov.limite : 10;
        const label = segmento === "mov" ? "movimientos" : "artículos";
        const desde = total ? p*limite+1 : 0;
        return `<div class="inv-paginacion ${extra}"><span class="inv-subtexto">${desde}–${Math.min(total,(p+1)*limite)} de ${total} ${label}</span>
            <div class="inv-acciones">${boton(segmento+"-anterior", icono("anterior"), 'aria-label="Página anterior" '+(p===0?"disabled":""))}
                ${boton(segmento+"-siguiente",icono("siguiente"),'aria-label="Página siguiente" '+((p+1)*limite>=total?"disabled":""))}</div></div>`;
    }
    const campoBuscar = (nombre, valor, placeholder) => `<label class="inv-campo-buscar">${icono("buscar")}
        <input class="inv-control" type="search" name="${nombre}" aria-label="${placeholder}" placeholder="${placeholder}" value="${codificar(valor)}" autocomplete="off"></label>`;

    function filaArticulo(a, movil) {
        const codigo = codificar(a.codigo);
        const nombre = codificar(a.descripcion);
        if (movil) return `<button type="button" class="inv-fila-movil" data-accion="seleccionar" data-codigo="${codigo}">
            <span><strong>${nombre}</strong><small class="inv-subtexto">${codigo}</small></span><strong>${numero.format(a.stock)}</strong>
            ${estadoChip(a.estado)}${icono("siguiente")}</button>`;
        return `<tr data-codigo="${codigo}" data-seleccionado="${a.codigo===modelo.seleccion}">
            <td class="inv-texto-tabla">${codigo}</td><td><button class="inv-articulo" type="button" data-accion="seleccionar" data-codigo="${codigo}">${nombre}</button></td>
            <td class="inv-texto-tabla">${codificar(a.categoria)}</td><td class="inv-num">${numero.format(a.entradas)}</td>
            <td class="inv-num">${numero.format(a.salidas)}</td><td class="inv-num"><strong>${numero.format(a.stock)}</strong></td>
            <td class="inv-num inv-texto-tabla">${numero.format(a.stock_minimo)}</td><td>${estadoChip(a.estado)}</td><td>${icono("siguiente")}</td></tr>`;
    }
    function tabla(cabeceras, filas, clase = "", numericas = []) {
        return `<div class="inv-tabla-wrap ${clase}"><table class="inv-tabla"><thead><tr>
            ${cabeceras.map((t,i) => `<th scope="col" ${numericas.includes(i)?'class="inv-num"':""}>${t}</th>`).join("")}
            </tr></thead><tbody>${filas}</tbody></table></div>`;
    }

    function ficha() {
        const a = seleccionado();
        if (!a) return "";
        const h = modelo.historial?.codigo === a.codigo ? modelo.historial : null;
        const lista = h?.movimientos?.length
            ? h.movimientos.map((m,i) => `<div class="inv-movimiento-breve ${i>=4?"inv-solo-movil":""}"><span><strong>${tipoTexto(m.tipo)}</strong><small class="inv-subtexto">${fechaCorta(m.fecha)}</small></span>
                <strong>${signo(m)}</strong></div>`).join("")
            : vacio(h?.error || (h ? "Sin movimientos registrados." : "Cargando historial…"));
        return `<aside class="inv-tarjeta inv-ficha" aria-label="Ficha del artículo">
            <div class="inv-ficha-top"><span class="inv-subtexto">${codificar(a.codigo)}</span>${estadoChip(a.estado)}</div>
            <h2>${codificar(a.descripcion)}</h2><p class="inv-subtexto">${codificar(a.categoria)}</p>
            <div class="inv-ficha-saldo"><div><span class="inv-subtexto">Stock actual</span><strong>${numero.format(a.stock)}</strong></div>
                <div><span class="inv-subtexto">Stock mínimo</span><strong>${numero.format(a.stock_minimo)}</strong></div></div>
            <div class="inv-ficha-totales inv-subtexto"><span>Entradas<strong>${numero.format(a.entradas)}</strong></span><span>Salidas<strong>${numero.format(a.salidas)}</strong></span></div>
            <div class="inv-ficha-top inv-ficha-historial"><h3>Últimos movimientos</h3>${boton("ver-historial","Ver historial","data-plano")}</div>
            ${lista}
            ${gestiona() ? `<div class="inv-acciones">${boton("movimiento-ficha","Registrar movimiento")}${boton("retirar",icono("quitar")+"Quitar de la lista","data-peligro")}</div>` : ""}
            </aside>`;
    }

    function existencias() {
        const filtro = busqueda(modelo.filtro);
        const lista = articulos().filter(a => (!modelo.categoria || a.categoria===modelo.categoria) &&
            (!modelo.estado || a.estado===modelo.estado) && busqueda(a.codigo+" "+a.descripcion).includes(filtro));
        modelo.pagina = Math.min(modelo.pagina,Math.max(0,Math.ceil(lista.length/10)-1));
        const categorias = modelo.catalogo.categorias;
        const grupos = categorias.map(c => {
            const filas = lista.filter(a => a.categoria === c);
            if (!filas.length) return "";
            const completa = modelo.completas.has(c) || filtro || modelo.categoria;
            return `<details class="inv-grupo" data-grupo="${codificar(c)}" ${modelo.abiertas.has(c)||filtro||modelo.categoria?"open":""}>
                <summary><span>${codificar(c)}</span><span class="inv-subtexto">${filas.length} ${icono("desplegar")}</span></summary>
                ${filas.slice(0,completa ? undefined : 6).map(a=>filaArticulo(a,true)).join("")}
                ${!completa && filas.length>6 ? `<button type="button" class="inv-mas-grupo" data-accion="mas-articulos" data-grupo="${codificar(c)}">Ver los ${filas.length} artículos ${icono("siguiente")}</button>` : ""}
                </details>`;
        }).join("");
        return `<div class="inv-volver">${boton("volver",icono("anterior")+"Existencias","data-plano")}</div>
            <div class="inv-distribucion"><div class="inv-tarjeta">
                <div class="inv-filtros">${campoBuscar("filtro",modelo.filtro,"Buscar por nombre o código…")}
                    <select class="inv-control" name="categoria" aria-label="Categoría">${opcion("","Todas las categorías",modelo.categoria)}${categorias.map(c=>opcion(c,c,modelo.categoria)).join("")}</select>
                    <select class="inv-control" name="estado" aria-label="Estado">${opcion("","Todos los estados",modelo.estado)}${estados.map(e=>opcion(e,e,modelo.estado)).join("")}</select>
                </div>
                ${lista.length ? tabla(["Código","Artículo","Categoría","Entradas","Salidas","Stock","Mín.","Estado",""],lista.slice(modelo.pagina*10,modelo.pagina*10+10).map(a=>filaArticulo(a,false)).join(""),"inv-escritorio",[3,4,5,6]) : vacio("No hay artículos para estos filtros.")}
                <div class="inv-lista-movil" ${grupos?"":"hidden"}>${grupos}</div>
                ${lista.length ? paginacion(lista.length,modelo.pagina,"stock","inv-escritorio") : ""}
            </div>${ficha()}</div>`;
    }

    function movimientos() {
        const f = modelo.filtrosMov;
        const datos = modelo.movimientos;
        const filas = datos?.movimientos ?? [];
        return `<div class="inv-tarjeta inv-contenedor-movimientos"><div class="inv-filtros">
            ${campoBuscar("busqueda",f.busqueda,"Buscar artículo o código…")}
            <select class="inv-control" name="tipo" aria-label="Tipo de movimiento">${[["","Todos los movimientos"],["entrada","Entradas"],["salida","Salidas"]].map(([v,l])=>opcion(v,l,f.tipo)).join("")}</select>
            <label class="inv-filtro-fecha">Desde<input class="inv-control" type="date" name="desde" value="${codificar(f.desde)}"></label>
            <label class="inv-filtro-fecha">Hasta<input class="inv-control" type="date" name="hasta" value="${codificar(f.hasta)}"></label>
            ${f.codigo ? boton("todos-mov","Artículo "+codificar(f.codigo)+" · Quitar filtro") : ""}
            </div>
            ${modelo.movError ? vacio(modelo.movError) : filas.length ? `
                ${tabla(["Fecha","Tipo","Artículo","Categoría","Cantidad","Responsable","Comentario"],filas.map(m=>`<tr>
                    <td>${fechaCorta(m.fecha)}</td><td>${tipoTexto(m.tipo)}</td><td><strong>${codificar(m.descripcion)}</strong><br><small class="inv-subtexto">${codificar(m.codigo)}</small></td>
                    <td>${codificar(m.categoria)}</td><td class="inv-num"><strong>${signo(m)}</strong></td><td>${codificar(m.responsable||"—")}</td><td>${codificar(m.comentario||"—")}</td></tr>`).join(""),"inv-escritorio",[4])}
                <div class="inv-lista-movil">${filas.map(m=>`<div class="inv-movimiento-breve">
                    <span><strong>${codificar(m.descripcion)}</strong><small class="inv-subtexto">${tipoTexto(m.tipo)} · ${fechaCorta(m.fecha)} · ${codificar(m.codigo)}</small>
                    ${m.responsable||m.comentario ? `<small>${codificar([m.responsable,m.comentario].filter(Boolean).join(" · "))}</small>` : ""}</span><strong>${signo(m)}</strong></div>`).join("")}</div>
                ${paginacion(datos.total,f.pagina,"mov")}` : vacio(datos?"No hay movimientos para estos filtros.":"Cargando movimientos…")}
            </div>`;
    }

    function renderizar() {
        const teniaFoco = cuerpo.contains(document.activeElement) ? document.activeElement : null;
        const foco = teniaFoco?.name;
        const cursor = foco && teniaFoco.type === "search" ? teniaFoco.selectionStart : null;
        cuerpo.dataset.ficha = String(modelo.ficha && modelo.vista === "existencias");
        if (!puedeVer()) {
            cuerpo.innerHTML = '<h1 id="inventario-titulo">Inventario</h1>'+vacio("Inicia sesión con acceso a Inventario.");
            return;
        }
        const catalogo = modelo.catalogo;
        cuerpo.innerHTML = `<header class="inv-cabecera"><div><h1 id="inventario-titulo">Inventario</h1>
            ${catalogo ? `<p class="inv-subtexto">Último movimiento · ${fechaCorta(catalogo.ultimo_movimiento)}</p>` : ""}</div>
            ${catalogo ? `<div class="inv-acciones">${boton("descargar",icono("descargar")+"Descargar")}
            ${gestiona()?boton("agregar",icono("agregar")+"Agregar artículo")+boton("movimiento","+ Registrar movimiento", "data-primario "+(articulos().length?"":"disabled")):""}</div>` : ""}</header>
            ${modelo.error ? `<div class="inv-filtros"><p role="alert">${codificar(modelo.error)}</p>${boton("actualizar","Volver a intentar")}</div>` : ""}
            ${catalogo ? metricas()+`<div class="inv-tabs" aria-label="Vista de inventario">
                ${[["existencias","Existencias"],["movimientos","Movimientos"]].map(([id,t])=>`<button type="button" class="inv-tab" data-accion="vista" data-vista="${id}" aria-pressed="${modelo.vista===id}">${t}</button>`).join("")}</div>`
                +(modelo.vista==="existencias"?existencias():movimientos()) : (modelo.error?"":vacio("Cargando inventario…"))}`;
        const nuevo = foco ? cuerpo.querySelector("[name='"+foco+"']") : null;
        if (nuevo) {
            nuevo.focus({preventScroll:true});
            if (cursor!==null) nuevo.setSelectionRange(cursor,cursor);
        }
    }

    function abrirDialogo(tipo, a = null) {
        if (dialogo.open || (tipo !== "descargar" && !gestiona())) return;
        tipoDialogo = tipo;
        solicitud = null;
        dialogo.dataset.panel = String(tipo==="agregar" || tipo==="movimiento");
        dialogo.dataset.movilHoja = String(tipo==="descargar");
        dialogo.dataset.previa = "false";
        const titulo = {agregar:"Agregar artículo",movimiento:"Registrar movimiento",retirar:"Quitar de la lista",descargar:"Descargar inventario"}[tipo];
        let campos, acciones;
        if (tipo === "agregar") {
            campos = `<label>Descripción<input class="inv-control" name="descripcion" required maxlength="200"></label>
                <div class="inv-dos-campos"><label>Código<input class="inv-control" name="codigo" required maxlength="24" pattern="[A-Za-z0-9][A-Za-z0-9._\\-]{0,23}" autocapitalize="characters"></label>
                <label>Categoría<select class="inv-control" name="categoria" required>${opcion("","Seleccionar","")}${modelo.catalogo.categorias.map(c=>opcion(c,c,"")).join("")}</select></label></div>
                <div class="inv-dos-campos"><label>Stock mínimo<input class="inv-control" name="stock_minimo" type="number" min="0" step="1" max="2147483647" value="0" required></label>
                <label>Stock inicial (opcional)<input class="inv-control" name="stock_inicial" type="number" min="0" step="1" max="2147483647" value="0"></label></div>
                <p class="inv-subtexto">El stock inicial se registra como una entrada.</p>`;
        } else if (tipo === "movimiento") {
            campos = `<div><p>Tipo de movimiento</p><div class="inv-dos-campos">
                ${boton("tipo-entrada","Entrada",'aria-pressed="true"')}${boton("tipo-salida","Salida",'aria-pressed="false"')}</div></div>
                <input type="hidden" name="tipo" value="entrada">
                <label>Artículo<select class="inv-control" name="codigo" required>
                ${articulos().map(x=>opcion(x.codigo,x.codigo+" · "+x.descripcion,a?.codigo||modelo.seleccion)).join("")}</select></label>
                <div class="inv-dos-campos"><label>Cantidad<input class="inv-control" name="cantidad" type="number" min="1" step="1" max="2147483647" required></label>
                <label>Fecha<input class="inv-control" name="fecha" type="date" value="${fechaHoy()}" min="1900-01-01" max="9999-12-31" required></label></div>
                <div class="inv-ficha-saldo"><div><span class="inv-subtexto">Stock actual</span><strong data-stock-actual></strong></div>
                <div><span class="inv-subtexto">Stock resultante</span><strong data-stock-resultante></strong></div></div>
                <label>Responsable<input class="inv-control" name="responsable" maxlength="120" placeholder="Nombre (opcional)"></label>
                <label>Comentario<textarea class="inv-control" name="comentario" maxlength="1000" rows="3" placeholder="Agregar un comentario (opcional)"></textarea></label>`;
        } else if (tipo === "retirar") {
            campos = `<p>¿Quitar <strong>${codificar(a.descripcion)}</strong> de Existencias?</p>
                <p class="inv-subtexto">${codificar(a.codigo)} · Stock registrado ${numero.format(a.stock)}</p>
                <p class="inv-subtexto">Sus movimientos se conservan en el historial.</p>
                <input type="hidden" name="codigo" value="${codificar(a.codigo)}"><input type="hidden" name="stock" value="${a.stock}">`;
        } else {
            campos = `<p class="inv-subtexto">Incluye Inventario, Entradas y Salidas.</p>
                ${["xlsx","pdf"].map((formato,i)=>boton("archivo-"+formato,icono(i?"pdf":"excel")
                    +`<span>Descargar ${i?"PDF":"Excel"}<small class="inv-subtexto">${i?"Documento para enviar":"Libro editable con tres hojas"}</small></span>`
                    +icono("descargar"), "", "inv-opcion-archivo")).join("")}`;
        }
        acciones = tipo==="descargar" ? "" : `<div class="inv-acciones">${boton("cerrar","Cancelar")}
            <button class="inv-boton" type="submit" data-primario>${tipo==="agregar"?"Guardar artículo":tipo==="retirar"?"Quitar de la lista":"Guardar movimiento"}</button></div>`;
        dialogo.innerHTML = `<form><div class="inv-cabecera"><h2 id="inv-dialogo-titulo">${titulo}</h2>${boton("cerrar","Cerrar","data-plano")}</div>
            <fieldset>${campos}</fieldset><p role="alert" hidden></p>${acciones}</form>`;
        dialogo.showModal();
        if (tipo === "movimiento") previsualizarStock();
    }

    function previsualizarStock() {
        const form = dialogo.querySelector("form");
        const a = articulos().find(i=>i.codigo===form.elements.codigo.value);
        if (!a) return;
        const cantidad = Number(form.elements.cantidad.value || 0);
        const salida = form.elements.tipo.value === "salida";
        form.querySelector("[data-stock-actual]").textContent = numero.format(a.stock);
        form.querySelector("[data-stock-resultante]").textContent = numero.format(a.stock+(salida?-cantidad:cantidad));
        form.elements.cantidad.setCustomValidity(salida&&cantidad>a.stock ? "La cantidad supera el stock disponible." : "");
    }
    function bloqueo(estado) {
        guardando = estado;
        dialogo.querySelectorAll("button,fieldset").forEach(b=>{ b.disabled=estado; });
    }
    function alertaDialogo(texto) {
        const nodo = dialogo.querySelector('[role="alert"]');
        nodo.textContent = texto;
        nodo.hidden = !texto;
    }

    async function previsualizarArchivo(formato) {
        const vigente = generacion;
        bloqueo(true);
        alertaDialogo("");
        try {
            const datos = await consultar("exportar");
            if (vigente !== generacion) return;
            const nombre = formato === "xlsx" ? "Excel" : "PDF";
            const stock = datos.articulos.slice(0,8).map(a => [
                a.codigo,a.descripcion,a.categoria,a.stock,a.stock_minimo,
                a.estado==="Crítico"?"!":a.estado==="Agotado"?"×":"",a.estado,
            ]);
            const movimientosDe = tipo => datos.movimientos.filter(m=>m.tipo===tipo).slice(0,8)
                .map(m=>[m.codigo,m.descripcion,m.categoria,fechaCorta(m.fecha),m.cantidad,m.comentario,m.responsable]);
            const filas = valores => valores.map(r => `<tr>${r.map(c=>`<td>${codificar(c)}</td>`).join("")}</tr>`).join("");
            const papel = (titulo,encabezados,valores) => `<section class="inv-papel"><h3>${titulo}</h3>${tabla(encabezados,filas(valores))}</section>`;
            const cabeceraMov = ["Código","Descripción","Categoría","Fecha","Cantidad","Comentario","Responsable"];
            tipoDialogo = "descargar";
            dialogo.dataset.previa = "true";
            dialogo.dataset.movilHoja = "false";
            dialogo.querySelector("form").innerHTML = `
                <div class="inv-cabecera"><h2 id="inv-dialogo-titulo">${nombre} · Inventario nuevo</h2>${boton("cerrar","Cerrar")}</div>
                <p class="inv-subtexto">Muestra de la plantilla · Desliza para ver las columnas</p>
                <div class="inv-vista-archivo" tabindex="0" aria-label="Vista previa del archivo">
                ${papel("INVENTARIO",["Código","Descripción","Categoría","Stock","Stock mínimo",".","Estado"],stock)}
                ${papel("ENTRADAS",cabeceraMov,movimientosDe("entrada"))}
                ${papel("SALIDAS",cabeceraMov,movimientosDe("salida"))}</div>
                <p role="alert" hidden></p><div class="inv-acciones">${boton("guardar-archivo-"+formato,icono("descargar")+"Descargar "+nombre,"data-primario")}</div>`;
        } catch {
            if (vigente===generacion) alertaDialogo("No se pudo consultar la vista del archivo.");
        } finally {
            if (vigente===generacion) bloqueo(false);
        }
    }

    dialogo.addEventListener("submit",async e => {
        e.preventDefault();
        if (guardando || tipoDialogo === "descargar" || !gestiona()) return;
        const datos = Object.fromEntries(new FormData(e.target));
        const serial = JSON.stringify(datos);
        if (solicitud?.serial !== serial) solicitud = {serial,id:crypto.randomUUID()};
        const vigente = generacion, tipo = tipoDialogo;
        bloqueo(true);
        alertaDialogo("");
        try {
            const {data,error} = await cliente().rpc("haiku_inventario_guardar_v1",{p_accion:tipo,p_datos:datos,p_solicitud:solicitud.id});
            if (error) throw error;
            if (vigente !== generacion) return;
            dialogo.close();
            if (tipo === "agregar") modelo.seleccion = data.codigo;
            if (tipo === "retirar") modelo.ficha = false;
            temporal(tipo==="agregar"?"Artículo agregado.":tipo==="retirar"?"Artículo retirado de Existencias.":"Movimiento registrado.");
            await cargarCatalogo();
        } catch (error) {
            if (vigente === generacion) alertaDialogo(mensaje(error,"No se pudo guardar. Revisa los datos o vuelve a intentar."));
        } finally {
            if (vigente === generacion) bloqueo(false);
        }
    });
    async function descargar(formato) {
        if (guardando) return;
        const vigente = generacion;
        bloqueo(true);
        alertaDialogo("");
        try {
            const {data,error} = await cliente().functions.invoke("haiku-inventario-exportar",{body:{formato}});
            if (error || !data?.base64) throw error || new Error("Archivo no disponible.");
            if (vigente !== generacion) return;
            const archivo = new Blob([Uint8Array.from(atob(data.base64), c=>c.charCodeAt(0))],{type:data.mime});
            const url = URL.createObjectURL(archivo);
            const enlace = Object.assign(document.createElement("a"),{href:url,download:data.nombre});
            document.body.append(enlace);
            enlace.click();
            enlace.remove();
            setTimeout(()=>URL.revokeObjectURL(url),1500);
            dialogo.close();
            temporal("Descarga preparada.");
        } catch {
            if (vigente === generacion) alertaDialogo("No se pudo descargar el archivo. Vuelve a intentar.");
        } finally {
            if (vigente === generacion) bloqueo(false);
        }
    }

    dialogo.addEventListener("click", e => {
        if (guardando) return;
        const accion = e.target.closest("[data-accion]")?.dataset.accion;
        if (accion === "cerrar" || e.target === dialogo) dialogo.close();
        if (accion?.startsWith("archivo-")) previsualizarArchivo(accion.slice(8));
        if (accion?.startsWith("guardar-archivo-")) descargar(accion.slice(16));
        if (accion === "tipo-entrada" || accion === "tipo-salida") {
            dialogo.querySelector("[name=tipo]").value = accion.slice(5);
            dialogo.querySelectorAll("[aria-pressed]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.accion===accion)));
            previsualizarStock();
        }
    });
    dialogo.addEventListener("cancel", e=>{ if (guardando) e.preventDefault(); });
    dialogo.addEventListener("input", ()=>{ if (tipoDialogo==="movimiento") previsualizarStock(); });
    dialogo.addEventListener("change", e=>{
        if (tipoDialogo==="movimiento" && e.target.name==="codigo") previsualizarStock();
    });
    cuerpo.addEventListener("click", e => {
        const b = e.target.closest("[data-accion]") || e.target.closest("tr[data-codigo]");
        if (!b) return;
        const accion = b.dataset.accion || "seleccionar";
        if (accion === "seleccionar") {
            modelo.seleccion = b.dataset.codigo;
            modelo.ficha = true;
            modelo.historial = null;
            cargarHistorial();
        } else if (accion === "vista" || accion === "ver-historial" || accion === "todos-mov") {
            modelo.vista = b.dataset.vista || "movimientos";
            modelo.ficha = false;
            modelo.filtrosMov.codigo = accion==="ver-historial" ? modelo.seleccion : "";
            modelo.filtrosMov.pagina = 0;
            modelo.movimientos = null;
            modelo.movError = "";
            if (modelo.vista === "movimientos") cargarMovimientos();
            else cargarHistorial();
        } else if (accion === "volver") modelo.ficha = false;
        else if (accion === "mas-articulos") modelo.completas.add(b.dataset.grupo);
        else if (accion.startsWith("stock-")) modelo.pagina += accion.endsWith("anterior") ? -1 : 1;
        else if (accion.startsWith("mov-")) {
            modelo.filtrosMov.pagina += accion.endsWith("anterior") ? -1 : 1;
            cargarMovimientos();
        } else if (accion === "actualizar") cargarCatalogo();
        else {
            const articulo = seleccionado();
            if (accion === "retirar" && !articulo) return;
            abrirDialogo(accion === "movimiento-ficha" ? "movimiento" : accion,articulo);
            return;
        }
        renderizar();
    });
    cuerpo.addEventListener("toggle", e => {
        const nodo = e.target;
        if (!nodo.dataset.grupo || modelo.filtro || modelo.categoria) return;
        if (nodo.open) modelo.abiertas.add(nodo.dataset.grupo);
        else modelo.abiertas.delete(nodo.dataset.grupo);
    }, true);
    function filtrar(e) {
        const {name,value} = e.target;
        if (["filtro","categoria","estado"].includes(name)) {
            modelo[name] = value;
            modelo.pagina = 0;
            renderizar();
        } else if (["busqueda","tipo","desde","hasta"].includes(name)) {
            modelo.filtrosMov[name] = value;
            modelo.filtrosMov.pagina = 0;
            clearTimeout(filtrarTimer);
            filtrarTimer = setTimeout(cargarMovimientos,name==="busqueda"?230:0);
        }
    }
    cuerpo.addEventListener("input", e=>{ if (e.target.type==="search") filtrar(e); });
    cuerpo.addEventListener("change", e=>{ if (e.target.type!=="search") filtrar(e); });

    function limpiarSesion() {
        ++generacion;
        sesion = null;
        modelo = modeloInicial();
        clearTimeout(filtrarTimer);
        guardando = false;
        if (dialogo.open) dialogo.close();
        dialogo.replaceChildren();
        aviso.hidden = true;
        menu.hidden = true;
        cuerpo.replaceChildren();
    }
    function iniciarSesion() {
        const id = window.haikuSesion?.auth?.id;
        if (!id || !puedeVer()) { limpiarSesion(); return; }
        if (sesion !== id) limpiarSesion();
        sesion = id;
        menu.hidden = false;
        if (activo()) { renderizar(); cargarCatalogo(); }
    }
    function conectar() {
        if (conectado || !cliente()) return;
        conectado = true;
        cliente().auth.onAuthStateChange(evento=>{ if (evento==="SIGNED_OUT") limpiarSesion(); });
        if (window.haikuSesion) iniciarSesion();
    }
    window.addEventListener("haiku:auth-ready",iniciarSesion);
    document.addEventListener("haiku:supabase-ready",conectar);
    new MutationObserver(() => {
        if (activo() && puedeVer()) { renderizar(); cargarCatalogo(); }
    }).observe(raiz,{attributes:true,attributeFilter:["class"]});
    document.addEventListener("visibilitychange",()=>{ if (!document.hidden) cargarCatalogo(); });
    conectar();
})();
