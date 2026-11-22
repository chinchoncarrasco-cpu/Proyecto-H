// Fictitious content of the approved Figma. No production guest data.
const names=[['Diego','Rojas'],['Camila','Pérez'],['Valentina','Soto'],['Mateo','López'],['Jean','Moreau'],['Nicolás','Vidal'],['Carolina','Reyes'],[null,null]];
const visits=[10,10,11,11,6,2,8,10];
const types=['Loft Deluxe','Loft Deluxe','Dos Ambientes','Dos Ambientes','Loft Clásico','Miniloft','Maxiloft','Loft Deluxe'];
const combos=[['Turismo aventura','Sociable'],['En pareja','Bienestar'],['Familia','Naturaleza'],['Familia','Senderismo'],['Internacional','Cultura local'],['Trabajo y descanso'],['Amigos','Networking'],[]];
const tagGroups={Motivo:['Descanso','Trabajo','Luna de miel','Celebración'],Compañía:['En pareja','Familia','Amigos','Viajero solo'],Intereses:['Turismo aventura','Naturaleza','Senderismo','Bienestar','Cultura local','Networking'],Atención:['Sociable','Privacidad','Atención cercana','Internacional']};
const tags=Object.entries(tagGroups).flatMap(([grupo,entries])=>entries.map(nombre=>({id:'tag-'+nombre,grupo,nombre})));
const reserva='reserva-diego';
const photo='demo/diego.png';
const filas=names.map(([nombre,apellido],i)=>({id:'guest-'+i,nombre,apellido,tipo_documento:i===4?'pasaporte':'rut',documento:i===7?null:'RUT ••••••'+['821-4','260-7','415-2','650-9','218','219-1','940-3'][i],
  foto:i===0?photo:null,nacionalidad:i===4?'Francia':'Chile',borrador:i===7,rol:i===7?'borrador':[1,3].includes(i)?'acompanante':'titular',plaza:i===7?2:null,
  pendiente:i===7,excedente:false,numero:visits[i],tipo:types[i],ingreso:i===2||i===3?'2026-11-19':'2026-11-20',salida:i===2||i===3?'2026-11-23':'2026-11-22',reserva_id:i===0||i===1||i===7?reserva:'reserva-'+i,visitas:i<2?2:i<4?3:1,registros:[4,2,6,1,2,0,0,0][i],etiquetas:combos[i]}));
const visit={reserva_id:reserva,rol:'titular',plaza:null,excedente:false,hospedada:true,numero:10,tipo:'Loft Deluxe',ingreso:'2026-11-20',salida:'2026-11-22',adultos:3,ninos:0,mascotas:1};
const record=(id,texto,categoria='preferencia',source='Lo comentó',local=false)=>({id,texto,categoria,fuente:source,reserva_id:local?reserva:null,nombre_operador:local?'Scarla':'Felipe',fecha:'2026-11-20T16:30:00Z',modificado_en:'2026-11-20T16:30:00Z',superior:null,inferior:null});
const registros=[record('pref1','Prefiere chocolate amargo.','preferencia','Confirmado por huésped'),record('pref2','Le gustan las recomendaciones locales.'),record('act1','Hicieron rafting en el río Maipo.','actividad','Lo comentó',true),record('act2','Exploran la zona durante el día.','nota','Observación',true),{...record('clothes','', 'vestimenta','Observación',true),superior:'Chaqueta azul',inferior:'Pantalón beige'}];
const personas=filas.map((r,i)=>({...r,numero_documento:i===0?'123458214':i===1?'123452607':null,idioma:'Español',telefono:null,correo:null,descripcion:null,cupo_revisado_en:null}));
const profiles=Object.fromEntries(personas.map((persona,i)=>[persona.id,{
  persona,visita:{...visit,reserva_id:filas[i].reserva_id,numero:filas[i].numero,tipo:filas[i].tipo,rol:filas[i].rol,plaza:filas[i].plaza},visitas:filas[i].visitas,
  tipos_visitados:i<2?['Miniloft','Loft Deluxe']:[filas[i].tipo],historial:[visit],estadias:[{id:'stay',numero:10,tipo:'Loft Deluxe'}],integrantes:[personas[0],personas[1],personas[7]],
  registros:i===0?registros:i===1?[record('camila1','Prefiere té de hierbas.'),record('camila2','Le gustan los masajes relajantes.')]:[],
  etiquetas:tags.filter(t=>(i===0?['En pareja','Turismo aventura','Sociable','Luna de miel']:combos[i]).includes(t.nombre)),
  vehiculos:i===0?[{id:'vehicle1',tipo:'SUV',modelo:'Toyota RAV4',color:'Gris oscuro',patente:null,foto:null}]:[],
  mascotas:i===0?[{id:'pet1',nombre:'Milo',especie:'Perro',raza:'Mestizo',tamano:'Mediano',color:'Café',cuidados:'Se asusta con ruidos fuertes.',presente:true,foto:null}]:[],puede_editar:true,
}]));
function rpc(name,args={}){
  const kind=name.replace('haiku_huesped_','').replace('_v1','');
  if(kind==='perfil')return profiles[args.p_id];
  if(kind==='directorio_estadias'){
    const rows=filas.filter(r=>r.rol==='titular').map((r,i)=>({
      ...r,documento:r.documento?.replace(/^RUT /,''),estadia_id:'stay-'+r.id,
      estado:i<2?'hospedados':'historial',por_asignar:false,abrir_acompanantes:false,
      acompanantes:i===0?[filas[1],filas[7]]:i===1?[filas[3]]:[],
    }));
    const grupos={hospedados:{titulares:2,estadias:2},historial:{titulares:rows.length-2,estadias:rows.length-2}};
    return {...rpc('haiku_huesped_directorio_v1'),filas:rows,grupos,titulares:rows.length,
      conteos:{todos:rows.length,hospedados:2,historial:rows.length-2,pendientes:1}};
  }
  if(kind==='directorio'){
    const rows=filas.filter(r=>(args.p_estado!=='pendientes'||r.pendiente)&&(!args.p_busqueda||[r.nombre,r.apellido,r.documento].join(' ').toLocaleLowerCase('es').includes(args.p_busqueda.toLocaleLowerCase('es')))&&(!args.p_tipo||r.tipo===args.p_tipo)&&(!args.p_etiqueta||r.etiquetas.includes(args.p_etiqueta.replace('tag-','')))&&(!args.p_origen||r.nacionalidad===args.p_origen));
    return {filas:rows,conteos:{hospedados:rows.length,todos:128,pendientes:3},cabanas:5,puede_editar:true,tipos:[...new Set(types)],origenes:['Chile','Francia'],etiquetas:tags};
  }
  throw new Error('Visual fixture is read only. Use PostgreSQL integration tests for writes.');
}
module.exports={rpc,filas,profiles,photo,tags};
