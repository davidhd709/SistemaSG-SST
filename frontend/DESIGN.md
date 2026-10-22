---
name: Gestión SST
description: Consola operativa de formatos SG-SST con identidad marina y acción en verde azulado.
colors:
  marino-950: '#061a2e'
  marino-900: '#08213a'
  marino: '#0c2c4c'
  marino-700: '#12385f'
  marino-600: '#1a4775'
  teal: '#1a8c78'
  teal-claro: '#5fd0b8'
  teal-tenue: '#e2f3ef'
  azul: '#12705f'
  azul-oscuro: '#0d5a4c'
  tinta: '#0c2340'
  tinta-media: '#3f5468'
  tinta-suave: '#55687c'
  fondo: '#edf1f5'
  fondo-hundido: '#e4eaf0'
  superficie: '#ffffff'
  borde: '#d8e0e8'
  borde-fuerte: '#a7b5c4'
  filete: '#e6ebf0'
  ok: '#12694f'
  ok-fondo: '#e2f4ec'
  ok-borde: '#b5dcc9'
  alerta: '#8a5200'
  alerta-fondo: '#fdf1dc'
  alerta-borde: '#ecd09c'
  error: '#b42318'
  error-fondo: '#fdecea'
  error-borde: '#f1c2bd'
typography:
  display:
    fontFamily: 'Montserrat, system-ui, sans-serif'
    fontSize: 'clamp(2.25rem, 7vw, 3.75rem)'
    fontWeight: 800
    lineHeight: 1.04
    letterSpacing: '-0.035em'
  headline:
    fontFamily: 'Montserrat, system-ui, sans-serif'
    fontSize: 'clamp(1.6rem, 3vw, 2.25rem)'
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: '-0.03em'
  title:
    fontFamily: 'Montserrat, system-ui, sans-serif'
    fontSize: '1.25rem'
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: '-0.02em'
  body:
    fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif'
    fontSize: '1rem'
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: 'Montserrat, system-ui, sans-serif'
    fontSize: '0.875rem'
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: '0.01em'
  cifra:
    fontFamily: 'Montserrat, system-ui, sans-serif'
    fontSize: '1.875rem'
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: '-0.03em'
    fontFeature: 'tnum'
rounded:
  chico: '10px'
  radio: '12px'
  bloque: '16px'
  radio-grande: '18px'
  grande: '22px'
  acceso: '24px'
  pastilla: '999px'
spacing:
  xs: '4px'
  sm: '8px'
  md: '16px'
  lg: '24px'
  xl: '32px'
components:
  boton-primario:
    backgroundColor: '{colors.azul}'
    textColor: '{colors.superficie}'
    typography: '{typography.label}'
    rounded: '{rounded.radio}'
    padding: '12px 22px'
    height: '52px'
  boton-primario-hover:
    backgroundColor: '{colors.azul-oscuro}'
    textColor: '{colors.superficie}'
  boton-secundario:
    backgroundColor: '{colors.superficie}'
    textColor: '{colors.tinta}'
    rounded: '{rounded.radio}'
    padding: '12px 22px'
    height: '52px'
  boton-secundario-hover:
    backgroundColor: '#f5f8fb'
    textColor: '{colors.marino}'
  boton-peligro:
    backgroundColor: '{colors.error}'
    textColor: '{colors.superficie}'
    rounded: '{rounded.radio}'
    padding: '12px 22px'
  boton-compacto:
    rounded: '{rounded.chico}'
    padding: '7px 15px'
    height: '40px'
  campo:
    backgroundColor: '#fbfcfd'
    textColor: '{colors.tinta}'
    rounded: '{rounded.radio}'
    padding: '11px 14px'
    height: '50px'
  bloque:
    backgroundColor: '{colors.superficie}'
    rounded: '{rounded.radio-grande}'
    padding: '26px'
  tarjeta:
    backgroundColor: '{colors.superficie}'
    rounded: '{rounded.radio-grande}'
    padding: '32px 28px'
  pestana-activa:
    backgroundColor: '{colors.superficie}'
    textColor: '{colors.marino}'
    typography: '{typography.label}'
    rounded: '{rounded.chico}'
    padding: '8px 16px'
    height: '40px'
  distintivo-vigente:
    backgroundColor: '{colors.ok-fondo}'
    textColor: '{colors.ok}'
    rounded: '{rounded.pastilla}'
    padding: '3px 10px 3px 8px'
  distintivo-por-vencer:
    backgroundColor: '{colors.alerta-fondo}'
    textColor: '{colors.alerta}'
    rounded: '{rounded.pastilla}'
    padding: '3px 10px 3px 8px'
  distintivo-vencida:
    backgroundColor: '{colors.error-fondo}'
    textColor: '{colors.error}'
    rounded: '{rounded.pastilla}'
    padding: '3px 10px 3px 8px'
  opcion-marcada:
    backgroundColor: '{colors.azul}'
    textColor: '{colors.superficie}'
    rounded: '{rounded.radio}'
    padding: '12px 18px'
    height: '54px'
  cabecera-app:
    backgroundColor: '{colors.marino-900}'
    textColor: '{colors.superficie}'
    padding: '12px 24px'
