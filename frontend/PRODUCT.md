# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Colaboradores:** completan el control previo al inicio de labores exclusivamente desde el celular, normalmente de pie, en campo, con conectividad variable y condiciones de luz difíciles.
- **Coordinación:** registra colaboradores y revisa/decide permisos desde celular o escritorio.
- **Gestor de ARL, Legal y Administración:** realizan sus tareas internas exclusivamente desde escritorio.

## Product Purpose

Sistema SG-SST digitaliza el control previo al inicio de labores: valida la afiliación ARL, confirma la charla de seguridad, guía el diligenciamiento de permisos versionados, captura la firma y deja cada decisión trazable hasta su aprobación o rechazo.

## Positioning

Convierte un permiso de trabajo en altura y sus condiciones de seguridad en un flujo guiado, verificable y auditable que bloquea el avance cuando faltan requisitos críticos.

## Operating Context

Los colaboradores acceden con documento y PIN desde su teléfono antes de comenzar labores. El flujo incluye estado de ARL, confirmación de charla, formulario de trabajo en altura, revisión y firma. Coordinación consulta, aprueba o rechaza envíos y registra colaboradores. Los equipos de ARL, Legal y Administración gestionan afiliaciones, trazabilidad, cuentas, auditoría y formatos desde estaciones de escritorio.

## Capabilities and Constraints

- PWA Angular online-first: la instalación y caché son apoyo; los envíos oficiales requieren conexión.
- El colaborador usa solo celular; los controles deben ser táctiles, legibles y claros en exteriores o con poca luz.
- Coordinación debe funcionar eficazmente tanto en celular como en escritorio.
- Las áreas de ARL, Legal y Administración se diseñan para escritorio.
- No se usan fuentes remotas, para no depender de descargas en conexiones limitadas.
- Se preservan los roles, permisos, validaciones de ARL, trazabilidad y contenido funcional existente.

## Evidence on Hand

- Formulario inicial: `HSE-FO-016` — Permiso de trabajo en altura, versión 00.
- Especificación del formulario: `docs/FORM_HSE-FO-016.md`.
- Decisiones técnicas y de negocio: `docs/DECISIONS.md`.
- Flujos y funcionalidades implementados en `frontend/src/app/features/`.
- No hay marca, logo ni activos visuales corporativos vinculantes actualmente.

## Product Principles

1. La seguridad crítica se entiende antes de actuar.
2. El colaborador debe completar su tarea con una mano, sin ambigüedad y sin carga visual innecesaria.
3. Una decisión interna debe revelar el contexto y la evidencia necesarios para ser responsable.
4. La trazabilidad y el estado del proceso deben ser comprensibles para cada rol.
5. La interfaz debe rendir con dignidad en equipos y conexiones limitados.

## Accessibility & Inclusion

Priorizar objetivos táctiles amplios, contraste alto, lenguaje directo, estados no dependientes solo del color, navegación por teclado y respeto de `prefers-reduced-motion`.
