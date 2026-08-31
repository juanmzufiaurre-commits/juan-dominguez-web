/**
 * INTRO-GLOBE.JS
 * ---------------------------------------------------------------
 * Intro animada en WebGL (Three.js, self-hosted en assets/js/vendor/)
 * con la coreografía de IMPORTACIÓN (no exportación): el viaje nace en
 * China, suma una escala en Paraguay, y ambos convergen en Argentina.
 *
 * Coreografía:
 *  Fase 1 — Cámara se acerca al globo centrado en China. Aparece el
 *           "puesto" de China: bandera clavada + caja de mercadería al
 *           lado. Texto: "Vos detectás la tendencia".
 *  Fase 2 — La caja se reemplaza (destello) por un avión que despega
 *           hacia arriba y vuela hacia Sudamérica. La cámara sigue al
 *           avión TODO el trayecto, sin cortes ni giros aparte.
 *           Texto: "Nosotros somos tu puente logístico".
 *  Fase 3 — Cuando el avión ya está sobre Sudamérica (y por lo tanto
 *           la cámara también), aparecen los puestos de Paraguay y
 *           Argentina. La caja paraguaya se vuelve un segundo avión.
 *  Fase 4 — Los dos aviones llegan a Argentina EXACTAMENTE juntos,
 *           desaparecen y se transforman en cajas apiladas. Todo se
 *           desvanece con el texto final: "Juntos construimos tu imperio."
 *  Fase 5 — Hold sobre el texto final y transición al Hero.
 *
 * Decisiones de implementación que importan (y por qué):
 *
 *  - ARCOS: se generan por interpolación ESFÉRICA (slerp) con un perfil
 *    de altura senoidal, NO con una curva Bézier entre los dos puntos.
 *    Una Bézier entre puntos casi antipodales (China ↔ Argentina) se
 *    hunde hasta radio ~0.78 (con el globo de radio 1), o sea que el
 *    avión se ve pasar POR ADENTRO del planeta. Con slerp el trayecto
 *    nunca baja de la superficie.
 *
 *  - SEGUIMIENTO: el globo se orienta con un cuaternión que lleva la
 *    posición actual del avión al frente de la cámara, construido con
 *    una base ortonormal que mantiene el norte hacia arriba. Se aplica
 *    durante TODO el vuelo, sin mezclarse con ninguna orientación fija:
 *    el globo frena solo porque el avión frena al llegar. (Rotar solo
 *    en el eje Y ignoraba la latitud y dejaba a Argentina fuera de
 *    cuadro, abajo de la pantalla.)
 *
 *  - BANDERAS: el mástil NO se planta a lo largo de la normal de la
 *    superficie. Si se hace así, cuando la cámara centra ese país la
 *    está mirando justo a lo largo del mástil y solo se ve la puntita.
 *    Acá el mástil se inclina hacia el "arriba de la pantalla", así la
 *    bandera siempre se lee de frente, y la tela encara a la cámara.
 *
 * Nota técnica: build UMD clásico de Three.js + continentes-data.js
 * cargados como <script> normales (no ES modules) para que la intro
 * funcione también abriendo index.html directo con doble clic
 * (file://) y no solo servido por http(s).
 */

