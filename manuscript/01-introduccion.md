y # Introducción
HOLAAAA PRUEBA

:::table{widths="33 33 33"}
|   |   |   |
|:---|:---|:---|
|   |   |   |
|   |   |   |
|   |   |   |
:::

Prueba funcionando La elaboración de informes académicos exige un formato presentable y consistente: numeración de páginas, títulos jerárquicos, figuras y tablas referenciadas en el texto, y una tipografía que no distraiga del contenido. Markdown resuelve bien la escritura, pero no tiene concepto de página; por eso los saltos suelen quedar donde no deben.

Este informe describe una canalización que conserva la simplicidad de Markdown y produce un PDF paginado de calidad tipográfica. El contenido se escribe en `manuscript/`, el diseño vive en `theme/` y el PDF se reconstruye con un solo comando.

:::callout{type="info" title="Cómo leer esta plantilla"}
Cada capítulo es un archivo Markdown independiente. Las figuras usan `@fig:...`, las tablas `@tbl:...` y las secciones `@sec:...`; la numeración se calcula sola al compilar.
:::

## Contexto

Los cursos de proyecto piden entregables con una estructura estable: portada, índice, introducción, desarrollo, conclusiones y referencias. Cuando el documento crece, los ajustes manuales —mover una figura, agregar un párrafo— rompen la paginación y obligan a revisar todo el documento.

La alternativa habitual es escribir en un procesador de texto, pero entonces se pierde el control de versiones: los cambios quedan en un archivo binario y no se pueden revisar línea por línea.

### Problema

Un mismo párrafo puede empujar un título al pie de la página, separar una figura de su nota o partir una tabla en dos sin repetir la cabecera. Estos defectos son visibles para el evaluador y difíciles de detectar sin una vista paginada.

### Objetivos

1. Escribir en Markdown estándar, sin sintaxis propietaria.
2. Obtener un PDF A4 con páginas reales y numeración automática.
3. Referenciar figuras, tablas y secciones sin numerar a mano.
4. Mantener todo el proyecto en Git, de modo que al clonarlo se reconstruya el mismo PDF.

## Arquitectura de la solución

La @fig:arquitectura resume el flujo: el texto se convierte en un árbol de nodos, se traduce a Typst y se compila a PDF. El diseño y el contenido quedan separados, así que un cambio de tema no obliga a tocar los capítulos. hola hola

![Flujo de conversión: de Markdown a PDF paginado.](assets/figura-arquitectura.png){#fig:arquitectura width=92%}

El resultado es determinista: la misma entrada produce el mismo PDF, incluso en otra máquina, porque las fuentes y la versión del motor están fijadas en el repositorio.[^1]

[^1]: Las fuentes se guardan en `theme/fonts/` y el motor se documenta en el README; no se descargan durante la compilación.

Las alternativas evaluadas se comparan en la @tbl:comparacion. La decisión prioriza el control de la paginación y la legibilidad del código fuente.

:::table{caption="Comparación de alternativas para generar el PDF" widths="auto auto auto" id="tbl:comparacion"}
| Criterio | Procesador de texto | Markdown + plugin |
|:---|:---|:---|
| esotilin | mANUEL | Limitado |
| Referencias cruzadas | Parcial | Manual |
| Reproducibilidad | Baja | Media |
:::


