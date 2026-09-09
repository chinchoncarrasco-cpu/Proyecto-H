// HAKU · diseño persistente para tarjetas restauradas desde historial
// El historial elimina <style> por seguridad; estas reglas se cargan siempre
// para que las respuestas antiguas no vuelvan a verse crudas al recargar.
(function (root) {
    "use strict";
    if (!root.document || root.HAIKU_LIBRO_HISTORIAL_UI_FIX_V1) return;

    const style = document.createElement("style");
    style.id = "haiku-libro-historial-ui-fix-v1";
    style.textContent = `
      /* ==========================================================
         LIBRO · SERVICIOS / NOTAS
         ========================================================== */
      .haiku-asistente-preview.haku-libro-servicios{
        border:1px solid #bdd9c8;border-radius:16px;background:#fbfdfb;
        padding:14px;display:flex;flex-direction:column;gap:10px;min-width:0;
        font-size:12px;line-height:1.35;color:#26372c;box-sizing:border-box
      }
      .haku-libro-servicios__head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;padding-bottom:9px;border-bottom:1px solid #dfe9e2}
      .haku-libro-servicios__kicker{font-size:10px;font-weight:900;letter-spacing:.11em;text-transform:uppercase;color:#26704c}
      .haku-libro-servicios__title{font-size:18px;font-weight:850;color:#17261d;margin-top:2px}
      .haku-libro-servicios__chip{font-size:10px;font-weight:800;padding:5px 9px;border-radius:999px;background:#edf7f0;color:#326b4c;white-space:nowrap}
      .haku-libro-servicios__stats{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px}
      .haku-libro-servicios__stat{border:1px solid #e0e9e3;border-radius:10px;background:#fff;padding:7px 8px;min-width:0}
      .haku-libro-servicios__stat span{display:block;font-size:8px;text-transform:uppercase;letter-spacing:.08em;color:#778279}
      .haku-libro-servicios__stat strong{display:block;font-size:15px;margin-top:2px;color:#25352b}
      .haku-libro-servicios details{border:1px solid #dfe8e2;border-radius:11px;background:#fff;overflow:hidden}
      .haku-libro-servicios summary{cursor:pointer;display:flex;justify-content:space-between;gap:8px;padding:9px 10px;font-size:11px;font-weight:850;color:#32483a;list-style:none}
      .haku-libro-servicios summary::-webkit-details-marker{display:none}
      .haku-libro-servicios__lista{display:flex;flex-direction:column;gap:6px;padding:0 8px 8px;max-height:250px;overflow:auto}
      .haku-libro-servicios__item{border:1px solid #e3eae5;border-radius:10px;padding:8px;display:grid;grid-template-columns:auto minmax(0,1fr);gap:7px;background:#fcfdfc}
      .haku-libro-servicios__item--revisar{border-color:#ead9b4;background:#fffaf0}
      .haku-libro-servicios__item--existente{opacity:.78}
      .haku-libro-servicios__item--nota{border-color:#cbded2;background:#f6fbf7}
      .haku-libro-servicios__nombre{font-size:11px;font-weight:850;color:#203127;white-space:normal;overflow-wrap:anywhere}
      .haku-libro-servicios__meta{font-size:9px;color:#6d796f;margin-top:2px;line-height:1.35}
      .haku-libro-servicios__texto{font-size:10px;color:#39473e;margin-top:5px;line-height:1.35}
      .haku-libro-servicios__razones{margin:5px 0 0;padding-left:16px;font-size:9px;color:#805e23;line-height:1.4}
      .haku-libro-servicios__inferencias{margin:5px 0 0;padding-left:16px;font-size:9px;color:#347052;line-height:1.4}
      .haku-libro-servicios__nota{font-size:9px;color:#657369;margin-top:4px}
      .haku-libro-servicios__acciones{display:flex;gap:7px;align-items:center}
      .haku-libro-servicios__boton{border:0;border-radius:9px;padding:9px 12px;background:#1f7650;color:#fff;font:inherit;font-size:10px;font-weight:850}
      .haku-libro-servicios__boton:disabled{opacity:.45}
      .haku-libro-servicios__pie{font-size:9px;color:#738078;padding-top:7px;border-top:1px solid #e2e9e4}
      [data-haiku-historial-restaurado="1"].haku-libro-servicios .haku-libro-servicios__acciones{display:none!important}
      [data-haiku-historial-restaurado="1"].haku-libro-servicios{opacity:.96}

      /* ==========================================================
         HAKU · TINAJAS POR COORDINAR
         Estas reglas son persistentes porque el historial elimina
         el <style> dinámico que crea la consulta al ejecutarse.
         ========================================================== */
      .haku-tinajas-card{
        --ac:#6d6230;--soft:#fff9e9;--bd:#e7dcae;
        border:1px solid var(--bd);border-radius:16px;
        background:linear-gradient(180deg,#fffef9,#fbfaf4);
        padding:14px;display:flex;flex-direction:column;gap:10px;
        box-shadow:0 5px 16px rgba(71,61,26,.055);
        box-sizing:border-box;min-width:0
      }
      .haku-tinajas-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding-bottom:9px;border-bottom:1px solid #ece6cf}
      .haku-tinajas-kicker{font-size:10px;font-weight:900;letter-spacing:.09em;text-transform:uppercase;color:var(--ac)}
      .haku-tinajas-title{margin:2px 0 0;font-size:18px;line-height:1.15;color:#25261d}
      .haku-tinajas-badge{flex:0 0 auto;padding:5px 9px;border:1px solid var(--bd);border-radius:999px;background:var(--soft);color:var(--ac);font-size:9px;font-weight:900}
      .haku-tinajas-rango{display:flex;gap:6px;flex-wrap:wrap}
      .haku-tinajas-chip{display:inline-flex;align-items:center;padding:5px 8px;border-radius:8px;background:var(--soft);color:var(--ac);font-size:10px;font-weight:850}
      .haku-tinajas-resumen{display:flex;align-items:center;gap:10px;padding:9px 11px;border:1px solid #ebe5d0;border-radius:12px;background:#fff;color:#444333;font-size:11px}
      .haku-tinajas-cantidad{display:grid;place-items:center;min-width:32px;height:32px;border-radius:9px;background:var(--ac);color:#fff;font-size:14px;font-weight:900}
      .haku-tinajas-lista{display:flex;flex-direction:column;gap:7px;max-height:330px;overflow:auto;padding-right:2px}
      .haku-tinajas-item{padding:9px 10px;border:1px solid #e7e3d5;border-radius:11px;background:#fff;display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:8px;align-items:start}
      .haku-tinajas-cab{padding:4px 7px;border-radius:8px;background:var(--soft);color:var(--ac);font-size:10px;font-weight:900;white-space:nowrap}
      .haku-tinajas-main{min-width:0}
      .haku-tinajas-main strong{display:block;color:#343329;font-size:11px;margin-bottom:3px}
      .haku-tinajas-main p{margin:0;color:#5f5e51;font-size:10px;line-height:1.4;overflow-wrap:anywhere}
      .haku-tinajas-meta{display:flex;gap:5px;flex-wrap:wrap;margin-top:5px}
      .haku-tinajas-meta span{font-size:8px;font-weight:850;padding:3px 6px;border-radius:999px;background:#f6f4eb;color:#706c57}
      .haku-tinajas-fecha{font-size:9px;font-weight:850;color:#766e49;white-space:nowrap;padding-top:3px}
      .haku-tinajas-vacio{padding:10px;border:1px dashed var(--bd);border-radius:10px;background:var(--soft);color:#68634d;font-size:11px}
      .haku-tinajas-pie{padding-top:7px;border-top:1px solid #ece6cf;color:#7b7869;font-size:9px;line-height:1.4}

      @media(max-width:720px){
        .haku-libro-servicios__stats{grid-template-columns:repeat(2,minmax(0,1fr))}
        .haiku-asistente-preview.haku-libro-servicios{padding:11px}
        .haku-libro-servicios__title{font-size:16px}
      }
      @media(max-width:620px){
        .haku-tinajas-card{padding:11px}
        .haku-tinajas-item{grid-template-columns:auto minmax(0,1fr)}
        .haku-tinajas-fecha{grid-column:2}
        .haku-tinajas-title{font-size:16px}
      }
    `;
    document.head.appendChild(style);

    // Carga el complemento que distingue visualmente en Historial las acciones
    // ejecutadas por Haku. Se hace desde este módulo, que ya está incluido en el
    // panel, para no duplicar scripts en panel.html.
    if (!root.HAIKU_HISTORIAL_AUTOR_V1 && !document.querySelector('script[data-haiku-historial-autor]')) {
        const script = document.createElement("script");
        script.src = "js/haiku-historial-autor-v1.js?v=1";
        script.async = false;
        script.dataset.haikuHistorialAutor = "1";
        document.head.appendChild(script);
    }

    root.HAIKU_LIBRO_HISTORIAL_UI_FIX_V1 = Object.freeze({ version: "1.2.0" });
})(typeof window !== "undefined" ? window : globalThis);