---

# Design System: Gestión SST

## Overview

**Creative North Star: "La consola de turno con bandera marina"**

Gestión SST es la consola operativa estándar de su categoría, ejecutada con acabado completo dentro de la marca del cliente. La identidad no vive en ornamento sino en bloques: la cabecera, la banda de área (masthead) y el panel de acceso son franjas marinas con el escudo como marca de agua; todo lo demás es un suelo claro y frío donde flotan tarjetas blancas con sombras teñidas de marino. El verde azulado aparece solo donde se actúa o donde hay estado vivo.

Hay dos densidades. El colaborador recorre un flujo de una tarea por pantalla, de pie, con guantes y a contraluz: objetivos táctiles de 52–54px, barra de acción fija al pie y progreso siempre visible. Los equipos internos (Coordinación, ARL, Legal, Administración) leen estado y evidencia en superficies de escritorio densas y tranquilas: franja de indicadores, pestañas, tablas con cifras tabulares y fichas de definición.

Rechazo confirmado: el aspecto plano crema y verde que no cargaba identidad. La marca se reconoce al instante por el marino y el escudo, no por colores pastel.

**Key Characteristics:**

- Bandas marinas de identidad (`--banda-marina`: degradado marino con luz verde azulada en una esquina) con el escudo al 6–7 % de opacidad.
- Suelo frío claro (`fondo`) y tarjetas blancas elevadas con sombras marinas desplazadas.
- Montserrat autoalojada para títulos, controles y cifras; la letra del sistema para el cuerpo.
- Verde azulado reservado a acciones, foco, selección y progreso.
- Un solo gesto de movimiento: "subir".

## Colors

Paleta de marca de dos voces: marino institucional para identidad, verde azulado para acción, sobre neutros fríos con matiz azul.

### Primary

- **Marino institucional** (`marino`): fondo de la banda de área, pestaña de módulo activa, cifras de indicadores, chapa de código de formato. Su escala (`marino-950` a `marino-600`) arma el degradado de banda; `marino-900` es la cabecera de la app y del flujo, y el `theme-color` de la PWA.
- **Verde azulado de acción** (`azul`): botón primario, opción marcada, casilla marcada, foco (`:focus-visible` 3px), enlaces y `caret-color`. Es el teal del logo oscurecido para que el texto blanco cumpla AA. Hover y bordes: `azul-oscuro`.

### Secondary

- **Teal de logo** (`teal`): solo en el progreso del flujo (degradado `teal` → `teal-claro`) y en puntos de estado vivo; también tiñe los anillos de foco de campos (`rgb(26 140 120 / 0.18)`).
- **Teal claro** (`teal-claro`): acentos sobre marino: contorno de foco dentro de bandas, globos de conteo en pestañas de la banda, iconos del panel de acceso, pastilla de contexto de área.
- **Teal tenue** (`teal-tenue`): fondo de casilla marcada y de globos de conteo sobre suelo claro.

### Neutral

- **Tinta marina** (`tinta`): texto principal y títulos.
- **Tinta media** (`tinta-media`): párrafos de apoyo, encabezados de tabla, rótulos de indicador.
- **Tinta suave** (`tinta-suave`): texto secundario, ayudas, términos de fichas.
- **Suelo frío** (`fondo`): fondo de página; también fondo de campo deshabilitado y de chips neutros.
- **Suelo hundido** (`fondo-hundido`): carril de pestañas sobre suelo claro.
- **Superficie** (`superficie`): tarjetas, bloques, tablas.
- **Borde** (`borde`) y **borde fuerte** (`borde-fuerte`): contornos de contenedor y de control respectivamente.
- **Filete** (`filete`): divisores internos de tabla, preguntas y segmentos de indicadores.

### Estados

Tres familias de tres tonos (texto, fondo, borde): `ok`, `alerta`, `error`. Se usan siempre juntas en mensajes, distintivos, fichas de expediente y pantallas de resultado.

### Named Rules

