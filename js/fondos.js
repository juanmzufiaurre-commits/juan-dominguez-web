/**
 * FONDOS.JS
 * ---------------------------------------------------------------
 * Le da movimiento a las fotos de fondo de cada sección
 * (ver css/fondos.css). Hace dos cosas, independientes entre sí:
 *
 *  1. ENTRADA — cuando una sección entra en viewport, le agrega
 *     .is-fondo-visible y el CSS hace el fade-in con zoom
 *     (opacidad 0 → 1, escala 1.08 → 1). Una sola vez por sección,
 *     igual que js/reveal.js.
 *
 *  2. PARALLAX — mientras se scrollea, escribe --fondo-y en cada
 *     sección: cuánto tiene que desplazarse su foto respecto del
 *     contenido. La foto se mueve más lento, así el fondo y el texto
 *     no viajan pegados.
 *
 * Igual que en js/route-line.js, el JS acá solo PUBLICA NÚMEROS: no
 * escribe transform ni opacity a mano. Quién dibuja qué está en el CSS.
 *
 * Nota sobre requestAnimationFrame: route-line.js explica por qué NO
 * lo usa (su barra se congelaba). Acá sí corresponde y no pasa lo
 * mismo, porque son casos distintos: allá el valor tiene que quedar
 * exacto al final del scroll, y un frame descartado dejaba la barra a
 * mitad de camino. Acá el valor se recalcula desde cero en cada frame
 * a partir de la posición actual, así que un frame salteado no deja
 * nada colgado — se corrige solo en el siguiente.
 */

