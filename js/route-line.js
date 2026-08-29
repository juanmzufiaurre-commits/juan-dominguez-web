/**
 * ROUTE-LINE.JS
 * ---------------------------------------------------------------
 * Scroll spy del signature element: la línea de "ruta/trayecto" que
 * atraviesa las 5 secciones (ver css/route-line.css).
 *
 * Hace dos cosas:
 *  1. Marca qué parada está activa/pasada (Intersection Observer).
 *  2. Escribe el progreso de scroll (0 a 1) en la custom property
 *     --route-progreso del <nav>.
 *
 * El JS no toca width ni height: solo publica un número y el CSS decide
 * cómo dibujarlo (escala en Y en desktop, en X en mobile). Antes se
 * escribían las dos dimensiones inline y, como el estilo inline le gana
 * a la hoja de estilos, el "hilo" de 3px terminaba con un width en
 * porcentaje y se veía como un bloque naranja gigante.
 */

(function () {
  const nav = document.querySelector('.route-line');
  const secciones = document.querySelectorAll('.seccion[data-stop]');
  const paradas = document.querySelectorAll('.route-line__stop');

  if (!nav || secciones.length === 0 || paradas.length === 0) return;

  const mapaParadas = new Map();
  paradas.forEach((parada) => mapaParadas.set(parada.dataset.stop, parada));
  const orden = Array.from(secciones, (s) => s.dataset.stop);

  // --- 1. Parada activa / pasadas ---
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        // Se queda con la sección más visible del viewport en este
        // momento: evita parpadeos cuando dos secciones se cruzan.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;

        const activa = visible.target.dataset.stop;
        const indiceActivo = orden.indexOf(activa);

        paradas.forEach((parada) => {
          const indice = orden.indexOf(parada.dataset.stop);
          const esActiva = indice === indiceActivo;
          parada.classList.toggle('is-active', esActiva);
          parada.classList.toggle('is-passed', indice < indiceActivo);
          const enlace = parada.querySelector('a');
          if (enlace) {
            if (esActiva) enlace.setAttribute('aria-current', 'true');
            else enlace.removeAttribute('aria-current');
          }
        });
      },
      { threshold: [0.25, 0.5, 0.75] }
    );

    secciones.forEach((s) => observer.observe(s));
  } else {
    mapaParadas.get(orden[0])?.classList.add('is-active');
  }

  // --- 2. Progreso continuo de scroll (0 a 1) ---
  // El alto scrolleable se cachea en vez de leerse en cada scroll:
  // scrollHeight fuerza un recálculo de layout, y hacerlo en cada evento
  // es justamente lo que encarece un scroll listener. Así el handler
  // queda en pura aritmética + una escritura de custom property.
  //
  // Tampoco se difiere con requestAnimationFrame: ese patrón necesita
  // que corra un frame para liberar su guard, y mientras no corre (rAF
  // throttleado) las actualizaciones siguientes quedan descartadas y la
  // barra se congela a mitad de camino.
  let altoScroll = 0;

  function medirAlto() {
    altoScroll = document.documentElement.scrollHeight - window.innerHeight;
    actualizarProgreso();
  }

  function actualizarProgreso() {
    const progreso = altoScroll > 0 ? window.scrollY / altoScroll : 0;
    nav.style.setProperty(
      '--route-progreso',
      String(Math.min(Math.max(progreso, 0), 1))
    );
  }

  window.addEventListener('scroll', actualizarProgreso, { passive: true });
  window.addEventListener('resize', medirAlto, { passive: true });

  // El alto cambia cuando cargan imágenes/videos o se revela contenido,
  // así que se remide ante cualquier cambio de tamaño del documento.
  if ('ResizeObserver' in window) {
    new ResizeObserver(medirAlto).observe(document.body);
  }

  medirAlto();
})();
