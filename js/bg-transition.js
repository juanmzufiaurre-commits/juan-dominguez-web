/**
 * BG-TRANSITION.JS
 * ---------------------------------------------------------------
 * Cambia el fondo de <body> según qué sección esté actualmente
 * ocupando la mayor parte del viewport, usando Intersection Observer.
 *
 * Cada <section class="seccion"> tiene un atributo data-bg="clave".
 * Esa clave corresponde a una variable CSS --bg-clave definida en
 * css/tokens.css (ej: data-bg="hero" → var(--bg-hero)).
 *
 * La transición suave del cambio de color/gradiente la hace el CSS
 * (ver "transition: background" en css/base.css) — este script solo
 * decide CUÁNDO cambiar, no CÓMO se anima el cambio.
 */

(function () {
  const secciones = document.querySelectorAll('.seccion[data-bg]');
  const body = document.body;

  if (!('IntersectionObserver' in window) || secciones.length === 0) {
    return; // sin soporte o sin secciones: se queda con el fondo por defecto del CSS
  }

  // Mapa clave → valor de la variable CSS, leído una sola vez al cargar.
  // Evita tener que leer getComputedStyle en cada scroll (más performante).
  const raiz = getComputedStyle(document.documentElement);
  const fondosPorClave = {};
  secciones.forEach((seccion) => {
    const clave = seccion.dataset.bg;
    fondosPorClave[clave] = raiz.getPropertyValue(`--bg-${clave}`).trim();
  });

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        // threshold 0.5 → cuando una sección ocupa el 50%+ del viewport,
        // se la considera "la sección activa" y se aplica su fondo.
        if (entry.isIntersecting) {
          const clave = entry.target.dataset.bg;
          const valor = fondosPorClave[clave];
          if (valor) {
            body.style.background = valor;
          }
        }
      });
    },
    {
      threshold: 0.5,
    }
  );

  secciones.forEach((seccion) => observer.observe(seccion));
})();
