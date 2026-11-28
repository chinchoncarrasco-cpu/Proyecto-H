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
    fecha:'2026-11-28', permisos:{}, elementos:[], personas:[],
    cabanas:[
        {numero:3, nombre:'Loft Clásico 3', estado_operativo:'continua', continua_estadia_id:'stay',
            continua_reserva_id:'reservation', continua_titular:'Titular de prueba', aseo_estado:'pendiente'},
        {numero:11, nombre:'Loft', estado_operativo:'libre-libre'},
    ],
    ocupacion_estadias:{stay:{huespedes:2,noches:2,hospedada:true}},
    notas_resumen:{3:[first,second,third,fourth],11:[separate]},
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
        await badge(3).waitFor({state:'attached'});
        assert.equal(await badge(3).count(),1);
        assert.equal(await badge(11).count(),1);
        assert.equal(await badge(2).count(),0);
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
            await centerCabin(3);
            await cabin(3).locator('.footprint').hover();
            const tooltip = page.getByRole('tooltip');
            await tooltip.waitFor();
            const preview = await tooltip.textContent();
            assert(preview.includes('Titular de prueba'));
            assert(preview.includes(first) && preview.includes(second) && preview.includes('+ 2 más en la ficha'));
            assert(!preview.includes(third) && !preview.includes(separate));
        }
        await openCabin(3);
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
        });
        await page.getByRole('button',{name:'Actualizar mapa'}).click();
        await notes.getByText('Batas entregadas',{exact:true}).waitFor();
        assert.equal(await notes.getByText(third,{exact:true}).isVisible(),true);
        assert.equal(await notes.getByText(first,{exact:true}).count(),0);

        await page.locator('#close').click();
        await openCabin(11);
        assert.equal(await page.locator('#detail-title').textContent(),'CAB 11');
        await notes.getByText(separate,{exact:true}).waitFor();
        assert.equal(await notes.getByText(second,{exact:true}).count(),0);
        await page.evaluate(() => {
            window.mapNotesFixture.fecha = '2026-11-29';
            delete window.mapNotesFixture.notas_resumen;
        });
        await page.getByRole('button',{name:'Actualizar mapa'}).click();
        await notes.waitFor({state:'detached'});
        assert.equal(await page.locator('.cabin-note-badge').count(),0);
        assert.deepEqual(errors,[]);
        console.log('Notas del Resumen en el mapa verificadas',theme,mobile ? 'móvil' : 'escritorio');
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