(function () {
  if (typeof THREE === 'undefined') {
    return; // el watchdog inline de index.html se encarga de limpiar
  }

  window.__introGlobeReady = true;

  const overlay = document.getElementById('intro');
  const canvas = document.getElementById('intro-canvas');
  const skipBtn = document.getElementById('intro-skip');
  const relatoEl = document.getElementById('intro-relato');
  const finalEl = document.getElementById('intro-final');

  if (!overlay || !canvas) return;

  const prefersReducedMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)'
  ).matches;

  let finished = false;

  /* El navegador no debe reponer el scroll de la visita anterior.
     Con 'auto' (el valor por omisión), recargar después de haber
     scrolleado devuelve a esa posición... y como durante la intro el
     scroll está bloqueado, ese salto se ejecuta JUSTO al liberarse, o
     sea que la intro termina y el Hero ya quedó atrás. */
  try {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  } catch (err) {
    /* algunos navegadores lo bloquean en contextos raros; no es crítico */
  }

  /* Y se saca el hash de la URL apenas arranca la intro.
   *
   * ESTO EVITA EL SALTO, no lo corrige. Antes se corregía después, y en
   * el celular el resultado era visible: la página aterrizaba en la
   * sección del hash (#dedica, o sea "Rubro") y recién ahí se corregía
   * al Hero. Se veían las dos posiciones, una atrás de la otra.
   *
   * El hash lo dejan los links del nav y los botones del Hero — el CTA
   * principal apunta a #dedica, así que basta con que alguien lo toque
   * una vez y recargue para que todas las visitas siguientes arranquen
   * corridas. Sin hash en la URL, el navegador no tiene a dónde saltar.
   *
   * Se usa replaceState y no location.hash = '': asignar el hash mete
   * una entrada nueva en el historial y deja el botón "atrás" raro. */
  try {
    if (location.hash && window.history && history.replaceState) {
      history.replaceState(null, '', location.pathname + location.search);
    }
  } catch (err) {
    /* si falla, volverArriba() sigue estando como red de seguridad */
  }

  /* Y se sube al tope YA, antes de bloquear el scroll.
     Los scripts corren al final del <body>, así que para cuando este
     archivo se ejecuta el navegador puede haber saltado al hash hace
     rato. Si no se corrige acá, el bloqueo congela la página en esa
     posición y la intro entera transcurre "parada" sobre Rubro: al
     soltar el scroll, ya estás ahí. */
  volverArriba();

  /**
   * Deja la página arriba de todo, sin animar el recorrido.
   *
   * Se llama al soltar el bloqueo de scroll, y resuelve dos saltos que
   * si no se comen el Hero entero:
   *   1. El hash de la URL. Los links del nav y los botones del Hero
   *      dejan #dedica, #testimonios, etc. Con un hash puesto, al
   *      recargar el navegador salta a esa sección apenas el documento
   *      se lo permite — que es exactamente el instante en que la intro
   *      libera el scroll.
   *   2. La reposición de scroll del navegador (ver arriba).
   *
   * scroll-behavior: smooth está puesto en css/base.css, así que se
   * apaga un momento: si no, el "salto" al tope se ve como un viaje
   * animado por todas las secciones.
   */
  function volverArriba() {
    const raiz = document.documentElement;
    const comportamiento = raiz.style.scrollBehavior;
    raiz.style.scrollBehavior = 'auto';
    window.scrollTo(0, 0);
    raiz.style.scrollBehavior = comportamiento;
  }

  /**
   * Cierre de la intro.
   *
   * El remate NO es un fundido: es un EMPUJE. La escena entera de la
   * intro (globo, cajas y texto) se desliza una pantalla hacia arriba
   * mientras el Hero sube desde una pantalla abajo, los dos a la misma
   * velocidad. Se lee como si el Hero corriera a la intro fuera de
   * cuadro. Toda la coreografía vive en css/intro.css; acá solo se
   * prenden y apagan las clases.
   *
   * OJO con el orden: .intro-lock se saca al TERMINAR, no al empezar.
   * Es esa clase la que mantiene al Hero esperando abajo (y el scroll
   * bloqueado); si se sacara antes, el Hero pegaría un salto a su lugar
   * en vez de subir.
   */
  function finishIntro(instant) {
    if (finished) return;
    finished = true;
    window.removeEventListener('resize', sincronizarTamaño);
    document.removeEventListener('visibilitychange', sincronizarTamaño);

    let limpiado = false;
    const limpiar = () => {
      if (limpiado) return;
      limpiado = true;
      overlay.remove();
      document.body.classList.remove('intro-lock', 'intro-empuje');

      // Recién ahora el documento vuelve a ser scrolleable, así que este
      // es el momento en que el navegador aplicaría el salto al hash o
      // la posición repuesta. Se lo gana de mano.
      volverArriba();
      // Segunda pasada en el frame siguiente: el salto del hash puede
      // llegar después del desbloqueo, no en el mismo tick.
      window.requestAnimationFrame(volverArriba);
    };

    if (instant) {
      overlay.style.transition = 'none';
      limpiar();
      return;
    }

    // .intro--saliendo ya no dibuja nada (el movimiento lo maneja
    // .intro-empuje sobre el body), pero SE SIGUE PONIENDO porque es la
    // señal que esperan js/fondos.js y js/portada.js para arrancar el
    // revelado del Hero y los contadores. Si se saca, esos dos módulos
    // se quedan esperando para siempre.
    overlay.classList.add('intro--saliendo');
    document.body.classList.add('intro-empuje');

    // El evento se filtra por elemento Y por propiedad, y no alcanza con
    // { once: true }.
    //
    // transitionend BURBUJEA: el botón "Saltar intro" tiene su propia
    // transición de 200ms, y al terminar disparaba la limpieza antes de
    // que el empuje llegara a arrancar — la intro desaparecía de golpe
    // en vez de deslizarse. Solo cuenta el transform del overlay mismo.
    overlay.addEventListener('transitionend', (evento) => {
      if (evento.target !== overlay || evento.propertyName !== 'transform') return;
      limpiar();
    });

    // Respaldo por si el transform nunca dispara (pestaña en segundo
    // plano al momento del cierre, por ejemplo).
    setTimeout(limpiar, 1600);
  }

  if (prefersReducedMotion) {
    finishIntro(true);
    return;
  }

  skipBtn.addEventListener('click', () => finishIntro(false));
  document.body.classList.add('intro-lock');

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'low-power',
    });
  } catch (err) {
    finishIntro(true);
    return;
  }

  const css = getComputedStyle(document.documentElement);
  const leerColor = (variable, fallback) => {
    const valor = css.getPropertyValue(variable).trim();
    try {
      return new THREE.Color(valor || fallback);
    } catch (err) {
      return new THREE.Color(fallback);
    }
  };

  const colorBase900 = leerColor('--color-base-900', '#070B14');
  const colorBase700 = leerColor('--color-base-700', '#131D33');
  const colorAcento = leerColor('--color-acento', '#D9A73C');
  const colorTextoClaro = leerColor('--color-texto-claro', '#F2F4F8');

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(colorBase900, 1);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(colorBase900.getHex(), 0.05);

  const camera = new THREE.PerspectiveCamera(
    50,
    window.innerWidth / window.innerHeight,
    0.01,
    100
  );

  // --- Luces ---
  scene.add(new THREE.AmbientLight(colorBase700, 1.1));
  const keyLight = new THREE.DirectionalLight(colorTextoClaro, 1.2);
  keyLight.position.set(1.5, 2.5, 3);
  scene.add(keyLight);
  const rimLight = new THREE.PointLight(colorAcento, 1.3, 8);
  rimLight.position.set(1.5, 1.5, 2);
  scene.add(rimLight);
  const INTENSIDAD_BASE_RIM = 1.3;

  // --- Estrellas de fondo ---
  const ESTRELLAS_CANTIDAD = 400;
  const estrellasPos = new Float32Array(ESTRELLAS_CANTIDAD * 3);
  for (let i = 0; i < ESTRELLAS_CANTIDAD; i++) {
    const r = 12 + Math.random() * 18;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    estrellasPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    estrellasPos[i * 3 + 1] = r * Math.cos(phi);
    estrellasPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  const estrellasGeom = new THREE.BufferGeometry();
  estrellasGeom.setAttribute('position', new THREE.BufferAttribute(estrellasPos, 3));
  scene.add(
    new THREE.Points(
      estrellasGeom,
      new THREE.PointsMaterial({
        color: colorTextoClaro,
        size: 0.035,
        transparent: true,
        opacity: 0.35,
        sizeAttenuation: true,
      })
    )
  );

  // --- Globo ---
  const RADIO_GLOBO = 1;
  const globoGroup = new THREE.Group();
  scene.add(globoGroup);

  globoGroup.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(RADIO_GLOBO * 0.99, 48, 32),
      new THREE.MeshBasicMaterial({ color: colorBase900, transparent: true, opacity: 0.75 })
    )
  );
  globoGroup.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(RADIO_GLOBO, 24, 16),
      new THREE.MeshBasicMaterial({
        color: colorTextoClaro,
        wireframe: true,
        transparent: true,
        opacity: 0.1,
      })
    )
  );

  function latLonAVec3(lat, lon, radio) {
    const phi = ((90 - lat) * Math.PI) / 180;
    const theta = ((lon + 180) * Math.PI) / 180;
    return new THREE.Vector3(
      -radio * Math.sin(phi) * Math.cos(theta),
      radio * Math.cos(phi),
      radio * Math.sin(phi) * Math.sin(theta)
    );
  }

  // --- Continentes reales (silueta de costas) ---
  if (Array.isArray(window.CONTINENTES_DATA)) {
    const segmentosPos = [];
    window.CONTINENTES_DATA.forEach((anillo) => {
      for (let i = 0; i < anillo.length; i++) {
        const [lonA, latA] = anillo[i];
        const [lonB, latB] = anillo[(i + 1) % anillo.length];
        const a = latLonAVec3(latA, lonA, RADIO_GLOBO * 1.002);
        const b = latLonAVec3(latB, lonB, RADIO_GLOBO * 1.002);
        segmentosPos.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    });
    const continentesGeom = new THREE.BufferGeometry();
    continentesGeom.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(segmentosPos, 3)
    );
    globoGroup.add(
      new THREE.LineSegments(
        continentesGeom,
        new THREE.LineBasicMaterial({
          color: colorTextoClaro,
          transparent: true,
          opacity: 0.55,
        })
      )
    );
  }

  // =====================================================================
  // CAJA — modelo 3D de caja de cartón siguiendo la referencia del
  // cliente: cuerpo, junta de solapas en la tapa, cinta de embalar que
  // cruza arriba y cae por un lateral, y los pictogramas de manejo
  // (flechas / paraguas / copa) aplicados como calco en la cara frontal.
  // =====================================================================

  // Cartón deliberadamente oscuro, tipo kraft con poca luz. Con los
  // tonos claros de antes las cajas salían casi blancas y el texto
  // final quedaba ilegible encima: medido, 1.03:1 de contraste en el
  // peor caso, o sea texto blanco sobre blanco.
  const CARTON = '#B98A6B';
  const CARTON_TAPA = '#C9A184';
  const CINTA = '#C4B7A8';
  // El papel de la etiqueta de envío sí es claro (lo es en la realidad),
  // pero apagado para que no se vuelva un punto de fuga de brillo.
  const PAPEL_ETIQUETA = '#E8E2D8';

  // Calco de pictogramas: fondo transparente, se aplica sobre la cara
  // frontal de la caja (no es la caja en sí, solo las etiquetas).
  let _texturaEtiquetas = null;
  function texturaEtiquetas() {
    if (_texturaEtiquetas) return _texturaEtiquetas;

    const W = 384;
    const H = 128;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    const TINTA = '#1A1A1A';

    const glifos = [
      // 1) Flechas "este lado arriba"
      (g, cx, cy, s) => {
        g.strokeStyle = TINTA;
        g.lineWidth = s * 0.1;
        g.lineCap = 'round';
        g.lineJoin = 'round';
        [-1, 1].forEach((lado) => {
          const x = cx + lado * s * 0.17;
          g.beginPath();
          g.moveTo(x, cy + s * 0.18);
          g.lineTo(x, cy - s * 0.26);
          g.stroke();
          g.beginPath();
          g.moveTo(x - s * 0.13, cy - s * 0.1);
          g.lineTo(x, cy - s * 0.28);
          g.lineTo(x + s * 0.13, cy - s * 0.1);
          g.stroke();
        });
        g.beginPath();
        g.moveTo(cx - s * 0.34, cy + s * 0.3);
        g.lineTo(cx + s * 0.34, cy + s * 0.3);
        g.stroke();
      },
      // 2) Paraguas "proteger de la humedad"
      (g, cx, cy, s) => {
        g.fillStyle = TINTA;
        g.beginPath();
        g.arc(cx, cy, s * 0.33, Math.PI, 0);
        g.closePath();
        g.fill();
        g.strokeStyle = TINTA;
        g.lineWidth = s * 0.1;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(cx, cy);
        g.lineTo(cx, cy + s * 0.33);
        g.stroke();
      },
      // 3) Copa "frágil"
      (g, cx, cy, s) => {
        g.fillStyle = TINTA;
        g.beginPath();
        g.moveTo(cx - s * 0.3, cy - s * 0.3);
        g.lineTo(cx + s * 0.3, cy - s * 0.3);
        g.lineTo(cx, cy + s * 0.05);
        g.closePath();
        g.fill();
        g.strokeStyle = TINTA;
        g.lineWidth = s * 0.1;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(cx, cy + s * 0.05);
        g.lineTo(cx, cy + s * 0.24);
        g.stroke();
        g.beginPath();
        g.moveTo(cx - s * 0.22, cy + s * 0.3);
        g.lineTo(cx + s * 0.22, cy + s * 0.3);
        g.stroke();
      },
    ];

    const lado = 108;
    const separacion = 12;
    const anchoTotal = lado * 3 + separacion * 2;
    let x = (W - anchoTotal) / 2;
    const y = (H - lado) / 2;
    glifos.forEach((dibujar) => {
      ctx.fillStyle = '#C9A184';
      ctx.fillRect(x, y, lado, lado);
      dibujar(ctx, x + lado / 2, y + lado / 2, lado * 0.62);
      x += lado + separacion;
    });

    _texturaEtiquetas = new THREE.CanvasTexture(c);
    _texturaEtiquetas.needsUpdate = true;
    return _texturaEtiquetas;
  }

  // ---------------------------------------------------------------
  // ETIQUETA DE ENVÍO — el papel blanco pegado con código de barras,
  // QR y renglones de dirección. Es lo que más "lee" como paquete real.
  // Se generan varias variantes para que no se repita la misma calcomanía
  // en todas las cajas del racimo.
  // ---------------------------------------------------------------

  const _etiquetasEnvio = [];

  function texturaEtiquetaEnvio(variante) {
    if (_etiquetasEnvio[variante]) return _etiquetasEnvio[variante];

    const W = 256;
    const H = 160;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');

    // Papel
    g.fillStyle = PAPEL_ETIQUETA;
    g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(26,26,26,0.25)';
    g.lineWidth = 2;
    g.strokeRect(1, 1, W - 2, H - 2);

    // Generador pseudoaleatorio con semilla: cada variante sale distinta
    // pero SIEMPRE igual entre recargas. Con Math.random() la etiqueta
    // cambiaría en cada visita, que no es lo que se quiere de un envase.
    let semilla = 9973 + variante * 613;
    const azar = () => {
      semilla = (semilla * 1103515245 + 12345) & 0x7fffffff;
      return semilla / 0x7fffffff;
    };

    if (variante % 2 === 0) {
      // --- Variante con QR ---
      const q = 74;
      const qx = W - q - 14;
      const qy = 14;
      g.fillStyle = '#FFFFFF';
      g.fillRect(qx, qy, q, q);
      g.fillStyle = '#1A1A1A';
      const celdas = 11;
      const cel = q / celdas;
      for (let i = 0; i < celdas; i++) {
        for (let j = 0; j < celdas; j++) {
          if (azar() > 0.5) g.fillRect(qx + i * cel, qy + j * cel, cel, cel);
        }
      }
      // Los tres cuadrados de referencia que tiene todo QR
      [[0, 0], [celdas - 3, 0], [0, celdas - 3]].forEach(([i, j]) => {
        g.fillStyle = '#FFFFFF';
        g.fillRect(qx + i * cel, qy + j * cel, cel * 3, cel * 3);
        g.fillStyle = '#1A1A1A';
        g.fillRect(qx + i * cel, qy + j * cel, cel * 3, cel * 0.6);
        g.fillRect(qx + i * cel, qy + (j + 2.4) * cel, cel * 3, cel * 0.6);
        g.fillRect(qx + i * cel, qy + j * cel, cel * 0.6, cel * 3);
        g.fillRect(qx + (i + 2.4) * cel, qy + j * cel, cel * 0.6, cel * 3);
        g.fillRect(qx + (i + 1.1) * cel, qy + (j + 1.1) * cel, cel * 0.8, cel * 0.8);
      });
    } else {
      // --- Variante con código de barras ---
      let bx = W - 100;
      g.fillStyle = '#1A1A1A';
      while (bx < W - 16) {
        const ancho = 2 + Math.floor(azar() * 5);
        if (azar() > 0.35) g.fillRect(bx, 16, ancho, 62);
        bx += ancho + 2;
      }
    }

    // Renglones de dirección: barras grises, no texto real. A este tamaño
    // en pantalla ninguna letra sería legible, y dibujar texto de verdad
    // solo agregaría peso al canvas.
    g.fillStyle = 'rgba(26,26,26,0.72)';
    g.fillRect(14, 18, 62, 9);
    g.fillStyle = 'rgba(26,26,26,0.34)';
    [40, 56, 72].forEach((y, i) => {
      g.fillRect(14, y, 108 - i * 22, 6);
    });

    // Franja inferior con el "número de seguimiento"
    g.fillStyle = '#1A1A1A';
    g.fillRect(0, H - 42, W, 42);
    g.fillStyle = PAPEL_ETIQUETA;
    let sx = 14;
    while (sx < W - 20) {
      const ancho = 2 + Math.floor(azar() * 4);
      if (azar() > 0.3) g.fillRect(sx, H - 32, ancho, 22);
      sx += ancho + 3;
    }

    const tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    _etiquetasEnvio[variante] = tex;
    return tex;
  }

  const CAJA_ANCHO = 0.062;
  const CAJA_ALTO = 0.05;
  const CAJA_PROF = 0.056;

  // Proporciones por tipo de bulto. La mayoría son "normal" a propósito:
  // un racimo con demasiadas formas raras deja de leerse como mercadería
  // y empieza a parecer un rompecabezas.
  const FORMAS_CAJA = {
    normal: { w: 1, h: 1, p: 1 },
    chica: { w: 0.62, h: 0.66, p: 0.62 },
    alargada: { w: 1.55, h: 0.62, p: 0.72 },
    alta: { w: 0.78, h: 1.42, p: 0.78 },
    plana: { w: 1.2, h: 0.42, p: 1.05 },
  };

  /**
   * @param {number} escala   tamaño general del bulto
   * @param {string} forma    clave de FORMAS_CAJA
   * @param {number} variante semilla de etiquetas (0..3); cada una da una
   *                          calcomanía distinta para que no se repitan
   */
  function crearCajaMesh(escala, forma, variante) {
    const grupo = new THREE.Group();
    const k = escala || 1;
    const prop = FORMAS_CAJA[forma] || FORMAS_CAJA.normal;
    const v = variante || 0;

    const matCarton = new THREE.MeshStandardMaterial({
      color: CARTON,
      roughness: 0.95,
      metalness: 0,
    });
    const matTapa = new THREE.MeshStandardMaterial({
      color: CARTON_TAPA,
      roughness: 0.95,
      metalness: 0,
    });
    const matCinta = new THREE.MeshStandardMaterial({
      color: CINTA,
      roughness: 0.6,
      metalness: 0,
    });

    const w = CAJA_ANCHO * k * prop.w;
    const h = CAJA_ALTO * k * prop.h;
    const p = CAJA_PROF * k * prop.p;

    // Cuerpo
    const cuerpo = new THREE.Mesh(new THREE.BoxGeometry(w, h, p), matCarton);
    grupo.add(cuerpo);

    // Tapa (un poco más clara, como en la referencia)
    const tapa = new THREE.Mesh(new THREE.BoxGeometry(w, h * 0.06, p), matTapa);
    tapa.position.y = h / 2;
    grupo.add(tapa);

    // Cinta cruzando la tapa y cayendo por el lateral derecho
    const cintaTapa = new THREE.Mesh(
      new THREE.BoxGeometry(w * 1.02, h * 0.05, p * 0.26),
      matCinta
    );
    cintaTapa.position.y = h / 2 + h * 0.04;
    grupo.add(cintaTapa);

    const cintaLado = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.04, h * 0.5, p * 0.26),
      matCinta
    );
    cintaLado.position.set(w / 2 + w * 0.015, h * 0.22, 0);
    grupo.add(cintaLado);

    // Segunda cinta, perpendicular, cayendo por el frente. No la llevan
    // todas: si todas las cajas tuvieran el mismo cruzado, el racimo se
    // vería estampado en serie.
    if (v % 2 === 0) {
      const cintaFrente = new THREE.Mesh(
        new THREE.BoxGeometry(w * 0.13, h * 0.04, p * 1.02),
        matCinta
      );
      cintaFrente.position.set(-w * 0.18, h / 2 + h * 0.035, 0);
      grupo.add(cintaFrente);
    }

    // Calco de pictogramas (flechas / paraguas / copa) en la cara frontal
    const etiquetas = new THREE.Mesh(
      new THREE.PlaneGeometry(w * 0.62, h * 0.21),
      new THREE.MeshBasicMaterial({
        map: texturaEtiquetas(),
        transparent: true,
        depthWrite: false,
      })
    );
    etiquetas.position.set(0, -h * 0.24, p / 2 + 0.0004 * k);
    grupo.add(etiquetas);

    // Etiqueta de envío con QR o código de barras, en la cara superior.
    // Va arriba y no al frente porque es donde se pega en la vida real y
    // porque desde la cámara del remate las tapas quedan bien a la vista.
    const etiquetaEnvio = new THREE.Mesh(
      new THREE.PlaneGeometry(w * 0.46, p * 0.42),
      new THREE.MeshBasicMaterial({
        map: texturaEtiquetaEnvio(v % 4),
        transparent: true,
        depthWrite: false,
      })
    );
    etiquetaEnvio.rotation.x = -Math.PI / 2;
    etiquetaEnvio.position.set(w * 0.14, h / 2 + h * 0.035 + 0.0006 * k, p * 0.12);
    grupo.add(etiquetaEnvio);

    // Una de cada tres lleva además un sello redondo en el lateral
    if (v % 3 === 0) {
      const sello = new THREE.Mesh(
        new THREE.CircleGeometry(Math.min(w, h) * 0.12, 12),
        new THREE.MeshBasicMaterial({
          color: CINTA,
          transparent: true,
          opacity: 0.75,
          depthWrite: false,
        })
      );
      sello.rotation.y = Math.PI / 2;
      sello.position.set(w / 2 + 0.0005 * k, h * 0.12, 0);
      grupo.add(sello);
    }

    return grupo;
  }

  // =====================================================================
  // BANDERAS — modelo 3D (base + mástil + remate + tela con onda).
  // La orientación se recalcula por frame en actualizarPuesto().
  // =====================================================================

  function dibujarEstrella(ctx, cx, cy, r) {
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const ang = -Math.PI / 2 + i * ((Math.PI * 2) / 5);
      const angIn = ang + Math.PI / 5;
      ctx.lineTo(cx + r * Math.cos(ang), cy + r * Math.sin(ang));
      ctx.lineTo(cx + r * 0.42 * Math.cos(angIn), cy + r * 0.42 * Math.sin(angIn));
    }
    ctx.closePath();
    ctx.fill();
  }

  const DIBUJOS_BANDERA = {
    argentina(ctx, w, h) {
      const f = h / 3;
      ctx.fillStyle = '#75AADB';
      ctx.fillRect(0, 0, w, f);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, f, w, f);
      ctx.fillStyle = '#75AADB';
      ctx.fillRect(0, f * 2, w, f);
      ctx.fillStyle = '#F6B40E';
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, h * 0.15, 0, Math.PI * 2);
      ctx.fill();
    },
    paraguay(ctx, w, h) {
      const f = h / 3;
      ctx.fillStyle = '#D52B1E';
      ctx.fillRect(0, 0, w, f);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, f, w, f);
      ctx.fillStyle = '#0038A8';
      ctx.fillRect(0, f * 2, w, f);
      ctx.strokeStyle = '#0038A8';
      ctx.lineWidth = Math.max(1, h * 0.035);
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, h * 0.12, 0, Math.PI * 2);
      ctx.stroke();
    },
    china(ctx, w, h) {
      ctx.fillStyle = '#DE2910';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#FFDE00';
      dibujarEstrella(ctx, w * 0.2, h * 0.28, h * 0.19);
      dibujarEstrella(ctx, w * 0.38, h * 0.11, h * 0.065);
      dibujarEstrella(ctx, w * 0.46, h * 0.25, h * 0.065);
      dibujarEstrella(ctx, w * 0.44, h * 0.41, h * 0.065);
      dibujarEstrella(ctx, w * 0.33, h * 0.5, h * 0.065);
    },
  };

  function crearTexturaBandera(pais) {
    const w = 128;
    const h = 86;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    (DIBUJOS_BANDERA[pais] || DIBUJOS_BANDERA.argentina)(ctx, w, h);
    const tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
  }

  const ALTO_MASTIL = 0.125;
  const ANCHO_TELA = 0.082;
  const ALTO_TELA = 0.055;

  function crearBandera(pais) {
    const grupo = new THREE.Group();

    const matMetal = new THREE.MeshStandardMaterial({
      color: colorTextoClaro,
      roughness: 0.4,
      metalness: 0.4,
    });

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.009, 0.012, 0.007, 12),
      matMetal
    );
    base.position.y = 0.0035;
    grupo.add(base);

    const mastil = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0025, 0.0025, ALTO_MASTIL, 8),
      matMetal
    );
    mastil.position.y = ALTO_MASTIL / 2;
    grupo.add(mastil);

    const remate = new THREE.Mesh(new THREE.SphereGeometry(0.005, 10, 8), matMetal);
    remate.position.y = ALTO_MASTIL + 0.003;
    grupo.add(remate);

    // Tela: plano segmentado con onda fija (volumen real, doble cara)
    const telaGeom = new THREE.PlaneGeometry(ANCHO_TELA, ALTO_TELA, 14, 5);
    const posAttr = telaGeom.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const u = (x + ANCHO_TELA / 2) / ANCHO_TELA;
      posAttr.setZ(i, Math.sin(u * Math.PI * 1.8) * 0.009 * u);
    }
    telaGeom.computeVertexNormals();

    const tela = new THREE.Mesh(
      telaGeom,
      new THREE.MeshStandardMaterial({
        map: crearTexturaBandera(pais),
        roughness: 0.85,
        metalness: 0,
        side: THREE.DoubleSide,
      })
    );
    tela.position.set(
      ANCHO_TELA / 2 + 0.003,
      ALTO_MASTIL - ALTO_TELA / 2 - 0.006,
      0
    );
    grupo.add(tela);

    grupo.scale.setScalar(0.001);
    grupo.visible = false;
    globoGroup.add(grupo);
    return grupo;
  }

  // =====================================================================
  // PUESTO — bandera clavada sobre el país.
  // Posición y orientación se recalculan por frame según dónde esté la
  // cámara, para que la bandera nunca se vea "de punta".
  //
  // La bandera va EXACTAMENTE sobre el punto del país, sin desplazamiento
  // lateral. Antes se corría 0.085 hacia un lado para dejarle lugar a una
  // caja de mercadería que la acompañaba, y eso tenía un efecto no
  // buscado: los arcos de vuelo nacen y mueren en el centro del país, así
  // que los aviones despegaban y aterrizaban visiblemente al costado de
  // la bandera. Sacada la caja, la bandera vuelve al centro y los aviones
  // salen y llegan justo sobre ella.
  // =====================================================================

  const INCLINACION_MASTIL = THREE.MathUtils.degToRad(52);

  function crearPuesto(pais, posSuperficie) {
    return {
      pais,
      base: posSuperficie.clone().normalize(),
      bandera: crearBandera(pais),
    };
  }

  const _camLocal = new THREE.Vector3();
  const _arribaLocal = new THREE.Vector3();
  const _normal = new THREE.Vector3();
  const _haciaCam = new THREE.Vector3();
  const _tangenteArriba = new THREE.Vector3();
  const _dirMastil = new THREE.Vector3();
  const _ejeX2 = new THREE.Vector3();
  const _ejeZ2 = new THREE.Vector3();
  const _matPuesto = new THREE.Matrix4();
  const _posTmp = new THREE.Vector3();
  function actualizarPuesto(puesto) {
    if (!puesto.bandera.visible) return;

    // Cámara y "arriba de pantalla", pasados al espacio local del globo
    _camLocal.copy(camera.position);
    globoGroup.worldToLocal(_camLocal);
    _arribaLocal.set(0, 1, 0).applyQuaternion(globoGroup.quaternion.clone().invert());

    _normal.copy(puesto.base);
    _haciaCam.subVectors(_camLocal, _normal).normalize();

    // Componente de "arriba de pantalla" sobre el plano del suelo
    _tangenteArriba
      .copy(_arribaLocal)
      .addScaledVector(_normal, -_arribaLocal.dot(_normal));
    if (_tangenteArriba.lengthSq() < 1e-8) _tangenteArriba.set(0, 0, 1);
    _tangenteArriba.normalize();

    // Mástil inclinado hacia el arriba de pantalla: si se plantara a lo
    // largo de la normal, con el país centrado la cámara lo miraría de
    // punta y solo se vería el remate.
    _dirMastil
      .copy(_normal)
      .multiplyScalar(Math.cos(INCLINACION_MASTIL))
      .addScaledVector(_tangenteArriba, Math.sin(INCLINACION_MASTIL))
      .normalize();

    // Base ortonormal de la bandera: Y = mástil, Z = hacia la cámara
    _ejeZ2.copy(_haciaCam).addScaledVector(_dirMastil, -_haciaCam.dot(_dirMastil));
    if (_ejeZ2.lengthSq() < 1e-8) _ejeZ2.copy(_tangenteArriba);
    _ejeZ2.normalize();
    _ejeX2.crossVectors(_dirMastil, _ejeZ2).normalize();
    _matPuesto.makeBasis(_ejeX2, _dirMastil, _ejeZ2);
    puesto.bandera.quaternion.setFromRotationMatrix(_matPuesto);

    // La bandera va clavada JUSTO sobre el punto del país, que es donde
    // nacen y mueren los arcos de vuelo. Ver la nota en crearPuesto().
    _posTmp.copy(_normal).multiplyScalar(RADIO_GLOBO);
    puesto.bandera.position.copy(_posTmp);
  }

  // =====================================================================
  // AVIÓN COMERCIAL — silueta de fuselaje ancho tipo 747.
  // =====================================================================
  //
  // ORIENTACIÓN: el morro apunta a -Z y la cola a +Z. No es arbitrario:
  // actualizarAvion() orienta con Matrix4.lookAt(posición, puntoAdelante),
  // que deja el +Z del objeto mirando hacia ATRÁS del recorrido. Si se
  // invierte, los aviones vuelan de cola.
  //
  // Todo se arma con primitivas de Three.js en vez de cargar un modelo
  // .gltf: un modelo externo obligaría a sumar un loader y un archivo
  // más, y el sitio dejaría de abrirse con doble clic sobre index.html
  // (file:// bloquea ese fetch). Ver la nota sobre el build UMD de
  // Three.js en index.html.
  //
  // La escala del grupo la maneja actualizarAvion(); acá solo importan
  // las proporciones relativas.

  /**
   * Ala en flecha y con estrechamiento, simétrica respecto del eje.
   * Se dibuja la planta como un contorno cerrado y se extruye para darle
   * espesor. Con BoxGeometry no se puede: una caja no tiene flecha, y esa
   * diagonal del borde de ataque es justamente lo que hace que se lea
   * como un avión de línea y no como una cruz.
   *
   * @param {number} semi     media envergadura (de la panza a la punta)
   * @param {number} cuerdaRaiz  largo del ala pegada al fuselaje
   * @param {number} cuerdaPunta largo del ala en la punta
   * @param {number} flecha   cuánto se atrasa la punta respecto de la raíz
   * @param {number} espesor  grosor del perfil
   */
  function crearAla(semi, cuerdaRaiz, cuerdaPunta, flecha, espesor) {
    const forma = new THREE.Shape();
    const raizFrente = -cuerdaRaiz / 2;
    const raizAtras = cuerdaRaiz / 2;
    const puntaFrente = raizFrente + flecha;
    const puntaAtras = puntaFrente + cuerdaPunta;

    // Contorno recorrido en orden: punta izquierda → raíz → punta derecha
    // por el borde de ataque, y de vuelta por el borde de fuga.
    forma.moveTo(-semi, puntaFrente);
    forma.lineTo(0, raizFrente);
    forma.lineTo(semi, puntaFrente);
    forma.lineTo(semi, puntaAtras);
    forma.lineTo(0, raizAtras);
    forma.lineTo(-semi, puntaAtras);
    forma.closePath();

    const geo = new THREE.ExtrudeGeometry(forma, {
      depth: espesor,
      bevelEnabled: false,
      curveSegments: 1,
    });
    // La forma nace en el plano XY extruida hacia +Z. Rotando 90° sobre X
    // queda: X = envergadura, Z = cuerda, Y = espesor, que es como vuela.
    geo.translate(0, 0, -espesor / 2);
    geo.rotateX(Math.PI / 2);
    return geo;
  }

  function crearAvion() {
    const grupo = new THREE.Group();

    const matCuerpo = new THREE.MeshStandardMaterial({
      color: colorTextoClaro,
      roughness: 0.42,
      metalness: 0.25,
    });
    const matCola = new THREE.MeshStandardMaterial({
      color: colorAcento,
      roughness: 0.5,
      metalness: 0.05,
    });
    // Motores y ventanas en un tono apagado: dan lectura de volumen sin
    // competir con el blanco del fuselaje.
    const matOscuro = new THREE.MeshStandardMaterial({
      color: colorBase700,
      roughness: 0.6,
      metalness: 0.3,
    });

    const LARGO = 0.058;
    const RADIO = 0.0046;

    // --- Fuselaje ---
    const fuselaje = new THREE.Mesh(
      new THREE.CylinderGeometry(RADIO, RADIO, LARGO * 0.74, 12),
      matCuerpo
    );
    fuselaje.rotation.x = Math.PI / 2;
    grupo.add(fuselaje);

    // Morro: romo, no en punta. Un 747 tiene la nariz redondeada; en
    // punta se lee como jet ejecutivo o caza.
    const morro = new THREE.Mesh(
      new THREE.CylinderGeometry(RADIO * 0.62, RADIO, LARGO * 0.13, 12),
      matCuerpo
    );
    morro.rotation.x = -Math.PI / 2;
    morro.position.z = -(LARGO * 0.435);
    grupo.add(morro);

    // Casquete que cierra la nariz
    const puntaMorro = new THREE.Mesh(
      new THREE.SphereGeometry(RADIO * 0.62, 12, 8),
      matCuerpo
    );
    puntaMorro.scale.z = 0.8;
    puntaMorro.position.z = -(LARGO * 0.5);
    grupo.add(puntaMorro);

    // Cola: el fuselaje se afina y se levanta, como en los de línea
    const conoCola = new THREE.Mesh(
      new THREE.CylinderGeometry(RADIO * 0.18, RADIO, LARGO * 0.28, 12),
      matCuerpo
    );
    conoCola.rotation.x = Math.PI / 2;
    conoCola.position.set(0, RADIO * 0.42, LARGO * 0.5);
    grupo.add(conoCola);

    // --- Joroba del 747 ---
    // Es LA seña del modelo: la cubierta superior detrás de la cabina.
    // Sin esto podría ser cualquier avión.
    // Se achata en Y y se estira en Z para que se funda con el lomo del
    // fuselaje. Un cilindro sin achatar sobresale como un bulto pegado.
    const joroba = new THREE.Mesh(
      new THREE.CylinderGeometry(RADIO * 0.66, RADIO * 0.66, LARGO * 0.26, 12),
      matCuerpo
    );
    joroba.rotation.x = Math.PI / 2;
    joroba.scale.y = 0.62;
    joroba.position.set(0, RADIO * 0.52, -(LARGO * 0.2));
    grupo.add(joroba);

    // Frente de la joroba redondeado: es la cabina del piso superior
    const frenteJoroba = new THREE.Mesh(
      new THREE.SphereGeometry(RADIO * 0.66, 12, 8),
      matCuerpo
    );
    frenteJoroba.scale.set(1, 0.62, 1.1);
    frenteJoroba.position.set(0, RADIO * 0.52, -(LARGO * 0.33));
    grupo.add(frenteJoroba);

    // --- Alas principales ---
    const alas = new THREE.Mesh(
      crearAla(0.039, 0.019, 0.007, 0.013, 0.0016),
      matCuerpo
    );
    alas.position.set(0, -RADIO * 0.3, 0.003);
    // Diedro: las puntas apenas más arriba que la raíz. Un ala
    // perfectamente plana se ve de juguete.
    alas.rotation.z = 0;
    grupo.add(alas);

    // --- Motores: cuatro, dos por ala ---
    //
    // La Z de cada motor NO es al ojo: sigue el borde de ataque del ala.
    // Como el ala va en flecha, cuanto más afuera está la estación, más
    // atrás cae su borde de ataque. Poner los externos adelante (que fue
    // el primer intento) los deja desalineados con el ala.
    //
    // Geometría del ala, en coordenadas del grupo:
    //   raíz  → z = -0.0065      punta → z = +0.0065
    const ALA_LE_RAIZ = -0.0065;
    const ALA_LE_PUNTA = 0.0065;
    const SEMI = 0.039;
    const LARGO_MOTOR = LARGO * 0.13;
    const RADIO_MOTOR = RADIO * 0.42;
    const Y_ALA_ABAJO = -RADIO * 0.3 - 0.0008; // panza del ala

    const geoMotor = new THREE.CylinderGeometry(RADIO_MOTOR, RADIO * 0.36, LARGO_MOTOR, 10);

    [-0.026, -0.014, 0.014, 0.026].forEach((x) => {
      const fraccion = Math.abs(x) / SEMI;
      const bordeAtaque = ALA_LE_RAIZ + fraccion * (ALA_LE_PUNTA - ALA_LE_RAIZ);
      // El motor cuelga por delante del borde de ataque, como en el real
      const z = bordeAtaque - LARGO_MOTOR * 0.45;
      const yMotor = Y_ALA_ABAJO - RADIO_MOTOR - 0.0006;

      const motor = new THREE.Mesh(geoMotor, matOscuro);
      motor.rotation.x = Math.PI / 2;
      motor.position.set(x, yMotor, z);
      grupo.add(motor);

      // Pilón: la pieza que une el motor al ala. Sin esto los motores se
      // ven flotando en el aire, que era el problema del primer intento.
      const pilon = new THREE.Mesh(
        new THREE.BoxGeometry(RADIO * 0.16, Y_ALA_ABAJO - yMotor, LARGO_MOTOR * 0.5),
        matCuerpo
      );
      pilon.position.set(x, (Y_ALA_ABAJO + yMotor) / 2, z + LARGO_MOTOR * 0.28);
      grupo.add(pilon);
    });

    // --- Empenaje ---
    const colaH = new THREE.Mesh(
      crearAla(0.015, 0.009, 0.004, 0.006, 0.0014),
      matCuerpo
    );
    colaH.position.set(0, RADIO * 0.55, LARGO * 0.55);
    grupo.add(colaH);

    // Deriva vertical en color de acento: es lo único que da un punto de
    // color al avión y ayuda a leer hacia dónde va.
    const colaV = new THREE.Mesh(
      crearAla(0.013, 0.011, 0.005, 0.009, 0.0014),
      matCola
    );
    colaV.rotation.z = Math.PI / 2; // de horizontal a vertical
    colaV.position.set(0, RADIO * 1.5, LARGO * 0.55);
    grupo.add(colaV);

    grupo.visible = false;
    grupo.scale.setScalar(0.001);
    globoGroup.add(grupo);
    return grupo;
  }

  // =====================================================================
  // ARCOS DE VUELO — se arma la ruta pasando por waypoints (lat, lon) e
  // interpolando ESFÉRICAMENTE entre cada par, con un perfil de altura
  // senoidal sobre el total del trayecto.
  //
  // Dos motivos para no usar una curva Bézier ni un único slerp directo:
  //  1. Una Bézier entre puntos casi antipodales (China ↔ Argentina) se
  //     hunde hasta radio ~0.78 con el globo de radio 1: el avión se ve
  //     pasar POR ADENTRO del planeta.
  //  2. El círculo máximo entre esos dos puntos pasa cerquísima del polo
  //     sur, y ahí el rumbo cambia de golpe (el avión pega un volantazo).
  //     Con waypoints por el Pacífico la ruta va hacia el este y el giro
  //     queda repartido de forma pareja.
  // =====================================================================

  function crearArco(waypointsLatLon, alturaMax) {
    const nodos = waypointsLatLon.map(([lat, lon]) =>
      latLonAVec3(lat, lon, RADIO_GLOBO).normalize()
    );

    // Spline centrípeta a través de los waypoints y luego proyección a
    // la esfera: interpolar tramo por tramo con slerp dejaría un codo en
    // cada waypoint (cambio de rumbo de golpe); la spline da continuidad
    // y el rumbo cambia de a poco a lo largo de toda la ruta.
    const curvaDir = new THREE.CatmullRomCurve3(nodos, false, 'centripetal', 0.5);

    const N = 160;
    const puntos = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const dir = curvaDir.getPoint(t).normalize();
      puntos.push(
        dir.multiplyScalar(RADIO_GLOBO * (1 + alturaMax * Math.sin(Math.PI * t)))
      );
    }

    const geom = new THREE.BufferGeometry().setFromPoints(puntos);
    geom.setDrawRange(0, 0);
    const linea = new THREE.Line(
      geom,
      new THREE.LineBasicMaterial({ color: colorAcento, transparent: true, opacity: 0.8 })
    );
    globoGroup.add(linea);
    return {
      linea,
      curva: new THREE.CatmullRomCurve3(puntos),
      totalPuntos: puntos.length,
      avion: crearAvion(),
    };
  }

  // --- Geografía ---
  const posArgentina = latLonAVec3(-34.6, -58.4, RADIO_GLOBO);
  const posChina = latLonAVec3(31.2, 121.5, RADIO_GLOBO);
  const posParaguay = latLonAVec3(-25.3, -57.6, RADIO_GLOBO);

  const puestoChina = crearPuesto('china', posChina);
  const puestoParaguay = crearPuesto('paraguay', posParaguay);
  const puestoArgentina = crearPuesto('argentina', posArgentina);
  const PUESTOS = [puestoChina, puestoParaguay, puestoArgentina];

  // Ruta China → Argentina POR EL ESTE, cruzando todo el Pacífico.
  // Evita el círculo máximo, que pasa junto al polo sur y hace que el
  // avión pegue un giro brusco al cruzarlo.
  const arcoChina = crearArco(
    [
      [31.2, 121.5], // Shanghái
      [22, 148],
      [8, 176],
      [-6, -158], // cruce de la línea de fecha
      [-18, -128],
      [-28, -98],
      [-33, -76], // costa de Chile
      [-34.6, -58.4], // Buenos Aires
    ],
    0.26
  );

  const arcoParaguay = crearArco(
    [
      [-25.3, -57.6],
      [-30, -58],
      [-34.6, -58.4],
    ],
    0.1
  );

  // =====================================================================
  // RACIMO FINAL DE CAJAS
  // =====================================================================
  // Al llegar los aviones, un grupo de cajas irrumpe delante de la cámara
  // y el texto final se funde por encima.
  //
  // Va COLGADO DE LA CÁMARA, no del globo. Es la única forma de que el
  // encuadre sea estable: la cámara se mueve durante toda la intro, así
  // que unas cajas ancladas al mundo quedarían descuadradas según en qué
  // punto del recorrido esté. Colgadas de la cámara, sus coordenadas ya
  // son coordenadas de pantalla.
  //
  // La profundidad hace el trabajo de las escalas: las del centro están
  // más cerca y se ven grandes; las de los costados están más atrás y la
  // perspectiva las achica sola. No hay ninguna caja "chiquita": son casi
  // del mismo tamaño real, puestas a distinta distancia.
  //
  // TODO EL RACIMO TIENE QUE QUEDAR POR DELANTE DEL GLOBO.
  // El globo es una esfera semitransparente (opacidad 0.75) de radio 1 y
  // la cámara termina a ~2.1 de su centro, así que cualquier caja a más
  // de ~1.05 de la cámara queda DETRÁS de esa esfera y se ve al 25% de
  // su color: gris azulado en vez de cartón. Fue exactamente el problema
  // del primer intento, con las cajas puestas entre 1.5 y 3.1.
  //
  // ACERCAMIENTO reduce posiciones Y tamaños por igual, así que la
  // composición en pantalla no cambia: solo se acerca todo el conjunto.
  const ACERCAMIENTO = 0.3;
  const cajasFinal = new THREE.Group();
  // El par grande se corre hacia los lados y no se agranda más: el texto
  // final cae justo en el medio y tiene que poder leerse.
  //
  // Los costados llevan MÁS bultos que el centro, y a propósito: con el
  // texto ocupando la franja central, los huecos que se notan son los de
  // los bordes. La banda central queda deliberadamente despejada.
  //
  // [x, y, z, escala, giro, forma, variante]
  const CAJAS_FINAL = [
    // --- Par grande, flanqueando el texto ---
    [-0.54, -0.12, -1.48, 3.3, -0.38, 'normal', 0],
    [0.58, 0.05, -1.62, 3.0, 0.42, 'normal', 1],

    // --- Anillo intermedio ---
    [-0.82, 0.44, -2.05, 2.6, 0.28, 'alargada', 2],
    [0.88, -0.42, -2.1, 2.7, -0.34, 'normal', 3],
    [-0.24, 0.66, -2.25, 2.3, 0.5, 'chica', 1],
    [0.3, -0.7, -2.2, 2.4, -0.22, 'normal', 0],
    [-1.02, -0.5, -2.3, 2.2, 0.44, 'normal', 2],
    [1.06, 0.5, -2.35, 2.15, -0.5, 'plana', 3],

    // --- Costados: la franja que quedaba vacía ---
    [-1.34, 0.06, -2.6, 2.3, 0.16, 'alta', 1],
    [1.4, -0.04, -2.65, 2.25, -0.2, 'normal', 2],
    [-1.5, 0.62, -2.9, 2.1, -0.34, 'normal', 3],
    [1.54, -0.58, -2.95, 2.05, 0.3, 'alargada', 0],
    [-1.44, -0.78, -3.0, 2.0, 0.5, 'chica', 2],
    [1.48, 0.8, -3.05, 1.95, -0.42, 'normal', 1],

    // --- Fondo: rellenan huecos y dan profundidad ---
    [-0.62, 1.02, -3.1, 1.9, 0.22, 'normal', 0],
    [0.68, -1.06, -3.05, 1.95, -0.28, 'chica', 3],
    [-0.06, -1.12, -3.2, 1.85, 0.38, 'normal', 2],
    [0.12, 1.16, -3.25, 1.8, -0.16, 'plana', 1],
    [-1.86, -0.22, -3.35, 1.85, 0.26, 'normal', 3],
    [1.92, 0.26, -3.4, 1.8, -0.36, 'alta', 0],
  ];

  /* En pantallas chicas se usa la mitad del racimo.
     Cada caja son 8 mallas, así que las 20 completas suman ~160 objetos
     a dibujar, encima de los dos aviones (17 piezas cada uno) y el
     globo. En un teléfono eso se nota. Se toman una de cada dos, que por
     cómo está ordenada la lista deja repartidas las del centro, las del
     anillo y las del fondo — no se vacía ningún sector. */
  const CAJAS_A_MOSTRAR =
    window.innerWidth < 768
      ? CAJAS_FINAL.filter((_, i) => i % 2 === 0)
      : CAJAS_FINAL;

  (function () {
    CAJAS_A_MOSTRAR.forEach(([x, y, z, k, giro, forma, variante]) => {
      const caja = crearCajaMesh(k * ACERCAMIENTO, forma, variante);
      caja.position.set(x * ACERCAMIENTO, y * ACERCAMIENTO, z * ACERCAMIENTO);
      caja.rotation.set(giro * 0.35, giro, giro * 0.18);
      // Cada caja se anima por separado, así que arranca en cero
      caja.scale.setScalar(0.001);
      cajasFinal.add(caja);
    });
    cajasFinal.visible = false;
    camera.add(cajasFinal);
    // La cámara tiene que estar en la escena para que sus hijos se
    // dibujen: por sí sola no forma parte del grafo que se renderiza.
    scene.add(camera);
  })();

  // Luz propia del racimo, también colgada de la cámara.
  //
  // Hace falta porque las luces de la escena están puestas para el globo
  // y apuntan al origen del mundo. Las cajas viajan con la cámara, así
  // que quedaban fuera de ese encuadre de luz y se veían casi negras en
  // vez de cartón. Con la luz colgada de la cámara, el racimo se ve
  // igual sin importar dónde esté la cámara en ese momento.
  // Intensidades altas a propósito: three.js r160 ya no usa el modo de
  // luces heredado, así que una direccional en 2 rinde bastante menos de
  // lo que rendía en versiones viejas. Con valores "normales" las cajas
  // salían casi negras.
  const luzCajas = new THREE.DirectionalLight(colorTextoClaro, 1.5);
  luzCajas.position.set(0.9, 1.2, 0.6);
  const objetivoLuzCajas = new THREE.Object3D();
  objetivoLuzCajas.position.set(0, 0, -2.2);
  camera.add(objetivoLuzCajas);
  luzCajas.target = objetivoLuzCajas;
  luzCajas.visible = false; // solo se enciende en el remate
  camera.add(luzCajas);

  // Relleno tenue para que las caras en sombra no queden en negro puro
  const rellenoCajas = new THREE.DirectionalLight(colorTextoClaro, 0.5);
  rellenoCajas.position.set(-1.1, -0.5, 0.3);
  rellenoCajas.target = objetivoLuzCajas;
  rellenoCajas.visible = false;
  camera.add(rellenoCajas);

  // =====================================================================
  // TIMELINE
  // =====================================================================

  const T_ZOOM_FIN = 1.4;
  const T_BANDERA_CHINA = 0.7;
  const T_MORPH_CHINA = 1.9; // despegue: arranca el vuelo y el seguimiento
  // Los puestos sudamericanos aparecen cuando el avión (y por lo tanto
  // la cámara, que lo sigue) ya está sobre Sudamérica.
  const T_BANDERA_PY = 5.9;
  const T_BANDERA_ARG = 6.0;
  const T_MORPH_PY = 6.35;
  const T_LLEGADA = 7.2; // ambos aviones llegan juntos → el globo frena acá

  // --- Remate ---
  // Las cajas irrumpen primero y el texto se funde encima un toque
  // después: si entraran juntos, la explosión le tapa la lectura.
  const T_CAJAS_FINAL = 7.25;
  const DURACION_ESTALLIDO = 0.8; // cuánto tarda cada caja en llegar a su tamaño
  // 0.035 y no más: son 20 cajas, y a 0.055 la última recién arrancaba
  // más de un segundo después que la primera.
  const ESCALONADO_CAJA = 0.035;
  const T_TEXTO_FINAL = 7.6;
  // Ya no hay desvanecido del canvas: el remate ahora es un empuje, toda
  // la escena se desliza hacia arriba y el Hero entra desde abajo.
  // Ver finishIntro() y css/intro.css.
  const T_TOTAL = 9.7;

  function easeInOutQuad(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }
  function tramo(t, inicio, fin) {
    if (t <= inicio) return 0;
    if (t >= fin) return 1;
    return easeInOutQuad((t - inicio) / (fin - inicio));
  }
  function progresoLineal(t, inicio, fin) {
    if (t <= inicio) return 0;
    if (t >= fin) return 1;
    return (t - inicio) / (fin - inicio);
  }
  function popElastico(t) {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const c4 = (2 * Math.PI) / 3;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  }
  function pulso(t, centro, semiAncho) {
    const d = Math.abs(t - centro);
    return d >= semiAncho ? 0 : 1 - d / semiAncho;
  }

  // --- Orientación del globo: lleva un punto al frente de la cámara,
  // manteniendo el norte hacia arriba. ---
  const _mBase = new THREE.Matrix4();
  const _ejeX = new THREE.Vector3();
  const _ejeY = new THREE.Vector3();
  const _ejeZ = new THREE.Vector3();
  const _norteGlobo = new THREE.Vector3(0, 1, 0);

  function orientacionParaCentrar(punto, destino) {
    _ejeZ.copy(punto).normalize();
    _ejeX.crossVectors(_norteGlobo, _ejeZ);
    if (_ejeX.lengthSq() < 1e-8) _ejeX.set(1, 0, 0);
    _ejeX.normalize();
    _ejeY.crossVectors(_ejeZ, _ejeX).normalize();
    _mBase.makeBasis(_ejeX, _ejeY, _ejeZ);
    return destino.setFromRotationMatrix(_mBase).invert();
  }

  const qSeguimiento = new THREE.Quaternion();
  const _puntoSeguido = new THREE.Vector3();

  const camLejos = new THREE.Vector3(0.2, 0.15, 3.9);
  const camCerca = new THREE.Vector3(0.12, 0.02, 2.1);
  const camVuelo = new THREE.Vector3(0.12, 0.06, 2.7);
  const lookCentro = new THREE.Vector3(0, 0, 0);
  const vTmpPos = new THREE.Vector3();

  function actualizarCamara(t) {
    vTmpPos.lerpVectors(camLejos, camCerca, tramo(t, 0, T_ZOOM_FIN));
    if (t > T_MORPH_CHINA) {
      // Retrocede un toque durante el vuelo y vuelve al encuadre cercano
      // sobre el final, cuando el avión está por llegar.
      const salida = tramo(t, T_MORPH_CHINA, T_MORPH_CHINA + 0.9);
      const regreso = tramo(t, T_LLEGADA - 1.3, T_LLEGADA);
      vTmpPos.lerp(camVuelo, salida * (1 - regreso));
    }
    camera.position.copy(vTmpPos);
    camera.lookAt(lookCentro);
  }

  function popGrupo(grupo, t, inicio, duracion) {
    if (t < inicio) {
      grupo.visible = false;
      return;
    }
    grupo.visible = true;
    grupo.scale.setScalar(
      Math.max(0.001, popElastico(progresoLineal(t, inicio, inicio + duracion)))
    );
  }

  /**
   * Racimo final: cada caja crece de cero a su tamaño con un rebote, y
   * las de más adelante arrancan primero. El escalonado es lo que lo
   * hace leer como un estallido y no como un bloque que aparece de una.
   */
  function actualizarCajasFinal(t) {
    if (t < T_CAJAS_FINAL) {
      cajasFinal.visible = false;
      luzCajas.visible = false;
      rellenoCajas.visible = false;
      return;
    }
    cajasFinal.visible = true;
    // Las luces se encienden con el racimo: si estuvieran prendidas desde
    // el principio, blanquearían el globo durante toda la intro.
    luzCajas.visible = true;
    rellenoCajas.visible = true;

    const hijos = cajasFinal.children;
    for (let i = 0; i < hijos.length; i++) {
      const inicio = T_CAJAS_FINAL + i * ESCALONADO_CAJA;
      const p = progresoLineal(t, inicio, inicio + DURACION_ESTALLIDO);
      // La escala va de 0 a 1, NO al factor de tamaño: crearCajaMesh(k)
      // ya construye la geometría a ese tamaño. Multiplicar por k acá
      // otra vez las dejaría k² de grandes.
      // popElastico pasa de 0 a 1 con sobrepaso: la caja se pasa de rosca
      // y vuelve, que es el "levemente explosivo" buscado.
      hijos[i].scale.setScalar(Math.max(0.001, popElastico(p)));
    }
  }

  const _lookMatrix = new THREE.Matrix4();
  const _posAvion = new THREE.Vector3();
  const _posAdelante = new THREE.Vector3();

  function actualizarAvion(arco, t, inicio) {
    const progreso = tramo(t, inicio, T_LLEGADA);
    const activo = t >= inicio && t < T_LLEGADA;
    arco.avion.visible = activo;
    if (!activo) {
      arco.linea.geometry.setDrawRange(0, t >= T_LLEGADA ? arco.totalPuntos : 0);
      return progreso;
    }
    _posAvion.copy(arco.curva.getPoint(progreso));
    arco.avion.position.copy(_posAvion);

    const tAdelante = Math.min(1, progreso + 0.015);
    if (tAdelante > progreso) {
      _posAdelante.copy(arco.curva.getPoint(tAdelante));
      _lookMatrix.lookAt(_posAvion, _posAdelante, _posAvion.clone().normalize());
      arco.avion.quaternion.setFromRotationMatrix(_lookMatrix);
    }

    arco.avion.scale.setScalar(
      Math.max(0.001, popElastico(progresoLineal(t, inicio, inicio + 0.35)))
    );
    arco.linea.geometry.setDrawRange(0, Math.floor(arco.totalPuntos * progreso));
    return progreso;
  }

  let fraseActual = '';
  let cambiandoFrase = false;
  function mostrarFrase(texto) {
    if (fraseActual === texto || cambiandoFrase) return;
    const habiaAnterior = fraseActual !== '';
    cambiandoFrase = true;
    fraseActual = texto;
    relatoEl.classList.remove('is-visible');
    setTimeout(
      () => {
        relatoEl.textContent = texto;
        relatoEl.classList.add('is-visible');
        cambiandoFrase = false;
      },
      habiaAnterior ? 260 : 0
    );
  }
  function ocultarFrase() {
    fraseActual = '';
    relatoEl.classList.remove('is-visible');
  }

  let finalMostrado = false;

  function actualizarEscena(t) {
    // --- Aviones (primero: el globo sigue al avión chino) ---
    const progresoChina = actualizarAvion(arcoChina, t, T_MORPH_CHINA);
    actualizarAvion(arcoParaguay, t, T_MORPH_PY);

    // --- Seguimiento continuo ---
    // Antes del despegue el punto seguido es China; después, la posición
    // del propio avión. No hay mezcla con ninguna orientación fija: el
    // globo frena solo porque el avión frena al llegar a Argentina.
    if (t < T_MORPH_CHINA) {
      _puntoSeguido.copy(posChina);
    } else {
      _puntoSeguido.copy(arcoChina.curva.getPoint(progresoChina)).normalize();
    }
    globoGroup.quaternion.copy(orientacionParaCentrar(_puntoSeguido, qSeguimiento));
    globoGroup.updateMatrixWorld(true);

    // --- Puestos (solo banderas) ---
    popGrupo(puestoChina.bandera, t, T_BANDERA_CHINA, 0.45);
    popGrupo(puestoParaguay.bandera, t, T_BANDERA_PY, 0.4);
    popGrupo(puestoArgentina.bandera, t, T_BANDERA_ARG, 0.4);
    PUESTOS.forEach(actualizarPuesto);

    // --- Destello en cada morphing caja→avión ---
    rimLight.intensity =
      INTENSIDAD_BASE_RIM +
      pulso(t, T_MORPH_CHINA, 0.22) * 4 +
      pulso(t, T_MORPH_PY, 0.22) * 4;

    // --- Remate: el racimo de cajas estalla delante de la cámara ---
    actualizarCajasFinal(t);

    // --- Texto narrativo ---
    if (t < T_MORPH_CHINA) {
      if (t > 0.45) mostrarFrase('Vos detectás la tendencia');
    } else if (t < T_LLEGADA) {
      mostrarFrase('Nosotros somos tu puente logístico');
    } else if (fraseActual !== '') {
      ocultarFrase();
    }

    // --- Texto final + desvanecido de la escena 3D ---
    // Entra DESPUÉS de que arrancó el estallido, no junto con él: el
    // texto se funde por encima de las cajas ya en movimiento.
    if (t >= T_TEXTO_FINAL && !finalMostrado) {
      finalMostrado = true;
      finalEl.classList.add('is-visible');
    }
  }

  let animId = null;
  const reloj = new THREE.Clock();
  let anchoActual = 0;
  let altoActual = 0;

  function sincronizarTamaño() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w > 0 && h > 0 && (w !== anchoActual || h !== altoActual)) {
      anchoActual = w;
      altoActual = h;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      return true;
    }
    return false;
  }

  function loop() {
    sincronizarTamaño();
    const t = reloj.getElapsedTime();
    actualizarCamara(t);
    actualizarEscena(t);
    renderer.render(scene, camera);

    if (t >= T_TOTAL) {
      finishIntro(false);
      return;
    }
    animId = requestAnimationFrame(loop);
  }

  window.addEventListener('resize', sincronizarTamaño);
  document.addEventListener('visibilitychange', sincronizarTamaño);

  sincronizarTamaño();
  actualizarCamara(0);
  actualizarEscena(0);
  renderer.render(scene, camera);

  animId = requestAnimationFrame(loop);

  window.addEventListener(
    'error',
    () => {
      if (!finished && animId !== null) {
        cancelAnimationFrame(animId);
        finishIntro(true);
      }
    },
    { once: true }
  );
})();
