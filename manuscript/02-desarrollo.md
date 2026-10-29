# Desarrollo

Esta sección muestra los recursos que el documento necesita en la práctica: fórmulas, código, listas, figuras y control explícito de página.

## Modelo de contenido

El conversor recorre el árbol de Markdown y emite Typst. Las reglas de página no dependen del texto: un título de nivel uno siempre empieza en una hoja nueva y una figura nunca se separa de su pie.

### Fórmulas

El costo de una página puede expresarse como la suma del espacio ocupado por sus bloques. Si el bloque siguiente no cabe, se desplaza completo a la página posterior.

$$
C(p) = \sum_{b \in p} h(b) + \sum_{b \in p} s(b)
$$

El criterio de corte compara $C(p) + h(b) < H_{\max}$ antes de insertar el bloque $b$.

### Código

El comando de construcción es único y no requiere argumentos:

```bash
npm run build
```

El modo de observación recompila al guardar y muestra el número de páginas resultante:

```js
const { output, pages } = buildOnce({ quiet: false });
console.log(`${output}: ${pages} páginas`);
```

## Resultados

La @fig:rendimiento compara el tiempo de compilación de tres versiones del conversor. La mejora proviene de medir una sola vez el ancho de los bloques y reutilizar la caché cuando el texto no cambia.

![Tiempo de compilación por versión del conversor.](assets/figura-rendimiento.png){#fig:rendimiento width=78%}

Los aspectos que se verificaron fueron:

- Que ninguna figura quede separada de su pie.
- Que las tablas que se parten repitan la cabecera.
- Que la numeración de páginas empiece en uno después del índice.
- Que el texto en inglés se guiones correctamente: :en[the quick brown fox jumps over the lazy dog, demonstrating language-aware hyphenation] se procesa con su propio diccionario.

### Control explícito

Cuando el flujo automático no alcanza, existen dos mecanismos: el salto de página y el bloque indivisible.

:::keep
Este bloque se mantiene completo en una sola página, aunque haya espacio para una parte en la anterior. Es útil para listas de verificación, tablas pequeñas y figuras con su explicación.
:::

El bloque anterior demuestra que el control explícito convive con el automático: se usa solo donde hace falta y el resto se pagina solo.

## Discusión

Separar contenido y diseño permite que un mismo capítulo se publique con dos temas distintos sin editar una sola línea de texto. También facilita la revisión: el evaluador lee el PDF y el autor revisa el cambio en Git.

La limitación principal es que el conversor debe conocer cada recurso nuevo; por eso la sintaxis se documenta y se prueba con un documento de ejemplo como este.

### Verificación

Cada entrega se compila dos veces: una para revisar el PDF y otra para confirmar que el resultado es idéntico. La comparación se hace con la huella digital del archivo, de modo que cualquier diferencia —una fuente distinta, una imagen reescalada— se detecta antes de enviar el trabajo.

El historial de Git complementa esa verificación: si una página cambió, el diff muestra exactamente qué frase o qué figura la movió. En un procesador de texto ese diagnóstico exigiría comparar dos archivos binarios, que no permiten una revisión línea por línea.

También se revisa el presupuesto de páginas. Los cursos suelen fijar un máximo; saber cuántas hojas ocupa el documento antes de entregarlo evita recortes de último minuto.
