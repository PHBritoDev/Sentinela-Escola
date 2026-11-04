/**
 * Saúde+ · Sentinela — ambientação Three.js opcional na tela de login.
 * Sem dependências no backend. Não interfere em botões, autenticação ou dados.
 * Carrega a biblioteca somente após o carregamento da página e quando há GPU adequada.
 */
(() => {
  "use strict";

  const hero = document.querySelector(".login-arte");
  if (!hero || !window.WebGL2RenderingContext) return;

  const reduzido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const economizar = navigator.connection?.saveData || window.matchMedia("(prefers-reduced-data: reduce)").matches;
  const poucaMemoria = navigator.deviceMemory && navigator.deviceMemory <= 2;
  const poucosNucleos = navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2;
  if (reduzido || economizar || poucaMemoria || poucosNucleos) return;

  const mobile = window.matchMedia("(max-width: 900px)").matches;
  const biblioteca = "https://cdn.jsdelivr.net/npm/three@0.187.0/build/three.module.js";

  async function iniciar() {
    // Falha na CDN ou falta de WebGL não afetam o login.
    let THREE;
    try {
      THREE = await import(biblioteca);
    } catch {
      return;
    }
    if (!hero.isConnected) return;

    const canvas = document.createElement("canvas");
    canvas.className = "login-vfx";
    canvas.setAttribute("aria-hidden", "true");
    hero.appendChild(canvas);

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        powerPreference: "low-power",
        failIfMajorPerformanceCaveat: true
      });
    } catch {
      canvas.remove();
      return;
    }

    renderer.setPixelRatio(1);
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 40);
    camera.position.z = 10;

    // Um único draw call para as partículas; quantidade limitada em celulares.
    const quantidade = mobile ? 24 : 52;
    const vertices = new Float32Array(quantidade * 3);
    for (let i = 0; i < quantidade; i++) {
      const j = i * 3;
      vertices[j] = (Math.random() - 0.5) * 9;
      vertices[j + 1] = (Math.random() - 0.5) * 8;
      vertices[j + 2] = (Math.random() - 0.5) * 3;
    }
    const particulasGeo = new THREE.BufferGeometry();
    particulasGeo.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
    const particulasMaterial = new THREE.PointsMaterial({
      color: 0xc6fff5,
      size: mobile ? 0.065 : 0.045,
      transparent: true,
      opacity: 0.68,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const particulas = new THREE.Points(particulasGeo, particulasMaterial);
    scene.add(particulas);

    // Órbitas médicas discretas (geometrias simples, sem texturas ou shaders externos).
    const aros = [];
    const geometrias = [particulasGeo];
    const materiais = [particulasMaterial];
    if (!mobile) {
      for (let i = 0; i < 2; i++) {
        const pontos = [];
        for (let n = 0; n < 72; n++) {
          const a = n / 72 * Math.PI * 2;
          pontos.push(new THREE.Vector3(Math.cos(a) * 1.45, Math.sin(a) * 1.45, 0));
        }
        const geometria = new THREE.BufferGeometry().setFromPoints(pontos);
        const material = new THREE.LineBasicMaterial({
          color: i === 0 ? 0xb3fff0 : 0x9ccaff,
          transparent: true,
          opacity: i === 0 ? 0.22 : 0.13,
          depthTest: false,
          depthWrite: false
        });
        const aro = new THREE.LineLoop(geometria, material);
        aro.position.set(2.1, 0.9, -1.5);
        aro.rotation.set(0.45 + i * 0.7, i * 0.7, i * 0.3);
        aros.push(aro);
        geometrias.push(geometria);
        materiais.push(material);
        scene.add(aro);
      }
    }

    const escala = mobile ? 0.65 : 0.75;
    function redimensionar() {
      const largura = hero.clientWidth;
      const altura = hero.clientHeight;
      if (!largura || !altura) return;
      camera.aspect = largura / altura;
      camera.updateProjectionMatrix();
      renderer.setSize(
        Math.max(1, Math.floor(largura * escala)),
        Math.max(1, Math.floor(altura * escala)),
        false
      );
    }
    redimensionar();

    let visivel = true;
    let ativo = false;
    let raf = 0;
    let timer = 0;
    let encerrado = false;

    function parar() {
      ativo = false;
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      raf = 0;
      timer = 0;
    }

    function quadro(agora) {
      if (!ativo || encerrado) return;
      const t = agora * 0.001;
      particulas.rotation.y = Math.sin(t * 0.13) * 0.10;
      particulas.position.y = Math.sin(t * 0.28) * 0.11;
      for (let i = 0; i < aros.length; i++) {
        aros[i].rotation.z = t * (i ? -0.045 : 0.05);
      }
      renderer.render(scene, camera);

      // Em vez de 60 FPS, ~12-20 FPS (conforme dispositivo).
      timer = setTimeout(() => {
        if (ativo) raf = requestAnimationFrame(quadro);
      }, mobile ? 65 : 34);
    }

    function sincronizar() {
      const deveAnimar = !encerrado && visivel && !document.hidden;
      if (!deveAnimar) {
        parar();
      } else if (!ativo) {
        ativo = true;
        raf = requestAnimationFrame(quadro);
      }
    }

    const observer = typeof IntersectionObserver === "function"
      ? new IntersectionObserver(entradas => {
          visivel = entradas[0]?.isIntersecting ?? true;
          sincronizar();
        }, { threshold: 0.01 })
      : null;
    observer?.observe(hero);

    const resizer = typeof ResizeObserver === "function"
      ? new ResizeObserver(redimensionar)
      : null;
    if (resizer) resizer.observe(hero);
    else window.addEventListener("resize", redimensionar, { passive: true });

    document.addEventListener("visibilitychange", sincronizar);

    function limpar() {
      if (encerrado) return;
      encerrado = true;
      parar();
      observer?.disconnect();
      resizer?.disconnect();
      window.removeEventListener("resize", redimensionar);
      document.removeEventListener("visibilitychange", sincronizar);
      geometrias.forEach(item => item.dispose());
      materiais.forEach(item => item.dispose());
      renderer.dispose();
      canvas.remove();
    }
    canvas.addEventListener("webglcontextlost", e => {
      e.preventDefault();
      limpar();
    }, { once: true });
    window.addEventListener("pagehide", limpar, { once: true });
    sincronizar();
  }

  // O login e suas chamadas à API têm prioridade sobre os efeitos decorativos.
  function agendar() {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(iniciar, { timeout: 1800 });
    } else {
      setTimeout(iniciar, 450);
    }
  }
  if (document.readyState === "complete") agendar();
  else window.addEventListener("load", agendar, { once: true });
})();
