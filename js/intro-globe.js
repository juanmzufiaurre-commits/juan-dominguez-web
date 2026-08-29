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

  function finishIntro(instant) {
    if (finished) return;
    finished = true;
    document.body.classList.remove('intro-lock');
    overlay.classList.add('intro--saliendo');
    window.removeEventListener('resize', sincronizarTamaño);
    document.removeEventListener('visibilitychange', sincronizarTamaño);
    const cleanup = () => overlay.remove();
    if (instant) {
      overlay.style.transition = 'none';
      cleanup();
    } else {
      overlay.addEventListener('transitionend', cleanup, { once: true });
      setTimeout(cleanup, 1000);
    }
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

  const CARTON = '#EFBB9B';
  const CARTON_TAPA = '#F5CDB4';
  const CINTA = '#EFE3D6';

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
      ctx.fillStyle = '#F7DCCB';
      ctx.fillRect(x, y, lado, lado);
      dibujar(ctx, x + lado / 2, y + lado / 2, lado * 0.62);
      x += lado + separacion;
    });

    _texturaEtiquetas = new THREE.CanvasTexture(c);
    _texturaEtiquetas.needsUpdate = true;
    return _texturaEtiquetas;
  }

  const CAJA_ANCHO = 0.062;
  const CAJA_ALTO = 0.05;
  const CAJA_PROF = 0.056;

  function crearCajaMesh(escala) {
    const grupo = new THREE.Group();
    const k = escala || 1;

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

    const w = CAJA_ANCHO * k;
    const h = CAJA_ALTO * k;
    const p = CAJA_PROF * k;

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

    // Calco de pictogramas en la cara frontal
    const etiquetas = new THREE.Mesh(
      new THREE.PlaneGeometry(w * 0.62, h * 0.21),
      new THREE.MeshBasicMaterial({
        map: texturaEtiquetas(),
        transparent: true,
        depthWrite: false,
      })
    );
    etiquetas.position.set(0, -h * 0.22, p / 2 + 0.0004 * k);
    grupo.add(etiquetas);

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
  // PUESTO — bandera + caja, uno AL LADO del otro sobre el mismo país.
  // Posición y orientación se recalculan por frame según dónde esté la
  // cámara, para que la bandera nunca se vea "de punta" y las dos cosas
  // queden repartidas horizontalmente en pantalla.
  // =====================================================================

  const SEPARACION = 0.085; // distancia lateral entre bandera y caja
  const INCLINACION_MASTIL = THREE.MathUtils.degToRad(52);

  function crearPuesto(pais, posSuperficie) {
    const bandera = crearBandera(pais);

    const caja = new THREE.Group();
    caja.add(crearCajaMesh());
    caja.scale.setScalar(0.001);
    caja.visible = false;
    globoGroup.add(caja);

    return { pais, base: posSuperficie.clone().normalize(), bandera, caja };
  }

  const _camLocal = new THREE.Vector3();
  const _arribaLocal = new THREE.Vector3();
  const _normal = new THREE.Vector3();
  const _haciaCam = new THREE.Vector3();
  const _tangenteArriba = new THREE.Vector3();
  const _lateral = new THREE.Vector3();
  const _dirMastil = new THREE.Vector3();
  const _ejeX2 = new THREE.Vector3();
  const _ejeZ2 = new THREE.Vector3();
  const _matPuesto = new THREE.Matrix4();
  const _posTmp = new THREE.Vector3();
  // Giro fijo sobre el eje vertical de la caja para verla en 3/4.
  const _qTresCuartos = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    THREE.MathUtils.degToRad(-32)
  );

  function actualizarPuesto(puesto) {
    if (!puesto.bandera.visible && !puesto.caja.visible) return;

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

    // Lateral = perpendicular a "arriba" sobre el suelo → horizontal en pantalla
    _lateral.crossVectors(_tangenteArriba, _normal).normalize();

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

    // Bandera a un lado, caja al otro — sobre la superficie del globo
    _posTmp
      .copy(_normal)
      .addScaledVector(_lateral, -SEPARACION)
      .normalize()
      .multiplyScalar(RADIO_GLOBO);
    puesto.bandera.position.copy(_posTmp);

    _posTmp
      .copy(_normal)
      .addScaledVector(_lateral, SEPARACION)
      .normalize()
      .multiplyScalar(RADIO_GLOBO + CAJA_ALTO * 0.5);
    puesto.caja.position.copy(_posTmp);

    // La caja es un modelo 3D: se apoya en el piso (Y local = normal) y
    // se gira un poco sobre su eje para que se vea en 3/4 y no de frente
    // plano, como en la referencia.
    _ejeZ2.copy(_haciaCam).addScaledVector(_normal, -_haciaCam.dot(_normal));
    if (_ejeZ2.lengthSq() < 1e-8) _ejeZ2.copy(_tangenteArriba);
    _ejeZ2.normalize();
    _ejeX2.crossVectors(_normal, _ejeZ2).normalize();
    _matPuesto.makeBasis(_ejeX2, _normal, _ejeZ2);
    puesto.caja.quaternion
      .setFromRotationMatrix(_matPuesto)
      .multiply(_qTresCuartos);
  }

  // =====================================================================
  // AVIÓN COMERCIAL — silueta simple y angulosa (alas + cola).
  // =====================================================================

  function crearAvion() {
    const grupo = new THREE.Group();
    const matCuerpo = new THREE.MeshStandardMaterial({
      color: colorTextoClaro,
      roughness: 0.5,
      metalness: 0.1,
    });
    const matCola = new THREE.MeshStandardMaterial({
      color: colorAcento,
      roughness: 0.5,
      metalness: 0.05,
    });

    grupo.add(new THREE.Mesh(new THREE.BoxGeometry(0.009, 0.009, 0.055), matCuerpo));

    const alas = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.0022, 0.018), matCuerpo);
    alas.position.z = 0.004;
    grupo.add(alas);

    const colaH = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.0022, 0.011), matCuerpo);
    colaH.position.z = 0.023;
    grupo.add(colaH);

    const colaV = new THREE.Mesh(new THREE.BoxGeometry(0.0022, 0.016, 0.011), matCola);
    colaV.position.set(0, 0.009, 0.023);
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

  // Pila final de cajas 3D (llegada a Argentina)
  const pilaCajas = new THREE.Group();
  (function () {
    const k = 0.78;
    const w = CAJA_ANCHO * k;
    const h = CAJA_ALTO * k;
    [
      [-w * 0.55, 0, 0],
      [w * 0.55, 0, -w * 0.15],
      [-w * 0.3, h, w * 0.1],
      [w * 0.42, h, w * 0.05],
    ].forEach(([ox, oy, oz], i) => {
      const caja = crearCajaMesh(k);
      caja.position.set(ox, oy, oz);
      caja.rotation.y = (i % 2 === 0 ? 1 : -1) * 0.25;
      pilaCajas.add(caja);
    });
    pilaCajas.scale.setScalar(0.001);
    pilaCajas.visible = false;
    globoGroup.add(pilaCajas);
  })();

  // =====================================================================
  // TIMELINE
  // =====================================================================

  const T_ZOOM_FIN = 1.4;
  const T_BANDERA_CHINA = 0.7;
  const T_CAJA_CHINA = 1.1;
  const T_MORPH_CHINA = 1.9; // despegue: arranca el vuelo y el seguimiento
  // Los puestos sudamericanos aparecen cuando el avión (y por lo tanto
  // la cámara, que lo sigue) ya está sobre Sudamérica.
  const T_BANDERA_PY = 5.9;
  const T_BANDERA_ARG = 6.0;
  const T_CAJA_PY = 6.05;
  const T_MORPH_PY = 6.35;
  const T_LLEGADA = 7.2; // ambos aviones llegan juntos → el globo frena acá
  const T_CANVAS_FADE = 7.55;
  const T_TOTAL = 9.4;

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

  // Pop de salida: la caja se infla un toque y colapsa a cero justo
  // cuando nace el avión — así el reemplazo se lee como una
  // transformación y no como una desaparición seca.
  const DURACION_POP_SALIDA = 0.3;
  function popSalida(p) {
    return (1 - p * p) * (1 + 0.32 * Math.sin(Math.PI * p));
  }

  function actualizarCaja(caja, t, inicioPop, duracionPop, inicioMorph) {
    const inicioSalida = inicioMorph - DURACION_POP_SALIDA;
    if (t >= inicioMorph) {
      caja.visible = false;
    } else if (t >= inicioSalida) {
      caja.visible = true;
      caja.scale.setScalar(
        Math.max(0.001, popSalida(progresoLineal(t, inicioSalida, inicioMorph)))
      );
    } else {
      popGrupo(caja, t, inicioPop, duracionPop);
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
  let canvasDesvanecido = false;

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

    // --- Puestos (bandera + caja) ---
    popGrupo(puestoChina.bandera, t, T_BANDERA_CHINA, 0.45);
    popGrupo(puestoParaguay.bandera, t, T_BANDERA_PY, 0.4);
    popGrupo(puestoArgentina.bandera, t, T_BANDERA_ARG, 0.4);
    actualizarCaja(puestoChina.caja, t, T_CAJA_CHINA, 0.35, T_MORPH_CHINA);
    actualizarCaja(puestoParaguay.caja, t, T_CAJA_PY, 0.3, T_MORPH_PY);
    puestoArgentina.caja.visible = false; // en Argentina llega la pila, no una caja suelta
    PUESTOS.forEach(actualizarPuesto);

    // --- Destello en cada morphing caja→avión ---
    rimLight.intensity =
      INTENSIDAD_BASE_RIM +
      pulso(t, T_MORPH_CHINA, 0.22) * 4 +
      pulso(t, T_MORPH_PY, 0.22) * 4;

    // --- Llegada: pila de cajas junto a la bandera argentina ---
    if (t >= T_LLEGADA) {
      popGrupo(pilaCajas, t, T_LLEGADA, 0.45);
      pilaCajas.position.copy(puestoArgentina.caja.position);
    } else {
      pilaCajas.visible = false;
    }

    // --- Texto narrativo ---
    if (t < T_MORPH_CHINA) {
      if (t > 0.45) mostrarFrase('Vos detectás la tendencia');
    } else if (t < T_LLEGADA) {
      mostrarFrase('Nosotros somos tu puente logístico');
    } else if (fraseActual !== '') {
      ocultarFrase();
    }

    // --- Texto final + desvanecido de la escena 3D ---
    if (t >= T_LLEGADA && !finalMostrado) {
      finalMostrado = true;
      finalEl.classList.add('is-visible');
    }
    if (t >= T_CANVAS_FADE && !canvasDesvanecido) {
      canvasDesvanecido = true;
      canvas.classList.add('is-fading');
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
