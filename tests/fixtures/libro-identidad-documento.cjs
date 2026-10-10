// Sólo datos sintéticos. No representa la CAB ni las fechas del caso operativo.
module.exports=()=>{
    const q={desde:'2026-10-01',hasta:'2026-10-31'};
    const reservas=Array.from({length:6},(_,i)=>({id:'libro-ficticio-'+(i+1),titular:'Persona Ficticia Libro '+(i+1),
        rut_documento:'FICTICIO-LIBRO-'+(i+1),cabana:i+1,fecha_checkin:'2026-10-13',fecha_checkout:'2026-10-15',
        tipo_estadia:'alojamiento',noches:2,adultos:2,ninos:0,mascotas:0,texto_original:'',
        pagos:[],pagos_sin_asociacion:[],servicios:[],advertencias:[],coordenadas_origen:{hoja:'Oct26',celda:'C'+(i+1)}}));
    for(let i=0;i<2;i++) reservas[i].pagos=[{monto:10000,moneda:'CLP',medio_pago:'webpay_debito',
        codigo_autorizacion:'FICTICIO-AUT-'+(i+1),folio:null,bovtar:null,fecha_bloque:'2026-10-13',
        fecha_comprobante:'2026-10-13',tipo_movimiento:'alojamiento',pago_recibido:true,estado_pago:'registrado_en_libro',
        texto_original:'Comprobante ficticio '+(i+1),origen:{hoja:'Oct26',celda:'P'+(i+1)}}];
    const estadias=reservas.slice(0,4).map((r,i)=>({id:'estadia-ficticia-'+(i+1),reserva_id:'reserva-ficticia-'+(i+1),
        cabanas:{numero:r.cabana},fecha_ingreso:r.fecha_checkin,fecha_salida:r.fecha_checkout,tipo_estadia:r.tipo_estadia,
        adultos:2,ninos:0,mascotas:0,estado_estadia:'confirmada',
        reservas:{titular_nombre:'Persona Ficticia Proyecto '+(i+1),titular_tipo_documento:'pasaporte',
            titular_numero_documento:'FICTICIO-PROYECTO-'+(i+1),estado_reserva:'confirmada'}}));
    return {q,reservas,estadias};
};
