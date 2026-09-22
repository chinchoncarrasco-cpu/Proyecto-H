const S = Object.freeze({
  NO: 'NO_SERVICIO', REAL: 'SERVICIO_REAL', CONSULTA: 'CONSULTA_SERVICIO', DESCARTADO: 'SERVICIO_DESCARTADO', AMBIGUO: 'AMBIGUO'
});
const F = Object.freeze({ CORTESIA: 'CORTESIA', COBRABLE: 'COBRABLE', ND: 'NO_DETERMINADA' });

function caso(id, origen, texto, semantica, conceptos, financiera, evidencias, observacion = '', contexto = {}) {
  return Object.freeze({ id, origen, texto, semantica, conceptos, financiera, evidencias, observacion, contexto });
}

// Corpus estable derivado de Sep26. Los nombres de profesionales se anonimizan;
// se conservan la estructura lingüística, cantidades, fechas, horas y cobros.
const casos = [
  caso(1, 'Sep26!C3', 'dejar batas tinaja de 17:45 a 18:45', S.REAL, ['tinaja'], F.ND, ['acción operativa', 'rango horario'], 'Sara: YA_EXISTE confirmado; Proyecto H conserva la autoridad financiera.'),
  caso(2, 'Sep26!C3', '1 masaje reljante de 60 min simultaneo con PROFESIONAL A y PROFESIONAL B a las 19hrs y 1 descontracturante de 60 min. Masajes por pagar', S.REAL, ['masaje'], F.COBRABLE, ['dos prestaciones', 'duración', 'profesionales', 'horario', 'cobro'], 'Dos unidades de masaje; nombres anonimizados.'),
  caso(3, 'Sep26!BW3', 'CAMA ADICIONAL', S.NO, ['cama_adicional'], F.ND, ['mención aislada'], 'En este contexto real no hay intención de prestación.'),
  caso(4, 'Sep26!BW3', 'TINAJA DE CORTESÍA TONEL 19.15 HRS', S.REAL, ['tonel'], F.CORTESIA, ['concepto específico', 'horario', 'cortesía']),
  caso(5, 'Sep26!CA3', 'cama adicional', S.NO, ['cama_adicional'], F.ND, ['mención aislada']),
  caso(6, 'Sep26!S4', 'Jacuzzi a las 22,15 sáb 05-09 x pagar late check out hasta las 14:00 x pagar', S.REAL, ['jacuzzi', 'lateout'], F.COBRABLE, ['dos prestaciones', 'horarios independientes', 'fecha', 'cobro'], 'Jacuzzi y Late Check-out deben producir unidades separadas.'),
  caso(7, 'Sep26!AU4', '1 HORA DE TINAJA CALIENTE DE MADERA A LAS 11,00 AM (batas entregadas)', S.REAL, ['tonel'], F.ND, ['duración', 'material identifica Tonel', 'horario']),
  caso(8, 'Sep26!AY4', 'LATE OUT 13,00 HRS DE CORTESIA (X HACER) REPONER: Cab 2 checked out , Reponer:', S.REAL, ['lateout'], F.CORTESIA, ['horario', 'cortesía', 'acción operativa']),
  caso(9, 'Sep26!BO4', 'CAMA ADICIONAL', S.NO, ['cama_adicional'], F.ND, ['mención aislada']),
  caso(10, 'Sep26!O5', '1 hora de tinaja pagada  jacuzzi de 17:45 a 18:45 dejar batas en cabañas', S.REAL, ['jacuzzi'], F.COBRABLE, ['duración', 'rango horario', 'acción operativa', 'pago explícito']),
  caso(11, 'Sep26!S5', 'AGREGAR CAMA ADICIONAL', S.NO, ['cama_adicional'], F.ND, ['cama adicional fuera de Servicios']),
  caso(12, 'Sep26!AY5', '+1 HORA DE TINAJA TONEL DE CORTESIA 22,15 HRS', S.REAL, ['tonel'], F.CORTESIA, ['duración', 'horario', 'cortesía']),
  caso(13, 'Sep26!CU5', '2 masaje de 1 hora confirmado con PROFESIONAL A y PROFESIONAL B desde las 18 hrs por pagar', S.REAL, ['masaje'], F.COBRABLE, ['cantidad', 'duración', 'profesionales', 'horario', 'cobro'], 'Nombres anonimizados.'),
  caso(14, 'Sep26!G6', 'Tinaja A LAS 13HRS. (dejar batas)', S.REAL, ['tinaja'], F.ND, ['horario', 'acción operativa']),
  caso(15, 'Sep26!K6', '1 HORA DE TINAJA', S.REAL, ['tinaja'], F.ND, ['duración']),
  caso(16, 'Sep26!O6', 'late check out hasta las 14:00 x pagar', S.REAL, ['lateout'], F.COBRABLE, ['horario', 'cobro']),
  caso(17, 'Sep26!AE6', 'Tinaja x confirmar', S.NO, ['tinaja'], F.ND, ['pendiente de confirmación'], 'Mientras siga por confirmar, corresponde a Nota y no agenda prestación ni cargo.'),
  caso(18, 'Sep26!AY6', 'JACUZZI CORTESÍA A LAS 22:15', S.REAL, ['jacuzzi'], F.CORTESIA, ['horario', 'cortesía']),
  caso(19, 'Sep26!BO6', 'cliente frecuente CONSULTAR SI DESEA TINAJA ES DE CORTESÍA, DEJE BATAS EN SU CABAÑA', S.CONSULTA, ['tinaja'], F.CORTESIA, ['consulta condicional'], 'La cortesía no convierte una consulta en prestación.'),
  caso(20, 'Sep26!K7', 'Tinaja jacuzzi a las 22:15', S.REAL, ['jacuzzi'], F.ND, ['concepto específico', 'horario']),
  caso(21, 'Sep26!O7', 'tinaja de cortesía jacuzzi sábado 16:15 batas ok', S.REAL, ['jacuzzi'], F.CORTESIA, ['día', 'horario', 'cortesía']),
  caso(22, 'Sep26!AU7', 'Sábado 12-09 Tinaja jacuzzi a las 19 :15 hrs por pagar', S.REAL, ['jacuzzi'], F.COBRABLE, ['fecha', 'horario', 'cobro']),
  caso(23, 'Sep26!BO7', 'JACUZZI 17,45 X PAGAR', S.REAL, ['jacuzzi'], F.COBRABLE, ['horario', 'cobro']),
  caso(24, 'Sep26!BO7', '1 MASAJE RELAJANTE 60 MIN A LAS 16 HRS CON PROFESIONAL A', S.REAL, ['masaje'], F.ND, ['cantidad', 'duración', 'horario', 'profesional'], 'Nombre anonimizado.'),
  caso(25, 'Sep26!BS7', '1 MASAJE DESCONTRACTURANTE 60 MIN A LAS 12.15 Y 1 MASAJE RELAJANTE A LAS 13.15 AMBOS CON PROFESIONAL A SÁB 19-09', S.REAL, ['masaje'], F.ND, ['dos prestaciones', 'horarios independientes', 'profesional', 'fecha'], 'Dos unidades de masaje; nombre anonimizado.'),
  caso(26, 'Sep26!O8', 'TÓNEL A LAS 19:15 X PAGAR', S.REAL, ['tonel'], F.COBRABLE, ['horario', 'cobro']),
  caso(27, 'Sep26!AQ8', 'tónel a las 22.15 el sáb 12-09', S.REAL, ['tonel'], F.ND, ['horario', 'fecha']),
  caso(28, 'Sep26!BS8', 'cama adicional', S.NO, ['cama_adicional'], F.ND, ['mención aislada']),
  caso(29, 'Sep26!CA8', 'TINAJA DE MADERA A LAS 19,15 HRS X PAGAR', S.REAL, ['tonel'], F.COBRABLE, ['material identifica Tonel', 'horario', 'cobro']),
  caso(30, 'Sep26!CE8', 'Consultó por booking como erael sistema de tinajas, se le indico pero no hubo respuesta.', S.CONSULTA, ['tinaja'], F.ND, ['consulta', 'sin respuesta']),
  caso(31, 'Sep26!K9', '1 hora de tinaja tipo jacuzzi de cortesia por coordinar', S.NO, ['jacuzzi'], F.CORTESIA, ['pendiente de coordinación']),
  caso(32, 'Sep26!AU9', 'PROMO HAIKU SEGUNDA NOCHE, TINAJA JACUZZI A LAS 19,15 HRS CORTESIA- ENTREGAR BATAS.', S.REAL, ['jacuzzi'], F.CORTESIA, ['noche indicada', 'horario', 'cortesía', 'acción operativa']),
  caso(33, 'Sep26!BC9', '1 hora de tinaja cortesía a las 19.15 hrs JACUZZI 14-09', S.REAL, ['jacuzzi'], F.CORTESIA, ['duración', 'horario', 'fecha', 'cortesía']),
  caso(34, 'Sep26!BC9', '15-09 JACUZZI A LAS 19,45 HRS X PAGAR', S.REAL, ['jacuzzi'], F.COBRABLE, ['fecha', 'horario', 'cobro']),
  caso(35, 'Sep26!BC9', '16-09 JACUZZI A LAS 17.45 HRS X PAGAR', S.REAL, ['jacuzzi'], F.COBRABLE, ['fecha', 'horario', 'cobro']),
  caso(36, 'Sep26!BO9', 'CAMA ADICIONAL', S.NO, ['cama_adicional'], F.ND, ['mención aislada']),
  caso(37, 'Sep26!AQ10', 'SÁB 12-09 JACUZZI A LAS 20:45', S.REAL, ['jacuzzi'], F.ND, ['fecha', 'horario']),
  caso(38, 'Sep26!AY10', 'CONSULTAR SI DESEA CAMA ADICIONAL O CUNA ( la movi de cab 7 a cab 8 para extender 1 noche de cab 7)', S.CONSULTA, ['cama_adicional', 'cuna'], F.ND, ['consulta condicional']),
  caso(39, 'Sep26!AY10', '2 MASAJES RELAJANTES DE 30 MINUTOS C/D CON PROFESIONAL A X PAGAR (13-09-26)', S.REAL, ['masaje'], F.COBRABLE, ['cantidad', 'duración por unidad', 'profesional', 'fecha', 'cobro'], 'C/D y nombre anonimizado deben conservarse.'),
  caso(40, 'Sep26!AY10', 'TINAJA TONEL A LAS 19,15 HRS x PAGAR CLP$30,000 (13-09-26)', S.REAL, ['tonel'], F.COBRABLE, ['horario', 'fecha', 'monto', 'cobro']),
  caso(41, 'Sep26!BK10', 'JACUZZI A LAS 19.15 X PAGAR 16-09 COBRARLE $30.000, PORQUE HAY UNA MENOR DE 2 AÑOS', S.REAL, ['jacuzzi'], F.COBRABLE, ['horario', 'fecha', 'monto', 'cobro']),
  caso(42, 'Sep26!BK10', 'JACUZZI A LAS 16,15 X PAGAR X 3 PERS.', S.REAL, ['jacuzzi'], F.COBRABLE, ['horario', 'personas', 'cobro']),
  caso(43, 'Sep26!BS10', 'CAMA ADICIONAL', S.NO, ['cama_adicional'], F.ND, ['mención aislada']),
  caso(44, 'Sep26!BS10', 'JACUZZI 19,15 CORTESÍA X 5 PERS', S.REAL, ['jacuzzi'], F.CORTESIA, ['horario', 'personas', 'cortesía']),
  caso(45, 'Sep26!BS10', 'SABADO 19-9-26 MASAJES RELAJANTES 30 MIN C/U X 4, 2 CON PROFESIONAL A Y CON PROFESIONAL B, DESDE LAS 11 AM', S.REAL, ['masaje'], F.ND, ['fecha', 'duración por unidad', 'cantidad', 'profesionales', 'horario'], 'C/U y nombres anonimizados deben conservarse.'),
  caso(46, 'Sep26!AU11', 'TINAJA JACUZZI 22,15 HRS X PAGAR (12-09-26)', S.REAL, ['jacuzzi'], F.COBRABLE, ['horario', 'fecha', 'cobro']),
  caso(47, 'Sep26!BO11', 'CAMA ADICIONAL', S.NO, ['cama_adicional'], F.ND, ['mención aislada']),
  caso(48, 'Sep26!DC11', '+ 1 HORA DE TINAJA CALIENTE DE COORTESIA X COORDINAR.', S.NO, ['tinaja'], F.CORTESIA, ['pendiente de coordinación'], 'Conserva la falta ortográfica real COORTESIA.'),
  caso(49, 'Sep26!G12', 'TINAJA 11HRS. DEJAR BATAS', S.REAL, ['tinaja'], F.ND, ['horario', 'acción operativa']),
  caso(50, 'Sep26!O12', 'tinaja por coordinar', S.NO, ['tinaja'], F.ND, ['pendiente de coordinación']),
  caso(51, 'Sep26!AU12', 'Sabado 12-9-26 20,45 cortesia tinaja tonel', S.REAL, ['tonel'], F.CORTESIA, ['fecha', 'horario', 'cortesía']),
  caso(52, 'Sep26!BO12', 'TÓNEL A LAS 20,45 EL 17-09', S.REAL, ['tonel'], F.ND, ['horario', 'fecha']),
  caso(53, 'Sep26!BW12', 'Tonel de madera de cortesía 20.45 a 21.45', S.REAL, ['tonel'], F.CORTESIA, ['rango horario', 'cortesía']),
  caso(54, 'Sep26!AQ13', 'tinaja de cortesía 19.15 hrs', S.REAL, ['tinaja'], F.CORTESIA, ['horario', 'cortesía']),
  caso(55, 'Sep26!AQ13', 'TÓNEL A LAS 19:15 SÁBADO X PAGAR', S.REAL, ['tonel'], F.COBRABLE, ['día', 'horario', 'cobro']),
  caso(56, 'Sep26!BC13', 'TÓNEL A LAS 18:15 HRS de cortesia', S.REAL, ['tonel'], F.CORTESIA, ['horario', 'cortesía']),
  caso(57, 'Sep26!BC13', '2 MASAJES RELAJANTES DE 60 MIN C/U DESDE LAS 16 HRS CON PROFESIONAL A 15-09', S.REAL, ['masaje'], F.ND, ['cantidad', 'duración por unidad', 'horario', 'profesional', 'fecha'], 'C/U y nombre anonimizados deben conservarse.'),
  caso(58, 'Sep26!BC13', '2 MASAJEs RELAJANTE DE 60 MIN C/U DESDE LAS 16 HRS CON PROFESIONAL A', S.REAL, ['masaje'], F.ND, ['cantidad', 'duración por unidad', 'horario', 'profesional'], 'C/U y nombre anonimizados deben conservarse.'),
  caso(59, 'Sep26!BS13', 'JACUZZI 22,15 CORTESIA', S.REAL, ['jacuzzi'], F.CORTESIA, ['horario', 'cortesía']),
  caso(60, 'Sep26!AB14', 'TINAJA X COORDINAR DEJAR BATAS', S.NO, ['tinaja'], F.ND, ['pendiente de coordinación']),
  caso(61, 'Sep26!AU15', '1 HORA TINAJA DE CORTESÍA X COORDINAR', S.DESCARTADO, ['tinaja'], F.CORTESIA, ['reserva cancelada'], 'No debe operar ni buscar identidad.', { cancelada: true }),
  caso(62, 'Sep26!AZ15', 'cama adicional', S.NO, ['cama_adicional'], F.ND, ['mención aislada']),
  caso(63, 'Sep26!G16', 'FAVOR RESPETAR 1 HORA DE TINAJA CALIENTE DE CORTESIA', S.DESCARTADO, ['tinaja'], F.CORTESIA, ['reserva cancelada'], 'No debe operar ni buscar identidad.', { cancelada: true })
];

