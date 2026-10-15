// Candidata administrativa. Sin CLI ni conexión automática.
const fs=require('node:fs'),path=require('node:path');
async function install(db,{authorized=false}={}){
  if(authorized!==true)throw Error('Requiere autorización independiente de instalación');
  const scripts=['01-registro-y-guard.sql','02-writers.sql'].map(name=>{
    const sql=fs.readFileSync(path.join(__dirname,'../supabase/candidates/rut-identidad',name),'utf8').replace(/\r\n/g,'\n');
    if((sql.match(/^begin;$/gm)||[]).length!==1||(sql.match(/^commit;$/gm)||[]).length!==1)throw Error('Estructura de candidata inesperada');
    return sql.replace(/^begin;$/m,'').replace(/^commit;$/m,'');
  });
  await db.exec('begin');
  let committing=false;
  try{for(const sql of scripts)await db.exec(sql);committing=true;await db.exec('commit');}
  catch(e){try{await db.exec('rollback')}catch(_){}
    throw Object.assign(new Error(committing?'Resultado de instalación no confirmado; consultar preflight antes de reintentar':
      'Instalación revertida; revisar preflight y cuerpos auditados'),{code:committing?'HLR03':'HLR02'});}
}
module.exports={install};
