# Juan Domínguez Importación — sitio web

Landing page de presentación de un importador (China y Paraguay → Argentina).
Una sola pantalla continua con cinco secciones, precedida por una intro animada en 3D.

## Cómo abrirlo

**No hay build step. No hay dependencias. No hace falta instalar nada.**

La forma más simple es doble clic en `index.html` — el sitio está armado para
funcionar en `file://` (por eso Three.js se carga como build UMD clásico y no
como módulo ES).

Si preferís servirlo por HTTP:

```bash
npx serve .
```

## Estructura

```
index.html            Único documento. Todo el contenido está acá.

css/
  tokens.css          FUENTE ÚNICA: paleta, tipografía, espaciado, motion.
                      Cambiar un valor acá se propaga a todo el sitio.
  base.css            Reset, tipografía compartida, revelado al scrollear.
  sections.css        Layout de secciones, pasos, contacto.
  portada.css         Hero: plano 3D, tarjetas de vidrio, contadores.
  fondos.css          Fotos de fondo por sección + overlays.
  mapa.css            Ubicación del canvas del mapa punteado.
  route-line.css      Barra de progreso lateral.
  testimonios.css     Grilla de videos.
  intro.css           Overlay de la intro 3D.

js/
  route-line.js       Scroll spy + progreso de la barra lateral.
  reveal.js           Revelado de contenido al entrar en viewport.
  bg-transition.js    Cambia el fondo del <body> según la sección activa.
  fondos.js           Parallax y entrada de las fotos de fondo.
  portada.js          Contadores del hero + inclinación 3D con el cursor.
  mapa-mundi.js       Mapa punteado de fondo, lupa y aviones.
  intro-globe.js      Intro animada en WebGL.
  continentes-data.js Polígonos de los continentes. Lo usan intro-globe
                      y mapa-mundi: un solo origen de verdad.

assets/
  img/                Fotos de fondo y recorte del protagonista.
  video/              Videos de testimonios (pendientes de entrega).
  js/vendor/          Three.js (build UMD, ver nota en index.html).
```

## Convenciones

- **BEM en español** para las clases: `.seccion__contenido--hero`.
- **IIFE** en cada archivo JS, sin módulos ni bundler.
- **El JS publica números, el CSS decide cómo dibujarlos.** Los scripts
  escriben custom properties (`--fondo-y`, `--plano-x`) en vez de asignar
  `transform` u `opacity` a mano.
- **Solo se anima `transform` y `opacity`**, nunca `top` ni
  `background-position`.
- Todo bloque de movimiento respeta `prefers-reduced-motion`.

## Accesibilidad

Los alphas de los overlays en `tokens.css` **no son decisiones estéticas**:
salen de medir el contraste contra el punto más claro de cada foto. Bajarlos
deja ver más la imagen pero rompe el mínimo AA de WCAG (4,5:1). Están todos
documentados en el archivo con su ratio medido.

## Pendientes antes de publicar

- [ ] Links reales de WhatsApp e Instagram (hoy están en `href="#"`)
- [ ] Videos de testimonios y sus posters
- [ ] Nombres reales en las tarjetas de testimonios
- [ ] Reemplazar el testimonio de ejemplo del hero
- [ ] Confirmar la cifra de importadores acompañados (bloque comentado en el hero)
