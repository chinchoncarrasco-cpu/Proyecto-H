const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { chromium } = require('playwright');

const read = name => readFileSync(join(__dirname, '..', name), 'utf8');
const markup = read('assets/mapa/recinto.html');
const rules = read('js/haiku-reserva-estado-manual-v1.js');
const first = 'Dejar batas en la cabaña';
const second = 'Entregar espumante a las 19:00';
const third = 'Cortesía a las 09:00';
const fourth = 'Agregar una tarjeta con el texto <b>Felicitaciones</b>';
const separate = 'Revisar canasta de CAB 11';
const snapshot = {
    fecha:'2026-11-28', permisos:{agenda:true}, elementos:[], personas:[],
    cabanas:[
        {numero:3, nombre:'Loft Clásico 3', estado_operativo:'continua', continua_estadia_id:'stay',
            continua_reserva_id:'reservation', continua_titular:'Titular de prueba', aseo_estado:'pendiente'},
        {numero:11, nombre:'Loft', estado_operativo:'libre-libre'},
    ],
    ocupacion_estadias:{stay:{huespedes:2,noches:2,hospedada:true}},
    notas_resumen:{3:[first,second,third,fourth],5:['Preparar cortesía'],11:[separate]},
    agenda:[
        {numero:3, codigo:'tinajaTonel', nombre:'Tinaja Tonel', hora:'10:00:00', estado:'programado'},
        {numero:3, codigo:'lateCheckout', nombre:'Late Check-out', hora:'13:30:00', estado:'programado'},
        {numero:3, codigo:'masajeRelajante', nombre:'Masaje relajante', hora:'18:00:00', estado:'programado'},
        {numero:9, codigo:'tinajaJacuzzi', nombre:'Tinaja Jacuzzi', hora:'19:15:00', estado:'programado'},
        {numero:2, nombre:'Masaje realizado', hora:'09:00:00', estado:'realizado'},
        {numero:2, nombre:'Sin hora', hora:null, estado:'programado'},
        {numero:2, nombre:'Masaje cancelado', hora:'20:00:00', estado:'cancelado'},
    ],
};

