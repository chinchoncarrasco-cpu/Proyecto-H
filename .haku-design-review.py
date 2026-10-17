from pathlib import Path
import hashlib
p=Path('js/haiku-libro-consultas-v1.js')
b=p.read_bytes()
assert hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()=='00443da261d7fd19a0c552cc3cc3dc9dd3602dda', 'La base cambió: no aplicar'
s=b.decode()
def replace(a,b):
    global s
    assert s.count(a)==1,(s.count(a),a[:90])
    s=s.replace(a,b,1)
replace('''    function agregarDetalles(contenedor, titulo, items, tono = "", formato = "") {
        if (!items.length) return;''','''    function agregarDetalles(contenedor, titulo, items, tono = "", formato = "", vacio = "") {
        if (!items.length && !vacio) return;''')
replace('''        items.forEach(item => ul.append(filaComparacion(item, formato)));
        details.append(ul);
        contenedor.append(details);
    }''','''        items.forEach(item => ul.append(filaComparacion(item, formato)));
        if (!items.length && vacio) ul.append(elemento("li", "", vacio));
        details.append(ul);
        contenedor.append(details);
        return details;
    }''')
replace('''        agregarDetalles(revision, "Servicios que requieren revisión",
            serviciosRevisar.map(x => `${x.reserva.titular} · ${x.servicio.concepto} · ${x.servicio.texto_original}` + (x.canonico ? ` · ${x.razon}` : '')), "revision", "servicio");''','''        const detalleServicios = agregarDetalles(revision, "Servicios que requieren revisión",
            serviciosRevisar.map(x => `${x.reserva.titular} · ${x.servicio.concepto} · ${x.servicio.texto_original}` + (x.canonico ? ` · ${x.razon}` : '')), "revision", "servicio",
            comp.criterioServiciosNotas === 'operativo_v2' ? 'No hay servicios que requieran revisión.' : 'No hay avisos en la comparación preliminar.');''')
replace('''        if (comp.criterioServiciosNotas === 'operativo_v2') revision.append(elemento('p','haku-comparacion-sites-alcance',
            'Servicios y notas verificados con el mismo criterio de su revisión operativa. Los ya registrados no se vuelven a proponer.'));
        else if (comp.criterioServiciosNotas === 'no_disponible') revision.append(elemento('p','haku-comparacion-sites-alcance',
            'No está disponible la revisión operativa común. Estos avisos de servicios son preliminares; no acreditan que falten registros.'));''','''        if (comp.criterioServiciosNotas === 'no_disponible') detalleServicios.append(elemento('p','haku-fila-detalle',
            'No está disponible la revisión operativa común. Estos avisos de servicios son preliminares; no acreditan que falten registros.'));''')
b=s.encode()
assert hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()=='5f3edab96dd01920d854c5bb09fe0a9b6b2aca67', 'Candidato distinto al probado'
p.write_bytes(b)
print('Sólo presentación: acordeón compacto con contador real; criterio unificado intacto.')
