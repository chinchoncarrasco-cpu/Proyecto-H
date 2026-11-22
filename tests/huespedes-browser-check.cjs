
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { PGlite } = require(process.env.HAKU_PGLITE_MODULE || '@electric-sql/pglite');

const root = path.resolve(__dirname, '..');
const out = process.env.HAKU_GUEST_SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'haku-huespedes-'));
const user = 'a0000000-0000-4000-8000-000000000001';
const ada = 'a1000000-0000-4000-8000-000000000001';
const activeAda = '[data-estadia-id="a4000000-0000-4000-8000-000000000001"]';
const guestButton = activeAda + ' .hu-estadia-titular';
const directoryOnly = process.argv.includes('--directorio');
const allowed = new Set(['js/historial.js','js/calendario.js','js/checklist.js','js/app.js','js/cabanas.js',
  'js/haiku-huespedes-api-v1.js','js/haiku-huespedes-v1.js']);
const sqlFile = filename => fs.readFileSync(path.join(root, filename), 'utf8');

(async () => {
  const db = new PGlite();
  const images = new Map();
  let failUpload = false, failOutfit = false, browser;
  try {
    const migration = fs.readdirSync(path.join(root,'supabase/migrations')).find(f=>f.endsWith('_haku_huespedes_v1_1.sql'));
    await db.exec(sqlFile('tests/fixtures/huespedes-schema.sql'));
    await db.exec(sqlFile('supabase/migrations/'+migration));
    await db.exec(sqlFile('supabase/migrations/20261121003000_haku_huespedes_directorio_foto.sql'));
    await db.exec(sqlFile('supabase/migrations/20261122014301_huespedes_directorio_estadias.sql'));
    await db.exec(sqlFile('supabase/migrations/20261122042015_huespedes_vigencia_hospedados.sql'));
    await db.exec(sqlFile('supabase/migrations/20261122233716_huespedes_fotos_vehiculo.sql'));
    await db.exec("set time zone 'America/Santiago'");
    const seed = sqlFile('tests/huespedes-v1-postgres.test.sql').split('set local role authenticated;')[0];
    await db.exec(seed+'commit;');
    if(directoryOnly) await db.exec(sqlFile('tests/fixtures/huespedes-directorio.sql'));
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
    await db.exec('set role authenticated');
    const config = {
      directorio: ['p_estado','p_busqueda','p_tipo','p_origen','p_etiqueta','p_desde'],
      directorio_estadias: ['p_estado','p_busqueda','p_tipo','p_origen','p_etiqueta','p_desde'],
      perfil: ['p_id','p_reserva','p_historial'], guardar: ['p_id','p_reserva','p_accion','p_datos'],
    };
    let queue = Promise.resolve();
    function query(work) {
      const result = queue.then(work).then(data=>({data,error:null}),e=>({data:null,error:{message:e.message,code:e.code}}));
      queue = result.then(()=>{});
      return result;
    }
    const rpc = (name, values)=>{
      const kind = /^haiku_huesped_(directorio(?:_estadias)?|perfil|guardar)_v1$/.exec(name)?.[1];
      assert.ok(kind, 'RPC de Huéspedes esperada');
      const args = config[kind].map(key=>values[key] ?? ({p_estado:'hospedados',p_historial:false,p_desde:0}[key]??null));
      if(kind==='guardar') args[3]=JSON.stringify(args[3]);
      if(kind==='guardar'&&values.p_accion==='registro'&&values.p_datos.categoria==='vestimenta'&&failOutfit){
        failOutfit=false;
        return Promise.resolve({data:null,error:{message:'Guardado de vestimenta interrumpido',code:'P0001'}});
      }
      const params=args.map((_,i)=>'$'+(i+1)).join(',');
      return query(async()=> (await db.query('select public.haiku_huesped_'+kind+'_v1('+params+') data',args)).rows[0].data);
    };
    const storage = (action,key,bytes)=>query(async()=>{
      if(action==='upload'){
        if(failUpload)throw new Error('Subida ficticia interrumpida');
        await db.query("insert into storage.objects(bucket_id,name) values ('haiku-huespedes',$1)",[key]);
        images.set(key,Buffer.from(bytes));
        return {path:key};
      }
      if(action==='sign'){
        const r=await db.query("select name from storage.objects where bucket_id='haiku-huespedes' and name=$1",[key]);
        if(!r.rows.length) throw new Error('Foto no disponible');
        return {signedUrl:'/guest-test-photo/'+encodeURIComponent(key)};
      }
      const r=await db.query("delete from storage.objects where name=$1 returning name",[key]);
      if(r.rows.length)images.delete(key);
      return r.rows;
    });
    browser=await chromium.launch({headless:true,executablePath:process.env.HAIKU_BROWSER_PATH||undefined});
    fs.mkdirSync(out,{recursive:true});
    async function web(width,theme){
      const page=await browser.newPage({viewport:{width,height:950},timezoneId:'America/Santiago'});
      const errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      await page.exposeFunction('__guestRpc',rpc);
      await page.exposeFunction('__guestStorage',storage);
      await page.addInitScript(({user,theme})=>{
        localStorage.setItem('haikuSeccionActual','huespedes');
        window.haikuSesion={auth:{id:user},usuario:{id:user,nombre:'Operadora ficticia'}};
        window.haikuTienePermiso=()=>true;
        window.haikuSupabase={rpc:(n,a)=>window.__guestRpc(n,a),auth:{onAuthStateChange(){},getUser:async()=>({data:{user:{id:user}}})},
          storage:{from:()=>({
            createSignedUrl:k=>window.__guestStorage('sign',k),
            upload:async(k,file)=>window.__guestStorage('upload',k,Array.from(new Uint8Array(await file.arrayBuffer()))),
            remove:keys=>Promise.all(keys.map(key=>window.__guestStorage('delete',key)))
          })}};
        addEventListener('DOMContentLoaded',()=>{
          const node=document.documentElement;
          node.dataset.haikuTema=theme;
          node.classList.remove('haiku-privacidad-arranque','haiku-resumen-pendiente','haiku-cabanas-pendiente','haiku-pagos-pendiente');
        });
      },{user,theme});
      await page.route('**/*',route=>{
        const url=new URL(route.request().url());
        if(url.hostname==='cdn.jsdelivr.net') return route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:()=>({})}'});
        if(url.hostname!=='haku-huespedes.test') return route.abort();
        if(url.pathname.startsWith('/guest-test-photo/')){
          const bytes=images.get(decodeURIComponent(url.pathname.split('/').at(-1)));
          return bytes?route.fulfill({contentType:'image/jpeg',body:bytes}):route.fulfill({status:404});
        }
        const name=decodeURIComponent(url.pathname.slice(1)),file=path.join(root,name);
        if(name.includes('..')||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.abort();
        if(name.endsWith('.js')&&!allowed.has(name))return route.fulfill({contentType:'application/javascript',body:''});
        return route.fulfill({path:file,contentType:name.endsWith('.html')?'text/html':name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':undefined});
      });
      await page.goto('https://haku-huespedes.test/panel.html');
      await page.locator('#seccion-huespedes '+guestButton).waitFor();
      await page.evaluate(theme=>{
        document.documentElement.dataset.haikuTema=theme;
        document.documentElement.classList.remove('haiku-privacidad-arranque','haiku-resumen-pendiente','haiku-cabanas-pendiente','haiku-pagos-pendiente');
      },theme);
      return {page,errors};
    }
    async function android(preview,colorScheme){
      const mobile=await browser.newPage({viewport:{width:390,height:844},colorScheme,isMobile:true,hasTouch:true});
      const mobileErrors=[];
      mobile.on('pageerror',e=>mobileErrors.push(e.message));
      await mobile.exposeFunction('__guestRpc',rpc);
      await mobile.addInitScript(()=>{
        window.haikuSupabase={rpc:(n,a)=>window.__guestRpc(n,a)};
      });
      await mobile.route('**/*',route=>{
        const url=new URL(route.request().url());
        if(url.hostname!=='haku-android-guest.test')return route.abort();
        const name=decodeURIComponent(url.pathname.slice(1))||'index.html',file=path.join(preview,name);
        if(name.includes('..')||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.abort();
        return route.fulfill({path:file,contentType:({'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.ttf':'font/ttf'})[path.extname(name)]});
      });
      await mobile.goto('https://haku-android-guest.test/');
      return {mobile,mobileErrors};
    }

    if(directoryOnly){
      const demo=fs.readFileSync(path.join(root,'tests/fixtures/huespedes-figma/demo-avatar.png'));
      const file={name:'imagen-sintetica.png',mimeType:'image/png',buffer:demo};
      const face=user+'/a5000000-0000-4000-8000-000000000001.jpg';
      const reservation='a2000000-0000-4000-8000-000000000001';
      assert.equal((await storage('upload',face,demo)).error,null);
      assert.equal((await rpc('haiku_huesped_guardar_v1',{
        p_id:ada,p_reserva:reservation,p_accion:'foto',p_datos:{clase:'persona',ruta:face,esperada:null}
      })).error,null);
      for(const width of [1440,390]) for(const theme of ['claro','oscuro']){
        const {page,errors}=await web(width,theme);
        const section=page.locator('#seccion-huespedes');
        const list=section.locator('.hu-lista');
        const current=list.locator('[data-estadia-estado="hospedados"]');
        const previous=list.locator('[data-estadia-estado="historial"]');
        const holder=current.locator(activeAda);
        const toggle=holder.getByRole('button',{name:'1 acompañante',exact:true});
        assert.equal(await current.locator('[data-person-id="'+ada+'"]').count(),1);
        assert.equal(await previous.locator('[data-person-id="'+ada+'"]').count(),1);
        assert.deepEqual(await list.locator('.hu-estadia-grupo h3').allTextContents(),['Hospedados ahora','Por ingresar','Historial']);
        assert.equal(await list.getByText('Ciro Prueba',{exact:true}).count(),0);
        assert.equal(await toggle.getAttribute('aria-expanded'),'false');
        assert.ok(await list.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'el directorio no desborda');
        await toggle.focus();
        await toggle.press('Enter');
        assert.equal(await toggle.getAttribute('aria-expanded'),'true');
        await holder.getByText('Berta Prueba',{exact:true}).waitFor();
        await holder.getByText('Acompañantes por asignar a una cabaña').waitFor();
        await page.evaluate(()=>document.fonts.ready);
        await page.screenshot({path:path.join(out,'web-'+width+'-'+theme+'-directorio.png'),fullPage:true});
        await toggle.click();
        await holder.getByText('Berta Prueba',{exact:true}).waitFor({state:'hidden'});
        await holder.locator('.hu-estadia-titular').click();
        const card=section.locator('.hu-ficha');
        const viewer=section.locator('.hu-photo-viewer');
        await card.getByRole('button',{name:'Ampliar foto de perfil',exact:true}).click();
        await viewer.waitFor();
        const portrait=await viewer.locator('img').boundingBox();
        assert.ok(portrait.width>100&&portrait.width===portrait.height);
        assert.equal(await viewer.locator('img').evaluate(n=>getComputedStyle(n).borderRadius),'50%');
        await viewer.getByRole('button',{name:'Cerrar foto'}).click();
        await card.locator('summary[aria-label="Más opciones del huésped"]').click();
        await card.getByRole('button',{name:'Agregar vehículo',exact:true}).click();
        const vehicleForm=section.locator('.hu-vehicle-form');
        const type=`Vehículo de prueba ${width} ${theme}`;
        await vehicleForm.getByLabel('Tipo de vehículo').fill(type);
        await vehicleForm.getByLabel('Elegir imagen',{exact:true}).setInputFiles(file);
        const vehiclePhoto=vehicleForm.locator('.hu-vehicle-photo[data-adjustable]');
        await vehiclePhoto.waitFor();
        const frame=await vehiclePhoto.boundingBox();
        await page.mouse.move(frame.x+frame.width/2,frame.y+frame.height/2);
        await page.mouse.down();
        await page.mouse.move(frame.x+frame.width/2,frame.y+frame.height/2-26,{steps:4});
        await page.mouse.up();
        const position=Number(await vehicleForm.getByLabel('Ajustar vertical').inputValue());
        assert.ok(position>50,'el arrastre mueve el encuadre');
        const capture=vehicleForm.getByLabel('Capturar foto adicional',{exact:true});
        assert.equal(await capture.getAttribute('capture'),'environment');
        await vehicleForm.getByLabel('Seleccionar fotos adicionales',{exact:true}).setInputFiles(file);
        const thumb=vehicleForm.getByRole('button',{name:'Foto adicional 1',exact:true});
        await thumb.click();
        await viewer.getByRole('button',{name:'Cerrar foto'}).click();
        assert.equal(await vehicleForm.evaluate(node=>node.scrollWidth>node.clientWidth+1),false);
        await vehicleForm.getByRole('button',{name:'Guardar vehículo',exact:true}).click();
        await vehicleForm.waitFor({state:'hidden'});
        const stored=(await rpc('haiku_huesped_perfil_v1',{p_id:ada,p_reserva:reservation})).data.vehiculos.find(v=>v.tipo===type);
        assert.equal(stored.foto_posicion_y,position);
        assert.equal(stored.fotos_adicionales.length,1);
        assert.notEqual(stored.foto,stored.fotos_adicionales[0]);
        if(width===390)await section.getByRole('button',{name:'Huéspedes',exact:true}).click();
        const draft=current.getByRole('button',{name:'1 acompañante',exact:true}).last();
        await draft.click();
        await current.getByRole('button',{name:'Completar',exact:true}).click();
        await section.locator('.hu-ficha').getByRole('button',{name:'Completar datos',exact:true}).waitFor();
        if(width===390) await section.getByRole('button',{name:'Huéspedes',exact:true}).click();
        await section.locator('.hu-tabs').getByRole('button',{name:'Historial',exact:true}).click();
        await current.waitFor({state:'detached'});
        await previous.waitFor();
        await section.getByRole('searchbox').fill('Ciro');
        await previous.getByText('Ciro Prueba',{exact:true}).waitFor();
        await previous.getByRole('button',{name:'Ver perfil',exact:true}).click();
        await section.locator('.hu-ficha').getByRole('heading',{name:'Ciro Prueba',exact:true}).waitFor();
        assert.deepEqual(errors,[]);
        await page.close();
      }
      console.log('Directorio web verificado con PostgreSQL aislado, escritorio y móvil, claro y oscuro.');
      return;
    }
    if(process.argv.includes('--correcciones')){
      const preview=process.env.HAKU_GUEST_NATIVE_PREVIEW;
      assert.ok(preview,'Indica la vista Android en HAKU_GUEST_NATIVE_PREVIEW.');
      const berta='a1000000-0000-4000-8000-000000000002';
      const reservation='a2000000-0000-4000-8000-000000000001';
      const draft=(await db.query(
        "select id from public.haiku_huesped_integrantes_v1 where reserva_id=$1 and plaza>0",
        [reservation],
      )).rows[0].id;
      const note='Preferencia de prueba con respuesta demorada';
      for(const theme of ['light','dark']){
        const {mobile,mobileErrors}=await android(preview,theme);
        await mobile.getByRole('button',{name:'Ver perfil de Ada Prueba',exact:true}).first().click();
        await mobile.getByRole('button',{name:'Completar',exact:true}).click();
        await mobile.getByRole('button',{name:'Vincular perfil existente',exact:true}).click();
        const search=mobile.getByRole('textbox',{name:'Nombre o documento',exact:true});
        await search.fill('Ada');
        await mobile.getByText('Sin coincidencias.',{exact:true}).waitFor();
        await search.fill('Berta');
        await mobile.getByRole('button',{name:'Berta Prueba · ••••Y790',exact:true}).waitFor();
        assert.equal(await mobile.getByRole('button',{name:/Berta Prueba ·/}).count(),1);
        assert.deepEqual(mobileErrors,[]);
        await mobile.close();
      }
      for(const [width,theme] of [[1440,'claro'],[390,'oscuro']]){
        const {page,errors}=await web(width,theme);
        const section=page.locator('#seccion-huespedes');
        const modal=section.locator('dialog');
        await section.locator(guestButton).click();
        await section.getByRole('button',{name:'Completar',exact:true}).click();

        await section.getByRole('button',{name:'Vincular perfil existente',exact:true}).click();
        await modal.getByLabel('Nombre o documento').fill('Ada');
        await modal.getByText('Sin coincidencias.',{exact:true}).waitFor();
        await modal.getByLabel('Nombre o documento').fill('Berta');
        await modal.getByText('••••Y790',{exact:true}).waitFor();
        assert.equal(await modal.getByRole('button',{name:'Vincular',exact:true}).count(),1);
        await modal.getByRole('button',{name:'Volver',exact:true}).click();

        await section.getByRole('button',{name:'Completar datos',exact:true}).click();
        await modal.getByLabel('Información y gustos').fill(note+' '+theme);
        const identify=width===390;
        if(identify) await modal.getByLabel('Nombre',{exact:true}).fill('Acompañante ficticia');
        await page.evaluate(()=>{
          const client=window.haikuSupabase;
          const rpc=client.rpc;
          window.registroDeEscrituras=[];
          const hold=new Promise(resolve=>{window.liberarFicha=resolve;});
          client.rpc=async(name,args)=>{
            if(name!=='haiku_huesped_guardar_v1') return rpc(name,args);
            window.registroDeEscrituras.push([args.p_accion,args.p_id,args.p_reserva]);
            const result=await rpc(name,args);
            if(args.p_accion==='ficha') await hold;
            if(args.p_accion==='identificar') window.perfilIdentificado=result.data.id;
            return result;
          };
        });
        const originalForm=await modal.locator('form').elementHandle();
        await modal.getByRole('button',{name:'Guardar',exact:true}).click();
        await page.waitForFunction(()=>window.registroDeEscrituras.length===1);
        for(const name of ['Volver','Cerrar']){
          const button=modal.getByRole('button',{name,exact:true});
          assert.equal(await button.isDisabled(),true);
          await button.evaluate(element=>element.click());
        }
        await page.keyboard.press('Escape');
        assert.equal(await modal.isVisible(),true);

        // Fuerza un cambio de perfil aun si la interfaz impide cerrar el formulario.
        await modal.evaluate(element=>element.close());
        await section.getByRole('button',{name:'Ver perfil',exact:true}).last().click();
        await section.getByRole('heading',{name:'Berta Prueba',exact:true}).waitFor();
        await section.locator('.hu-ficha').getByRole('button',{name:'Registrar información',exact:true}).click();
        await page.evaluate(()=>window.liberarFicha());
        await page.waitForFunction(form=>!form.hasAttribute('aria-busy'),originalForm);
        const actions=identify?['ficha','registro','identificar']:['ficha','registro'];
        assert.deepEqual(await page.evaluate(()=>window.registroDeEscrituras),actions.map(action=>[action,draft,reservation]));
        assert.equal(await modal.getByRole('heading',{name:'Registrar información',exact:true}).isVisible(),true);
        await modal.getByRole('button',{name:'Volver',exact:true}).click();
        assert.equal(await section.getByRole('heading',{name:'Berta Prueba',exact:true}).isVisible(),true);
        const bertaProfile=await rpc('haiku_huesped_perfil_v1',{p_id:berta,p_reserva:reservation});
        const originalId=identify?await page.evaluate(()=>window.perfilIdentificado):draft;
        assert.ok(originalId);
        const originalProfile=await rpc('haiku_huesped_perfil_v1',{p_id:originalId,p_reserva:reservation});
        assert.ok(!bertaProfile.data.registros.some(row=>row.texto.startsWith(note)));
        assert.ok(originalProfile.data.registros.some(row=>row.texto===note+' '+theme));
        await section.locator('.hu-ficha').getByRole('button',{name:'Registrar información',exact:true}).click();
        await modal.getByLabel('Información o detalles').fill('Guardado normal de Berta '+theme);
        await modal.getByRole('button',{name:'Guardar',exact:true}).click();
        await section.getByText('Guardado normal de Berta '+theme,{exact:true}).waitFor();
        assert.equal(await modal.isVisible(),false);
        assert.deepEqual(errors,[]);
        await page.close();
      }
      console.log('Guardado demorado web y exclusión de integrantes en los dos clientes aprobados.');
      return;
    }
    for(const width of [1440,390]) for(const theme of ['claro','oscuro']){
      const {page,errors}=await web(width,theme);
      const section=page.locator('#seccion-huespedes');
      assert.equal(await section.locator('.hu-estadia-titular').count(),4);
      assert.ok(await section.evaluate(n=>n.scrollWidth<=n.clientWidth+1),'la sección no desborda horizontalmente');
      if(width>760){
        const geometry=await section.locator('.hu-layout').evaluate(n=>{
          const list=n.querySelector('.hu-lista').getBoundingClientRect(),card=n.querySelector('.hu-ficha').getBoundingClientRect();return {directory:list.width,side:card.width,listRight:list.right,sideLeft:card.left};
        });
        assert.ok(geometry.directory>geometry.side&&geometry.listRight<geometry.sideLeft,'directorio y ficha lateral');
      }else{
        assert.equal(await section.locator('.hu-ficha').isVisible(),false);
        const search=await section.locator('.hu-busqueda').boundingBox();
        const type=await section.getByLabel('Tipo de cabaña').boundingBox();
        assert.ok(search.width>300&&search.y<type.y,'la búsqueda usa una línea completa en móvil');
      }
      await page.screenshot({path:path.join(out,'web-'+width+'-'+theme+'-directorio.png'),fullPage:true});
      await section.locator(guestButton).click();
      await section.getByRole('heading',{name:'Ada Prueba'}).waitFor();
      assert.equal(await section.locator('.hu-lista').isVisible(),width>760);
      await page.screenshot({path:path.join(out,'web-'+width+'-'+theme+'-perfil.png'),fullPage:true});
      assert.deepEqual(errors,[]);
      await page.close();
    }


    const {page,errors}=await web(390,'claro');
    const section=page.locator('#seccion-huespedes');
    const modal=section.locator('dialog');
    await section.locator(guestButton).click();
    await section.getByRole('heading',{name:'Ada Prueba'}).waitFor();
    await section.locator('.hu-ficha').getByRole('button',{name:'Registrar información',exact:true}).click();
    await modal.getByLabel('Información o detalles').fill('Prefiere chocolate amargo');
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('haiku:auth-ready')));
    assert.equal(await modal.getByLabel('Información o detalles').inputValue(),'Prefiere chocolate amargo');
    await modal.getByRole('radio',{name:'Confirmado por huésped',exact:true}).click();
    await modal.getByRole('button',{name:'Guardar',exact:true}).click();
    await section.getByText('Prefiere chocolate amargo',{exact:true}).waitFor();
    await section.getByRole('button',{name:'Ver perfil',exact:true}).first().click();
    await section.getByRole('heading',{name:'Berta Prueba'}).waitFor();
    assert.equal(await section.getByText('Prefiere chocolate amargo',{exact:true}).count(),0);
    await section.getByRole('button',{name:'Ver perfil',exact:true}).first().click();
    await section.getByRole('heading',{name:'Ada Prueba'}).waitFor();

    await section.getByRole('button',{name:'Agregar foto',exact:true}).click();
    const png=await page.evaluate(()=>{
      const canvas=document.createElement('canvas');canvas.width=120;canvas.height=180;
      const ctx=canvas.getContext('2d');ctx.fillStyle='#c2906d';ctx.fillRect(0,0,120,180);
      ctx.fillStyle='#244436';ctx.fillRect(30,20,40,100);return canvas.toDataURL('image/png').split(',')[1];
    });
    const fixture={name:'foto-ficticia.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')};
    await modal.locator('input[type=file]').setInputFiles(fixture);
    await modal.locator('canvas').waitFor();
    await modal.getByRole('button',{name:'Girar'}).click();
    await modal.getByText('Ajustar encuadre',{exact:true}).click();
    await modal.getByLabel('Acercar',{exact:true}).fill('1.5');
    await modal.getByRole('button',{name:'Guardar cambios'}).click();
    await section.getByRole('button',{name:'Cambiar foto',exact:true}).waitFor();
    // A photo may succeed before clothing fails. Choosing another photo in the
    // same retained form must use the new expected path and preserve the outfit.
    await section.getByRole('button',{name:'Cambiar foto',exact:true}).click();
    await modal.locator('input[type=file]').setInputFiles(fixture);
    await modal.locator('canvas').waitFor();
    await modal.getByLabel('Prenda superior',{exact:true}).fill('Chaqueta azul de prueba');
    failOutfit=true;
    await modal.getByRole('button',{name:'Guardar cambios',exact:true}).click();
    await modal.getByText('Guardado de vestimenta interrumpido',{exact:true}).waitFor();
    await modal.locator('input[type=file]').setInputFiles(fixture);
    await modal.locator('canvas').waitFor();
    await modal.getByRole('button',{name:'Guardar cambios',exact:true}).click();
    await section.getByText('Chaqueta azul de prueba',{exact:true}).waitFor();
    const original=(await rpc('haiku_huesped_perfil_v1',{p_id:ada})).data.persona.foto;
    assert.ok(original);
    failUpload=true;
    await section.getByRole('button',{name:'Cambiar foto',exact:true}).click();
    await modal.locator('input[type=file]').setInputFiles(fixture);
    await modal.locator('canvas').waitFor();
    await modal.getByRole('button',{name:'Guardar cambios'}).click();
    await modal.getByText('No se pudo subir la foto. Se conservó la anterior.').waitFor();
    assert.equal((await rpc('haiku_huesped_perfil_v1',{p_id:ada})).data.persona.foto,original);
    failUpload=false;
    await modal.getByRole('button',{name:'Guardar cambios'}).click();
    await modal.waitFor({state:'hidden'});
    const updated=(await rpc('haiku_huesped_perfil_v1',{p_id:ada})).data.persona.foto;
    assert.ok(updated&&updated!==original);
    await section.getByRole('button',{name:'Cambiar foto',exact:true}).click();
    await modal.getByRole('button',{name:'Quitar',exact:true}).click();
    await modal.getByRole('button',{name:'Guardar cambios',exact:true}).click();
    await section.getByRole('button',{name:'Agregar foto'}).waitFor();
    assert.equal((await rpc('haiku_huesped_perfil_v1',{p_id:ada})).data.persona.foto,null);

    await section.getByRole('button',{name:'Completar',exact:true}).click();
    await section.getByRole('button',{name:'Completar datos'}).click();
    await modal.getByLabel('Cómo reconocerlo hoy').fill('Pañuelo verde');
    await modal.getByLabel('Información y gustos').fill('Prefiere té rojo');
    await modal.getByRole('button',{name:'Guardar',exact:true}).click();
    await section.getByText('Prefiere té rojo',{exact:true}).waitFor();
    await section.getByRole('button',{name:'Vincular perfil existente'}).click();
    await modal.getByLabel('Nombre o documento').fill('XY790');
    await modal.getByRole('button',{name:'Vincular',exact:true}).click();
    await modal.getByRole('button',{name:'Vincular',exact:true}).click();
    await section.getByRole('heading',{name:'Berta Prueba'}).waitFor();
    await section.getByText('Prefiere té rojo',{exact:true}).waitFor();
    assert.deepEqual(errors,[]);
    await page.close();

    const fresh=await web(390,'oscuro');
    await fresh.page.locator(guestButton).click();
    await fresh.page.getByText('Prefiere chocolate amargo',{exact:true}).waitFor();
    await fresh.page.close();

    if (process.env.HAKU_GUEST_NATIVE_PREVIEW) {
      const preview=process.env.HAKU_GUEST_NATIVE_PREVIEW;
      for(const colorScheme of ['light','dark']){
        const {mobile,mobileErrors}=await android(preview,colorScheme);
        await mobile.getByRole('button',{name:'Ver perfil de Ada Prueba',exact:true}).first().waitFor();
        await mobile.evaluate(()=>document.fonts.ready);
        await mobile.screenshot({path:path.join(out,'android-vista-'+colorScheme+'-directorio.png')});
        await mobile.getByRole('button',{name:'Ver perfil de Ada Prueba',exact:true}).first().click();
        await mobile.getByText('Prefiere chocolate amargo',{exact:true}).waitFor();
        await mobile.screenshot({path:path.join(out,'android-vista-'+colorScheme+'-perfil.png')});
        if(colorScheme==='dark'){
          await mobile.getByRole('button',{name:'Registrar información',exact:true}).click();
          await mobile.getByRole('textbox',{name:'Información',exact:true}).fill('Prefiere la terraza');
          await mobile.getByRole('button',{name:'Guardar',exact:true}).click();
          await mobile.getByText('Prefiere la terraza',{exact:true}).waitFor();
        }
        assert.deepEqual(mobileErrors,[]);
        await mobile.close();
      }
      const shared=await web(1440,'claro');
      await shared.page.getByText('Prefiere la terraza',{exact:true}).waitFor();
      await shared.page.close();
      console.log('Componentes Android en navegador: lectura y escritura compartidas con web en PostgreSQL.');
    }

    console.log('Huéspedes web: escritorio y móvil claro/oscuro, fichas vinculadas, persistencia y fotos. Capturas: '+out);
  } finally {
    await browser?.close();
    await db.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
