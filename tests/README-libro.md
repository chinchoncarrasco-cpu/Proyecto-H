# Pruebas del lector semántico

Ejecutar con Node.js: `node --test tests/libro-semantica.test.cjs`.

El módulo de interpretación no requiere navegador ni Supabase. Las pruebas usan datos sintéticos y comprueban separación de colores, fechas, asociación conservadora, ausencia de inferencias con geometría desconocida y consultas sin escritura.

Verificación funcional con un XLSX real (no incluir datos de huéspedes en el repositorio):

1. Cargar una copia anterior y una copia actual desde Libro de Reserva.
2. Preguntar a Haku: `Libro: CAB 6 el 05-09-26`. Contrastar celda y merge con el original, fechas de estancia y movimientos del bloque de ingreso.
3. Preguntar por aseo en una fecha con datos, y comprobar inicio, fin y revisión en la columna estrecha correspondiente.
4. Preguntar por diferencias entre versiones dentro de un mes.
5. Recargar y repetir ambas consultas. Volver a cargar el mismo archivo y comprobar que no reemplaza el snapshot anterior.
6. Quitar el Libro: deben desaparecer ambos snapshots y quedar invalidadas las respuestas de esa copia. Tras recargar, Haku debe pedir que se cargue un archivo.
7. Comparar una reserva con Proyecto H en una sesión autenticada. Verificar que sólo se emiten SELECT y que los movimientos sin asociación segura no se asignan.
8. Probar nota roja y fragmento amarillo junto a texto blanco, negro o azul: la nota no cambia el estado operativo.

La aplicación sólo incorpora rutas de lectura. Las órdenes de crear, modificar o borrar desde el Libro se detienen en una explicación; no llegan a los procesadores de escritura existentes.
