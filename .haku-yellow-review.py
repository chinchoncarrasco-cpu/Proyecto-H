from pathlib import Path
import hashlib

def blob(p):
    b=p.read_bytes()
    return hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()

base={'js/haiku-libro-semantica-v1.js':'1bb685afc61375799db9cae47c9e74592b453229',
      'js/haiku-libro-servicios-scope-v2.js':'b73f5d019e6ddaf5cc6bd1d564f762e4e07d2cf7'}
for name,sha in base.items():
    assert blob(Path(name))==sha, ('La base cambió, no aplicar',name)
p=Path('js/haiku-libro-semantica-v1.js');s=p.read_text()
def one(a,b):
    global s
    assert s.count(a)==1,(s.count(a),a[:90])
    s=s.replace(a,b,1)
one("else { vaciar(); entradas.push({ parte: f.texto }); }","else { vaciar(); entradas.push({ parte: f.texto, inicio: f.inicio, fin: f.fin }); }")
helper='''    // El formato viaja con el mismo texto de la celda. No usar el fondo ni
    // el color de otra glosa como evidencia de cobro de este servicio.
    function rangosColorServicio(texto, formato) {
        const fragmentos = formato?.fragmentos;
        if (!Array.isArray(fragmentos) || !fragmentos.length ||
            fragmentos.some(f => typeof f?.texto !== 'string') ||
            fragmentos.map(f => f.texto).join('') !== texto) return [];
        let inicio = 0;
        return fragmentos.map(f => {
            const rango = { inicio, fin:inicio + f.texto.length, texto:f.texto, color:f.color };
            inicio = rango.fin;
            return rango;
        });
    }

    function evidenciaAmarillaServicio(entrada, unidad, rangos, origen) {
        if (!rangos.length || !Number.isInteger(entrada.inicio) || entrada.inicio < 0 ||
            !Number.isInteger(entrada.fin) || !unidad.texto) return null;
        const relativo = entrada.parte.indexOf(unidad.texto);
        if (relativo < 0 || entrada.parte.lastIndexOf(unidad.texto) !== relativo) return null;
        const inicio = entrada.inicio + relativo, fin = inicio + unidad.texto.length;
        if (fin > entrada.fin) return null;
        let letras = false;
        for (const r of rangos) {
            const a = Math.max(inicio,r.inicio), b = Math.min(fin,r.fin);
            if (a >= b || !/[\\p{L}\\p{N}]/u.test(r.texto.slice(a-r.inicio,b-r.inicio))) continue;
            if (r.color !== 'FFFF00') return null;
            letras = true;
        }
        return letras ? { version:1, regla:'LETRA_AMARILLA_COBRABLE', color:'FFFF00',
            texto:unidad.texto, inicio, fin, origen:origen || null } : null;
    }

'''
one('    function servicios(texto, opciones = {}) {',helper+'    function servicios(texto, opciones = {}) {')
one('''        const salida = [];
        for (const entrada of entradasServicios(texto, opciones)) {''','''        const salida = [], rangosColor = rangosColorServicio(String(texto || ''), opciones.formato);
        for (const entrada of entradasServicios(texto, opciones)) {''')
one('''            for (const [unidad_indice, unidad] of unidades.entries()) {
                const intencion_cobro''','''            for (const [unidad_indice, unidadOriginal] of unidades.entries()) {
                // Complementar sólo cobro ausente de un servicio real. La letra
                // amarilla no crea servicios desde notas, no cobra cortesías
                // explícitas ni resuelve textos financieramente contradictorios.
                const cobroColor = canon.semantica === SEMANTICA_SERVICIO.SERVICIO_REAL &&
                    unidadOriginal.intencion_financiera === INTENCION_FINANCIERA.NO_DETERMINADA &&
                    !(unidadOriginal.evidencias_financieras || []).length
                    ? evidenciaAmarillaServicio(entrada, unidadOriginal, rangosColor, opciones.coordenadas_origen) : null;
                const unidad = cobroColor ? { ...unidadOriginal,
                    intencion_financiera:INTENCION_FINANCIERA.COBRABLE,
                    evidencias_financieras:['letra amarilla del servicio en el Libro'] } : unidadOriginal;
                const intencion_cobro''')
one('''                        intencion_operativa: canon.semantica === SEMANTICA_SERVICIO.SERVICIO_REAL, pendiente_pago: pendiente, cortesia },''','''                        intencion_operativa: canon.semantica === SEMANTICA_SERVICIO.SERVICIO_REAL, pendiente_pago: pendiente, cortesia,
                        ...(cobroColor ? { cobro_color:cobroColor } : {}) },''')
one('''const conceptosServicio = servicios(cell.valor, { origen_campo: "notas_reserva", coordenadas_origen: src });''','''const conceptosServicio = servicios(cell.valor, { origen_campo: "notas_reserva", coordenadas_origen: src, formato:colors });''')
p.write_text(s)
p=Path('js/haiku-libro-servicios-scope-v2.js');s=p.read_text()
a='''        const semantica = servicio.semantica, intencion_operativa = true;'''
b=a+'''
        if (servicio.evidencia_origen?.cobro_color?.regla === 'LETRA_AMARILLA_COBRABLE')
            inferencias.push('Cobrable por letra amarilla del Libro. El pago actual se comprueba en Proyecto H.');'''
assert s.count(a)==1;s=s.replace(a,b,1);p.write_text(s)
expected={'js/haiku-libro-semantica-v1.js':'244cb23a60a6929de32d7d8acf4c9e2967fb0233',
          'js/haiku-libro-servicios-scope-v2.js':'f4ff266ec0a0371df52a3573295f6677a96ef6e5'}
for name,sha in expected.items():
    assert blob(Path(name))==sha,('El resultado no es el probado',name,blob(Path(name)))
print('Dos archivos idénticos al candidato probado localmente; sin tocar datos ni RPC.')
