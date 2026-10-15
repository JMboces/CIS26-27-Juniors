(function (global) {
  "use strict";

  const CDN =
    "https://cdnjs.cloudflare.com/ajax/libs/matter-js/0.20.0/matter.min.js";

  function loadMatter() {
    if (global.Matter) return Promise.resolve(global.Matter);

    if (global.__textPhysicsPromise) {
      return global.__textPhysicsPromise;
    }

    global.__textPhysicsPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = CDN;
      script.onload = () => resolve(global.Matter);
      script.onerror = () => reject(new Error("Failed to load Matter.js"));
      document.head.appendChild(script);
    });

    return global.__textPhysicsPromise;
  }

  function apply(target = document.body, options = {}) {
    if (typeof target === "string") {
      target = document.querySelector(target);
    }

    if (!target) throw new Error("Target element not found");

    const config = {
      sensitivity: 2.0,
      minDistance: 160,
      sampleWindow: 140,
      directions: ["up", "down"],
      gravity: 1.2,
      restitution: 0.62,
      airFriction: 0.012,
      ...options
    };

    let engine, layer;
    let particles = [];
    let walls = [];
    let active = false;
    let destroyed = false;
    let armed = true;
    let raf = 0;
    let generation = 0;
    let samples = [];
    let originalVisibility = target.style.visibility;

    const api = {
      ready: null,
      get active() { return active; },
      reset,
      destroy
    };

    function addWalls() {
      const M = global.Matter;
      walls.forEach(w => M.Composite.remove(engine.world, w));

      const w = innerWidth;
      const h = innerHeight;
      const t = 100;

      walls = [
        M.Bodies.rectangle(-t / 2, h / 2, t, h * 3, { isStatic: true }),
        M.Bodies.rectangle(w + t / 2, h / 2, t, h * 3, { isStatic: true }),
        M.Bodies.rectangle(w / 2, h + t / 2 - 8, w * 2, t, { isStatic: true }),
        M.Bodies.rectangle(w / 2, -t / 2, w * 2, t, { isStatic: true })
      ];

      M.Composite.add(engine.world, walls);
    }

    function collectWords() {
      const words = [];
      const walker = document.createTreeWalker(
        target,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode(node) {
            if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;

            if (node.parentElement.closest(
              "script,style,noscript,textarea,input,select,button," +
              "[data-text-physics-ignore],.text-physics-layer"
            )) return NodeFilter.FILTER_REJECT;

            return NodeFilter.FILTER_ACCEPT;
          }
        }
      );

      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);

      const range = document.createRange();

      nodes.forEach(node => {
        const regex = /\S+/g;
        let match;

        while ((match = regex.exec(node.nodeValue))) {
          range.setStart(node, match.index);
          range.setEnd(node, match.index + match[0].length);

          const rect = range.getBoundingClientRect();

          if (
            rect.width <= 0 || rect.height <= 0 ||
            rect.bottom <= 0 || rect.top >= innerHeight ||
            rect.right <= 0 || rect.left >= innerWidth
          ) continue;

          const style = getComputedStyle(node.parentElement);

          if (style.display === "none" || style.visibility === "hidden") {
            continue;
          }

          words.push({
            text: match[0],
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height,
            font: style.font,
            color: style.color,
            letterSpacing: style.letterSpacing
          });
        }
      });

      return words;
    }

    function breakText(direction, speed) {
      if (active || destroyed || !armed) return;

      const M = global.Matter;
      const words = collectWords();
      if (!words.length) return;

      active = true;
      armed = false;

      layer.style.display = "block";
      target.style.visibility = "hidden";
      layer.replaceChildren();

      particles.forEach(p => p.el.remove());
      particles = [];

      M.Composite.clear(engine.world, false);
      addWalls();

      words.forEach(word => {
        const el = document.createElement("span");
        el.className = "text-physics-particle";
        el.textContent = word.text;
        el.style.font = word.font;
        el.style.color = word.color;
        el.style.letterSpacing = word.letterSpacing;
        layer.appendChild(el);

        const w = Math.max(word.width, 8);
        const h = Math.max(word.height, 12);
        const x = Math.max(w / 2 + 8,
          Math.min(innerWidth - w / 2 - 8, word.x + w / 2));
        const y = Math.max(h / 2,
          Math.min(innerHeight - h / 2 - 10, word.y + h / 2));

        const body = M.Bodies.rectangle(x, y, w, h, {
          friction: 0.35,
          frictionStatic: 0.5,
          frictionAir: config.airFriction,
          restitution: config.restitution,
          density: 0.0015,
          chamfer: { radius: 2 }
        });

        const kick = Math.min(32, speed * 5);
        const sign = direction === "down" ? 1 : -1;

        M.Body.setVelocity(body, {
          x: (Math.random() - 0.5) * kick,
          y: sign * (5 + Math.random() * kick)
        });

        M.Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.4);
        M.Composite.add(engine.world, body);

        particles.push({ el, body, width: w, height: h });
      });

      const currentGeneration = ++generation;
      let lastFrame = performance.now();

      function tick(now) {
        if (!active || destroyed || currentGeneration !== generation) {
          return;
        }

        const delta = Math.min(now - lastFrame, 33.3);
        lastFrame = now;
        M.Engine.update(engine, delta || 16.667);

        particles.forEach(({ el, body, width, height }) => {
          el.style.transform =
            `translate3d(${body.position.x - width / 2}px,` +
            `${body.position.y - height / 2}px,0) ` +
            `rotate(${body.angle}rad)`;
        });

        raf = requestAnimationFrame(tick);
      }

      raf = requestAnimationFrame(tick);
    }

    function reset() {
      if (destroyed) return;

      active = false;
      armed = false;
      generation++;
      cancelAnimationFrame(raf);
      samples = [];

      if (engine) {
        global.Matter.Composite.clear(engine.world, false);
        addWalls();
      }

      particles.forEach(p => p.el.remove());
      particles = [];

      if (layer) {
        layer.replaceChildren();
        layer.style.display = "none";
      }

      target.style.visibility = originalVisibility;

      setTimeout(() => {
        if (destroyed) return;
        samples = [];
        armed = true;
      }, 250);
    }

    function destroy() {
      if (destroyed) return;

      reset();
      destroyed = true;

      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onResize);

      if (layer) layer.remove();
      if (engine) global.Matter.Engine.clear(engine);
      target.style.visibility = originalVisibility;
    }

    function onScroll() {
      if (destroyed || active || !armed) return;

      const now = performance.now();
      const y = window.scrollY;

      samples.push({ y, time: now });
      samples = samples.filter(
        s => now - s.time <= config.sampleWindow
      );

      if (samples.length >= 2) {
        const first = samples[0];
        const elapsed = now - first.time;
        const delta = y - first.y;
        const distance = Math.abs(delta);
        const direction = delta < 0 ? "up" : "down";
        const speed = distance / Math.max(elapsed, 1);

        if (
          config.directions.includes(direction) &&
          elapsed > 0 &&
          distance >= config.minDistance &&
          speed >= config.sensitivity
        ) {
          breakText(direction, speed);
        }
      }
    }

    function onResize() {
      if (active) addWalls();
    }

    api.ready = loadMatter().then(M => {
      if (destroyed) return api;

      engine = M.Engine.create({
        gravity: { x: 0, y: config.gravity }
      });

      engine.positionIterations = 8;
      engine.velocityIterations = 6;

      layer = document.createElement("div");
      layer.className = "text-physics-layer";

      Object.assign(layer.style, {
        display: "none",
        position: "fixed",
        inset: "0",
        zIndex: "9998",
        overflow: "hidden",
        pointerEvents: "none",
        border: "8px solid #171717",
        borderTop: "0"
      });

      document.body.appendChild(layer);

      if (!document.getElementById("text-physics-styles")) {
        const style = document.createElement("style");
        style.id = "text-physics-styles";
        style.textContent = `
          .text-physics-particle {
            position: absolute;
            top: 0;
            left: 0;
            display: inline-block;
            white-space: pre;
            transform-origin: center;
            line-height: 1;
            user-select: none;
            will-change: transform;
          }
        `;
        document.head.appendChild(style);
      }

      addEventListener("scroll", onScroll, { passive: true });
      addEventListener("resize", onResize);

      return api;
    });

    return api;
  }

  global.TextPhysics = { apply };
})(window);