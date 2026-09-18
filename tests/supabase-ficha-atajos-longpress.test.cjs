const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../js/supabase-ficha-atajos.js'),'utf8');

class Elemento {
    constructor(tag='div') {
        this.tagName=tag.toUpperCase();this.children=[];this.parentElement=null;this.dataset={};this.attributes={};
        this.style={};this.hidden=false;this.isConnected=true;this.events={};this._text='';this.className='';
        this.classList={
            add:(...xs)=>{const s=new Set(this.className.split(/\s+/).filter(Boolean));xs.forEach(x=>s.add(x));this.className=[...s].join(' ')},
            remove:(...xs)=>{const s=new Set(this.className.split(/\s+/).filter(Boolean));xs.forEach(x=>s.delete(x));this.className=[...s].join(' ')},
            toggle:(x,on)=>{on?this.classList.add(x):this.classList.remove(x)},
            contains:x=>this.className.split(/\s+/).includes(x)
        };
    }
    set textContent(v){this._text=String(v??'');this.children=[]}
    get textContent(){return this._text+this.children.map(x=>x.textContent||'').join('')}
    append(...xs){xs.forEach(x=>{if(typeof x==='string')x=Object.assign(new Elemento('span'),{textContent:x});x.parentElement=this;this.children.push(x)})}
    appendChild(x){this.append(x);return x}
    replaceChildren(...xs){this.children=[];this._text='';this.append(...xs)}
    addEventListener(t,f){(this.events[t]??=[]).push(f)}
    setAttribute(k,v){this.attributes[k]=String(v)}
    removeAttribute(k){delete this.attributes[k]}
    closest(selector){
        if(selector==='[data-haiku-ficha-atajo]'&&this.dataset.haikuFichaAtajo)return this;
        return this.parentElement?.closest?.(selector)||null;
    }
    querySelector(selector){
        if(selector==='[data-haiku-ficha-detalle-contenido]'&&this.dataset.haikuFichaDetalleContenido)return this;
        for(const child of this.children){const found=child.querySelector?.(selector);if(found)return found}return null;
    }
    contains(target){if(target===this)return true;return this.children.some(x=>x.contains?.(target))}
    getBoundingClientRect(){return {left:120,top:160,right:220,bottom:220,width:100,height:60}}
    setPointerCapture(){}
}

function consulta(data){
    const q={select(){return q},in(){return q},eq(){return q},order(){return q},then(resolve){return Promise.resolve({data,error:null}).then(resolve)}};
    return q;
}

function harness({grupo=true}={}){
    const listeners={};const windowListeners={};const calls=[];
    let ahora=1000;
    const head=new Elemento('head'),body=new Elemento('body'),modal=new Elemento('div');
    modal.id='ficha-reserva-modal';modal.hidden=false;modal.dataset={reservaId:'r2',numeroCabana:'2'};
    const cuadro=new Elemento('div');cuadro.dataset.haikuFichaAtajo='ficha-pago-total';
    const valor=new Elemento('strong');valor.id='ficha-pago-total';cuadro.append(valor);
    const map=new Map([['ficha-reserva-modal',modal],['ficha-pago-total',valor]]);
    const menu={click(){calls.push(['menu'])}};
    const destino=new Elemento('div');destino.scrollIntoView=()=>calls.push(['enfocar']);
    const document={head,body,
        createElement:t=>new Elemento(t),
        getElementById:id=>map.get(id)||null,
        querySelector:s=>s==='.menu-item[data-seccion="pagos"]'?menu:s.startsWith('#pagos-lista-checkin ')?destino:null,
        addEventListener(t,f){(listeners[t]??=[]).push(f)}
    };
    const cliente={
        async rpc(name){
            calls.push(['rpc',name]);
            if(name==='haiku_ficha_reserva_core')return {data:{estadias:[{cabana_numero:2,fecha_ingreso:'2026-09-17',fecha_salida:'2026-09-20'}]},error:null};
            return {data:grupo?{es_grupo:true,total_alojamiento:600000,abonado_alojamiento:270000,saldo_alojamiento:330000,servicios_pendientes:50000,miembros:[{reserva_id:'r2',cabana:2},{reserva_id:'r7',cabana:7}]}:{es_grupo:false,reserva_id:'r2'},error:null};
        },
        from(tabla){
            calls.push(['from',tabla]);
            if(tabla==='vista_estado_cargos')return consulta([
                {reserva_id:'r2',tipo_cargo:'alojamiento',estado:'activo',monto_ajustado:300000,aplicado_neto:100000,saldo_cargo:200000},
                {reserva_id:'r7',tipo_cargo:'alojamiento',estado:'activo',monto_ajustado:300000,aplicado_neto:170000,saldo_cargo:130000},
                {reserva_id:'r7',servicio_id:'s1',tipo_cargo:'servicio',estado:'activo',monto_ajustado:50000,aplicado_neto:0,saldo_cargo:50000}
            ]);
            if(tabla==='pagos')return consulta([
                {id:'p1',reserva_id:'r2',pago_grupo_id:'g1',monto:100000,medio_pago:'tarjeta_credito',fecha_pago:'2026-09-17',folio:'284'},
                {id:'p2',reserva_id:'r7',pago_grupo_id:'g1',monto:170000,medio_pago:'tarjeta_credito',fecha_pago:'2026-09-17',folio:'284'}
            ]);
            if(tabla==='servicios')return consulta([
                {id:'s1',reserva_id:'r7',fecha_servicio:'2026-09-19',hora_inicio:'18:00:00',catalogo_servicios:{nombre:'Tinaja'}}
            ]);
            return consulta([]);
        }
    };
    const window={haikuSupabase:cliente,innerWidth:900,innerHeight:700,
        addEventListener(t,f){(windowListeners[t]??=[]).push(f)},
        haikuCargarSaldosCheckinSupabase:async()=>{calls.push(['saldo'])}
    };
    const reloj=(fn,ms)=>{const t=setTimeout(fn,ms);if(ms>=1000)t.unref();return t};
    const context={window,document,MutationObserver:class{observe(){}},localStorage:{setItem(){}},CSS:{escape:x=>x},
        Date:{now:()=>ahora},requestAnimationFrame:f=>f(),setTimeout:reloj,clearTimeout,console:{info(){},warn(){},error(){}},alert(){}};
    vm.runInNewContext(source,context);
    const fire=async(type,event={})=>{
        const e={target:valor,pointerId:4,pointerType:'touch',button:0,clientX:150,clientY:180,key:'',
            preventDefault(){this.prevented=true},stopPropagation(){},stopImmediatePropagation(){this.immediate=true},...event};
        for(const fn of listeners[type]||[])await fn(e);
        return e;
    };
    return {window,document,body,modal,cuadro,valor,calls,fire,advance:ms=>{ahora+=ms}};
}

