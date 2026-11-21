# Huéspedes · corrección de fidelidad visual

La entrega anterior tenía las funciones de V1.1, pero no reproducía la distribución aprobada. Esta corrección implementa el directorio, la ficha, los formularios y las variantes de web y móvil a partir del Figma existente. No se modificó el diseño para adaptarlo al código.

Fuente: [HAKU · Huéspedes · Diseño V1.1](https://www.figma.com/design/JGnBc0FElO2BamoS6xfYk7?node-id=131-3139). Web `129:2220` / `129:3343`; directorio móvil `129:2510`; titular `129:2651`; acompañante `151:4022`; foto `151:3479` / `151:3542`; vehículo `151:3615` / `151:3676`; mascota `151:3751` / `151:3826`; borrador `151:4148`; etiquetas `129:2772`; registro `129:2940`.

## Resultado y límites

- Web usa un panel de 1.208 px a 1.440 px de pantalla: directorio de unos 734 px y ficha de 458 px. Filas de 88 px, tipografía Inter, colores y espacios de V1.1. Móvil tiene una columna de 366 px a 390 px de pantalla, filas compactas y filtros de estado en una sola línea desplazable.
- Foto y vestimenta comparten formulario. Vehículos y mascotas tienen foto, vínculo a huésped/estadía y campos en pares. Los acompañantes conservan sus preferencias independientes; los borradores pueden guardarse sin identificación completa.
- La navegación visual se aplica solo en Huéspedes. Los destinos existentes siguen disponibles. En web, Más despliega los botones originales; en Android se mantienen los cinco destinos principales y se evita duplicar la barra.
- `20261121003000_haku_huespedes_directorio_foto.sql` amplía respuestas existentes con foto, cantidad de registros y tipos de cabaña visitados. Mantiene permisos, RLS y funciones como invocador. **No se aplicó en producción.** Los campos nuevos son opcionales en los clientes.
- La foto de demostración pertenece exclusivamente a las pruebas. Ningún perfil, contador, vehículo, mascota o gusto del ejemplo se inserta en producción.

## Evidencia reproducible

[Capturas reales](evidencia/huespedes-figma/) del código web y de los componentes React Native ejecutados en Chromium, con datos ficticios equivalentes a Figma, ambos temas. No son capturas de un prototipo sustitutivo. `geometry.json` contiene las medidas observadas.

| Vista | Web oscuro | Móvil oscuro |
| --- | --- | --- |
| Titular | [Ver](evidencia/huespedes-figma/web-oscuro-perfil.png) | [Ver](evidencia/huespedes-figma/android-browser-oscuro-perfil.png) |
| Acompañante | [Ver](evidencia/huespedes-figma/web-oscuro-acompanante.png) | [Ver](evidencia/huespedes-figma/android-browser-oscuro-acompanante.png) |
| Foto y vestimenta | [Ver](evidencia/huespedes-figma/web-oscuro-foto.png) | [Ver](evidencia/huespedes-figma/android-browser-oscuro-foto.png) |
| Vehículo | [Ver](evidencia/huespedes-figma/web-oscuro-vehiculo.png) | [Ver](evidencia/huespedes-figma/android-browser-oscuro-vehiculo.png) |
| Mascota | [Ver](evidencia/huespedes-figma/web-oscuro-mascota.png) | [Ver](evidencia/huespedes-figma/android-browser-oscuro-mascota.png) |
| Borrador | [Ver](evidencia/huespedes-figma/web-oscuro-borrador.png) | [Ver](evidencia/huespedes-figma/android-browser-oscuro-borrador.png) |
| Etiquetas | [Ver](evidencia/huespedes-figma/web-oscuro-etiquetas.png) | [Ver](evidencia/huespedes-figma/android-browser-oscuro-etiquetas.png) |
| Información | [Ver](evidencia/huespedes-figma/web-oscuro-nota.png) | [Ver](evidencia/huespedes-figma/android-browser-oscuro-nota.png) |

Las variantes claras y el directorio móvil están en la misma carpeta. Referencias originales: `figma-web-oscuro.png`, `figma-mobile-oscuro.png`, `figma-directory-oscuro.png`.

Pruebas: `tests/huespedes-foto-directorio.test.cjs` (PGlite y regresiones SQL V1.1); `tests/huespedes-browser-check.cjs` (persistencia, fotos y lectura/escritura compartida); su modo `--correcciones` (guardado demorado y exclusión de integrantes); `tests/huespedes-figma-browser-check.cjs` (pantallas reales con escenario ficticio de Figma). La vista nativa se prepara con `Haku-Mobile/tests/prepare-huespedes-browser.cjs` y se indica por `HAKU_GUEST_NATIVE_PREVIEW`. `HAKU_GUEST_SHOTS` selecciona la carpeta de capturas. `HAIKU_BROWSER_PATH` permite usar un Chromium instalado.

**Chromium no acredita Android nativo.** La apertura, navegación, elección/recorte de foto y actualización sobre la APK anterior deben comprobarse en teléfono o emulador con la nueva APK candidata. No se ha publicado web ni OTA de esta corrección. Activación pendiente de revisión y autorización: migración aditiva, publicación web y distribución Android; conservar los registros existentes.