**La Regla del Teal Que Actúa.** El verde azulado solo marca lo que se puede pulsar, lo que está seleccionado, el foco o el progreso. Como superficie solo llena acciones (la puerta destacada de la portada) y como luz solo tiñe la esquina del degradado de las bandas marinas; nunca es fondo decorativo de contenido ni color de título.

**La Regla del Marino Como Bandera.** El marino lleno se reserva a bloques de identidad (cabecera, banda de área, panel de acceso, portada) y a la selección activa de módulo. El contenido de trabajo vive siempre sobre suelo claro.

**La Regla de los Nombres Heredados.** Las variables conservan nombres históricos por compatibilidad: `--azul` es el verde azulado de acción, no un azul. No renombrar; leer el valor.

## Typography

**Display Font:** Montserrat variable (100–900), autoalojada en `/assets/fuentes/montserrat-variable.woff2`, `font-display: swap`, precargada; respaldo `system-ui, sans-serif`.
**Body Font:** pila del sistema (`system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif`).

**Character:** Montserrat geométrica pone la voz de marca en títulos, botones, pestañas y cifras; la letra del sistema mantiene el cuerpo ligero y nativo en equipos limitados.

### Hierarchy

- **Display** (800, clamp(2.25rem, 7vw, 3.75rem), 1.04, −0.035em): solo el titular de la portada, máximo 14ch.
- **Headline** (700, clamp(1.6rem, 3vw, 2.25rem), −0.03em): h1 de la banda de área, en blanco. Variante del panel de acceso: clamp(1.5rem, 2.4vw, 2rem), 18ch.
- **Título de paso / pantalla** (700, 1.625rem, −0.025em): h1 del flujo del colaborador y de encabezados de formulario.
- **Title** (700, 1.25rem): h2 de sección; h3 de bloque a 1.0625rem.
- **Body** (400, 1rem, 1.55): texto corriente; introducciones a 70ch como máximo; apoyo a 0.9375rem.
- **Label** (Montserrat 700, 0.875rem): botones (1rem en tamaño normal), pestañas, módulos.
- **Cifra** (Montserrat 700, 1.875rem, cifras tabulares): números de la franja de indicadores (1.625rem en celular).
- **Rótulo de dato** (600, 0.75–0.8125rem, +0.03em, mayúsculas): términos `dt` de fichas y encabezados de tabla (Montserrat 700, 0.71875rem, +0.06em). Rotula datos; nunca encabeza una sección.

### Named Rules

**La Regla del Titular Sin Antetítulo.** Ningún título lleva una etiqueta pequeña encima. El nombre del área vive en el h1 de la banda; el contexto va en la pastilla `area-contexto` al lado, en mayúscula inicial.

**La Regla de la Cifra Tabular.** Toda cifra comparable (indicadores, tablas, conteos, documento y PIN) usa `font-variant-numeric: tabular-nums`.

## Layout

- **Contenedores:** consola interna a 1200px máx. con 24px laterales (16px bajo 640px); flujo del colaborador a 760px con 20px laterales y 128px de reserva inferior para la barra de acción fija; acceso a 1040px.
- **Bandas a sangre:** la banda de área vive dentro del contenedor pero se extiende a todo el ancho con `box-shadow: 0 0 0 100vmax` + `clip-path: inset(0 -100vmax)`; el `body` recorta con `overflow-x: clip`.
- **Ritmo:** pasos de 4/8/16/24/32px; separaciones de campos 18px, entre bloques 22px, márgenes de sección 24–32px.
- **Acceso (primer viewport):** de 860px en adelante, tarjeta partida (panel marino 0.95fr con logo completo, titular y lista de garantías | formulario blanco 1fr, contenido a 400px). Bajo 859px, la banda marina lleva solo el logo y la tarjeta del formulario la monta con −60px, acción primaria a todo el ancho.
- **Portada:** banda marina con escudo; dos "puertas" (tarjetas) que suben −72 a −96px sobre la banda, en dos columnas desde 680px.
- **Celular (≤640px):** la banda de área apila texto y pestañas, las pestañas se desplazan en horizontal sin partirse; la franja de indicadores pasa a 2 columnas y el último segmento impar ocupa la fila completa; las tablas se convierten en fichas apiladas (encabezado oculto accesible, celdas en bloque, acción de fila a todo el ancho).
- **Rejilla de formulario:** una columna; `.dos` pasa a dos columnas desde 640px.

## Elevation & Depth

Sistema elevado: el suelo es plano y frío, y toda superficie de trabajo flota sobre él con sombras teñidas de marino (`rgb(8 33 58 / α)`), siempre con desplazamiento vertical y una capa de contacto más una difusa con spread negativo. Los controles interactivos llevan sombra de color propio (verde azulado o rojo) bajo el botón.

### Shadow Vocabulary

