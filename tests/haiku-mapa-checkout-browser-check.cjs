const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { chromium } = require('playwright');

const read = name => readFileSync(join(__dirname, '..', name), 'utf8');
const markup = read('assets/mapa/recinto.html');
const rules = read('js/haiku-reserva-estado-manual-v1.js');
const date = '2026-11-27';
const checkin = '2026-11-27T21:53:00Z';
const occupancy = {huespedes:2, noches:1, hospedada:false, por_llegar:false, checked_out:true};
const snapshot = {
    fecha:date, permisos:{}, elementos:[], personas:[],
    cabanas:[
        {numero:3, nombre:'Loft Clásico 3', estado_operativo:'libre-ingresa', ingreso_estadia_id:'early',
            ingreso_reserva_id:'group', ingreso_titular:'Titular de prueba', ingreso_checkin_en:checkin, aseo_estado:'pendiente'},
        {numero:4, estado_operativo:'continua', continua_estadia_id:'in-house', continua_reserva_id:'group'},
        {numero:5, estado_operativo:'sale-libre', salida_estadia_id:'planned', salida_reserva_id:'previous'},
        {numero:6, estado_operativo:'sale-libre', salida_estadia_id:'only-out', salida_reserva_id:'only-out-r'},
        {numero:9, estado_operativo:'sale-libre', salida_estadia_id:'completed', salida_reserva_id:'previous',
            salida_checkout_en:'2026-11-27T18:00:00Z'},
        {numero:10, estado_operativo:'libre-ingresa', ingreso_estadia_id:'turn-out', ingreso_reserva_id:'turn-out-r',
            ingreso_titular:'Huésped alojado', ingreso_checkin_en:checkin},
        {numero:11, estado_operativo:'sale-ingresa', ingreso_estadia_id:'next', ingreso_reserva_id:'next',
            salida_estadia_id:'early-previous', salida_reserva_id:'previous', salida_titular:'Salida de prueba'},
    ],
    ocupacion_estadias:{
        early:occupancy, 'in-house':{checked_out:false,hospedada:true}, planned:{checked_out:false},
        'only-out':{checked_out:false,hospedada:true},
        'turn-out':{huespedes:2,noches:1,checked_out:false,hospedada:true},
        'turn-in':{huespedes:3,noches:2,checked_out:false,por_llegar:true},
        next:{checked_out:false,por_llegar:true}, 'early-previous':occupancy,
    },
};

function fixture({ theme, snapshot, checkin }) {
    window.checkoutFixture = snapshot;
    window.checkoutWrites = [];
    window.ReactNativeWebView = {postMessage(raw) {
        const {channel,type,id,method,args} = JSON.parse(raw);
        if (type === 'ready') return window.HaikuMap.receive({channel,type:'init',theme});
        if (type !== 'request') return;
        let data;
        if (method === 'snapshot') data = window.checkoutFixture;
        else if (method === 'reservationState') {
            const row = window.checkoutFixture.cabanas.find(row => row.numero === args.p_numero);
            const fichas = args.p_estadias.map(stay => {
                const flag = ['ingreso','salida','continua','fullday'].find(flag => row[flag + '_estadia_id'] === stay);
                const occupancy = window.checkoutFixture.ocupacion_estadias[stay];
                const current = occupancy.checked_out ? 'checked_out' : occupancy.por_llegar ? 'confirmada' : 'hospedada';
                return {estadia_id:stay,reserva:{id:row[flag + '_reserva_id'],estado_reserva:current,
                    titular_nombre:row[flag + '_titular'] || 'Titular de prueba'},estadias:[{
                    id:stay,cabana_numero:args.p_numero,estado_estadia:current,tipo_estadia:'alojamiento',
                    fecha_ingreso:stay === 'turn-out' ? '2026-11-27' : window.checkoutFixture.fecha,
                    fecha_salida:stay === 'turn-out' ? '2026-11-28' : '2026-11-29',
                    checkin_realizado_en:occupancy.por_llegar ? null : checkin,checkout_realizado_en:null,
                }]};
            });
            data = {fichas,puede_editar:args.p_numero === 10,puede_cancelar:false};
        } else if (method === 'reservationChange') {
            window.checkoutWrites.push([args.p_reserva_id,args.p_estadia_id,args.p_estado]);
            Object.assign(window.checkoutFixture.ocupacion_estadias[args.p_estadia_id],{checked_out:true,hospedada:false});
            data = {ok:true,estado:args.p_estado};
        } else throw new Error('Consulta inesperada: ' + method);
        window.HaikuMap.receive({channel,type:'reply',id,data:structuredClone(data)});
    }};
}

