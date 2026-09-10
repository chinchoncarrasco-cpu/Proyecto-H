// ========================================
// HAIKU · FICHA SUPABASE V2
// Render directo: no depende del cache legacy para mostrar datos
// ========================================

(() => {
    "use strict";

    const cliente = window.haikuSupabase;
    if (!cliente) return;

    let cargando = false;
    let revisionBove = 0;
    const CAMPOS_BOVE = 'bove_cierre,bove_checkout';
    async function leerBoves(reservaId, reserva) {
        if (reserva && ['bove_cierre','bove_checkout'].every(k=>Object.hasOwn(reserva,k))) return reserva;
        const {data,error} = await cliente.from('reservas').select(CAMPOS_BOVE).eq('id',reservaId).single();
        if (error) throw error;
        return data || {};
    }
    function pintarBoves(reserva, error = false) {
        const cabecera = document.querySelector('#ficha-reserva-modal .ficha-reserva-cabecera > div');
        if (!cabecera) return;
        let bloque = document.getElementById('ficha-reserva-boves');
        if (!bloque) {
            bloque = document.createElement('aside'); bloque.id = 'ficha-reserva-boves';
            bloque.className = 'ficha-reserva-boves'; bloque.setAttribute('aria-label','BOVE registrados');
            bloque.setAttribute('aria-live','polite'); cabecera.appendChild(bloque);
        }
        bloque.replaceChildren();
        const numeros = new Map();
        for (const [campo,alcance] of [['bove_cierre','Alojamiento'],['bove_checkout','Servicios']]) {
            const valor = reserva?.[campo];
            const numero = typeof valor === 'string' || typeof valor === 'number' ? String(valor).trim() : '';
            if (numero) numeros.set(numero,[...(numeros.get(numero)||[]),alcance]);
        }
        bloque.hidden = !error && !numeros.size;
        if (error) { bloque.textContent = 'BOVE · No se pudo actualizar la lectura.'; return; }
        if (!numeros.size) return;
        const titulo = document.createElement('span'); titulo.className='ficha-bove-titulo'; titulo.textContent='BOVE'; bloque.appendChild(titulo);
        for (const [numero,alcances] of numeros) {
            const chip=document.createElement('span');chip.className='ficha-bove-chip';
            const etiqueta=document.createElement('span');etiqueta.textContent=alcances.join(' / ');
            const valor=document.createElement('strong');valor.textContent=numero;
            chip.append(etiqueta,valor);
            if (alcances.length===2) chip.title='El mismo número figura en los campos de alojamiento y servicios; no se infiere una boleta combinada.';
            bloque.appendChild(chip);
        }
    }
    window.addEventListener('haiku:bove-actualizado',async evento=>{
        const modal=document.getElementById('ficha-reserva-modal');
        const id=evento.detail?.reservaId;
        if (!id || !modal || modal.hidden || String(modal.dataset.reservaId)!==String(id)) return;
        const revision=++revisionBove;
        try {
            const boves=await leerBoves(id);
            if (revision===revisionBove && !modal.hidden && String(modal.dataset.reservaId)===String(id)) pintarBoves(boves);
        } catch (_) {
            if (revision===revisionBove && !modal.hidden && String(modal.dataset.reservaId)===String(id)) pintarBoves({},true);
        }
    });
    const estiloBove=document.createElement('style');
    estiloBove.textContent='#ficha-reserva-modal .ficha-reserva-boves{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-top:9px;font:11px/1.4 system-ui;color:#405c49}#ficha-reserva-modal .ficha-reserva-boves[hidden]{display:none}#ficha-reserva-modal .ficha-bove-titulo{font-size:10px;font-weight:750;letter-spacing:.05em;margin-right:2px}#ficha-reserva-modal .ficha-bove-chip{display:inline-flex;flex-wrap:wrap;align-items:center;gap:8px;padding:4px 8px;border:1px solid #d4e3d8;border-radius:8px;background:#f1f7f3;overflow-wrap:anywhere;max-width:100%}#ficha-reserva-modal .ficha-bove-chip strong{color:#245338;font-variant-numeric:tabular-nums}';
    document.head.appendChild(estiloBove);

    function fechaActual() {
        try { return String(fechaSeleccionada || "").slice(0,10); }
        catch { return ""; }
    }

    function dinero(valor) {
        return `$${Number(valor || 0).toLocaleString("es-CL")}`;
    }

    function formatearFecha(fecha) {
        if (!fecha) return "—";
        const [a,m,d] = String(fecha).slice(0,10).split("-");
        return a && m && d ? `${d}-${m}-${a.slice(-2)}` : String(fecha);
    }

    function diferenciaDias(inicio, fin) {
        const a = new Date(`${String(inicio).slice(0,10)}T12:00:00`);
        const b = new Date(`${String(fin).slice(0,10)}T12:00:00`);
        return Math.max(0, Math.round((b - a) / 86400000));
    }

    function reservaIdDeFila(fila) {
        if (!fila) return "";
        if (["libre-ingresa","sale-ingresa"].includes(fila.estado_operativo)) {
            return fila.ingreso_reserva_id || "";
        }
        if (fila.estado_operativo === "sale-libre") return fila.salida_reserva_id || "";
        if (fila.estado_operativo === "continua") return fila.continua_reserva_id || "";
        if (fila.estado_operativo === "fullday") return fila.fullday_reserva_id || "";
        return "";
    }

    async function resolverReserva(numeroCabana, fecha) {
        const { data, error } = await cliente.rpc("haiku_operacion_dia", { p_fecha: fecha });
        if (error) throw error;
        const fila = (data || []).find(item => Number(item.numero) === Number(numeroCabana));
        return { fila: fila || null, reservaId: reservaIdDeFila(fila) };
    }

    async function cargarFicha(reservaId) {
        const { data: core, error: errorCore } = await cliente.rpc(
            "haiku_ficha_reserva_core",
            { p_reserva_id: reservaId }
        );
        if (errorCore) throw errorCore;
        if (!core?.reserva) return null;

        const [serviciosR, cargosR, notasR, solicitudesR, pagosR, bovesR] = await Promise.all([
            cliente
                .from("servicios")
                .select("id,fecha_servicio,hora_inicio,total,tipo_cobro,estado_servicio,observaciones,catalogo_servicios(codigo,nombre,categoria)")
                .eq("reserva_id", reservaId)
                .order("fecha_servicio", { ascending: true }),
            cliente
                .from("vista_estado_cargos")
                .select("cargo_id,servicio_id,tipo_cargo,monto,estado,aplicado_neto,saldo_cargo,estado_pago")
                .eq("reserva_id", reservaId),
            cliente
                .from("notas")
                .select("id,fecha_operacion,texto,creado_en")
                .eq("reserva_id", reservaId)
                .order("creado_en", { ascending: true }),
            cliente
                .from("solicitudes")
                .select("id,descripcion,estado,vence_en,creado_en")
                .eq("reserva_id", reservaId)
                .order("creado_en", { ascending: true }),
            cliente
                .from("pagos")
                .select("id,monto,tipo_movimiento,etapa_operativa,medio_pago,estado,fecha_pago")
                .eq("reserva_id", reservaId)
                .order("fecha_pago", { ascending: true }),
            leerBoves(reservaId,core.reserva).then(data=>({data})).catch(error=>({error}))
        ]);

        [serviciosR,cargosR,notasR,solicitudesR,pagosR].forEach(r => {
            if (r.error) console.warn("HAIKU · Ficha V2 lectura parcial:", r.error);
        });

        return {
            ...core,
            boves: bovesR.data || {},
            errorBoves: Boolean(bovesR.error),
            servicios: serviciosR.data || [],
            cargos: cargosR.data || [],
            notas: notasR.data || [],
            solicitudes: solicitudesR.data || [],
            pagos: pagosR.data || []
        };
    }

    function nombreCompleto(huesped) {
        return [huesped?.nombre, huesped?.apellido].filter(Boolean).join(" ");
    }

    function obtenerTitular(ficha) {
        const huespedes = Array.isArray(ficha.huespedes) ? ficha.huespedes : [];
        return huespedes.find(h => h.es_titular) || {};
    }

    function prepararCacheEdicion(ficha) {
        const reserva = ficha.reserva;
        const estadia = ficha.estadias?.[0];
        if (!reserva || !estadia) return;

        const noches = (ficha.noches || []).filter(
            n => String(n.estadia_id) === String(estadia.id)
        );
        const tarifasNoches = {};
        noches.forEach(n => {
            tarifasNoches[String(n.fecha).slice(0,10)] = Number(n.tarifa || 0);
        });
        const totalReserva = Object.values(tarifasNoches)
            .reduce((s,v) => s + Number(v || 0), 0);
        const cantidadNoches = estadia.tipo_estadia === "fullday"
            ? 0
            : diferenciaDias(estadia.fecha_ingreso, estadia.fecha_salida);
        const titular = obtenerTitular(ficha);
        const acompanantes = (ficha.huespedes || []).filter(h => !h.es_titular);

        const base = {
            haikuFuente: "supabase",
            reservaId: reserva.id,
            titular: reserva.titular_nombre || "",
            adultos: Number(estadia.adultos || 0),
            ninos: Number(estadia.ninos || 0),
            mascotas: Number(estadia.mascotas || 0),
            noches: cantidadNoches,
            fechaOrigenReserva: String(estadia.fecha_ingreso).slice(0,10),
            fechaIngresoReserva: String(estadia.fecha_ingreso).slice(0,10),
            correo: reserva.correo_contacto || titular.correo || "",
            telefono: reserva.telefono_contacto || titular.telefono || "",
            rut: reserva.titular_numero_documento || titular.numero_documento || "",
            observaciones: reserva.observaciones || "",
            tarifasNoches,
            totalReserva,
            continuidadAutomatica: false
        };

        try {
            const numero = String(estadia.cabana_numero);
            const ingreso = String(estadia.fecha_ingreso).slice(0,10);
            if (typeof obtenerDatosDia === "function") {
                const dia = obtenerDatosDia(ingreso);
                dia.cabanas[numero] = {
                    ...(dia.cabanas?.[numero] || {}),
                    ...base,
                    estado: estadia.tipo_estadia === "fullday" ? "fullday" : "libre-ingresa"
                };
                if (typeof guardarDatos === "function") guardarDatos();
            }
        } catch {}

        const fichas = JSON.parse(localStorage.getItem("haikuFichaReservas") || "{}");
        fichas[reserva.id] = {
            titular: reserva.titular_nombre || "",
            rut: base.rut,
            telefono: base.telefono,
            correo: base.correo,
            observaciones: base.observaciones,
            numeroCabana: String(estadia.cabana_numero),
            fechaIngreso: base.fechaOrigenReserva,
            noches: cantidadNoches,
            adultos: base.adultos,
            ninos: base.ninos,
            mascotas: base.mascotas,
            totalReserva,
            tarifasNoches
        };
        for (let i=0; i<5; i++) {
            fichas[reserva.id][`acompanante${i+1}`] = acompanantes[i]
                ? nombreCompleto(acompanantes[i])
                : "";
        }
        localStorage.setItem("haikuFichaReservas", JSON.stringify(fichas));
    }

    function limpiarClasesEstado(el) {
        if (!el) return;
        el.classList.remove(
            "ficha-estado-hospedado",
            "ficha-estado-checkout",
            "ficha-estado-pendiente",
            "ficha-estado-confirmada",
            "ficha-estado-confirmacion-pendiente",
            "ficha-estado-cancelada",
            "ficha-estado-no-show"
        );
    }

    function pintarEstado(ficha) {
        const campo = document.getElementById("ficha-reserva-estado");
        if (!campo) return;
        limpiarClasesEstado(campo);

        const estadia = ficha.estadias?.[0] || {};
        const estado = ficha.reserva?.estado_reserva || "pendiente";

        if (estado === "cancelada") {
            campo.textContent = "● Cancelada";
            campo.classList.add("ficha-estado-cancelada");
        } else if (estado === "no_show") {
            campo.textContent = "● No-Show";
            campo.classList.add("ficha-estado-no-show");
        } else if (estado === "checked_out" || estadia.checkout_realizado_en) {
            campo.textContent = "● Checked Out";
            campo.classList.add("ficha-estado-checkout");
        } else if (estado === "hospedada" || estadia.checkin_realizado_en) {
            campo.textContent = "● Hospedado";
            campo.classList.add("ficha-estado-hospedado");
        } else if (estado === "confirmada") {
            campo.textContent = "● Confirmada";
            campo.classList.add("ficha-estado-confirmada");
        } else {
            campo.textContent = "● Confirmación pendiente";
            campo.classList.add("ficha-estado-confirmacion-pendiente");
        }
    }

    function pintarPagos(ficha) {
        const alojamiento = (ficha.cargos || []).filter(
            c => c.tipo_cargo === "alojamiento" && c.estado === "activo"
        );
        const servicios = (ficha.cargos || []).filter(
            c => c.tipo_cargo === "servicio" && c.estado === "activo"
        );

        const valores = {
            "ficha-pago-total": alojamiento.reduce((s,c) => s + Number(c.monto || 0), 0),
            "ficha-pago-abono": alojamiento.reduce((s,c) => s + Number(c.aplicado_neto || 0), 0),
            "ficha-pago-saldo": alojamiento.reduce((s,c) => s + Number(c.saldo_cargo || 0), 0),
            "ficha-pago-servicios": servicios.reduce((s,c) => s + Number(c.saldo_cargo || 0), 0)
        };
        Object.entries(valores).forEach(([id,valor]) => {
            const el = document.getElementById(id);
            if (el) el.textContent = dinero(valor);
        });
    }

    function crearItemServicio(servicio) {
        const item = document.createElement("div");
        item.className = "ficha-servicio-item";
        const izquierda = document.createElement("span");
        const catalogo = servicio.catalogo_servicios || {};
        const partes = [];
        if (servicio.fecha_servicio) partes.push(formatearFecha(servicio.fecha_servicio));
        if (servicio.hora_inicio) partes.push(String(servicio.hora_inicio).slice(0,5));
        partes.push(catalogo.nombre || "Servicio");
        izquierda.textContent = partes.join(" · ");
        const derecha = document.createElement("span");
        derecha.textContent = servicio.tipo_cobro === "cortesia"
            ? "🎁"
            : Number(servicio.total || 0) > 0 ? dinero(servicio.total) : "";
        item.append(izquierda,derecha);
        return item;
    }

    function pintarServicios(ficha) {
        const programados = document.getElementById("ficha-servicios-programados");
        const realizados = document.getElementById("ficha-servicios-realizados");
        const pendientes = document.getElementById("ficha-servicios-pendientes");
        if (!programados || !realizados || !pendientes) return;

        const cargosPorServicio = new Map(
            (ficha.cargos || []).filter(c => c.servicio_id).map(c => [c.servicio_id,c])
        );
        const lista = ficha.servicios || [];
        const p = lista.filter(s => s.estado_servicio !== "realizado");
        const r = lista.filter(s => s.estado_servicio === "realizado");
        const pp = lista.filter(s => {
            const c = cargosPorServicio.get(s.id);
            return s.tipo_cobro !== "cortesia" && Number(c?.saldo_cargo || 0) > 0;
        });

        [programados,realizados,pendientes].forEach(el => el.innerHTML = "");
        p.forEach(s => programados.appendChild(crearItemServicio(s)));
        r.forEach(s => realizados.appendChild(crearItemServicio(s)));
        pp.forEach(s => pendientes.appendChild(crearItemServicio(s)));

        [["ficha-servicios-programados-contador",p.length],["ficha-servicios-realizados-contador",r.length],["ficha-servicios-pendientes-contador",pp.length]]
            .forEach(([id,n]) => { const el=document.getElementById(id); if(el) el.textContent=String(n); });
    }

    function pintarSolicitudes(ficha) {
        const cont = document.getElementById("ficha-reserva-solicitudes");
        const contador = document.getElementById("ficha-solicitudes-contador");
        if (!cont) return;
        if (contador) { contador.hidden = true; contador.textContent = ""; }
        const lista = ficha.solicitudes || [];
        cont.innerHTML = "";
        if (lista.length === 0) {
            cont.textContent = "Sin solicitudes pendientes.";
            return;
        }
        lista.forEach(s => {
            const fila = document.createElement("div");
            fila.className = "ficha-solicitud-item";
            fila.textContent = `${formatearFecha(s.vence_en?.slice(0,10) || s.creado_en?.slice(0,10))} · ${s.descripcion || ""}`;
            cont.appendChild(fila);
        });
    }

    function pintarNotas(ficha) {
        const cont = document.getElementById("ficha-reserva-notas");
        if (!cont) return;
        const lista = ficha.notas || [];
        cont.innerHTML = "";
        if (lista.length === 0) {
            cont.textContent = "Sin notas registradas.";
            return;
        }
        lista.forEach(n => {
            const fila = document.createElement("div");
            fila.className = "ficha-nota-item";
            fila.textContent = `${formatearFecha(n.fecha_operacion || n.creado_en?.slice(0,10))} · ${n.texto || ""}`;
            cont.appendChild(fila);
        });
    }

    function pintarFicha(ficha) {
        const reserva = ficha.reserva;
        const estadia = ficha.estadias?.[0];
        if (!reserva || !estadia) return;

        const huespedes = Array.isArray(ficha.huespedes) ? ficha.huespedes : [];
        const titular = huespedes.find(h => h.es_titular) || {};
        const acompanantes = huespedes.filter(h => !h.es_titular);
        const cantidadNoches = estadia.tipo_estadia === "fullday"
            ? 0
            : diferenciaDias(estadia.fecha_ingreso, estadia.fecha_salida);
        const idVisible = reserva.codigo_haiku || reserva.cloudbeds_id || reserva.id;

        const textos = {
            "ficha-reserva-cabana": `CAB ${estadia.cabana_numero}`,
            "ficha-reserva-titular": reserva.titular_nombre || "Sin titular",
            "ficha-reserva-id": idVisible,
            "ficha-reserva-ingreso": formatearFecha(estadia.fecha_ingreso),
            "ficha-reserva-salida": formatearFecha(estadia.fecha_salida),
            "ficha-reserva-noches": cantidadNoches === 1 ? "◷ 1 noche" : `◷ ${cantidadNoches} noches`,
            "ficha-huesped-titular": reserva.titular_nombre || "Sin titular"
        };
        Object.entries(textos).forEach(([id,texto]) => {
            const el = document.getElementById(id);
            if (el) el.textContent = texto;
        });

        const modal = document.getElementById("ficha-reserva-modal");
        if (modal) {
            revisionBove++;
            modal.dataset.reservaId = reserva.id;
            modal.dataset.numeroCabana = String(estadia.cabana_numero);
            modal.dataset.reservaCancelada = reserva.estado_reserva === "cancelada" ? "true" : "false";
            modal.dataset.reservaNoShow = reserva.estado_reserva === "no_show" ? "true" : "false";
        }

        const ocupacion = {
            adultos: Number(estadia.adultos || 0),
            ninos: Number(estadia.ninos || 0),
            mascotas: Number(estadia.mascotas || 0)
        };
        try {
            if (typeof actualizarOcupacionFicha === "function") {
                actualizarOcupacionFicha(ocupacion, false);
            }
        } catch {}

        const superior = document.getElementById("ficha-reserva-acompanante-principal");
        if (superior) {
            if (acompanantes[0]) {
                superior.textContent = `Acompañante principal: ${nombreCompleto(acompanantes[0])}`;
                superior.hidden = false;
            } else {
                superior.textContent = "";
                superior.hidden = true;
            }
        }

        for (let i=1; i<=5; i++) {
            const campo = document.getElementById(`ficha-acompanante-${i}`);
            const fila = campo?.closest(".ficha-acompanante-fila");
            const h = acompanantes[i-1];
            if (campo) campo.value = h ? nombreCompleto(h) : "";
            if (fila) {
                const totalHuespedes = ocupacion.adultos + ocupacion.ninos;
                const esperados = Math.max(0, totalHuespedes - 1);
                fila.style.display = i <= Math.max(acompanantes.length, esperados) ? "" : "none";
            }
        }

        const rut = document.getElementById("ficha-reserva-rut");
        const telefono = document.getElementById("ficha-reserva-telefono");
        if (rut) rut.value = reserva.titular_numero_documento || titular.numero_documento || "";
        if (telefono) telefono.value = reserva.telefono_contacto || titular.telefono || "";

        document.querySelectorAll("#ficha-reserva-modal .ficha-dato-editable").forEach(campo => {
            campo.readOnly = true;
            campo.tabIndex = -1;
        });

        const editar = document.getElementById("ficha-reserva-editar");
        if (editar) {
            editar.hidden = !window.haikuTienePermiso?.("reservas.editar");
            editar.disabled = false;
        }

        pintarEstado(ficha);
        pintarBoves(ficha.boves, ficha.errorBoves);
        pintarServicios(ficha);
        pintarPagos(ficha);
        pintarSolicitudes(ficha);
        pintarNotas(ficha);

        if (modal) modal.hidden = false;

        console.info("HAIKU · Ficha V2 directa desde Supabase:", idVisible);
    }

    async function abrirFicha(numeroCabana, fecha) {
        if (!numeroCabana || !fecha || cargando) return;
        cargando = true;
        try {
            const { reservaId } = await resolverReserva(numeroCabana, fecha);
            if (!reservaId) {
                alert(`CAB ${numeroCabana} no tiene una reserva activa para ${fecha}.`);
                return;
            }
            const ficha = await cargarFicha(reservaId);
            if (!ficha) throw new Error("No se encontró la ficha en Supabase.");
            prepararCacheEdicion(ficha);
            pintarFicha(ficha);
        } catch (error) {
            console.error("HAIKU · No fue posible abrir Ficha V2:", error);
            alert("No fue posible cargar la ficha desde Supabase.");
        } finally {
            cargando = false;
        }
    }

    document.addEventListener("click", evento => {
        const boton = evento.target.closest("[data-ficha-cabana]");
        if (!boton || !window.haikuSesion) return;
        evento.preventDefault();
        evento.stopPropagation();
        evento.stopImmediatePropagation();
        abrirFicha(boton.dataset.fichaCabana, fechaActual());
    }, true);

    // En modo Supabase, los lápices rápidos no deben modificar sólo localStorage.
    // Los redirigimos al editor completo de la reserva.
    document.addEventListener("click", evento => {
        const rapido = evento.target.closest(
            "#ficha-reserva-modal [class*='editar'], #ficha-reserva-modal [data-editar-titular], #ficha-reserva-modal [data-editar-noches]"
        );
        if (!rapido || rapido.id === "ficha-reserva-editar") return;
        evento.preventDefault();
        evento.stopPropagation();
        evento.stopImmediatePropagation();
        document.getElementById("ficha-reserva-editar")?.click();
    }, true);

    window.haikuAbrirFichaSupabaseV2 = abrirFicha;
    console.info("HAIKU · Ficha Supabase V2 preparada.");
})();
