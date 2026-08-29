/**
 * MAPA-MUNDI.JS
 * ---------------------------------------------------------------
 * Capa de fondo de toda la página: los continentes dibujados como una
 * trama de puntos, con tres cosas encima:
 *
 *   1. SCROLL — el mapa avanza en latitud mientras se baja, y da la
 *      vuelta: se sale por arriba y vuelve a entrar por abajo, así el
 *      recorrido no tiene fin ni costura.
 *   2. LUPA — bajo el cursor los puntos se agrandan y se separan, como
 *      si un bulto empujara la trama desde atrás.
 *   3. AVIONES — como mucho dos a la vez, con su trayectoria dibujada
 *      detrás; al aterrizar la estela se desvanece y el avión se va.
 *
 * LA GEOGRAFÍA NO ES INVENTADA: sale de window.CONTINENTES_DATA, el
 * mismo dataset de polígonos que usa el globo 3D de la intro (ver
 * js/continentes-data.js). Un solo origen de verdad para los dos.
 *
 * Cómo se decide qué punto es tierra: los polígonos se rasterizan UNA
 * vez a un canvas chico fuera de pantalla y de ahí sale una máscara de
 * bytes. Después, por cada punto de la grilla, alcanza con una lectura
 * de array. Hacer punto-en-polígono contra cientos de polígonos en
 * cada frame sería inviable.
 */

