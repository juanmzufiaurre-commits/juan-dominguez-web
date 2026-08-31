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
 *   4. EL OVNI — easter egg: cada tanto a uno de esos aviones le toca
 *      salir con forma de platillo, y hacerle click devuelve a la intro.
 *
 * Las cuatro cosas viven solo en escritorio con movimiento permitido: en
 * celular el mapa se dibuja una vez y se queda quieto (ver modoQuieto).
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
  /* Mismo umbral que el resto del sitio (768px). Debajo de eso el mapa
     se dibuja quieto — ver modoQuieto() más abajo. */
  const consultaMobile = window.matchMedia('(max-width: 768px)');

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
     EASTER EGG — EL OVNI
     ------------------------------------------------------------
     Cada tanto, uno de los aviones que cruzan el fondo sale con forma
     de platillo. Si se le hace click, la página vuelve a la intro.

     Los 15s son el intervalo MÍNIMO entre platillos, no un reloj fijo:
     el ovni no aparece por su cuenta sino que le toca el turno al
     próximo avión que salga, y los aviones salen cada 4 a 10 segundos.
     Es a propósito — un platillo puntual cada 15s exactos se lee como
     un elemento de interfaz; uno que aparece "cuando aparece" se lee
     como un hallazgo, que es de lo que se trata. */
  const CADA_OVNI = 15000;

  /* Radio de click, bastante más grande que el dibujo (unos 12px de
     ancho). Un blanco de 12px es imposible de acertar mientras se
     mueve; con 22 se puede sin que deje de ser un gesto deliberado. */
  const RADIO_OVNI = 22;

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

  /* Cuándo puede volver a tocarle a un platillo, y dónde está el que
     hay ahora en pantalla (null si no hay). La posición se guarda en
     cada frame porque el click se resuelve por distancia: el canvas es
     pointer-events: none —está debajo del texto— así que no puede
     recibir el click él mismo. */
  let proximoOvni = CADA_OVNI;
  let ovniEnPantalla = null;

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

  function nuevoAvion(esOvni) {
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
      /* El platillo cruza más lento que un avión: da tiempo a verlo,
         reconocerlo y decidir hacerle click. Con la duración de un avión
         el easter egg era casi inalcanzable. */
      duracion: esOvni ? 13000 + Math.random() * 4000
                       : 7000 + Math.random() * 5000,
      // Fase tras aterrizar: la estela se apaga sola
      apagado: 0,
      ovni: !!esOvni
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

      if (a.ovni) {
        // El platillo NO se rota hacia la ruta: un ovni se mantiene
        // horizontal aunque se desplace en diagonal, y esa quietud es
        // justamente lo que lo delata entre los aviones.
        dibujarOvni();
        ovniEnPantalla = { x: punta.x, y: punta.y };
      } else {
        ctx.rotate(angulo);
        dibujarAeronave();
      }

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

  /**
   * La aeronave, en planta y con el origen ya trasladado y rotado hacia
   * su rumbo. Silueta de 737: fuselaje con morro afinado, ala en flecha
   * nacida a media eslora y estabilizador horizontal en la cola.
   *
   * Reemplaza a la punta de flecha que había antes. Una flecha se lee
   * como un cursor o un marcador de dirección, no como un avión — y en
   * una página sobre importación, los aviones son el tema.
   *
   * Mide unos 16 de largo por 14 de envergadura contra los 10x7 de la
   * flecha. Tuvo que crecer: por debajo de eso el ala en flecha y el
   * estabilizador se funden en una mancha y vuelve a parecer un triángulo.
   *
   * Las coordenadas son a ojo de la planta de un 737, no calcadas: a
   * este tamaño lo que importa es la relación entre fuselaje, ala y
   * cola, no la exactitud del contorno.
   */
  function dibujarAeronave() {
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = COLOR_ACENTO;

    // Fuselaje: morro en punta adelante, cono de cola atrás
    ctx.beginPath();
    ctx.moveTo(8.5, 0);
    ctx.quadraticCurveTo(4.5, -1.5, 0, -1.6);
    ctx.lineTo(-6, -1.2);
    ctx.quadraticCurveTo(-7.5, 0, -6, 1.2);
    ctx.lineTo(0, 1.6);
    ctx.quadraticCurveTo(4.5, 1.5, 8.5, 0);
    ctx.fill();

    /* Alas y estabilizadores, espejados.
       La FLECHA DEL ALA es lo que decide si esto se lee como avión de
       línea o como caza: el borde de ataque avanza 3,2 en 6,4 de
       semienvergadura, unos 27°, que es lo que tiene un 737. Con 37°
       —el primer intento— parecía un caza.
       El estrechamiento también importa: cuerda 4,2 en la raíz contra
       1,7 en la punta. Un ala de cuerda pareja se lee como tabla. */
    for (let lado = -1; lado <= 1; lado += 2) {
      // Ala
      ctx.beginPath();
      ctx.moveTo(2.6, 0.6 * lado);
      ctx.lineTo(-0.6, 7 * lado);
      ctx.lineTo(-2.3, 7 * lado);
      ctx.lineTo(-1.6, 0.6 * lado);
      ctx.closePath();
      ctx.fill();

      /* Motores, por delante del ala y colgados de ella. Son dos manchas
         de 2x1 que a tamaño real casi no se distinguen, pero rompen el
         borde de ataque y es eso lo que termina de decir "bimotor de
         pasajeros" en vez de "ala sola". */
      ctx.beginPath();
      ctx.ellipse(1.7, 3.2 * lado, 1.2, 0.62, 0, 0, Math.PI * 2);
      ctx.fill();

      // Estabilizador horizontal
      ctx.beginPath();
      ctx.moveTo(-4.6, 0.6 * lado);
      ctx.lineTo(-6.6, 3.4 * lado);
      ctx.lineTo(-7.5, 3.4 * lado);
      ctx.lineTo(-6.2, 0.6 * lado);
      ctx.closePath();
      ctx.fill();
    }
  }

  /**
   * El platillo, dibujado con el origen ya trasladado a su posición.
   * Mide unos 12x8, lo mismo que ocupa el avión: se pidió que no se
   * distinga por tamaño sino por forma.
   */
  function dibujarOvni() {
    // Las luces del borde laten. Es la única señal en movimiento propio
    // que tiene, y desde que se le sacó el halo, la única pista de que
    // ahí hay algo distinto de un avión.
    const latido = 0.5 + 0.5 * Math.sin(performance.now() / 260);

    ctx.fillStyle = COLOR_ACENTO;

    /* SIN HALO A PROPÓSITO. Tenía una elipse tenue alrededor que lo
       hacía notorio; se sacó para que pase desapercibido, que es lo que
       corresponde a un easter egg. El precio es que hay que mirar para
       encontrarlo, y está bien que así sea. */

    // Cúpula
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    ctx.ellipse(0, -1.2, 3.2, 2.8, 0, Math.PI, 0);
    ctx.fill();

    // Casco
    ctx.globalAlpha = 0.95;
    ctx.beginPath();
    ctx.ellipse(0, 0, 6.2, 2.1, 0, 0, Math.PI * 2);
    ctx.fill();

    // Luces de abajo
    ctx.globalAlpha = 0.45 + latido * 0.5;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.arc(i * 3.1, 1.9, 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
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
      // Le toca el turno al platillo si ya pasó su intervalo y no hay
      // otro cruzando. La condición de "no hay otro" evita que dos
      // platillos coincidan en pantalla, que arruinaría el hallazgo.
      const tocaOvni = ahora > proximoOvni && !ovniEnPantalla;
      aviones.push(nuevoAvion(tocaOvni));
      if (tocaOvni) proximoOvni = ahora + CADA_OVNI;
      proximoAvion = ahora + 4000 + Math.random() * 6000;
    }

    /* Se borra antes de dibujar y lo repone dibujarAvion() si el
       platillo sigue en pantalla. Así la posición para el click nunca
       queda apuntando a un ovni que ya se fue. */
    ovniEnPantalla = null;

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

  /* En el celular el mapa se dibuja UNA VEZ y se queda quieto.
   *
   * El costo del bucle no está en los puntos (son unos 270 por frame,
   * baratos): está en que cada frame borra y repinta el canvas ENTERO —
   * 1,22 megapíxeles a dpr 2 — y como es una capa fija sobre toda la
   * página, obliga al navegador a recomponerla sin parar. Encima las
   * estelas de los aviones son 52 trazos punteados por frame. En un
   * teléfono eso se siente al scrollear.
   *
   * Lo que se pierde es poco: la lupa necesita un cursor que en el celu
   * no existe, y los aviones y la deriva son decorativos. La trama de
   * continentes, que es lo que se ve, queda igual. */
  function modoQuieto() {
    return sinMovimiento.matches || consultaMobile.matches;
  }

  function remedir() {
    if (medir() && modoQuieto()) pintarQuieto();
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

  /* ------------------------------------------------------------
     EASTER EGG — CLICK EN EL OVNI
     ------------------------------------------------------------
     El canvas es pointer-events: none (vive debajo del texto, ver
     css/mapa.css), así que no puede recibir el click él mismo. Se
     escucha en la ventana y se resuelve por distancia contra la
     posición que el bucle publica en cada frame. */

  let volviendo = false;

  function sobreElOvni(x, y) {
    if (!ovniEnPantalla) return false;
    return Math.hypot(x - ovniEnPantalla.x, y - ovniEnPantalla.y) < RADIO_OVNI;
  }

  window.addEventListener('click', function (e) {
    if (volviendo || !sobreElOvni(e.clientX, e.clientY)) return;

    /* No se secuestra un click destinado a otra cosa. Si el platillo
       pasa por encima de un botón o un enlace, gana el botón: perder el
       easter egg es intrascendente, mandar a alguien de vuelta a la
       intro cuando quiso escribir por WhatsApp no lo es. */
    const destino = e.target;
    if (destino && destino.closest &&
        destino.closest('a, button, input, textarea, select, [role="button"]')) return;

    volviendo = true;

    /* Un corte a negro corto antes de recargar. Sin él la recarga se
       lee como un fallo de la página en vez de como una respuesta al
       click. */
    const telon = document.createElement('div');
    telon.style.cssText =
      'position:fixed;inset:0;z-index:9999;background:#070B14;opacity:0;' +
      'pointer-events:none;transition:opacity 260ms ease';
    document.body.appendChild(telon);
    // Un frame de por medio: sin esto el navegador aplica los dos
    // estilos juntos y no hay transición que ver.
    window.requestAnimationFrame(function () { telon.style.opacity = '1'; });

    window.setTimeout(function () { window.location.reload(); }, 280);
  });

  /* SIN CURSOR DE MANO, A PROPÓSITO.
     Había un listener que ponía el puntero en 'pointer' al pasar por
     encima del platillo. Se quitó: delataba el easter egg antes de que
     nadie lo buscara. El ovni se puede clickear igual —el listener de
     arriba no depende de ningún indicio visual— pero no se anuncia. */

  if (modoQuieto()) {
    pintarQuieto();
  } else {
    arrancarBucle();
  }

  // Si se cruza el umbral de tamaño (rotar el teléfono, redimensionar la
  // ventana), se cambia de modo en vez de quedar en el que tocó al cargar.
  if ('addEventListener' in consultaMobile) {
    consultaMobile.addEventListener('change', function () {
      if (modoQuieto()) {
        activo = false;
        if (frameEnCurso) window.cancelAnimationFrame(frameEnCurso);
        frameEnCurso = 0;
        medir();
        pintarQuieto();
      } else {
        arrancarBucle();
      }
    });
  }

  // Se muestra recién cuando ya hay algo dibujado, para que no aparezca
  // un rectángulo vacío antes del primer frame.
  window.requestAnimationFrame(function () {
    canvas.classList.add('is-listo');
  });

  // Con la pestaña en segundo plano no tiene sentido seguir calculando.
  document.addEventListener('visibilitychange', function () {
    if (modoQuieto()) return;
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
