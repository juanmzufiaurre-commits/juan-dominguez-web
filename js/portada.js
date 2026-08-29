/**
 * PORTADA.JS
 * ---------------------------------------------------------------
 * Contadores animados de los datos de autoridad del Hero: los números
 * suben desde 0 cuando la sección entra en viewport.
 *
 * Igual que el resto del sitio: IntersectionObserver para decidir
 * CUÁNDO, y una sola vez por elemento (se deja de observar apenas
 * arranca). Ver js/reveal.js y js/fondos.js.
 *
 * El número final vive en el HTML como texto, no acá: si el JS falla
 * o el usuario pidió menos movimiento, el dato igual se lee. El
 * atributo data-contador solo dice hasta dónde animar.
 *
 * Espera a que la intro 3D se vaya, por el mismo motivo que
 * js/fondos.js: el Hero ya está en viewport al cargar, así que sin
 * esperar los contadores terminarían de subir detrás del overlay de
 * la intro y se verían quietos al aparecer.
 */

(function () {
  const datos = document.querySelectorAll('[data-contador]');
  if (datos.length === 0) return;

  // Duración dentro del rango 400-600ms que la skill ui-ux-pro-max
  // recomienda para revelados al entrar en viewport. Los números son
  // chicos (4, 2), así que más largo se sentiría lento.
  const DURACION = 900;

  const sinMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)');

  /**
   * Espera a que la intro empiece a irse. Copia deliberada del mismo
   * mecanismo de js/fondos.js: son dos módulos independientes y
   * compartir estado entre IIFEs pediría una global, que este proyecto
   * no usa en ningún lado.
   */
  function alSalirLaIntro(callback) {
    const overlay = document.getElementById('intro');

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
      if (!overlay.isConnected || overlay.classList.contains('intro--saliendo')) {
        disparado = true;
        observadorClase.disconnect();
        observadorQuitado.disconnect();
        callback();
      }
    }

    const observadorClase = new MutationObserver(revisar);
    observadorClase.observe(overlay, { attributes: true, attributeFilter: ['class'] });

    const observadorQuitado = new MutationObserver(revisar);
    observadorQuitado.observe(overlay.parentNode, { childList: true });
  }

  /**
   * Sube el número de 0 al destino. Usa easing "out": arranca rápido y
   * frena al final, que es lo que hace que se lea como un contador y
   * no como una barra de progreso.
   */
  function contar(elemento) {
    const destino = parseInt(elemento.dataset.contador, 10);
    if (!Number.isFinite(destino)) return;

    const prefijo = elemento.dataset.prefijo || '';
    const arranque = performance.now();

    function frame(ahora) {
      const t = Math.min((ahora - arranque) / DURACION, 1);
      // easeOutCubic — equivalente al power2.out de la skill
      const suave = 1 - Math.pow(1 - t, 3);
      elemento.textContent = prefijo + Math.round(destino * suave);

      if (t < 1) {
        window.requestAnimationFrame(frame);
      } else {
        // Se reescribe el valor exacto: el redondeo del último frame
        // podría dejarlo en destino-1 si el timing cae justo.
        elemento.textContent = prefijo + destino;
      }
    }

    window.requestAnimationFrame(frame);
  }

  // Movimiento reducido: el número ya está escrito en el HTML, no se
  // toca nada y se termina acá.
  if (sinMovimiento.matches || !('IntersectionObserver' in window)) return;

  const observador = new IntersectionObserver(
    (entradas) => {
      entradas.forEach((entrada) => {
        if (!entrada.isIntersecting) return;
        observador.unobserve(entrada.target);
        contar(entrada.target);
      });
    },
    { threshold: 0.6 }
  );

  alSalirLaIntro(() => {
    datos.forEach((dato) => {
      // Recién acá se pone en 0: si se hiciera antes, el dato quedaría
      // en cero durante toda la intro y en 0 para siempre si el
      // observer nunca dispara.
      const prefijo = dato.dataset.prefijo || '';
      dato.textContent = prefijo + '0';
      observador.observe(dato);
    });
  });
})();


/**
 * PLANO 3D DEL HERO
 * ---------------------------------------------------------------
 * Inclina el conjunto panel + foto siguiendo el cursor.
 *
 * El parallax entre las dos capas NO se calcula acá: el CSS las pone a
 * distinta profundidad con translateZ (panel en 0, foto en 52px) y la
 * perspectiva del contenedor hace el resto. Inclinar el plano alcanza
 * para que la foto se desplace más que el panel, que es exactamente lo
 * que se busca. Ver css/portada.css.
 *
 * El JS solo publica dos ángulos en --plano-x / --plano-y, igual que el
 * resto del sitio: el CSS decide cómo dibujarlos.
 */
