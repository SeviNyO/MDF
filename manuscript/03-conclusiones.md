# Conclusiones

La canalización propuesta cumple el objetivo central: escribir en Markdown sin perder el control de la página. El documento resultante tiene portada, índice, numeración, figuras y tablas referenciadas, y se reconstruye con un comando a partir del repositorio.

## Hallazgos

1. **La paginación automática es suficiente** para la mayoría de los bloques; el control explícito se reserva para figuras grandes y listas de verificación.
2. **Las referencias cruzadas eliminan el trabajo manual** de renumerar cuando se inserta una figura en medio del documento.
3. **La separación entre tema y contenido** permite cambiar la identidad visual sin tocar los capítulos.
4. **Git funciona como historial real**: cada cambio es un diff de texto y el PDF se regenera desde cualquier clon.

## Limitaciones

- El conversor cubre el subconjunto de Markdown que el informe necesita; una sintaxis nueva requiere una regla nueva.
- La revisión visual sigue siendo necesaria: el compilador detecta referencias rotas, pero no juzga si una figura quedó demasiado pequeña.
- La edición de imágenes y el ajuste fino de tablas se resuelven fuera del Markdown, con archivos auxiliares versionados.

## Recomendaciones

Para el siguiente avance se propone:

- Agregar una vista paginada en vivo que muestre los cortes mientras se escribe.
- Incorporar un verificador de entrega que revise referencias, pies de figura y límite de páginas.
- Publicar el PDF como artefacto en cada integración continua, para comparar versiones sin compilar localmente.

## Referencias

1. Typst GmbH. *Typst: A new markup-based typesetting system*. Documentación oficial, 2026.
2. CommonMark. *CommonMark Specification*. 2024.
3. Universidad Peruana de Ciencias Aplicadas. *Guía de presentación de trabajos académicos*. 2025.