async function check(browser, theme, mobile) {
    const context = await browser.newContext({
        viewport:mobile ? {width:390,height:840} : {width:1280,height:800},
        isMobile:mobile, hasTouch:mobile,
    });
    try {
        const page = await context.newPage();
        page.setDefaultTimeout(5000);
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript({content:rules});
        await page.addInitScript(fixture,{theme,snapshot,checkin});
        await page.route('https://haku-checkout.test/', route => route.fulfill({contentType:'text/html',body:markup}));
        await page.goto('https://haku-checkout.test/');
        await page.locator('html[data-theme="' + theme + '"]').waitFor({state:'attached'});
        await page.locator('#viewport[data-scale]').waitFor();
        const cabin = n => page.locator('#regions [data-ref="c' + n + '"]');
        const color = n => cabin(n).locator('.footprint').getAttribute('fill');
        assert.equal(await color(3),'var(--checkout)','CAB 3 salió antes de su fecha prevista.');
        assert.equal(await cabin(3).getAttribute('aria-label'),'CAB 3 · Check-out');
        assert.equal(await cabin(3).locator('[fill="url(#cabin-light)"]').count(),0);
        assert.equal(await cabin(3).locator('[fill="var(--waiting)"]').count(),2);
        assert.equal(await color(4),'var(--continuing)','Otra estadía de la misma reserva sigue hospedada.');
        assert.equal(await color(5),'var(--departure)','Una salida prevista conserva su color.');
        assert.equal(await color(9),'var(--checkout)','La hora de salida sigue siendo válida para datos anteriores.');
        assert.equal(await color(11),'var(--arrival)','El próximo ingreso tiene prioridad sobre la salida anterior.');

        const openCabin = async n => {
            await page.evaluate(n => center(geometry.cabins['c' + n].center,1.35), n);
            const target = cabin(n).locator('.footprint');
            await (mobile ? target.tap() : target.click());
        };
        await openCabin(3);
        const summary = page.locator('.cabin-summary');
        await summary.getByText('Check-out',{exact:true}).waitFor();
        await page.locator('.reservation-tag[data-state="checked_out"]').waitFor();
        await page.evaluate(() => {
            Object.assign(window.checkoutFixture.ocupacion_estadias.early,{checked_out:false,hospedada:true});
        });
        await page.getByRole('button',{name:'Actualizar mapa'}).click();
        await summary.getByText('Check-in',{exact:true}).waitFor();
        await page.locator('.reservation-tag[data-state="hospedada"]').waitFor();
        assert.equal(await color(3),'var(--continuing)');
        assert.equal(await cabin(3).locator('[fill="url(#cabin-light)"]').count(),1);
        await page.locator('#close').click();
        await openCabin(11);
        await summary.getByText('Check-out · Salida de prueba',{exact:true}).waitFor({state:'attached'});

        await page.locator('#close').click();
        await openCabin(10);
        await summary.getByText('Huésped alojado',{exact:true}).waitFor();
        assert.equal(await color(10),'var(--continuing)');
        await page.evaluate(() => {
            const snapshot = window.checkoutFixture;
            snapshot.fecha = '2026-11-28';
            const index = snapshot.cabanas.findIndex(row => row.numero === 10);
            snapshot.cabanas[index] = {numero:10, estado_operativo:'sale-ingresa',
                salida_estadia_id:'turn-out', salida_reserva_id:'turn-out-r', salida_titular:'Huésped alojado',
                ingreso_estadia_id:'turn-in', ingreso_reserva_id:'turn-in-r', ingreso_titular:'Próximo ingreso'};
        });
        await page.getByRole('button',{name:'Actualizar mapa'}).click();
        await page.locator('#day[datetime="2026-11-28"]').waitFor();
        assert.equal(await color(10),'var(--continuing)','El cambio de fecha conserva el color del huésped alojado.');
        assert.equal(await color(6),'var(--continuing)','Una salida sin recambio sigue hospedada hasta el Check-out.');
        assert.equal(await cabin(10).locator('[fill="url(#cabin-light)"]').count(),1);
        assert.match(await page.evaluate(() => tooltipFor('c10')),/^Huésped alojado · 2 huéspedes/);

        await summary.getByText('Hospedado',{exact:true}).waitFor();
        await summary.getByText('Huésped alojado',{exact:true}).waitFor();
        assert.equal(await summary.getByText('Próximo ingreso',{exact:true}).count(),0);
        const departure = page.locator('.reservation-picker[data-stay="turn-out"]');
        const arrival = page.locator('.reservation-picker[data-stay="turn-in"]');
        await departure.getByText('Salida · Huésped alojado',{exact:true}).waitFor();
        await arrival.getByText('Ingreso · Próximo ingreso',{exact:true}).waitFor();
        await arrival.getByText('Confirmada',{exact:true}).waitFor();
        await departure.locator('summary').click();
        await departure.getByRole('button',{name:'Check-out',exact:true}).click();
        await summary.getByText('Próximo ingreso',{exact:true}).waitFor();
        await departure.getByText('Check-out',{exact:true}).waitFor();
        assert.equal(await color(10),'var(--arrival)');
        assert.equal(await cabin(10).locator('[fill="url(#cabin-light)"]').count(),0);
        assert.deepEqual(await page.evaluate(() => window.checkoutWrites),[['turn-out-r','turn-out','checked_out']]);
        assert.deepEqual(errors,[]);
        console.log('Check-out en el mapa verificado',theme,mobile ? 'móvil' : 'escritorio');
    } finally {
        await context.close();
    }
}

(async () => {
    const browser = await chromium.launch({executablePath:process.env.HAKU_BROWSER_PATH});
    try {
        for (const theme of ['light','dark']) {
            for (const mobile of [false,true]) await check(browser,theme,mobile);
        }
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
