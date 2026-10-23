const $=s=>document.querySelector(s);
$('#resumen-refresh-estado').textContent='';
$('#contador-busqueda-palabra').textContent='';
$('#fecha-actual').textContent='Jueves, 22 de octubre de 2026';
['continuan','ingresan','salen','servicios','pagos'].forEach((x,i)=>$('#contador-'+x).textContent=[3,2,2,3,2][i]);
$('#resumen-cabanas-conteo').textContent='11 de 11 cabañas';
const names=['Andrea Muñoz','Martín Rojas','Sofía Pérez','Valentina Soto','Diego Torres','Camila Díaz'];
const states=['Continúa','Ingresa','Sale','Continúa','Ingresa','Recambio','Libre'];
const stateKeys=['continua','ingresa','sale','continua','ingresa','recambio','libre'];
for(const [i,row] of [...document.querySelectorAll('.sites-resumen-cabana')].entries()){
 const q=s=>row.querySelector(s);
 const name=names[i]||'Sin reserva';
 q('.titular-cabana').textContent=name;
 q('.sites-resumen-celda--huesped .sites-resumen-subvalor').textContent=i<6?'2 adultos · 0 niños':'Disponible hoy';
 const badge=q('.sites-resumen-estado-badge');badge.textContent=states[i]||'Libre';badge.dataset.estadoVisual=stateKeys[i]||'libre';
 q('.sites-resumen-celda--aseo .sites-resumen-valor').textContent=i===2?'Pendiente':i<6?'Lista':'Sin pendientes';
 q('.sites-resumen-celda--aseo .sites-resumen-subvalor').textContent=i<6?'09:30 → 10:15':'—';
 q('.sites-resumen-servicio-chip').textContent=i===0?'Tinaja · 20:45':i===3?'Desayuno · 09:30':'Sin servicios';
 q('.sites-resumen-celda--servicios .sites-resumen-subvalor').textContent=i===0?'Nota: cortesía por coordinar':'—';
 q('.sites-resumen-celda--cobros .sites-resumen-valor').textContent=i===0?'Saldo $160.000':i===1?'Saldo $90.000':i<6?'Saldo $0':'—';
 q('.sites-resumen-celda--cobros .sites-resumen-subvalor').textContent=i<2?'Pendiente de pago':i<6?'Al día':'';
 q('.sites-resumen-celda--final .sites-resumen-valor').textContent=i===2?'Pendiente':'Lista';
 for(const [j,day]of [...row.querySelectorAll('.sites-resumen-dia')].entries()){
 day.querySelector('.sites-resumen-dia-valor').textContent=i<6?(j===0&&i===1?'Libre':name):'Libre';
 if(i<6)day.dataset.reservaEstado=j===2?'confirmada':'hospedada';
 }
}
