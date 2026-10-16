from pathlib import Path
import hashlib

def blob(p):
    b=p.read_bytes()
    return hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()
base={'js/haiku-libro-servicios-scope-v2.js':'f4ff266ec0a0371df52a3573295f6677a96ef6e5',
      'tests/fixtures/libro-servicio-manual.cjs':'032a3bd042eee7219d63ad01d2ad6168bc1aeee3'}
for name,sha in base.items():
    assert blob(Path(name))==sha, ('Base diferente; no aplicar',name)
p=Path('js/haiku-libro-servicios-scope-v2.js');s=p.read_text()
a='    function prepararNota(reserva, texto, asociacion, semantica = "NO_SERVICIO") {'
b='''    // Una hora incluida no es una tinaja agendada. El beneficio sin horario
    // sólo pasa a servicio si hay una prestación confirmada o ya registrada.
    function esBeneficioTinajaPorCoordinar(item) {
        const s = item?.servicio, t = normalizar(s?.texto_original);
        return item?.kind === 'servicio' && item.semantica === 'SERVICIO_REAL' &&
            item.intencion_cobro === 'cortesia' && esTinajaServicio(s) &&
            !s.promoTinajaMixta && !s.hora && !s.hora_fin &&
            /\\b(?:1|una)\\s*(?:hora|hrs?)\\b/.test(t) &&
            !/\\b(?:reservad[oa]s?|agendad[oa]s?|confirmad[oa]s?|reservo|agendo|confirmo|contrato)\\b/.test(t);
    }

'''+a
assert s.count(a)==1;s=s.replace(a,b,1)
a='''        // Firma exacta, sin persistencia: incluye todos los datos leídos del Libro y la asociación actual.
        const firmaLibro = JSON.stringify([libro.archivo, libro.generacion, libro.reservas]);'''
b='''        // Resolver el beneficio como nota ANTES de aplicar decisiones manuales
        // o generar propuestas. Primero preservar la autoridad de lo ya agendado.
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (!esBeneficioTinajaPorCoordinar(item)) continue;
            const decision = decisionServicioExistente(item, existentes.servicios);
            if (decision.estado === 'existente' || decision.candidatos?.length) continue;
            const nota = prepararNota(item.reserva,
                item.servicio.texto_original || item.servicio.fragmento_original,
                item.asociacion);
            nota.inferencias.push('Cortesía incluida pendiente de coordinar: nota de la reserva, sin agendar tinaja ni generar cargo.');
            // La misma evidencia puede venir también en menciones/Notas: una sola nota.
            if (items.some(x => x.kind === 'nota' && x.item_id === nota.item_id)) {
                items.splice(i--, 1);
            } else items[i] = nota;
        }

'''+a
assert s.count(a)==1;s=s.replace(a,b,1);p.write_text(s)
p=Path('tests/fixtures/libro-servicio-manual.cjs');s=p.read_text()
a="    const textos = ['1 HORA DE CORTESIA TINAJA',"
b="    // Estos casos prueban prestaciones confirmadas con datos aún incompletos, no beneficios por coordinar.\n    const textos = ['1 HORA DE CORTESIA TINAJA CONFIRMADA',"
assert s.count(a)==1;p.write_text(s.replace(a,b,1))
expected={'js/haiku-libro-servicios-scope-v2.js':'0ddb47a0adf3a57c404c73484e68275e3d11a951',
          'tests/fixtures/libro-servicio-manual.cjs':'95c68eeb5eca77b3e93ee2a664e1fe39644456e2'}
for name,sha in expected.items():
    assert blob(Path(name))==sha, ('Resultado distinto del probado localmente',name)
print('Fuente y fixture idénticos a los probados localmente. Sin modificar datos ni RPC.')