(function () {
  const secciones = document.querySelectorAll('.seccion[data-bg]');
  if (secciones.length === 0) return;

  /* Cuánto se desplaza la foto respecto de su sección, como fracción
     del alto de la sección. 0.25 = la foto recorre un cuarto del alto
     mientras la sección cruza toda la pantalla; se lee como un fondo
     que va "más lento" que el texto sin llamar la atención.

     OJO: este número está atado a --fondo-extension en css/fondos.css
     (30%). La foto se extiende ese 30% por arriba y por abajo de la
     sección justamente para tener de dónde desplazarse. Si se sube
     este factor por encima de 0.30, hay que subir la extensión
     también o van a aparecer franjas vacías en los bordes. */
  const FACTOR = 0.25;

  const consultaMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)');
  const consultaMobile = window.matchMedia('(max-width: 768px)');

  /* ------------------------------------------------------------
     1. ENTRADA — fade-in con zoom
     ------------------------------------------------------------ */

  /**
   * Espera a que la intro empiece a irse antes de ejecutar el callback.
   *
   * POR QUÉ HACE FALTA: el Hero ya está en viewport apenas carga la
   * página, así que su fade-in se dispara enseguida... pero detrás del
   * overlay de la intro, que lo tapa entero. Para cuando la intro se
   * va, la foto del Hero ya terminó de aparecer y se ve puesta de
   * golpe, sin transición.
   *
   * El enganche es .intro--saliendo (lo agrega finishIntro() en
   * js/intro-globe.js) y no la remoción del overlay: arrancando en ese
   * momento, los 1100ms del fade de la foto corren mientras el overlay
   * se desvanece en 700ms. La foto termina de resolverse justo después
   * de que la intro se despejó, en vez de quedar un hueco entre las dos.
   */
  function alSalirLaIntro(callback) {
    const overlay = document.getElementById('intro');

    // Sin overlay (ya se fue, o el watchdog de index.html lo sacó),
    // sin soporte de MutationObserver, o con la intro desactivada por
    // CSS (movimiento reducido, ver css/intro.css): no hay nada que
    // esperar y las fotos entran normalmente.
    if (
      !overlay ||
      !('MutationObserver' in window) ||
      getComputedStyle(overlay).display === 'none'
    ) {
      callback();
      return;
    }

    let disparado = false;

    function revisar() {
      if (disparado) return;
      // isConnected cubre el caso de que el overlay se remueva sin
      // pasar por la clase (el watchdog inline de index.html).
      if (!overlay.isConnected || overlay.classList.contains('intro--saliendo')) {
        disparado = true;
        observadorClase.disconnect();
        observadorQuitado.disconnect();
        callback();
      }
    }

    // Dos observadores acotados en vez de uno sobre todo el documento:
    // mirar atributos en subtree dispararía en cada .is-visible que
    // agregan reveal.js y route-line.js, decenas de veces por scroll.
    const observadorClase = new MutationObserver(revisar);
    observadorClase.observe(overlay, {
      attributes: true,
      attributeFilter: ['class'],
    });

    const observadorQuitado = new MutationObserver(revisar);
    observadorQuitado.observe(overlay.parentNode, { childList: true });
  }

  if ('IntersectionObserver' in window) {
    const observador = new IntersectionObserver(
      (entradas) => {
        entradas.forEach((entrada) => {
          if (!entrada.isIntersecting) return;
          entrada.target.classList.add('is-fondo-visible');
          // Ya apareció: no hace falta seguir observándola.
          observador.unobserve(entrada.target);
        });
      },
      {
        // 0.12 y no 0: si dispara apenas asoma un pixel, la animación
        // termina antes de que la sección esté a la vista y no se
        // llega a ver. Con 12% del alto adentro, el fade acompaña la
        // llegada de la sección.
        threshold: 0.12,
      }
    );

    // Recién se empieza a observar cuando la intro se va. Las otras
    // cuatro secciones están fuera de viewport igual, así que esperar
    // no les cambia nada: el único caso que arregla es el del Hero.
    alSalirLaIntro(() => {
      secciones.forEach((seccion) => observador.observe(seccion));
    });
  } else {
    // Sin soporte: mostrar las fotos directamente, sin animar.
    secciones.forEach((seccion) => seccion.classList.add('is-fondo-visible'));
  }

  /* ------------------------------------------------------------
     2. PARALLAX
     ------------------------------------------------------------ */

  // Geometría cacheada. Leer getBoundingClientRect() de 5 secciones en
  // cada evento de scroll fuerza un recálculo de layout por frame; se
  // mide una vez y se remide solo cuando el documento cambia de tamaño.
  let medidas = [];
  let frameEnCola = false;

  function parallaxActivo() {
    return !consultaMovimiento.matches && !consultaMobile.matches;
  }

  function medir() {
    const desplazamiento = window.scrollY;
    medidas = Array.from(secciones, (seccion) => {
      const caja = seccion.getBoundingClientRect();
      return {
        seccion: seccion,
        // Posición absoluta en el documento, independiente del scroll actual
        centro: caja.top + desplazamiento + caja.height / 2,
        alto: caja.height,
      };
    });
    pintar();
  }

  function pintar() {
    frameEnCola = false;

    const alturaViewport = window.innerHeight;
    const desplazamiento = window.scrollY;

    for (let i = 0; i < medidas.length; i++) {
      const m = medidas[i];

      // Progreso de la sección al cruzar la pantalla, de -1 a 1:
      //   -1 → recién asoma por abajo
      //    0 → está centrada en el viewport
      //    1 → terminó de salir por arriba
      const recorrido = (alturaViewport + m.alto) / 2;
      const bruto = (desplazamiento + alturaViewport / 2 - m.centro) / recorrido;
      const progreso = bruto < -1 ? -1 : bruto > 1 ? 1 : bruto;

      // Signo positivo = la foto se queda atrás mientras el contenido
      // sube. Eso es lo que produce la sensación de profundidad.
      m.seccion.style.setProperty(
        '--fondo-y',
        (progreso * FACTOR * m.alto).toFixed(1) + 'px'
      );
    }
  }

  function limpiar() {
    secciones.forEach((seccion) => seccion.style.removeProperty('--fondo-y'));
  }

  function alScrollear() {
    // Un solo repintado por frame: los eventos de scroll llegan mucho
    // más seguido que los frames y calcular de más no se ve en pantalla.
    if (frameEnCola) return;
    frameEnCola = true;
    window.requestAnimationFrame(pintar);
  }

  let enganchado = false;

  function sincronizar() {
    const debeAndar = parallaxActivo();

    if (debeAndar && !enganchado) {
      window.addEventListener('scroll', alScrollear, { passive: true });
      enganchado = true;
      medir();
    } else if (!debeAndar && enganchado) {
      window.removeEventListener('scroll', alScrollear);
      enganchado = false;
      // Importante: sin esto, al pasar de desktop a mobile la foto se
      // queda clavada en el último desplazamiento calculado.
      limpiar();
    } else if (debeAndar) {
      medir();
    }
  }

  window.addEventListener('resize', sincronizar, { passive: true });

  // Los media queries también cambian sin resize (rotar el teléfono,
  // o el usuario cambiando la preferencia de movimiento en el sistema).
  if ('addEventListener' in consultaMovimiento) {
    consultaMovimiento.addEventListener('change', sincronizar);
    consultaMobile.addEventListener('change', sincronizar);
  }

  // El alto del documento cambia cuando cargan las fotos o los videos
  // de testimonios, y ahí las medidas cacheadas quedan viejas. Mismo
  // recurso que usa js/route-line.js.
  if ('ResizeObserver' in window) {
    new ResizeObserver(sincronizar).observe(document.body);
  }

  sincronizar();
})();
