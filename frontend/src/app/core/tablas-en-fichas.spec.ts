import { rotularTablasEnFichas } from './tablas-en-fichas';

describe('rotularTablasEnFichas', () => {
  let raiz: HTMLElement;
  let detener: () => void;

  beforeEach(() => {
    raiz = document.createElement('div');
    raiz.innerHTML = `
      <table class="datos">
        <thead><tr><th>Cargo</th><th>Exige alturas</th><th>Vencimientos <span class="globo">12</span></th><th>Acciones</th></tr></thead>
        <tbody>
          <tr><td>Ayudante</td><td>No</td><td>5</td><td><button class="boton">Editar</button></td></tr>
          <tr><td colspan="4">Sin registros</td></tr>
        </tbody>
      </table>`;
    document.body.appendChild(raiz);
    detener = rotularTablasEnFichas(raiz);
  });

  afterEach(() => {
    detener();
    raiz.remove();
  });

  it('pone el encabezado de la columna como rótulo de cada dato', () => {
    const celdas = raiz.querySelectorAll('tbody tr:first-child td');
    expect(celdas[1].getAttribute('data-label')).toBe('Exige alturas');
    // El globo de conteo no forma parte del rótulo.
    expect(celdas[2].getAttribute('data-label')).toBe('Vencimientos');
  });

  it('no rotula el título de la ficha, las acciones ni las filas de estado vacío', () => {
    const celdas = raiz.querySelectorAll('tbody tr:first-child td');
    expect(celdas[0].hasAttribute('data-label')).toBeFalse();
    expect(celdas[3].hasAttribute('data-label')).toBeFalse();
    expect(raiz.querySelector('td[colspan]')?.hasAttribute('data-label')).toBeFalse();
  });

  it('rotula las filas que llegan después', async () => {
    const fila = document.createElement('tr');
    fila.innerHTML = '<td>Oficial</td><td>Sí</td><td>10</td><td></td>';
    raiz.querySelector('tbody')!.appendChild(fila);
    await new Promise((resolver) => requestAnimationFrame(() => setTimeout(resolver)));
    expect(fila.cells[1].getAttribute('data-label')).toBe('Exige alturas');
  });
});
