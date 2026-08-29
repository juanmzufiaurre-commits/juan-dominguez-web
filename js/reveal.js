/**
 * REVEAL.JS
 * ---------------------------------------------------------------
 * Revela progresivamente los elementos marcados con [data-reveal]
 * a medida que entran en el viewport, usando Intersection Observer
 * (nativo del navegador, sin librerías).
 *
 * Cómo se ve: ver la clase .is-visible en css/base.css, que define
 * la transición de opacity + translateY.
 *
 * threshold: 0.15 significa "cuando el 15% del elemento sea visible,
 * dispará la animación". Ajustar si se quiere que aparezca antes/después.
 */

(function () {
  const elementosRevelados = document.querySelectorAll('[data-reveal]');

  // Fallback: si el navegador no soporta Intersection Observer,
  // mostrar todo directamente sin animar (mejor que ocultar contenido).
  if (!('IntersectionObserver' in window)) {
    elementosRevelados.forEach((el) => el.classList.add('is-visible'));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          // Una vez revelado, no hace falta seguir observando ese elemento.
          observer.unobserve(entry.target);
        }
      });
    },
    {
      threshold: 0.15,
      rootMargin: '0px 0px -40px 0px',
    }
  );

  elementosRevelados.forEach((el) => observer.observe(el));
})();
