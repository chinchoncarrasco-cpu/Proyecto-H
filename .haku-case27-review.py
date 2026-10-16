from pathlib import Path
import hashlib

def sha(p):
    b=p.read_bytes();return hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()
base={'js/haiku-libro-semantica-v1.js':'244cb23a60a6929de32d7d8acf4c9e2967fb0233','js/haiku-libro-servicios-scope-v2.js':'0ddb47a0adf3a57c404c73484e68275e3d11a951'}
for p,h in base.items():assert sha(Path(p))==h,('Base cambió',p,sha(Path(p)))
p=Path('js/haiku-libro-semantica-v1.js');s=p.read_text()
def one(a,b):
    global s
    assert s.count(a)==1,(s.count(a),a[:100]);s=s.replace(a,b,1)
one('''        for (const f of fragmentosServicioPosicionales(fuente)) {
            const conceptos = conceptosDeServicio(f.texto);''',r'''        const fragmentos = fragmentosServicioPosicionales(fuente);
        for (const [indice, f] of fragmentos.entries()) {
            const anteriores = fragmentos.slice(0, indice), previo = anteriores.at(-1)?.texto || '';
            // Fecha aislada tras operador y datos de la reserva, ANTES de toda
            // prestación: pertenece a su registro, no al masaje que sigue.
            // Una fecha suelta de un bloque de masajes conserva su significado.
            const fechaRegistro = opciones.origen_campo === 'notas_reserva' &&
                /^\d{1,2}[-/.]\d{1,2}[-/.](?:\d{4}|\d{2})$/.test(f.texto) &&
                /^[A-Z]{2,4}$/.test(previo) && !/^(?:LUN|MAR|MIE|JUE|VIE|SAB|DOM)$/.test(previo) &&
                anteriores.some(x => /@|\b\d+\s*(?:adl|adultos?|noches?)\b/i.test(x.texto)) &&
                !anteriores.some(x => conceptosDeServicio(x.texto).length);
            if (fechaRegistro) {
                vaciar(); entradas.push({ parte:f.texto, inicio:f.inicio, fin:f.fin });
                continue;
            }
            const conceptos = conceptosDeServicio(f.texto);''')
anchor='''        const mencionAislada = /^(?:cama\\s*adicional|camaadicional|cuna|tinaja|jacuzzi|tonel|masaje)$/i.test(t);'''
one(anchor,r'''        if (conceptos.length === 1 && conceptos[0] === 'cuna' &&
            contextoReserva?.origen_campo !== 'servicios' &&
            /^(?:agregar|dejar|preparar|poner|colocar)\b/.test(t) &&
            !clasificarIntencionFinanciera(texto).evidencias.length) {
            evidencias.push('solicitud de cuna para preparar el alojamiento; nota sin cargo');
            return base(SEMANTICA_SERVICIO.NO_SERVICIO);
        }
'''+anchor)
p.write_text(s)
p=Path('js/haiku-libro-servicios-scope-v2.js');s=p.read_text()
anchor='''        const identidad = root.HAIKU_SERVICIOS_IDENTIDAD_V1;
        if (identidad?.resolverServicio && item.payload) {'''
one(anchor,r'''        // Mismo grupo de masajes ya registrado, pero otro subtipo: no crear
        // uno nuevo ni cambiar un servicio cobrado. Mostrar la discrepancia.
        if (item.servicio?.concepto === 'masaje' && item.fecha && hora &&
            /^masaje(?:Terapeutico|Descontracturante)(30|60)$/.test(item.mapa?.codigo || '') &&
            (item.reserva.servicios || []).filter(s => s.concepto === 'masaje' && s.hora === hora).length === 1) {
            const duracion = item.servicio.duracion_minutos;
            const otrosTipos = activos.filter(x => x.estadia_id === estadiaId &&
                x.fecha_servicio === item.fecha && horaCorta(x.hora_inicio) === hora &&
                /^masaje(?:Terapeutico|Descontracturante)(30|60)$/.test(codigoExistente(x) || '') &&
                codigoExistente(x).endsWith(String(duracion)) && !codigos.has(codigoExistente(x)));
            if (otrosTipos.length) return { estado:'revisar', candidatos:otrosTipos,
                conflicto_tipo_masaje:true, contradicciones:['tipo_masaje'],
                motivo:'Ya hay masajes registrados en esa fecha y hora, pero el tipo difiere del Libro. No se crearán otros ni se modificará el cobro.' };
        }
'''+anchor)
one("        const registrados = items.filter(i => i.estado === 'existente' && i.servicio_existente?.id);",
    "        const registrados = items.filter(i => (i.estado === 'existente' || i.conflicto_tipo_masaje) && i.servicio_existente?.id);")
