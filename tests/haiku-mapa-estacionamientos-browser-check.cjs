const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { chromium } = require('playwright');

const markup = readFileSync(join(__dirname, '../assets/mapa/recinto.html'), 'utf8');
const continuing = (number, reserve = 'r' + number) => ({
    numero:number, estado_operativo:'continua', continua_estadia_id:'e' + number, continua_reserva_id:reserve,
});
const arriving = number => ({
    numero:number, estado_operativo:'libre-ingresa', ingreso_estadia_id:'e' + number, ingreso_reserva_id:'r' + number,
});
const vehicle = (number, reserve, plate) => ({
    id:'v' + number, revision:1, tipo:'vehiculo', puesto:number, reserva_id:reserve,
    datos:{vehiculo:'Sedán', patente:plate, color:'Cereza', estacionado:true},
});
const snapshot = {
    fecha:'2026-11-27', permisos:{vehiculo:true}, personas:[], agenda:[],
    cabanas:[
        continuing(1), continuing(2), arriving(3), {numero:4,estado_operativo:'libre-libre'},
        continuing(7,'grupo'), continuing(8,'grupo'), { ...arriving(9), ingreso_reserva_id:'grupo' },
        {...arriving(11), estado_operativo:'sale-ingresa', salida_estadia_id:'saliente', salida_reserva_id:'rsaliente'},
    ],
    ocupacion_estadias:{
        e1:{hospedada:true}, e2:{hospedada:true}, e3:{por_llegar:true},
        e7:{hospedada:true}, e8:{hospedada:true}, e9:{por_llegar:true},
        e11:{por_llegar:true}, saliente:{hospedada:true},
    },
    elementos:[vehicle(2,'r2','TEST02'),vehicle(12,'grupo','TEST72'),vehicle(9,'grupo','TEST09'),vehicle(15,'rsaliente','TEST15')],
};

async function check(browser, theme, phone) {
    const context = await browser.newContext({
        viewport:phone ? {width:360,height:800} : {width:1280,height:800},
        isMobile:phone,
        hasTouch:phone,
    });
    try {
        const page = await context.newPage();
        page.setDefaultTimeout(5000);
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(({ theme, snapshot }) => {
            window.parkingFixture = snapshot;
            window.ReactNativeWebView = {
                postMessage(raw) {
                    const message = JSON.parse(raw);
                    if (message.type === 'ready') {
                        window.HaikuMap.receive({channel:message.channel,type:'init',theme});
                        return;
                    }
                    if (message.type !== 'request') return;
                    let data = window.parkingFixture;
                    if (message.method === 'save') {
                        const { p_accion:action, p_id:id, p_revision:revision } = message.args;
                        const entries = data.elementos;
                        const index = entries.findIndex(entry => entry.id === id);
                        const car = entries[index];
                        if (!car || car.revision !== revision) throw new Error('La revisión del auto difiere.');
                        if (action === 'retirar') entries.splice(index,1);
                        else if (action === 'entrada' || action === 'salida') {
                            car.datos.estacionado = action === 'entrada';
                            car.revision++;
                        } else throw new Error('Acción inesperada: ' + action);
                        data = {id};
                    } else if (message.method !== 'snapshot') {
                        throw new Error('Consulta inesperada: ' + message.method);
                    }
                    window.HaikuMap.receive({channel:message.channel,type:'reply',id:message.id,data:structuredClone(data)});
                },
            };
        }, {theme,snapshot});
        await page.route('https://haku-mapa.test/', route => route.fulfill({status:200,contentType:'text/html',body:markup}));
        await page.goto('https://haku-mapa.test/');
        const bay = n => page.locator(`#regions [data-ref="p${n}"]`);
        const bayWith = (n, attribute) => page.locator(`#regions [data-ref="p${n}"][${attribute}]`);
        const reserved = n => bayWith(n,'data-parking-reserved');
        const green = n => bayWith(n,'data-parking-hosted');
        const details = page.locator('#details');
        const click = locator => phone ? locator.tap() : locator.click();
        const refresh = () => page.evaluate(() => window.HaikuMap.receive({channel:'haiku:mapa:v1',type:'refresh'}));
        const styles = async n => ({
            border:await bay(n).locator('.hit').evaluate(node => getComputedStyle(node).stroke),
            opacity:await bay(n).locator('.hit').evaluate(node => Number(getComputedStyle(node).strokeOpacity)),
            icon:await bay(n).locator('.parking-car').evaluate(node => Number(getComputedStyle(node).opacity)),
        });
        await reserved(1).waitFor();
        await reserved(3).waitFor();
        await green(2).waitFor();
        await green(12).waitFor();
        await reserved(8).waitFor();
        await green(15).waitFor();
        await reserved(11).waitFor();
        for (const number of [4,7,9,13,16]) assert.equal(await reserved(number).count(),0);
        assert.equal(await green(9).count(),0);
        const border = theme === 'dark' ? 'rgb(142, 210, 166)' : 'rgb(49, 128, 81)';
        assert.deepEqual(await styles(2),{border,opacity:1,icon:1});

        await page.evaluate(() => center(geometry.parking.p2.center,1.3));
        await click(bay(2).locator('.hit'));
        const change = async label => {
            await click(details.getByRole('button',{name:label,exact:true}));
            await click(details.getByRole('button',{name:'Confirmar',exact:true}));
        };
        await change('Marcar salida');
        await bayWith(2,'data-vehicle-away').waitFor();
        await details.getByText('Fuera del recinto',{exact:true}).waitFor();
        assert.deepEqual(await styles(2),{border,opacity:.42,icon:.42});
        assert.equal(await reserved(2).count(),0);
        await change('Marcar entrada');
        await bayWith(2,'data-vehicle-away').waitFor({state:'detached'});
        await details.getByText('Estacionado',{exact:true}).waitFor();
        assert.deepEqual(await styles(2),{border,opacity:1,icon:1});
        await change('Quitar');
        await reserved(2).waitFor();
        assert.equal(await green(2).count(),0);
        assert.equal(await bay(2).locator('.parking-car').count(),0);

        await page.evaluate(() => {
            const car = window.parkingFixture.elementos.find(entry => entry.puesto === 15);
            car.reserva_id = 'r1';
            window.parkingFixture.ocupacion_estadias.e3 = {hospedada:true,por_llegar:false};
        });
        await refresh();
        await reserved(1).waitFor({state:'detached'});
        await green(15).waitFor();
        await reserved(3).waitFor();
        await page.evaluate(() => {
            const car = window.parkingFixture.elementos.find(entry => entry.puesto === 15);
            car.puesto = 3;
            car.reserva_id = null;
        });
        await refresh();
        await green(3).waitFor();
        await reserved(1).waitFor();
        assert.equal(await green(15).count(),0);
        assert.deepEqual(errors,[]);
        console.log('Estacionamientos verificados',theme,phone ? 'móvil' : 'escritorio');
    } finally {
        await context.close();
    }
}

(async () => {
    const browser = await chromium.launch({executablePath:process.env.HAKU_BROWSER_PATH});
    try {
        for (const theme of ['light','dark']) {
            await check(browser,theme,false);
            await check(browser,theme,true);
        }
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
