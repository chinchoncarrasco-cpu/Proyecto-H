from pathlib import Path
import hashlib

def blob(path):
    b=path.read_bytes()
    return hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()
paths={'js/haiku-libro-servicios-scope-v2.js':'c8834ec60a675758a2c6aa97560d133a599c6e69',
       'css/sites-asistente-v1.css':'e6dfe644c6e127f44638ad09a1a05120dd92c981'}
for name,sha in paths.items():
    assert blob(Path(name))==sha, ('Base distinta: no aplicar',name)
p=Path('js/haiku-libro-servicios-scope-v2.js');s=p.read_text()
anchor='        const detalle = crear("details", "haku-libro-resultado-sites__detalle");'
added='''        // Sólo el resultado por item_id del RPC acredita una incorporación.
        // No confundir elegidos, ya existentes u omitidos con elementos nuevos.
        const grupoIncorporados = (kind, titulo, cantidad, respuesta, estadoCreado) => {
            const grupo = crear("section", "haku-libro-resultado-sites__incorporados");
            grupo.dataset.tipo = kind;
            grupo.setAttribute("aria-label", titulo);
            const encabezado = crear("div", "haku-libro-resultado-sites__grupo-cabecera");
            encabezado.append(crear("h3", "", titulo),
                crear("span", "haku-libro-resultado-sites__chip", Number(cantidad || 0)));
            grupo.append(encabezado);
            const totalValido = Number.isSafeInteger(cantidad) && cantidad >= 0;
            const recibidos = Array.isArray(respuesta) ? respuesta : [];
            const nuevos = recibidos.filter(r => r?.estado === estadoCreado);
            const filas = nuevos.map(r => {
                const candidatos = elegidos.filter(i => i.item_id === r.item_id && i.kind === kind && i.estado === 'listo');
                const veces = [...(data.servicios || []), ...(data.notas || [])]
                    .filter(x => x?.item_id === r.item_id).length;
                const item = candidatos.length === 1 && veces === 1 ? candidatos[0] : null;
                if (!r.item_id || !item ||
                    r.reserva_id != null && r.reserva_id !== item.payload?.reserva_id ||
                    r.estadia_id != null && r.estadia_id !== item.payload?.estadia_id) return null;
                return item;
            });
            if (!totalValido || nuevos.length !== cantidad || filas.some(i => !i)) {
                const aviso = crear("p", "haku-libro-resultado-sites__grupo-aviso",
                    "El total fue confirmado, pero no se pudo identificar con seguridad el detalle. Revisa la reserva antes de repetir la operación.");
                aviso.setAttribute("role", "status"); grupo.append(aviso);
            } else if (!cantidad) {
                grupo.append(crear("p", "haku-libro-resultado-sites__grupo-vacio", kind === 'nota'
                    ? "No se incorporaron notas en esta operación."
                    : "No se incorporaron servicios en esta operación."));
            } else for (const item of filas) {
                const fila = crear("div", "haku-libro-resultado-sites__fila");
                fila.dataset.itemId = item.item_id;
                const cabana = item.reserva?.cabana ? `CAB ${item.reserva.cabana} · ` : '';
                const nombre = kind === 'nota' ? 'Nota de la reserva'
                    : item.mapa?.nombre || item.servicio?.concepto || 'Servicio';
                fila.append(crear("strong", "", `${cabana}${item.reserva?.titular || 'Reserva'} · ${nombre}`),
                    crear("span", "haku-libro-resultado-sites__estado", kind === 'nota' ? 'Nota incorporada' : 'Servicio incorporado'));
                const p = item.payload || {};
                if (kind === 'servicio') {
                    const datos = [p.fecha_servicio,
                        p.hora ? `${p.hora}${item.hora_fin ? '–' + item.hora_fin : ''}` : null,
                        p.cantidad != null ? `Cantidad: ${p.cantidad}` : null,
                        p.tipo_cobro === 'cortesia' ? 'Cortesía' : p.tipo_cobro === 'normal' ? 'Cobrable' : null].filter(Boolean);
                    if (datos.length) fila.append(crear("p", "", datos.join(' · ')));
                }
                const descripcion = kind === 'nota' ? p.texto || item.texto : item.servicio?.texto_original;
                if (descripcion) fila.append(crear("p", "haku-libro-resultado-sites__texto-incorporado", descripcion));
                grupo.append(fila);
            }
            return grupo;
        };
        const serviciosIncorporados = grupoIncorporados('servicio', 'Servicios incorporados',
            data.servicios_creados, data.servicios, 'creado');
        const notasIncorporadas = grupoIncorporados('nota', 'Notas incorporadas',
            data.notas_creadas, data.notas, 'creada');

'''
assert s.count(anchor)==1;s=s.replace(anchor,added+anchor,1)
a='        tarjeta.append(mensaje, metricas, detalle, pie);'
b='        tarjeta.append(mensaje, metricas, serviciosIncorporados, notasIncorporadas, detalle, pie);'
assert s.count(a)==1;s=s.replace(a,b,1);p.write_text(s)
p=Path('css/sites-asistente-v1.css');s=p.read_text()
anchor='.haku-libro-resultado-sites__detalle { margin: 0; border: 0; }'
css='''.haku-libro-resultado-sites__incorporados { padding: 14px 15px; border-bottom: 1px solid #dce8e0; min-width: 0; }
.haku-libro-resultado-sites__grupo-cabecera { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.haku-libro-resultado-sites__grupo-cabecera > h3 { margin: 0; color: #254531; font-size: 12px; line-height: 1.4; }
.haku-libro-resultado-sites__grupo-vacio,
.haku-libro-resultado-sites__grupo-aviso { margin: 8px 0 0; color: #617267; font-size: 10px; line-height: 1.5; }
.haku-libro-resultado-sites__grupo-aviso { color: #805e2e; }
.haku-libro-resultado-sites__incorporados .haku-libro-resultado-sites__fila:last-child { padding-bottom: 0; }
.haku-libro-resultado-sites__texto-incorporado { white-space: pre-wrap; }
'''
assert s.count(anchor)==1;s=s.replace(anchor,css+anchor,1);p.write_text(s)
expected={'js/haiku-libro-servicios-scope-v2.js':'cf9799b69b8ae279ef15072e0639ef05e9e3d74b',
          'css/sites-asistente-v1.css':'330d3d30def0e82f2ccb9e0f7bd42d5a4b18fc40'}
for name,sha in expected.items():
    assert blob(Path(name))==sha, ('Resultado distinto del probado',name)
print('Sólo recibo visual y CSS: hashes iguales a los probados localmente. Sin datos ni escrituras de producción.')