function fixture({ theme, snapshot }) {
    window.mapNotesFixture = snapshot;
    window.ReactNativeWebView = {postMessage(raw) {
        const {channel,type,id,method} = JSON.parse(raw);
        if (type === 'ready') return window.HaikuMap.receive({channel,type:'init',theme});
        if (type !== 'request') return;
        const data = method === 'snapshot' ? window.mapNotesFixture : {fichas:[]};
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
        await page.addInitScript(fixture,{theme,snapshot});
        await page.route('https://haku-map-notes.test/', route => route.fulfill({contentType:'text/html',body:markup}));
        await page.goto('https://haku-map-notes.test/');
        await page.locator('#viewport[data-scale]').waitFor();
        const cabin = n => page.locator('#regions [data-ref="c' + n + '"]');
        const badge = n => cabin(n).locator('.cabin-note-badge');
        const calendar = n => cabin(n).locator('.cabin-service-badge');
        await badge(3).waitFor({state:'attached'});
        assert.equal(await badge(3).count(),1);
        assert.equal(await badge(11).count(),1);
        assert.equal(await badge(2).count(),0);
        assert.equal(await calendar(3).count(),1);
        assert.equal(await calendar(9).count(),1);
        assert.equal(await calendar(2).count(),0);
        assert.equal(await calendar(11).count(),0);
        assert.match(await cabin(3).getAttribute('aria-label'),/3 servicios agendados/);
        assert.match(await cabin(9).getAttribute('aria-label'),/1 servicio agendado/);
        assert.equal(await page.getByRole('navigation',{name:'Navegación del plano'})
            .getByRole('button',{name:'CAB 11',exact:true}).count(),0);
        assert(!((await page.locator('#regions').textContent()).includes(first)));

        const centerCabin = n => page.evaluate(n => center(geometry.cabins['c' + n].center,1.35), n);
        const openCabin = async n => {
            await centerCabin(n);
            const target = cabin(n).locator('.footprint');
            await (mobile ? target.tap() : target.click());
        };
        if (!mobile) {
            await centerCabin(5);
            assert.equal(await badge(5).evaluate(node => {
                const {e:x,f:y} = node.getScreenCTM();
                return document.elementFromPoint(x,y)?.closest('[data-ref]')?.dataset.ref;
            }), 'c5');
            await centerCabin(3);
            await cabin(3).locator('.footprint').hover();
            const tooltip = page.getByRole('tooltip');
            await tooltip.waitFor();
            const preview = await tooltip.textContent();
            assert(preview.includes('Titular de prueba'));
            assert(preview.includes('10:00 · Tinaja Tonel'));
            assert(preview.includes('13:30 · Late Check-out'));
            assert(preview.includes('+ 1 servicio más en la ficha'));
            assert(!preview.includes('18:00 · Masaje relajante'));
            assert(!preview.includes('Tinaja Jacuzzi'));
            assert(preview.includes(first) && preview.includes(second) && preview.includes('+ 2 más en la ficha'));
            assert(!preview.includes(third) && !preview.includes(separate));
        }
        await openCabin(3);
        const agenda = page.locator('.cabin-summary-agenda');
        assert.deepEqual(await agenda.locator('li').allTextContents(),[
            '10:00 · Tinaja Tonel', '13:30 · Late Check-out', '18:00 · Masaje relajante',
        ]);
        const notes = page.locator('.cabin-summary-notes');
        await notes.getByText(first,{exact:true}).waitFor();
        await notes.getByText(second,{exact:true}).waitFor();
        assert.equal(await notes.getByText(third,{exact:true}).isVisible(),false);
        await notes.getByText('Ver 2 notas más',{exact:true}).click();
        await notes.getByText(fourth,{exact:true}).waitFor();
        assert.equal(await notes.locator('b').count(),0);
        assert.equal(await notes.locator('li').count(),4);

        await page.evaluate(() => {
            window.mapNotesFixture.notas_resumen[3][0] = 'Batas entregadas';
            window.mapNotesFixture.agenda[0].hora = '10:30:00';
        });
        await page.getByRole('button',{name:'Actualizar mapa'}).click();
        await notes.getByText('Batas entregadas',{exact:true}).waitFor();
        assert.equal(await notes.getByText(third,{exact:true}).isVisible(),true);
        assert.equal(await notes.getByText(first,{exact:true}).count(),0);
        await agenda.getByText('10:30 · Tinaja Tonel',{exact:true}).waitFor();

        await page.locator('#close').click();
        await openCabin(11);
        assert.equal(await page.locator('#detail-title').textContent(),'CAB 11');
        await notes.getByText(separate,{exact:true}).waitFor();
        assert.equal(await notes.getByText(second,{exact:true}).count(),0);
        assert.equal(await agenda.count(),0);
        await page.evaluate(() => {
            window.mapNotesFixture.fecha = '2026-11-29';
            delete window.mapNotesFixture.notas_resumen;
            window.mapNotesFixture.agenda = [];
        });
        await page.getByRole('button',{name:'Actualizar mapa'}).click();
        await notes.waitFor({state:'detached'});
        assert.equal(await page.locator('.cabin-note-badge').count(),0);
        assert.equal(await page.locator('.cabin-service-badge').count(),0);
        assert.deepEqual(errors,[]);
        console.log('Agenda y notas del Resumen en el mapa verificadas',theme,mobile ? 'móvil' : 'escritorio');
    } finally {
        await context.close();
    }
}

(async () => {
    const browser = await chromium.launch({executablePath:process.env.HAKU_BROWSER_PATH});
    try {
        for (const theme of ['light','dark']) for (const mobile of [false,true]) await check(browser,theme,mobile);
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