one("                item.cambioCortesiaExistente = cambioCortesiaExistente(item, decision);",
'''                item.cambioCortesiaExistente = cambioCortesiaExistente(item, decision);
                if (decision.conflicto_tipo_masaje && decision.candidatos?.length === 1) {
                    item.conflicto_tipo_masaje = true;
                    item.servicio_existente = decision.candidatos[0]; // Referencia de revisión, no identidad aceptada.
                }''')
anchor="    function crearItem(item, seleccionados, confirmarNoche, opciones = {}) {"
one(anchor,'''    function detalleMasajeRegistrado(item) {
        const s = item.servicio_existente;
        return `Proyecto H: ${nombreExistente(s)} · ${s.cantidad} unidades · ${s.fecha_servicio} · ${horaCorta(s.hora_inicio)} · ${item.finanzas_existente?.etiqueta || 'Pago por verificar'}. Libro: ${item.mapa.nombre}. El tipo no coincide. Revisa la ficha; no se volverá a cobrar.`;
    }

'''+anchor)
one("        let accionesRevision = null;\n        if (opciones.abrirManual && item.kind === 'servicio' && item.semantica === 'SERVICIO_REAL' && (item.estado === 'revisar' || item.resolucionManual)) {",
'''        if (item.conflicto_tipo_masaje && item.servicio_existente) {
            const registrado = document.createElement('p'); registrado.className = 'haiku-manual-aviso haiku-manual-aviso--revision';
            registrado.textContent = detalleMasajeRegistrado(item); cuerpo.append(registrado);
        }
        let accionesRevision = null;
        // Consultar la reserva no aprueba una prestación: también está disponible
        // para fragmentos ambiguos y notas, sin habilitar escrituras ambiguas.
        if (item.asociacion?.estado === 'asociada' || item.estado === 'revisar') {''')
one("            ver.addEventListener('click', () => (root.HAIKU_INSPECTOR_V1 || root.HAIKU_PANELES_V1)?.abrirReserva?.(item.asociacion.sistema.reserva_id, ver));",
'''            ver.addEventListener('click', () => {
                if (!ver.disabled && item.asociacion?.sistema?.reserva_id)
                    (root.HAIKU_INSPECTOR_V1 || root.HAIKU_PANELES_V1)?.abrirReserva?.(item.asociacion.sistema.reserva_id, ver);
            });''')
one("            if (opciones.abrirManual && codigosManual(item.manual_base || item).length) {",
'''            if (opciones.abrirManual && item.kind === 'servicio' && item.semantica === 'SERVICIO_REAL' &&
                (item.estado === 'revisar' || item.resolucionManual) && codigosManual(item.manual_base || item).length) {''')
one("        revalidacion.textContent = 'Al confirmar, Haku volverá a validar el servicio antes de dejarlo listo para incorporar.';",
'''        revalidacion.textContent = item.conflicto_tipo_masaje
            ? detalleMasajeRegistrado(item) + ' Confirmar aquí sólo revalida; no cambia el tipo del servicio existente.'
            : 'Al confirmar, Haku volverá a validar el servicio antes de dejarlo listo para incorporar.';''')
p.write_text(s)
expected={'js/haiku-libro-semantica-v1.js':'bec25dca424df8ec301681f83e1cd800bd5808eb','js/haiku-libro-servicios-scope-v2.js':'c8834ec60a675758a2c6aa97560d133a599c6e69'}
for p,h in expected.items():assert sha(Path(p))==h,('Resultado distinto del probado',p,sha(Path(p)))
print('Dos módulos idénticos al candidato probado; sin escrituras de huéspedes.')