// Foto del clasificador anterior al refactor: 33 confirmados, 15 "por
// confirmar" y 15 notas. Se conserva para que el antes/después sea repetible.
const antes = Object.freeze([
  'servicio_por_confirmar','servicio_confirmado','nota','servicio_confirmado','nota','servicio_confirmado','servicio_por_confirmar','servicio_confirmado','nota','servicio_confirmado',
  'servicio_por_confirmar','servicio_confirmado','servicio_confirmado','servicio_por_confirmar','nota','servicio_confirmado','servicio_por_confirmar','servicio_confirmado','servicio_por_confirmar','servicio_confirmado',
  'servicio_confirmado','servicio_confirmado','servicio_confirmado','nota','servicio_confirmado','servicio_confirmado','servicio_confirmado','nota','servicio_por_confirmar','nota',
  'servicio_por_confirmar','servicio_confirmado','servicio_confirmado','servicio_confirmado','servicio_confirmado','nota','servicio_confirmado','nota','nota','servicio_confirmado',
  'servicio_confirmado','servicio_confirmado','nota','servicio_confirmado','servicio_confirmado','servicio_confirmado','nota','servicio_por_confirmar','servicio_por_confirmar','servicio_por_confirmar',
  'servicio_confirmado','servicio_confirmado','servicio_confirmado','servicio_por_confirmar','servicio_confirmado','servicio_confirmado','nota','nota','servicio_confirmado','servicio_por_confirmar',
  'servicio_por_confirmar','nota','servicio_por_confirmar'
]);

module.exports = Object.freeze({ S, F, casos: Object.freeze(casos), antes });