test('the four summaries use current read-only data, including grouped payments and pending services',async()=>{
    const h=harness();
    const api=h.window.HAIKU_FICHA_ATAJOS_V2;
    const total=await api.leerDetalleFinanciero('r2','2','total');
    const abono=await api.leerDetalleFinanciero('r2','2','abono');
    const saldo=await api.leerDetalleFinanciero('r2','2','saldo');
    const servicios=await api.leerDetalleFinanciero('r2','2','servicios');
    assert.deepEqual({...total.resumen},{total:600000,abono:270000,saldo:330000,servicios:50000});
    assert.equal(total.porCabana.length,2);assert.equal(saldo.porCabana[1].saldo,130000);
    assert.equal(abono.pagos.length,1);assert.equal(abono.pagos[0].monto,270000);
    assert.equal(servicios.servicios.length,1);assert.equal(servicios.servicios[0].nombre,'Tinaja');
    assert.equal(servicios.servicios[0].saldo,50000);
    assert.ok(h.calls.every(x=>!['insert','update','upsert','delete'].includes(x[0])));
});

test('a short click retains the existing navigation to the corresponding payment section',async()=>{
    const h=harness();
    const click=await h.fire('click');
    await new Promise(resolve=>setTimeout(resolve,120));
    assert.equal(click.prevented,true);
    assert.equal(h.calls.filter(x=>x[0]==='rpc'&&x[1]==='haiku_ficha_reserva_core').length,1);
    assert.equal(h.calls.filter(x=>x[0]==='rpc'&&x[1]==='haiku_finanzas_grupo').length,0);
    assert.ok(h.calls.some(x=>x[0]==='menu'));
});

test('mouse and touch holds open the read-only popup and consume only their generated click',async()=>{
    for(const pointerType of ['mouse','touch']){
        const h=harness();
        await h.fire('pointerdown',{pointerType});
        await new Promise(resolve=>setTimeout(resolve,560));
        // Puede mantener el popup abierto todo el tiempo que necesite antes
        // de soltar; el click sintético posterior todavía debe consumirse.
        h.advance(10000);
        await h.fire('pointerup',{pointerType});
        const click=await h.fire('click',{pointerType});
        await new Promise(resolve=>setTimeout(resolve,20));
        const popup=h.body.children.find(x=>x.id==='haiku-ficha-detalle-popup');
        assert.ok(popup&&!popup.hidden,pointerType);
        assert.match(popup.textContent,/Total del grupo/);
        assert.match(popup.textContent,/\$600\.000/);
        assert.match(popup.textContent,/CAB 2/);
        assert.match(popup.textContent,/CAB 7/);
        assert.match(popup.textContent,/Sólo lectura/);
        assert.equal(click.prevented,true);assert.equal(click.immediate,true);
        assert.equal(h.calls.filter(x=>x[0]==='rpc'&&x[1]==='haiku_finanzas_grupo').length,1);
        assert.equal(h.calls.filter(x=>x[0]==='rpc'&&x[1]==='haiku_ficha_reserva_core').length,0);
    }
});

test('moving before the hold threshold cancels the popup without stealing the later short click',async()=>{
    const h=harness();
    await h.fire('pointerdown');
    await h.fire('pointermove',{clientX:190,clientY:220});
    await new Promise(resolve=>setTimeout(resolve,550));
    await h.fire('pointerup');
    const click=await h.fire('click');
    await new Promise(resolve=>setTimeout(resolve,120));
    assert.equal(click.prevented,true);
    assert.equal(h.calls.filter(x=>x[0]==='rpc'&&x[1]==='haiku_finanzas_grupo').length,0);
    assert.equal(h.calls.filter(x=>x[0]==='rpc'&&x[1]==='haiku_ficha_reserva_core').length,1);
});