- **Sombra 1** (`--sombra-1`: `0 1px 2px rgb(8 33 58 / 0.06), 0 2px 6px rgb(8 33 58 / 0.05)`): tablas, mensajes, carril de módulos, pestaña activa, expedientes.
- **Sombra** (`--sombra`: `0 1px 3px rgb(8 33 58 / 0.06), 0 10px 26px -8px rgb(8 33 58 / 0.18)`): bloques de contenido, franja de indicadores, resultado del envío.
- **Sombra alta** (`--sombra-alta`: `0 2px 6px rgb(8 33 58 / 0.08), 0 28px 56px -14px rgb(8 33 58 / 0.34)`): tarjeta de acceso, puertas de portada, tarjeta móvil que monta la banda.
- **Sombra de acción** (`0 6px 16px -6px rgb(18 112 95 / 0.55)` + brillo interior `inset 0 1px 0 rgb(255 255 255 / 0.16)`): botón primario; crece a `0 12px 24px -8px` en hover.
- **Hundido** (`inset 0 1px 2px rgb(8 33 58 / 0.06)`): campos y carril de pestañas.
- **Barra al pie** (`0 -10px 30px -12px rgb(8 33 58 / 0.25)` con `backdrop-filter: blur(14px)` sobre blanco al 92 %).

### Named Rules

**La Regla de la Sombra Desplazada.** Toda sombra tiene desplazamiento vertical y tinte marino. No hay resplandores difuminados centrados (`0 0 Npx`). Los anillos sólidos sin desenfoque (`0 0 0 4px`) sí existen, solo para foco de campo, firma completada y halo de estado.

## Shapes

Esquinas suavemente redondeadas y consistentes: 12px (`--radio`) en controles y campos, 18px (`--radio-grande`) en tarjetas y bloques, 22–24px en las superficies héroe (puertas, resultado, tarjeta de acceso). Los carriles de pestañas y módulos usan 14px con elementos internos de 10px (anidado concéntrico con 4px de relleno). Pastillas (999px) para distintivos, contexto de área, credenciales y globos. Bordes de 1px; 2px solo en las opciones grandes Sí/No/N.A. y en el lienzo de firma (discontinuo hasta firmar). El estado vacío usa borde discontinuo con el escudo centrado arriba.

## Components

### Buttons

Sólidos, táctiles y con peso: Montserrat 700, sombra de color propio.

- **Shape:** 12px (`rounded.radio`), alto mínimo 52px.
- **Primario:** verde azulado de acción con borde `azul-oscuro`, texto blanco, 12px 22px.
- **Hover / Focus:** fondo `azul-oscuro`, sube 1px y la sombra crece; `:active` baja 1px con sombra interior. Foco: contorno 3px `azul` a 2px (sobre marino, `teal-claro`).
- **Secundario:** blanco con `borde-fuerte`; hover borde `marino-600`, texto marino. Sobre bandas marinas se vuelve vidrio: blanco al 6 % con borde blanco al 22 %.
- **Peligro:** `error` con borde `#8f1c13`.
- **Compacto:** 40px, radio 10px, 0.875rem (36px en la cabecera móvil).
- **Bloque:** ancho completo (acción primaria en móvil y en barra al pie).

### Chips

- **Distintivo de estado:** pastilla con punto de 7px en `currentColor`, fondo/borde/texto de la familia de estado (vigente, por vencer, vencida, neutro). El punto y el texto hacen que el estado no dependa solo del color.
- **Contexto de área:** pastilla sobre la banda, teal claro al 12 % con contorno interior al 32 %, texto `#bff0e4`, Montserrat 600, mayúscula inicial.
- **Globo de conteo:** pastilla de 22px en pestañas (`teal-tenue`/`azul-oscuro` en claro; `teal-claro`/`marino-950` sobre banda).

### Cards / Containers

- **Corner Style:** 18px (bloque, tarjeta), 16px (franja de indicadores, expedientes), 14px (marco de tabla).
- **Background:** `superficie`; expedientes y resultados con degradado vertical tenue de su familia de estado.
- **Shadow Strategy:** sombra 1 / sombra / sombra alta según el papel (ver Elevation & Depth).
- **Border:** 1px `borde` en bloques, tablas y franja.
- **Internal Padding:** 26px en bloques (20px 16px en celular), 32px 28px en tarjetas.

### Inputs / Fields