(function () {
  const canvas = document.getElementById('mapa-fondo');
  if (!canvas || !canvas.getContext) return;

  const poligonos = window.CONTINENTES_DATA;
  if (!Array.isArray(poligonos) || poligonos.length === 0) return;

  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;

  const sinMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)');
  const punteroFino = window.matchMedia('(hover: hover) and (pointer: fine)');

  /* ------------------------------------------------------------
     COLORES — se leen de los tokens, no se hardcodean
     ------------------------------------------------------------ */

  const raiz = getComputedStyle(document.documentElement);

  function leerColor(nombre, respaldo) {
    const v = raiz.getPropertyValue(nombre).trim();
    return v || respaldo;
  }

  const COLOR_PUNTO = leerColor('--color-texto-claro', '#F2F4F8');
  const COLOR_ACENTO = leerColor('--color-acento', '#D9A73C');

  /* ------------------------------------------------------------
     AJUSTES
     ------------------------------------------------------------ */

  const MASCARA_W = 900;
  const MASCARA_H = 450;

  const SEPARACION_ESCRITORIO = 15;
  const SEPARACION_MOVIL = 19;

  const RADIO_PUNTO = 1.5;
  const ALFA_PUNTO = 0.17;

  /* Lupa: radio de influencia y cuánto empuja hacia afuera. */
  const LUPA_RADIO = 165;
  const LUPA_EMPUJE = 26;
  const LUPA_CRECIMIENTO = 2.1;

  /* Ancho del mundo entero en píxeles, como múltiplo del ancho de la
     ventana. 2.4 deja ver algo menos de la mitad del planeta a la vez:
     suficiente para reconocer continentes sin que se vuelva un plano
     escolar. */
  const ESCALA_MUNDO = 2.4;

  /* Cuánto avanza el mapa por píxel de scroll. Bien por debajo de 1
     para que se lea como una capa lejana. */
  const FACTOR_SCROLL = 0.16;

  /* Deriva horizontal constante, en píxeles por segundo. Muy lenta:
     mantiene la escena viva cuando nadie scrollea. */
  const DERIVA = 5;

  const MAX_AVIONES = 2;

  /* ------------------------------------------------------------
     MÁSCARA DE TIERRA
     ------------------------------------------------------------ */

  let mascara = null;

  function construirMascara() {
    const off = document.createElement('canvas');
    off.width = MASCARA_W;
    off.height = MASCARA_H;
    const octx = off.getContext('2d');
    if (!octx) return null;

    octx.fillStyle = '#fff';
    octx.beginPath();

    for (let i = 0; i < poligonos.length; i++) {
      const anillo = poligonos[i];
      if (!anillo || anillo.length < 3) continue;

      for (let j = 0; j < anillo.length; j++) {
        const par = anillo[j];
        // Proyección equirectangular: lon → x, lat → y
        const x = ((par[0] + 180) / 360) * MASCARA_W;
        const y = ((90 - par[1]) / 180) * MASCARA_H;
        if (j === 0) octx.moveTo(x, y);
        else octx.lineTo(x, y);
      }
      octx.closePath();
    }

    octx.fill();

    let datos;
    try {
      datos = octx.getImageData(0, 0, MASCARA_W, MASCARA_H).data;
    } catch (e) {
      // Canvas contaminado (no debería pasar: no se carga nada externo)
      return null;
    }

    // Un byte por celda en vez de los cuatro del RGBA: baja el uso de
    // memoria a la cuarta parte y la lectura por frame es directa.
    const m = new Uint8Array(MASCARA_W * MASCARA_H);
    for (let i = 0, p = 3; i < m.length; i++, p += 4) {
      m[i] = datos[p] > 128 ? 1 : 0;
    }
    return m;
  }

  function esTierra(u, v) {
    // u y v en 0..1, con u dando la vuelta al planeta
    let cu = u % 1;
    if (cu < 0) cu += 1;
    let cv = v % 1;
    if (cv < 0) cv += 1;

    const mx = (cu * MASCARA_W) | 0;
    const my = (cv * MASCARA_H) | 0;
    return mascara[my * MASCARA_W + mx] === 1;
  }

  /* ------------------------------------------------------------
     SPRITE DEL PUNTO
     ------------------------------------------------------------
     Se dibuja una sola vez y después se estampa con drawImage. Hacer
     un arc() por punto, con miles de puntos por frame, no llega a 60fps.
     ------------------------------------------------------------ */

  function hacerSprite(color) {
    const S = 20;
    const s = document.createElement('canvas');
    s.width = S;
    s.height = S;
    const sc = s.getContext('2d');
    const g = sc.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, color);
    g.addColorStop(0.5, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    sc.fillStyle = g;
    sc.beginPath();
    sc.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
    sc.fill();
    return s;
  }

  const sprite = hacerSprite(COLOR_PUNTO);

  /* ------------------------------------------------------------
     ESTADO
     ------------------------------------------------------------ */

  let ancho = 0;
  let alto = 0;
  let dpr = 1;
  let separacion = SEPARACION_ESCRITORIO;
  let mundoW = 0;
  let mundoH = 0;

  let cursorX = -9999;
  let cursorY = -9999;
  let lupaFuerza = 0;      // 0 a 1, sube al entrar el cursor
  let lupaObjetivo = 0;

  let derivaX = 0;
  let ultimoTiempo = 0;

  /* ID del frame pendiente en vez de una bandera "corriendo": si un
     frame se agenda y el navegador nunca lo entrega (pestaña oculta,
     throttling), una bandera quedaría trabada en true y el bucle no
     volvería a arrancar nunca. Con el ID se cancela y se reagenda. */
  let frameEnCurso = 0;
  let activo = false;

  const aviones = [];
  let proximoAvion = 0;

  function medir() {
    const w = window.innerWidth;
    const h = window.innerHeight;

    // Si todavía no hay layout (el navegador puede reportar 0 antes del
    // primer cálculo, o con la pestaña oculta), no se mide nada: dejar
    // el canvas en 0 lo rompería para siempre, porque en una sesión
    // normal no llega ningún resize después que lo arregle.
    if (w === 0 || h === 0) return false;

    // Nada que rehacer si no cambió: medir reasigna canvas.width, y eso
    // limpia el contenido dibujado aunque el tamaño sea el mismo.
    if (w === ancho && h === alto) return true;

    dpr = Math.min(window.devicePixelRatio || 1, 2);
    ancho = w;
    alto = h;
    separacion = ancho < 768 ? SEPARACION_MOVIL : SEPARACION_ESCRITORIO;

    canvas.width = Math.round(ancho * dpr);
    canvas.height = Math.round(alto * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    mundoW = ancho * ESCALA_MUNDO;
    mundoH = mundoW / 2; // equirectangular: 2:1
    return true;
  }

  /* ------------------------------------------------------------
     AVIONES
     ------------------------------------------------------------ */

  function nuevoAvion() {
    // Sale de un borde y aterriza en el lado opuesto, siempre cruzando
    // una buena parte de la pantalla.
    const desdeIzquierda = Math.random() < 0.5;
    const x0 = desdeIzquierda ? -60 : ancho + 60;
    const x1 = desdeIzquierda ? ancho * (0.55 + Math.random() * 0.5)
                              : ancho * (Math.random() * 0.45);
    const y0 = alto * (0.15 + Math.random() * 0.7);
    const y1 = alto * (0.15 + Math.random() * 0.7);

    // Punto de control desplazado en perpendicular: la ruta se curva
    // como una derrota de gran círculo en vez de una recta de regla.
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const largo = Math.hypot(dx, dy) || 1;
    const curva = largo * 0.16 * (Math.random() < 0.5 ? 1 : -1);

    return {
      x0: x0, y0: y0, x1: x1, y1: y1,
      cx: mx - (dy / largo) * curva,
      cy: my + (dx / largo) * curva,
      t: 0,
      duracion: 7000 + Math.random() * 5000,
      // Fase tras aterrizar: la estela se apaga sola
      apagado: 0
    };
  }

  function puntoEnRuta(a, t) {
    const it = 1 - t;
    return {
      x: it * it * a.x0 + 2 * it * t * a.cx + t * t * a.x1,
      y: it * it * a.y0 + 2 * it * t * a.cy + t * t * a.y1
    };
  }

  function dibujarAvion(a) {
    const punta = puntoEnRuta(a, a.t);
    const previo = puntoEnRuta(a, Math.max(a.t - 0.01, 0));
    const angulo = Math.atan2(punta.y - previo.y, punta.x - previo.x);

    // --- Estela ---
    // Se dibuja por tramos con la opacidad creciendo hacia el avión:
    // lo ya recorrido se va borrando y lo próximo va marcado.
    const PASOS = 26;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);

    for (let i = 0; i < PASOS; i++) {
      const t0 = (a.t * i) / PASOS;
      const t1 = (a.t * (i + 1)) / PASOS;
      const p0 = puntoEnRuta(a, t0);
      const p1 = puntoEnRuta(a, t1);
      const desvanecido = (i + 1) / PASOS;
      ctx.globalAlpha = desvanecido * 0.42 * (1 - a.apagado);
      ctx.strokeStyle = COLOR_ACENTO;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // --- Aeronave ---
    if (a.t < 1) {
      ctx.save();
      ctx.translate(punta.x, punta.y);
      ctx.rotate(angulo);
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = COLOR_ACENTO;
      ctx.beginPath();
      ctx.moveTo(6, 0);
      ctx.lineTo(-4, 3.4);
      ctx.lineTo(-2, 0);
      ctx.lineTo(-4, -3.4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // Punto de destino, marcado tenue
      ctx.globalAlpha = 0.3 * (1 - a.apagado);
      ctx.strokeStyle = COLOR_ACENTO;
      ctx.beginPath();
      ctx.arc(a.x1, a.y1, 3.5, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
  }

  /* ------------------------------------------------------------
     BUCLE
     ------------------------------------------------------------ */

  function pintar(ahora) {
    frameEnCurso = 0;
    if (!activo) return;

    // Reintento por si el primer medir() cayó antes de que hubiera
    // layout: acá ya corre dentro de un frame, así que las medidas
    // existen. Sin esto el canvas quedaría en 0 y no se vería nada.
    if (ancho === 0 || alto === 0) {
      if (!medir()) {
        frameEnCurso = window.requestAnimationFrame(pintar);
        return;
      }
    }

    const delta = ultimoTiempo ? Math.min(ahora - ultimoTiempo, 50) : 16;
    ultimoTiempo = ahora;

    ctx.clearRect(0, 0, ancho, alto);

    // Deriva y lupa avanzan con el tiempo, no con los frames: así el
    // ritmo no cambia si la máquina baja de 60fps.
    derivaX += (DERIVA * delta) / 1000;
    lupaFuerza += (lupaObjetivo - lupaFuerza) * 0.08;

    const desplazamientoY = window.scrollY * FACTOR_SCROLL;

    // --- Trama de puntos ---
    const columnas = Math.ceil(ancho / separacion) + 1;
    const filas = Math.ceil(alto / separacion) + 1;
    const usarLupa = lupaFuerza > 0.01;

    for (let f = 0; f < filas; f++) {
      const baseY = f * separacion;

      for (let c = 0; c < columnas; c++) {
        const baseX = c * separacion;

        // Coordenadas en el mundo, dando la vuelta en los dos ejes
        const u = (baseX + derivaX) / mundoW;
        const v = (baseY + desplazamientoY) / mundoH;

        if (!esTierra(u, v)) continue;

        let x = baseX;
        let y = baseY;
        let radio = RADIO_PUNTO;
        let alfa = ALFA_PUNTO;

        if (usarLupa) {
          const dx = baseX - cursorX;
          const dy = baseY - cursorY;
          const dist = Math.hypot(dx, dy);

          if (dist < LUPA_RADIO) {
            // Caída cuadrática: el bulto tiene hombros suaves en vez
            // de un borde marcado.
            const cerca = 1 - dist / LUPA_RADIO;
            const bulto = cerca * cerca * lupaFuerza;

            if (dist > 0.5) {
              const empuje = bulto * LUPA_EMPUJE;
              x += (dx / dist) * empuje;
              y += (dy / dist) * empuje;
            }
            radio += bulto * LUPA_CRECIMIENTO;
            alfa += bulto * 0.55;
          }
        }

        ctx.globalAlpha = alfa;
        ctx.drawImage(sprite, x - radio, y - radio, radio * 2, radio * 2);
      }
    }

    ctx.globalAlpha = 1;

    // --- Aviones ---
    if (aviones.length < MAX_AVIONES && ahora > proximoAvion) {
      aviones.push(nuevoAvion());
      proximoAvion = ahora + 4000 + Math.random() * 6000;
    }

    for (let i = aviones.length - 1; i >= 0; i--) {
      const a = aviones[i];

      if (a.t < 1) {
        a.t = Math.min(a.t + delta / a.duracion, 1);
      } else {
        // Ya aterrizó: la estela se apaga en un segundo y medio
        a.apagado = Math.min(a.apagado + delta / 1500, 1);
      }

      dibujarAvion(a);

      if (a.apagado >= 1) aviones.splice(i, 1);
    }

    frameEnCurso = window.requestAnimationFrame(pintar);
  }

  function arrancarBucle() {
    activo = true;
    ultimoTiempo = 0;
    if (frameEnCurso) window.cancelAnimationFrame(frameEnCurso);
    frameEnCurso = window.requestAnimationFrame(pintar);
  }

  /* ------------------------------------------------------------
     VERSIÓN QUIETA — movimiento reducido
     ------------------------------------------------------------ */

  function pintarQuieto() {
    ctx.clearRect(0, 0, ancho, alto);
    const columnas = Math.ceil(ancho / separacion) + 1;
    const filas = Math.ceil(alto / separacion) + 1;

    for (let f = 0; f < filas; f++) {
      for (let c = 0; c < columnas; c++) {
        const x = c * separacion;
        const y = f * separacion;
        if (!esTierra(x / mundoW, y / mundoH)) continue;
        ctx.globalAlpha = ALFA_PUNTO;
        ctx.drawImage(sprite, x - RADIO_PUNTO, y - RADIO_PUNTO, RADIO_PUNTO * 2, RADIO_PUNTO * 2);
      }
    }
    ctx.globalAlpha = 1;
  }

  /* ------------------------------------------------------------
     ARRANQUE
     ------------------------------------------------------------ */

  mascara = construirMascara();
  if (!mascara) return;

  medir();

  function remedir() {
    if (medir() && sinMovimiento.matches) pintarQuieto();
  }

  window.addEventListener('resize', remedir, { passive: true });

  // El evento resize no cubre todos los casos: la ventana puede pasar
  // de 0 a su tamaño real sin dispararlo (pestaña que se muestra por
  // primera vez). El ResizeObserver sí lo ve. Mismo recurso que usan
  // js/route-line.js y js/fondos.js.
  if ('ResizeObserver' in window) {
    new ResizeObserver(remedir).observe(document.documentElement);
  }

  if (punteroFino.matches && !sinMovimiento.matches) {
    window.addEventListener('mousemove', function (e) {
      cursorX = e.clientX;
      cursorY = e.clientY;
      lupaObjetivo = 1;
    }, { passive: true });

    document.addEventListener('mouseleave', function () {
      lupaObjetivo = 0;
    });
  }

  if (sinMovimiento.matches) {
    pintarQuieto();
  } else {
    arrancarBucle();
  }

  // Se muestra recién cuando ya hay algo dibujado, para que no aparezca
  // un rectángulo vacío antes del primer frame.
  window.requestAnimationFrame(function () {
    canvas.classList.add('is-listo');
  });

  // Con la pestaña en segundo plano no tiene sentido seguir calculando.
  document.addEventListener('visibilitychange', function () {
    if (sinMovimiento.matches) return;
    if (document.hidden) {
      activo = false;
    } else {
      // Siempre se reagenda al volver, sin preguntar si ya estaba
      // corriendo: es justo el caso en que la bandera puede haber
      // quedado desincronizada del bucle real.
      arrancarBucle();
    }
  });
})();
