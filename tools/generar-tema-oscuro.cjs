/* Genera sólo colores, sin ejecutar la aplicación ni acceder a servicios.
 * NODE_PATH=<ruta a playwright> node tools/generar-tema-oscuro.cjs
 * CHROMIUM_PATH permite usar un Chromium local; por defecto usa Playwright.
 * La aplicación sirve el CSS resultante: no analiza ni transforma el DOM.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

async function main() {
    let html;
    // Reutilizar el orden real del panel; sus scripts no se ejecutan.
    const document = { createElement: () => ({}), head: { appendChild: s => s.onload() },
        open() {}, write: value => { html = value; }, close() {} };
    await vm.runInNewContext(read('panel.html').match(/<script>([\s\S]*)<\/script>/)[1], {
        document, window: { supabase: { createClient() {} } },
        fetch: async () => ({ ok: true, text: async () => read('index.html') }), Date, console
    });
    const files = [...html.matchAll(/href="(css\/[^"?]+\.css)/g)].map(m => m[1])
        .filter(file => !file.includes('/haiku-tema'));
    const sources = [];
    // Estilos locales de tarjetas que Haku monta después de abrirse.
    for (const file of fs.readdirSync(path.join(root, 'js')).sort()) {
        const source = read('js/' + file);
        for (const match of source.matchAll(/(?:style|estilo|estilos)\.textContent\s*=\s*(`[^`]*`|'[^'\n]*'|"[^"\n]*")/g)) {
            const css = match[1].slice(1, -1);
            if (!css.includes('${') && css.includes('{')) sources.push({ file: 'js/' + file, css });
        }
    }
    for (const file of files) sources.push({ file, css: read(file) });
    const browser = await chromium.launch({ headless: true,
        ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
    try {
        const page = await browser.newPage();
        const result = await page.evaluate(sources => {
            const prefix = 'html[data-haiku-tema="oscuro"]';
            const exclude = ':not(:where(.sidebar, .sidebar *, #libro-reserva-visor table, #libro-reserva-visor table *))';
            const probe = document.createElement('span'); document.body.append(probe);
            const variables = {};
            const sheets = sources.map(source => {
                const sheet = new CSSStyleSheet(); sheet.replaceSync(source.css);
                return { ...source, sheet };
            });
            function collect(rules) {
                for (const rule of rules) {
                    if (rule.style) for (const p of rule.style) if (p.startsWith('--') && !p.startsWith('--haiku-reserva-')) {
                        const v = rule.style.getPropertyValue(p).trim();
                        if (CSS.supports('color', v) && !v.includes('var(')) variables[p] = v;
                    }
                    if (rule.cssRules) collect(rule.cssRules);
                }
            }
            sheets.forEach(s => collect(s.sheet.cssRules));
            function rgba(value) {
                if (!CSS.supports('color', value) || /currentcolor|inherit|initial|unset|var\(/i.test(value)) return null;
                probe.style.color = value;
                const result = getComputedStyle(probe).color.match(/[\d.]+/g);
                return result ? result.map(Number) : null;
            }
            function color(value, property) {
                const a = rgba(value); if (!a || a[3] === 0) return value;
                const [r, g, b] = a, max = Math.max(r,g,b), min = Math.min(r,g,b);
                const red = r > g + 20 && Math.abs(g-b) < 24;
                const warm = r > g + 20;
                const blue = b > g + 5 && b > r;
                const saturated = max-min > 30;
                let out = value;
                if (/border|outline/.test(property)) out = saturated && max < 190
                    ? (red ? '#f3b2a8' : warm ? '#f2c58d' : blue ? '#a6ccee' : '#9fd2b3') : '#3e5145';
                else if (/background/.test(property)) {
                    if (min > 160) out = max-min > 20
                        ? (red ? '#3c2928' : r > g+5 ? '#34271b' : b > r+4 ? '#1d2d39' : '#1e3025')
                        : min < 245 ? '#1f2b24' : '#1b2420';
                } else if (/shadow/.test(property)) { return value; }
                else if (max < 220) out = saturated
                    ? (red ? '#f3b2a8' : warm ? '#f2c58d' : blue ? '#a6ccee' : '#9fd2b3')
                    : max > 105 ? '#b1c2b7' : '#e8efea';
                if (out !== value && a.length > 3 && a[3] < 1) {
                    const h = out.slice(1); return `rgba(${parseInt(h.slice(0,2),16)}, ${parseInt(h.slice(2,4),16)}, ${parseInt(h.slice(4,6),16)}, ${a[3]})`;
                }
                return out;
            }
            function value(v, property) {
                v = resolve(v);
                return v.replace(/#[\da-f]{3,8}\b|rgba?\([^)]*\)|\b(?:white|black)\b/gi, c => color(c, property));
            }
            function resolve(v) {
                return v.replace(/var\((--[\w-]+)(?:,\s*([^()]+))?\)/g,
                    (all, name) => name.startsWith('--haiku-reserva-') ? all : variables[name] || all);
            }
            function selector(s) {
                // CSSOM normaliza ::before/::after; no dividir las comas de :is/:has.
                const list = []; let depth = 0, start = 0;
                for (let i=0;i<s.length;i++) { if ('(['.includes(s[i])) depth++; if (')]'.includes(s[i])) depth--; if (s[i] === ',' && depth === 0) { list.push(s.slice(start,i).trim()); start=i+1; } }
                list.push(s.slice(start).trim());
                return list.map(part => {
                    const pseudo = part.match(/::[\w-]+(?:\([^)]*\))?$/)?.[0] || '';
                    const subject = pseudo ? part.slice(0,-pseudo.length) : part;
                    if (subject === ':root' || subject === 'html') return prefix + exclude + pseudo;
                    // Los IDs de otras secciones no pueden contener el sidebar ni el XLSX.
                    // Mantener la exclusión conservadora para todos los selectores compartidos.
                    const isolated = /^#seccion-(?!libro-reserva\b)[\w-]+(?:\s|[.:#[]|$)/.test(subject);
                    return prefix + ' ' + subject + (isolated ? '' : exclude) + pseudo;
                }).join(', ');
            }
            // Longhands exclusivamente: ninguna regla puede cambiar tamaño, posición u ocultar contenido.
            const properties = ['color','background-color','background-image','border-top-color','border-right-color',
                'border-bottom-color','border-left-color','outline-color','box-shadow','text-shadow','accent-color','fill','stroke','scrollbar-color'];
            function walk(rules) {
                let output = '';
                for (const rule of rules) {
                    if (rule.selectorText && rule.style) {
                        // CSSOM no expande un shorthand mientras contiene var(). Resolver sólo
                        // las variables de color conocidas, antes de extraer sus longhands.
                        const style = document.createElement('span').style;
                        style.cssText = resolve(rule.style.cssText);
                        const declarations = [];
                        for (const p of properties) {
                            let v = style.getPropertyValue(p);
                            if (!v && p === 'background-color' && CSS.supports('color', style.background)) v = style.background;
                            if (!v) continue;
                            declarations.push(`${p}:${value(v,p)}${style.getPropertyPriority(p) || style.getPropertyPriority(p === 'background-color' ? 'background' : p) ? '!important' : ''}`);
                        }
                        const borders = declarations.filter(d => /^border-(top|right|bottom|left)-color:/.test(d));
                        if (borders.length === 4 && new Set(borders.map(d => d.slice(d.indexOf(':')))).size === 1) {
                            for (const d of borders) declarations.splice(declarations.indexOf(d), 1);
                            declarations.push('border-color' + borders[0].slice(borders[0].indexOf(':')));
                        }
                        if (declarations.length) output += `${selector(rule.selectorText)}{${declarations.join(';')}}\n`;
                    } else if (rule.cssRules && /^@(?:media|supports|container)\b/.test(rule.cssText)) {
                        const nested = walk(rule.cssRules); if (nested) output += rule.cssText.slice(0,rule.cssText.indexOf('{')) + '{\n' + nested + '}\n';
                    }
                }
                return output;
            }
            return sheets.map(s => `/* ${s.file} */\n${walk(s.sheet.cssRules)}`).join('\n');
        }, sources);
        fs.writeFileSync(path.join(root, 'css/haiku-tema-oscuro-v1.css'),
            '/* Generado por tools/generar-tema-oscuro.cjs. Sólo colores; editar la paleta allí.\n' +
            ' * Complementos deliberados y selector: haiku-tema-v1.css. No modificar a mano. */\n@media screen {\n' + result + '}\n');
        console.log(`Tema generado: ${sources.length} fuentes; ${Buffer.byteLength(result)} bytes.`);
    } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
