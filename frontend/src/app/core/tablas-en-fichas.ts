/**
 * En el celular cada fila de `table.datos` se vuelve una ficha apilada y su
 * encabezado se oculta. Sin él, "No", "5" o "Vigente" no dicen a qué columna
 * pertenecen: aquí cada celda recibe el texto de su encabezado en
 * `data-label`, que el CSS muestra como rótulo solo en pantallas angostas.
 *
 * Se hace una vez para toda la app, observando el DOM, para que ninguna tabla
 * nueva quede sin rótulos por olvidar marcarla.
 */
export function rotularTablasEnFichas(raiz: HTMLElement): () => void {
  let pendiente = 0;
  const rotular = () => {
    pendiente = 0;
    for (const tabla of Array.from(raiz.querySelectorAll<HTMLTableElement>('table.datos'))) {
      const encabezados = Array.from(tabla.querySelectorAll<HTMLTableCellElement>('thead th')).map((th) =>
        // Solo el texto propio: los globos de conteo no forman parte del rótulo.
        Array.from(th.childNodes)
          .filter((nodo) => nodo.nodeType === Node.TEXT_NODE || !(nodo as Element).classList?.contains('globo'))
          .map((nodo) => nodo.textContent ?? '')
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim(),
      );
      if (!encabezados.length) continue;
      for (const fila of Array.from(tabla.tBodies).flatMap((cuerpo) => Array.from(cuerpo.rows))) {
        Array.from(fila.cells).forEach((celda, indice) => {
          const rotulo = encabezados[indice] ?? '';
          // La primera columna identifica la fila (nombre, fecha) y va como
          // título de la ficha; las acciones y las filas de estado vacío no
          // necesitan rótulo.
          const sinRotulo =
            indice === 0 ||
            !rotulo ||
            celda.colSpan > 1 ||
            (celda.children.length > 0 &&
              Array.from(celda.children).every((hijo) => hijo.matches('button, a.boton, .boton, .acciones')));
          if (sinRotulo) celda.removeAttribute('data-label');
          else if (celda.getAttribute('data-label') !== rotulo) celda.setAttribute('data-label', rotulo);
        });
      }
    }
  };
  const observador = new MutationObserver(() => {
    if (!pendiente) pendiente = requestAnimationFrame(rotular);
  });
  observador.observe(raiz, { childList: true, subtree: true });
  rotular();
  return () => {
    observador.disconnect();
    if (pendiente) cancelAnimationFrame(pendiente);
  };
}
