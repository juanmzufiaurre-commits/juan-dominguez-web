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

  /* Duración de la subida. Deliberadamente larga para lo que suele usarse
     en un contador, y el motivo son los números: 4 y 2 tienen muy pocos
     pasos intermedios. A 900ms el 4 se alcanzaba antes de la mitad del
     recorrido y el resto de la animación quedaba congelada en el valor
     final — se veía como si apareciera puesto, no sumando.
     Con 1800ms cada número queda a la vista unos 400ms, que es el mínimo
     para que el ojo lo registre como un paso. */
  const DURACION = 1800;

  /* Arranque escalonado entre un dato y el siguiente. Sin esto los dos
     contadores tictaquean al unísono y se lee como un solo bloque
     parpadeando en vez de dos datos independientes. */
  const ESCALONADO = 180;

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
   * Sube el número de 0 al destino con un frenado suave al final.
   *
   * @param {Element} elemento  el .dato__valor a animar
   * @param {number}  retraso   ms de espera antes de arrancar
   */
  function contar(elemento, retraso) {
    const destino = parseInt(elemento.dataset.contador, 10);
    if (!Number.isFinite(destino)) return;

    // Marca para la red de seguridad de más abajo
    elemento.dataset.contado = 'si';

    const prefijo = elemento.dataset.prefijo || '';
    const arranque = performance.now() + (retraso || 0);

    function frame(ahora) {
      const transcurrido = ahora - arranque;

      // Todavía en la espera del escalonado
      if (transcurrido < 0) {
        window.requestAnimationFrame(frame);
        return;
      }

      const t = Math.min(transcurrido / DURACION, 1);
      /* easeOutQuad y no easeOutCubic: la cúbica arranca demasiado rápido
         y se come los primeros números antes de que se lleguen a ver.
         La cuadrática reparte mejor los pocos pasos que hay. */
      const suave = 1 - Math.pow(1 - t, 2);
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
        // El retraso sale de la posición del dato en la fila, para que
        // arranquen de izquierda a derecha y no todos juntos.
        const indice = Array.prototype.indexOf.call(datos, entrada.target);
        contar(entrada.target, Math.max(indice, 0) * ESCALONADO);
      });
    },
    { threshold: 0.6 }
  );

  alSalirLaIntro(() => {
    datos.forEach((dato) => {
      // Recién acá se pone en 0: si se hiciera antes, el dato quedaría
      // en cero durante toda la intro.
      const prefijo = dato.dataset.prefijo || '';
      dato.textContent = prefijo + '0';
      observador.observe(dato);
    });

    /* RED DE SEGURIDAD.
       Poner el dato en 0 y esperar a que el observer lo anime tiene un
       riesgo: si por lo que sea el conteo nunca arranca, el número se
       queda en CERO, que no es un estado neutro sino un dato FALSO
       ("0 años importando"). Peor que no animar.
       Pasados unos segundos, cualquier dato que no haya empezado a
       contar recibe su valor real. Mismo criterio que el watchdog de la
       intro en index.html. */
    window.setTimeout(() => {
      datos.forEach((dato) => {
        if (dato.dataset.contado === 'si') return;
        dato.textContent = (dato.dataset.prefijo || '') + dato.dataset.contador;
      });
    }, 8000);
  });
})();


/**
 * PLANOS 3D CON PARALLAX POR CAPAS
 * ---------------------------------------------------------------
 * Inclina siguiendo el cursor cualquier elemento marcado con
 * [data-plano]. Hoy son dos: el de la portada (panel + recorte de Juan)
 * y el de "A qué me dedico" (panel + pila de consolas + Juan).
 *
 * El parallax entre capas NO se calcula acá: el CSS las pone a distinta
 * profundidad con translateZ y la perspectiva del contenedor hace el
 * resto. Inclinar el plano alcanza para que las capas de adelante se
 * desplacen más que las de atrás, que es exactamente lo que se busca.
 * Ver css/portada.css y css/rubro.css.
 *
 * El JS solo publica dos ángulos en --plano-x / --plano-y, igual que el
 * resto del sitio: el CSS decide cómo dibujarlos.
 *
 * Es genérico en vez de atado a un id porque son dos planos con la misma
 * mecánica: duplicar el bucle habría significado mantener el mismo
 * seguimiento, el mismo lerp y el mismo arreglo de frames en dos lados.
 */
(function () {
  const planos = document.querySelectorAll('[data-plano]');
  if (planos.length === 0) return;

  const sinMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)');
  // En pantallas táctiles no hay cursor que seguir: el efecto no aplica
  // y enganchar listeners sería gasto puro.
  const punteroFino = window.matchMedia('(hover: hover) and (pointer: fine)');

  if (sinMovimiento.matches || !punteroFino.matches) return;

  /* Inclinación máxima en grados. Bajado de 6° a 3,5°: a 6° el gesto se
     leía exagerado y competía con el contenido en vez de acompañarlo.
     3,5° sigue siendo perfectamente perceptible —el desplazamiento entre
     capas es proporcional al ángulo, así que el parallax se nota igual—
     pero el recuadro ya no parece bambolearse.
     Por debajo de ~2° el efecto se pierde; ese es el piso útil. */
  const MAX = 3.5;

  /* Cuánto se acerca por frame al valor objetivo (0 a 1). 0.09 da una
     estela suave: el plano persigue al cursor con un poco de inercia en
     vez de pegarse a él, que es lo que lo hace sentir físico. */
  const SEGUIMIENTO = 0.09;

  /**
   * Engancha un plano. Cada uno lleva su propio estado, así que dos
   * planos en la misma página no se pisan.
   *
   * @param {Element} plano  el elemento con [data-plano]
   */
  function engancharPlano(plano) {
    // El bloque que define la zona sensible al cursor: el padre que
    // tiene la perspectiva. Sin él no hay contra qué normalizar.
    const visual = plano.parentElement;
    if (!visual) return;

    let objetivoX = 0;
    let objetivoY = 0;
    let actualX = 0;
    let actualY = 0;
    let dentroDeVista = true;

    /* Se guarda el ID del frame pendiente, no un booleano "estoy
       animando". Con un booleano queda un agujero: si un frame se agenda
       pero el navegador nunca lo entrega (pestaña en segundo plano,
       throttling), la bandera se queda en true para siempre y arrancar()
       no vuelve a agendar nada — el efecto muere hasta recargar.
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
        Math.abs(objetivoX - actualX) < 0.01 &&
        Math.abs(objetivoY - actualY) < 0.01;

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
  }

  planos.forEach(engancharPlano);
})();
