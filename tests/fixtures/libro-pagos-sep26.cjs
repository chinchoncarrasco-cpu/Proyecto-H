// Geometría observada en Sep26 del XLSX real. Sólo datos del caso reportado;
// no incluye contactos/documentos ni otros huéspedes del archivo privado.
module.exports = function fixture() {
 const celdas = [], combinaciones = [];
 const cell = (r,c,valor,extra={}) => celdas.push({r,c,valor,...extra});
 for (const [c,d] of [[10,'03'],[14,'04'],[18,'05']]) {
  cell(1,c,d+'-9-2026',{fechaISO:'2026-09-'+d});
  cell(24,c,c===10?'':'Pagos de arriendos de hoy');
  combinaciones.push({s:{r:24,c},e:{r:24,c:c+3}});
 }
 for(let cab=1;cab<=11;cab++) {
  cell(cab+1,0,'cabaña '+cab);
  const r=25+(cab-1)*5;
  cell(r,0,'cabaña '+cab);
  combinaciones.push({s:{r,c:0},e:{r:r+4,c:0}});
 }
 cell(6,10,'Macarena Hurtado // 1 noche');
 cell(11,14,'Macarena Hurtado // full day');
 for(const [r,c,d,concepto,monto,texto] of [
  [45,10,'03','cab1/1noche',153000,'Macarena Hurtado // Luigi Martínez // Bovtar: 173121-Folio: 000235// CREDITO // DG'],
  [46,10,'03','early check in',40000,'Macarena Hurtado // Luigi Martínez // Bovtar: 173121-Folio: 000235 //CREDITO// DG'],
  [70,14,'04','cab10/fullday',100000,'Macarena Hurtado // efectivo // $100.000 // CO'],
  [71,14,'04','cab10/fullday',20000,'Macarena Hurtado // Bovtar: 750453 - Folio: 000242 // debito // CO']]) {
  cell(r,c,Number(d)+'-9-2026',{fechaISO:'2026-09-'+d}); cell(r,c+1,texto);
  cell(r,c+2,concepto); cell(r,c+3,'$'+monto.toLocaleString('en-US'),{valorNumero:monto});
 }
 return {celdas,combinaciones,estilos:[]};
};
