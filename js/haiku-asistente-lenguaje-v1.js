// Adapta las palabras de la orden. Los nombres, comprobantes y observaciones conservan su texto.
(function (root) {
    "use strict";

    const normalizar = valor => String(valor ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    const sinVocativo = valor => String(valor ?? "").trim().replace(/^[¿¡\s]*(?:(?:oye|hola)\s+)?(?:haku|haiku)\b[\s,;:¡!¿?–—-]*/i, "");
    function limpiarOrden(valor,preservarFinal=false) {
        const inicio=sinVocativo(valor).replace(/^(?:por\s+favor|porfa|me\s+puedes|puedes|podr[ií]as)\b[\s,;:]+/i,"")
            .replace(/^(?:me\s+(?:das|muestras|dices|pasas)|d[eé]jame\s+ver)\s+/i,"muestra ");
        return (preservarFinal ? inicio : inicio.replace(/[\s,]+(?:por\s+favor|porfa)[.!?]*$/i,"").replace(/[!?]+$/,"")).trim();
    }
    const variantesVerbo = {
        muestra:"muestra", mostrar:"muestra", muestrame:"muestra", muestame:"muestra",
        dame:"muestra", da:"muestra", pasame:"muestra", traeme:"muestra", dime:"muestra", digame:"muestra", listame:"muestra",
        cambia:"cambia", cambiar:"cambia", cambiame:"cambia", cambialo:"cambia", camvia:"cambia", camba:"cambia", cambai:"cambia",
        modifica:"modifica", modificar:"modifica", modificame:"modifica", modifca:"modifica", modfica:"modifica",
        edita:"edita", editar:"edita", editame:"edita", corrige:"edita", corrjge:"edita",
        fija:"fija", deja:"deja", dejame:"deja", pon:"pon", ponme:"pon", pone:"pon",
        registra:"registra", registrar:"registra", registrame:"registra", rejistra:"registra", regsitra:"registra",
        ingresa:"ingresa", ingresar:"ingresa", ingresame:"ingresa", ingesa:"ingresa", ingrsa:"ingresa",
        agrega:"agrega", agregar:"agrega", agregame:"agrega", agrgea:"agrega", anota:"anota", anotame:"anota",
        mete:"ingresa", meteme:"ingresa", carga:"ingresa", cargame:"ingresa",
        agenda:"agenda", agendar:"agenda", agendame:"agenda", ajenda:"agenda", programa:"agenda", programame:"agenda",
        reserva:"reserva", reservame:"reserva", crea:"crea", creame:"crea", prepara:"prepara", preparame:"prepara",
        abre:"abre", abrir:"abre", abreme:"abre", busca:"busca", buscar:"busca", buscame:"busca", ver:"ver",
        compara:"compara", comparar:"compara", comparame:"compara", comprara:"compara", coteja:"compara",
        cancela:"cancela", cancelame:"cancela", canecela:"cancela", anula:"cancela",
        reactiva:"reactiva", reactivame:"reactiva", reativa:"reactiva",
        marca:"marca", marcame:"marca", mraca:"marca", pasa:"pasa", pasalo:"pasa"
    };

    function orden(texto,preservarFinal=false) {
        const limpia = limpiarOrden(texto,preservarFinal);
        const separada = limpia.replace(/^(ingresa|ingesa|ingr[eé]same|registra|reg[ií]strame|agrega|agenda|crea)(?=(?:servicios?|pagos?|abonos?|reservas?|tinajas?)\b)/i, "$1 ");
        const m = separada.match(/^(\p{L}+)[\s,;:]+([\s\S]*)$/u);
        return { limpia:separada, verbo:m ? (variantesVerbo[normalizar(m[1])] || normalizar(m[1])) : "", resto:m?.[2] || "" };
    }

    function corregirEntidadInicial(resto) {
        return resto.replace(/^((?:(?:el|la|los|las|un|una|este|esta|estos|estas|del|de)\s+)*)(ingrseos|ingrsos|ingresoss|salidass|resumne|resuemn|titualres|titulaers|cbanas|cabaans|tinaha|tinahas|pagso|servicos|resrva)\b/i,
            (_, prefijo, palabra) => prefijo + ({
                ingrseos:"ingresos", ingrsos:"ingresos", ingresoss:"ingresos", salidass:"salidas", resumne:"resumen", resuemn:"resumen",
                titualres:"titulares", titulaers:"titulares", cbanas:"cabañas", cabaans:"cabañas", tinaha:"tinaja", tinahas:"tinajas",
                pagso:"pagos", servicos:"servicios", resrva:"reserva"
            }[normalizar(palabra)]));
    }

    function adaptarComparacion(verbo,resto,libro) {
        if (verbo!=="compara") return null;
        const contenido=corregirEntidadInicial(resto);
        const t=normalizar(contenido);
        const asunto=/^(?:(?:solo|los|las)\s+)*(?:reservas?|titulares|pagos?|abonos?|servicios?|notas?)\b/.test(t);
        if (!asunto || !libro && !/\b(?:proyecto\s+h|libro)\b/.test(t)) return null;
        const periodo=/\b(?:(del?|para|durante|en)\s+)?(?:mes actual|este mes|mes siguiente|pr[oó]ximo mes|mes pasado|mes anterior)\b/i;
        const diaActual=hoy();
        const explicito=contenido.replace(periodo,(valor,preposicion)=>{
            const [year,month]=diaActual.split("-").map(Number);
            const desplazamiento=/siguiente|proximo/.test(normalizar(valor)) ? 1 : /pasado|anterior/.test(normalizar(valor)) ? -1 : 0;
            const mes=new Date(Date.UTC(year,month-1+desplazamiento,1));
            return (preposicion?"de ":"")+meses[mes.getUTCMonth()]+" "+mes.getUTCFullYear();
        }).replace(/\b(hoy|ma[nñ]ana|ayer)\b/gi,valor=>fechaLiteral(valor,diaActual).split("-").reverse().join("/"));
        return "Libro: compara "+explicito;
    }

    const adaptarLectura=contenido=>"Haku, muestra "+contenido.replace(
        /^((?:(?:las|los)\s+)?)continuaciones\b/i, "las reservas que continúan");

    function adaptarOrden(texto) {
        const original = String(texto ?? "").trim();
        const {limpia, verbo, resto} = orden(original,true);
        if (!limpia) return original;
        const explicito=limpia.match(/^libro\s*:\s*([\s\S]+)/i);
        const ordenLibro=explicito ? orden(explicito[1]) : {verbo,resto};
        const comparacion=adaptarComparacion(ordenLibro.verbo,ordenLibro.resto,Boolean(explicito));
        if (comparacion) return comparacion;
        const contenido = corregirEntidadInicial(resto || limpia);
        const t = normalizar(contenido);
        const entidad = t.replace(/^(?:(?:el|la|los|las|un|una|este|esta|estos|estas)\s+)+/, "");
        const pago = /^(?:pagos?|abonos?)\b/.test(entidad);
        const reserva = /^reservas?\b/.test(entidad);
        const lectura = /^(?:ingresos?|llegadas?|salidas?|continuaciones?|reservas?|huespedes?|titulares|cabanas|horarios?|tinajas?|disponibilidad|resumen|aseo|revision|confirmadas|bove|abonos|pagos|cuales|quienes|que|cuantas?)\b/.test(entidad);
        if (["registra","ingresa","agrega","anota"].includes(verbo) && pago && !/\b(?:nueva reserva|libro)\b/.test(t))
            return "Haku, registra " + contenido;
        if (["ingresa","crea","prepara","agrega","reserva"].includes(verbo) && reserva)
            return "Haku, prepara " + contenido;
        if (verbo === "muestra" && /^(?:informe de actualizacion|cambios del libro)$/.test(entidad))
            return "Haku, "+entidad;
        if (verbo === "muestra" && lectura) return adaptarLectura(contenido);
        const directa = corregirEntidadInicial(limpia);
        if (/^(?:(?:los|las|el)\s+)?(?:ingresos|salidas|llegadas|continuaciones|titulares|resumen|cabanas libres)\b/.test(normalizar(directa)))
            return adaptarLectura(directa);
        if (verbo === "compara" && /\b(?:libro|proyecto h|titulares|servicios|pagos|reservas|notas)\b/.test(t))
            return "Haku, compara " + contenido;
        if (["cancela","reactiva","marca","pasa","cambia","pon","deja"].includes(verbo) &&
            /\b(?:tinaja|tonel|jacuzzi|masaje|servicio|hospedad[oa]s?|bove)\b/.test(t)) {
            // Estas formas de hora sólo se convierten cuando hay un marcador horario.
            const conHora = contenido.replace(/(\b(?:a\s+las?|hora|las)\s+)(\d{1,2})[.h](\d{2})(?![\d.])/gi, "$1$2:$3");
            return "Haku, " + verbo + " " + conHora;
        }
        return original;
    }

    const meses = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
    const patronFecha = /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}[-/.]\d{1,2}[-/.](?:\d{4}|\d{2})|\d{1,2}\/\d{1,2}|\d{1,2}\s+(?:de\s+)?(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s+(?:de\s+)?\d{4})?|hoy|ma[nñ]ana|ayer)\b/gi;
    const formatoChile = new Intl.DateTimeFormat("en-CA",{timeZone:"America/Santiago",year:"numeric",month:"2-digit",day:"2-digit"});
    function hoy(instante = new Date()) {
        const p = Object.fromEntries(formatoChile.formatToParts(instante).map(x => [x.type,x.value]));
        return p.year + "-" + p.month + "-" + p.day;
    }

    function iso(year,mes,dia) {
        const f = new Date(Date.UTC(Number(year),Number(mes)-1,Number(dia)));
        return f.getUTCFullYear() === Number(year) && f.getUTCMonth() === Number(mes)-1 && f.getUTCDate() === Number(dia)
            ? f.toISOString().slice(0,10) : null;
    }

    function fechaLiteral(texto,diaActual) {
        const t = normalizar(texto);
        if (["hoy","manana","ayer"].includes(t)) {
            const diferencia = t === "ayer" ? -1 : t === "manana" ? 1 : 0;
            return new Date(Date.parse(diaActual) + diferencia * 86400000).toISOString().slice(0,10);
        }
        if (/^\d{4}-/.test(t)) return iso(...t.split("-"));
        const n = t.match(/^(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2,4}))?$/);
        if (n) return iso(n[3] ? (n[3].length === 2 ? 2000 + Number(n[3]) : n[3]) : diaActual.slice(0,4),n[2],n[1]);
        const letras = t.match(/^(\d{1,2})\s+(?:de\s+)?([a-z]+)(?:\s+(?:de\s+)?(\d{4}))?$/);
        if (!letras) return null;
        return iso(letras[3] || diaActual.slice(0,4),meses.indexOf(letras[2] === "setiembre" ? "septiembre" : letras[2])+1,letras[1]);
    }

    function extraerFecha(texto,diaActual=hoy()) {
        const fechas = [...texto.matchAll(patronFecha)];
        if (fechas.length > 1) return {error:"Indica una sola fecha para esta operación."};
        if (!fechas.length) return {fecha:null,resto:texto};
        const [m] = fechas;
        const fecha = fechaLiteral(m[0],diaActual);
        if (!fecha) return {error:"Revisa el día y el mes de la fecha indicada."};
        const previo = texto.slice(0,m.index);
        const marca = previo.match(/\b(?:del?\s+|con\s+)?(ingreso|salida|check[\s-]?in|check[\s-]?out)\s*(?:del?|el)?\s*$/i);
        const modoFecha = marca ? (/ingreso|in$/i.test(marca[1]) ? "ingreso" : "salida") : "estadia";
        const comienzo = marca ? previo.slice(0,marca.index) :
            previo.replace(/\b(?:(?:de\s+)?fecha\s*:?|del?|el|para(?:\s+el)?|en)\s*$/i,"");
        return {fecha,modoFecha,resto:(comienzo + " " + texto.slice(m.index+m[0].length)).trim()};
    }

    function extraerCabana(texto) {
        const cabanas = [...texto.matchAll(/\b(?:cab(?:a[nñ]a)?\.?|cba\.?)\s*#?\s*(\d{1,2})\b/gi)];
        if (cabanas.length > 1 || cabanas.some(m => Number(m[1]) < 1)) return {error:"Indica una sola cabaña válida."};
        if (!cabanas.length) return {cabana:null,resto:texto};
        const [m] = cabanas;
        return {cabana:Number(m[1]),resto:(texto.slice(0,m.index).replace(/\b(?:del?|en|a|para|la)\s*$/i,"") +
            " " + texto.slice(m.index+m[0].length)).trim()};
    }

    function limpiarTitular(valor) {
        const nombre=valor.replace(/^[\s,·.:–—-]+|[\s,·.:–—-]+$/g,"").trim()
            .replace(/^(?:(?:del?|la|el|reserva|ficha|para|a nombre de|titular)\s*[:·]?\s+)+/i,"")
            .replace(/\s+(?:de|del|en|para)$/i,"").replace(/\s+/g," ").trim();
        return /^(?:del?|la|el|reserva|ficha|para|titular)$/i.test(nombre) ? "" : nombre;
    }

    const nombreValido = nombre => /^[\p{L}][\p{L}\p{M}.'’ -]*$/u.test(nombre) &&
        !/\b(?:cab(?:ana)?|fecha|precio|total|hoy|ayer|manana|reserva|semana|mes|pagos?|servicios?|todos)\b/.test(normalizar(nombre));

    function importeClp(texto) {
        const m = texto.trim().match(/^(?:(?:clp\s*)?\$\s*|clp\s*)?(\d{1,3}(?:[. ]\d{3})+|\d+)(?:\s*(mil|lucas|k))?(?:\s*(?:clp|pesos))?\.?$/i);
        if (!m || m[2] && /[. ]/.test(m[1])) return null;
        const n = Number(m[1].replace(/[. ]/g,"")) * (m[2] ? 1000 : 1);
        return Number.isSafeInteger(n) && n > 0 ? n : null;
    }

    function totalAlFinal(texto) {
        const limites = [...texto.matchAll(/\s+(?:a|en|por)\s+/gi)].reverse();
        for (const m of limites) {
            const total = importeClp(texto.slice(m.index+m[0].length));
            if (total !== null) return {destino:texto.slice(0,m.index),total};
        }
        return null;
    }

    function interpretarTotal(texto,{diaActual=hoy(),max=20}={}) {
        let {limpia,verbo,resto} = orden(texto);
        const invertida = limpia.match(/^reserva\s+(.+?)\s+(cambia|cambiame|modifica|modifca|fija)\s+(?:el\s+)?(?:precio(?:\s+total)?|total|valor)\s+(?:a|en)\s+([\s\S]+)$/i);
        if (invertida) {
            verbo = "cambia";
            resto = "total " + invertida[1] + " a " + invertida[3];
        }
        if (!["cambia","modifica","edita","fija","deja","pon"].includes(verbo)) return null;
        const campo = resto.match(/^(?:(?:el|los|la)\s+)?(?:precio(?:\s+total)?|total(?:es)?|valor)\b(?:\s+de\s+alojamiento\b)?\s*/i);
        if (!campo) return null;
        const cuerpo = resto.slice(campo[0].length);
        const entradas = [];
        if (/\b(?:por\s+noche|cada\s+noche|tarifa\s+diaria|descuento|recargo)\b/i.test(cuerpo))
            return {error:"Por chat se puede cambiar el total de alojamiento. Abre Editar reserva para cambiar una tarifa por noche o un ajuste."};
        const partes = [];
        let inicio = 0;
        for (const corte of cuerpo.matchAll(/\s+y\s+|[,;\r\n]+/gi)) {
            const parte = cuerpo.slice(inicio,corte.index);
            if (!totalAlFinal(parte)) continue;
            partes.push(parte.trim());
            inicio = corte.index+corte[0].length;
        }
        partes.push(cuerpo.slice(inicio).trim());
        if (partes.length > max) return {error:"Indica entre 1 y " + max + " reservas con su nuevo total."};
        for (const parte of partes) {
            const importe = totalAlFinal(parte);
            if (!importe) return {error:"Indica un total CLP entero positivo. Ejemplo: cambia el precio de CAB 5 Ana Pérez a $180.000."};
            const f = extraerFecha(importe.destino,diaActual);
            if (f.error) return f;
            const c = extraerCabana(f.resto);
            if (c.error) return c;
            const titular = limpiarTitular(c.resto);
            if (!nombreValido(titular) || titular.split(/\s+/).length < 2)
                return {error:"Indica el titular. Agrega cabaña y fecha si tiene más de una reserva."};
            entradas.push({titular,cabana:c.cabana,total_objetivo:importe.total,origen:"chat",
                ...(f.fecha ? {fecha:f.fecha,modoFecha:f.modoFecha} : {})});
        }
        return {entradas};
    }

    function coincideNombre(real,pedido,contextoCompleto=false) {
        const clave = v => normalizar(v).replace(/[^\p{L}\p{M}\p{N}]+/gu," ").trim();
        const a=clave(real),b=clave(pedido);
        if (!a || !b) return false;
        if (a === b || a.split(" ").sort().join(" ") === b.split(" ").sort().join(" ")) return true;
        const sem = root.HAIKU_LIBRO_SEMANTICA;
        if (sem?.mismaPersona?.(real,pedido)) return true;
        if (!contextoCompleto) return false;
        const partes = x => new Set(x.split(" ").filter(y => y.length >= 3 && !/^(?:del|las|los)$/.test(y)));
        const reales=partes(a),buscadas=partes(b);
        if (buscadas.size >= 2 && [...buscadas].every(p => reales.has(p))) return true;
        return sem?.varianteTitular?.(real,pedido) === "errata";
    }

    function coincideFecha(estadia,fecha,modo="estadia") {
        if (!fecha) return true;
        const ingreso=estadia.fecha_ingreso,salida=estadia.fecha_salida;
        if (!ingreso || !salida) return false;
        if (modo === "ingreso") return ingreso === fecha;
        if (modo === "salida") return salida === fecha;
        if (modo === "incluyeSalida") return ingreso <= fecha && fecha <= salida;
        return ingreso === salida ? fecha === ingreso : ingreso <= fecha && fecha < salida;
    }

    const api = Object.freeze({normalizar,orden,limpiarOrden,corregirEntidadInicial,adaptarOrden,hoy,extraerFecha,extraerCabana,limpiarTitular,nombreValido,
        importeClp,interpretarTotal,coincideNombre,coincideFecha});
    root.HAIKU_ASISTENTE_LENGUAJE_V1 = api;
    if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
