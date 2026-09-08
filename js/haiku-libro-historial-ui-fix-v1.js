// HAKU · diseño persistente para tarjetas del Libro restauradas desde historial
// El historial elimina <style> por seguridad; estas reglas se cargan siempre
// desde panel.html para que las respuestas antiguas no vuelvan a verse crudas.
(function (root) {
    "use strict";
    if (!root.document || root.HAIKU_LIBRO_HISTORIAL_UI_FIX_V1) return;

    const style = document.createElement("style");
    style.id = "haiku-libro-historial-ui-fix-v1";
    style.textContent = `
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
      @media(max-width:720px){
        .haku-libro-servicios__stats{grid-template-columns:repeat(2,minmax(0,1fr))}
        .haiku-asistente-preview.haku-libro-servicios{padding:11px}
        .haku-libro-servicios__title{font-size:16px}
      }
    `;
    document.head.appendChild(style);

    root.HAIKU_LIBRO_HISTORIAL_UI_FIX_V1 = Object.freeze({ version: "1.0.0" });
})(typeof window !== "undefined" ? window : globalThis);
