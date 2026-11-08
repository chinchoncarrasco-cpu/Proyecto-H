// Ejecutar el mismo conjunto amplio localmente y en CI. Sólo pruebas aisladas;
// no requiere un Libro real ni credenciales de Proyecto H.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const archivos=fs.readdirSync(__dirname).filter(nombre=>nombre.endsWith('.test.cjs')&&
 /haiku-libro-semantica-v1|supabase-libro-reserva-worker-v1/.test(fs.readFileSync(path.join(__dirname,nombre),'utf8')))
 .sort().map(nombre=>path.join('tests',nombre));
if(!archivos.length)throw Error('No se encontraron pruebas del lector.');
console.log(`Verificando el lector y sus consumidores: ${archivos.length} archivos de pruebas.`);
const r=spawnSync(process.execPath,['--test',...archivos],{cwd:root,stdio:'inherit',env:process.env});
if(r.error)throw r.error;
process.exitCode=r.status??1;