(function () {
  const plano = document.getElementById('portada-plano');
  if (!plano) return;

  const visual = plano.closest('.portada__visual');
  if (!visual) return;

  const sinMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)');
  // En pantallas táctiles no hay cursor que seguir: el efecto no aplica
  // y enganchar listeners sería gasto puro.
  const punteroFino = window.matchMedia('(hover: hover) and (pointer: fine)');

  if (sinMovimiento.matches || !punteroFino.matches) return;

  /* Inclinación máxima en grados. 6° es el techo antes de que el panel
     empiece a verse deformado en vez de inclinado. */
  const MAX = 6;

  /* Cuánto se acerca por frame al valor objetivo (0 a 1). 0.09 da una
     estela suave: el plano persigue al cursor con un poco de inercia en
     vez de pegarse a él, que es lo que lo hace sentir físico. */
  const SEGUIMIENTO = 0.09;

  let objetivoX = 0;
  let objetivoY = 0;
  let actualX = 0;
  let actualY = 0;
  let dentroDeVista = true;

  /* Se guarda el ID del frame pendiente, no un booleano "estoy animando".
     Con un booleano queda un agujero: si un frame se agenda pero el
     navegador nunca lo entrega (pestaña en segundo plano, throttling),
     la bandera se queda en true para siempre y arrancar() no vuelve a
     agendar nada — el efecto muere hasta recargar la página.
     Con el ID se puede cancelar y reagendar sin depender de que el
     frame anterior haya llegado. */
  let frameEnCurso = 0;

  function alMoverElCursor(evento) {
    const caja = visual.getBoundingClientRect();
    if (caja.width === 0 || caja.height === 0) return;

    // Posición del cursor dentro del bloque, normalizada de -1 a 1.
    const nx = ((evento.clientX - caja.left) / caja.width) * 2 - 1;
    const ny = ((evento.clientY - caja.top) / caja.height) * 2 - 1;

    // Signo de rotateX invertido: con el cursor ARRIBA (ny negativo)
    // queremos rotateX positivo, que aleja el borde superior y deja el
    // de abajo más largo. Es la inclinación que se pidió.
    objetivoX = -ny * MAX;
    // rotateY directo: cursor a la derecha aleja el borde derecho.
    objetivoY = nx * MAX;

    arrancar();
  }

  function alSalirElCursor() {
    objetivoX = 0;
    objetivoY = 0;
    arrancar();
  }

  function frame() {
    frameEnCurso = 0;

    actualX += (objetivoX - actualX) * SEGUIMIENTO;
    actualY += (objetivoY - actualY) * SEGUIMIENTO;

    plano.style.setProperty('--plano-x', actualX.toFixed(3) + 'deg');
    plano.style.setProperty('--plano-y', actualY.toFixed(3) + 'deg');

    // Se corta el bucle cuando ya llegó: dejarlo girando en vacío
    // mantendría una capa compuesta viva sin motivo.
    const quieto =
      Math.abs(objetivoX - actualX) < 0.01 && Math.abs(objetivoY - actualY) < 0.01;

    if (quieto || !dentroDeVista) return;

    frameEnCurso = window.requestAnimationFrame(frame);
  }

  function arrancar() {
    if (!dentroDeVista) return;
    // Siempre se reagenda: si quedó un frame viejo sin entregar, se
    // cancela y se pide uno nuevo. Nunca queda más de uno pendiente.
    if (frameEnCurso) window.cancelAnimationFrame(frameEnCurso);
    frameEnCurso = window.requestAnimationFrame(frame);
  }

  // El cursor se sigue desde toda la ventana y no solo desde el bloque:
  // así el plano ya viene inclinado cuando el cursor llega, en vez de
  // pegar un salto al cruzar el borde.
  window.addEventListener('mousemove', alMoverElCursor, { passive: true });
  document.addEventListener('mouseleave', alSalirElCursor);

  // Fuera de viewport no se calcula nada.
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(
      (entradas) => {
        dentroDeVista = entradas[0].isIntersecting;
        if (dentroDeVista) arrancar();
      },
      { threshold: 0 }
    ).observe(visual);
  }
})();