- **Style:** 50px de alto, 11px 14px, borde 1px `borde-fuerte`, radio 12px, fondo `#fbfcfd` hundido.
- **Focus:** borde `azul`, fondo blanco, anillo sólido `0 0 0 4px rgb(26 140 120 / 0.18)`.
- **Error / Disabled:** campo inválido con borde `error` y anillo rojo al 12 %, mensaje 600 bajo el campo; deshabilitado sobre `fondo` con `tinta-suave`.
- **Numérico (documento y PIN):** Montserrat 600, 1.25rem, +0.08em, cifras tabulares.
- **Rótulo:** 600, 0.9375rem, encima del control con 6px; ayuda a 0.8125rem.

### Navigation

- **Cabecera de app:** `marino-900`, solo marca (sigla 40px + sello en mayúsculas + lema); el nombre del área no se repite aquí, vive en el h1 de la banda. Salida como botón secundario vidrio.
- **Banda de área:** degradado `--banda-marina` a sangre, escudo al 6 %, h1 blanco + párrafo `#c3d3e3`, pastilla de contexto y pestañas.
- **Pestañas:** carril de 4px de relleno, botones de 40px en Montserrat 700; activa en blanco con texto marino y sombra 1. Sobre la banda el carril es negro al 22 %.
- **Módulos:** carril blanco con enlaces entre áreas hermanas; el activo es marino lleno con texto blanco.
- **Cabecera de paso (colaborador):** pegajosa, `marino-900`, sigla 36px (30px en celular), título y contador "paso X de Y", barra de progreso de 5px en degradado teal.

### Franja de indicadores

Una sola franja blanca dividida en segmentos con filete de 1px, no tarjetas sueltas. Cada segmento: cifra marina y rótulo `tinta-media`. El segmento que pide atención se pinta con la familia `alerta`. En celular, 2 columnas y el último impar ocupa toda la fila.

### Tabla de datos

Encabezado `#f5f8fb` en mayúsculas pequeñas Montserrat, celdas de 13px 16px, filete entre filas, hover `#f4f8fb`, fila de alerta en `error-fondo`. Bajo 640px se reflujo a fichas apiladas con la acción de fila a todo el ancho.

### Opciones grandes (Sí / No / N.A.)

Botones de 54px con borde 2px; marcada en verde azulado; el "No" marcado pasa a `error` (es una alerta, no una preferencia) y "N.A." a `tinta-media`.

### Barra de acción al pie

Fija, blanca al 92 % con desenfoque, respeta `safe-area-inset-bottom`; la acción primaria crece y la secundaria se ajusta a su contenido.

### Pantalla de resultado

Tarjeta centrada de 22px con símbolo circular de 76px en la familia de estado (aprobado, rechazado, pendiente) y halo sólido de 8px.

### Movimiento

Un solo momento: la animación `subir` (translateY 14px → 0, 600–700ms, `cubic-bezier(0.16, 1, 0.3, 1)`) en la entrada de la tarjeta de acceso, las puertas, el texto de la banda de área y el resultado. Microtransiciones de 140–260ms en color, sombra y desplazamiento de 1–4px en hover. Con `prefers-reduced-motion: reduce` se anulan todas las animaciones y transiciones.

## Do's and Don'ts

### Do:

- **Do** usar el marino solo en bandas de identidad (cabecera `marino-900`, banda de área y panel de acceso con `--banda-marina`) y llevar el escudo como marca de agua al 6–7 %.
- **Do** reservar el verde azulado (`azul`) a acciones, selección, foco y progreso.
- **Do** poner el contenido en tarjetas blancas sobre `fondo` con la sombra del papel correspondiente (sombra 1, sombra, sombra alta).
- **Do** mantener objetivos táctiles de 52–54px en el flujo del colaborador y la acción primaria a todo el ancho en móvil.
- **Do** mostrar el estado como una sola franja segmentada y como distintivos con punto + texto.
- **Do** convertir las tablas en fichas apiladas bajo 640px con la acción de fila a todo el ancho.
- **Do** usar Montserrat en títulos, controles y cifras, y cifras tabulares en todo número comparable.
- **Do** escribir la pastilla de contexto de área en mayúscula inicial.

### Don't:

- **Don't** volver al aspecto plano crema y verde sin identidad.
- **Don't** poner una etiqueta pequeña (antetítulo) encima de un título.
- **Don't** repetir el nombre del área en la cabecera; la cabecera muestra solo la marca.
- **Don't** usar resplandores difuminados centrados; toda sombra va desplazada y teñida de marino.
- **Don't** usar el verde azulado como fondo decorativo de contenido ni como color de títulos.
- **Don't** añadir un segundo gesto de entrada: el movimiento de llegada es solo "subir".
- **Don't** renombrar `--azul` ni el resto de variables heredadas; su nombre no describe su color.
- **Don't** cargar fuentes de terceros; Montserrat se sirve desde la app.
