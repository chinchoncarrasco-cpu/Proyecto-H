// Casos inventados: patrones estructurales, nunca datos del Libro real.
const titular='Aurora Ficción del Bosque';
function hoja(texto,extra={}) {
 return {celdas:[{r:1,c:2,valor:'3 oct',fechaISO:'2026-10-03'},
  {r:1,c:6,valor:'4 oct',fechaISO:'2026-10-04'},{r:1,c:10,valor:'5 oct',fechaISO:'2026-10-05'},
  {r:2,c:0,valor:'cabaña 1'},{r:2,c:2,valor:texto,estiloId:0,...extra},
  {r:24,c:2,valor:'Pagos de arriendos de hoy'}],
  combinaciones:[{s:{r:2,c:2},e:{r:2,c:8}}],
  estilos:[{fill:{fgColor:{rgb:'FFB4A7D6'}},font:{color:{rgb:'FF000000'}}}]};
}
const notas=[
 'CHECK-IN EN ACORDEÓN','RESERVA EN ACORDEON','reserva reagendada',
 'tarifa autorizada por Recepción','descuento autorizado por Administración',
 'SE LE RESPETA EL PRECIO BOOKING','tarifa especial','Late x pagar',
 'JUGUERA PRESTADA','descorchador entregado','SACA CORCHOS',
 'SE PRESTARON UTENSILIOS DE ASADO','SE LES REPUSO CARBÓN Y TOALLAS',
 'SE ÑE REPUSO CARBON, CONFORT Y SERVILLETAS','SE REPUSO CHISPERO (NO TENÍA)',
 'ATENCIÓN DE ANIVERSARIO AVAL EN WHATSAPP','Cotesía de cumpleaños',
 'GRUPO AGENCIA DE VIAJE','grupo familiar','numero telefonico',
 'El contrato de mascotas está en el correo','VIENE CON DOS AUTOS',
 'vienen con un conejo pequeño','dar prioridad en entregar',
 'modificada la estadía por mantenimiento','se guardó comida en el freezer',
 'presentó PDI y pasaporte','debe presentar PDI',
 'COBRO HECHO SIN IVA, RECORDAR SOLICITAR PDI','PAGA DIFERENCIA PROMO HAIKU, SE QUEDAN UNA NOCHE'
];
module.exports={titular,hoja,notas};
