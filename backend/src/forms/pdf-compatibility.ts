import type { TemplateMapping } from '../pdf/template-loader';
import { isReservedSystemFieldId } from './form-schema-policy';

/** Campo del esquema tal como se guarda en `FormVersion.schemaJson`. */
export type CampoEsquema = { id: string; type: string; label?: string; options?: unknown };

/**
 * Campos del formulario que la plantilla PDF imprime, con las opciones que
 * marcan casillas. Los datos del sistema (firmas, cuadrilla, fechas y horas)
 * no se incluyen: no los diligencia el colaborador.
 */
export function vinculosDelPdf(mapping: TemplateMapping): Map<string, Set<string>> {
  const vinculos = new Map<string, Set<string>>();
  const agregar = (campo: string, opcion?: string) => {
    if (isReservedSystemFieldId(campo)) return;
    const opciones = vinculos.get(campo) ?? new Set<string>();
    if (opcion !== undefined) opciones.add(opcion);
    vinculos.set(campo, opciones);
  };
  for (const [clave, definicion] of Object.entries(mapping.fields ?? {})) {
    if (definicion.type === 'CHECKBOX') {
      const { field, includes, equals } = definicion.checkedWhen;
      agregar(field, includes ?? equals);
    } else if (['TEXT', 'MULTILINE_TEXT', 'NUMBER', 'DATE', 'TIME'].includes(definicion.type)) {
      agregar(clave);
    }
  }
  return vinculos;
}

export type Compatibilidad = { errors: string[]; warnings: string[] };

const normalizar = (valor: string) => valor.trim().toLocaleUpperCase('es-CO');

/**
 * Compara un esquema nuevo con el publicado frente a la plantilla PDF oficial.
 *
 * Bloquea lo que dejaría el documento incompleto sin aviso: quitar o cambiar
 * de tipo un campo que se imprime, o quitar una opción que marca una casilla.
 * Advierte lo que no rompe el PDF pero conviene saber: campos nuevos que solo
 * quedarán en el registro digital.
 */
export function compatibilidadConPdf(
  actual: CampoEsquema[],
  nuevo: CampoEsquema[],
  vinculos: Map<string, Set<string>>,
): Compatibilidad {
  const errors: string[] = [];
  const warnings: string[] = [];
  const nuevos = new Map(nuevo.map((campo) => [campo.id, campo]));
  const actuales = new Map(actual.map((campo) => [campo.id, campo]));

  for (const anterior of actual) {
    const opcionesPdf = vinculos.get(anterior.id);
    const siguiente = nuevos.get(anterior.id);
    const nombre = anterior.label ? `"${anterior.label}" (${anterior.id})` : anterior.id;
    if (!opcionesPdf) {
      if (!siguiente && anterior.type !== 'auto') {
        warnings.push(`Se retira el campo ${nombre}; los permisos anteriores conservan su respuesta.`);
      }
      continue;
    }
    if (!siguiente) {
      errors.push(`El campo ${nombre} se imprime en el PDF oficial y no se puede retirar.`);
      continue;
    }
    if (siguiente.type !== anterior.type) {
      errors.push(`El campo ${nombre} se imprime en el PDF oficial y no puede cambiar de tipo.`);
      continue;
    }
    if (siguiente.type === 'select' || siguiente.type === 'multi_select') {
      const disponibles = new Set(
        (Array.isArray(siguiente.options) ? siguiente.options : []).map((opcion) => normalizar(String(opcion))),
      );
      for (const opcion of opcionesPdf) {
        if (!disponibles.has(normalizar(opcion))) {
          errors.push(`La opción "${opcion}" de ${nombre} marca una casilla del PDF oficial y no se puede retirar.`);
        }
      }
    }
  }

  for (const campo of nuevo) {
    if (campo.type === 'auto' || actuales.has(campo.id) || vinculos.has(campo.id)) continue;
    const nombre = campo.label ? `"${campo.label}"` : campo.id;
    warnings.push(`El campo nuevo ${nombre} no aparece en el PDF oficial; quedará en el registro digital.`);
  }
  return { errors, warnings };
}
