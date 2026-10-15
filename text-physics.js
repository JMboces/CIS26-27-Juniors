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
      script.onload = () => {
        if (global.Matter) {
          resolve(global.Matter);
        } else {
          reject(new Error("Matter.js loaded but was not available."));
        }
      };
      script.onerror = () => {
        global.__textPhysicsPromise = null;
        reject(new Error("Failed to load Matter.js"));
      };
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
      sensitivity: 2,
      minDistance: 160,
      sampleWindow: 140,
      directions: ["up", "down"],
      gravity: 1.2,
      restitution: 0.62,
      airFriction: 0.012,
      ...options
    };

    let engine = null;
    let layer = null;
    let particles = [];
    let walls = [];
    let active = false;
    let destroyed = false;
    let armed = true;
    let raf = 0;
    let generation = 0;
    let samples = [];
    let resetTimer = null;

    const originalVisibility = target.style.visibility;
    const resetButton = document.getElementById("resetPhysics");
    const originalButtonVisibility = resetButton
      ? resetButton.style.visibility
      : "";

    const api = {
      ready: null,
      get active() {
        return active;
      },
      reset,
      destroy
    };

    function addWalls() {
      if (!engine || !global.Matter) return;

      const M = global.Matter;

      walls.forEach(wall => {
        M.Composite.remove(engine.world, wall);
      });

      const width = global.innerWidth;
      const height = global.innerHeight;
      const thickness = 100;

      walls = [
        M.Bodies.rectangle(
          -thickness / 2, height / 2,
          thickness, height * 3,
          { isStatic: true }
        ),
        M.Bodies.rectangle(
          width + thickness / 2, height / 2,
          thickness, height * 3,
          { isStatic: true }
        ),
        M.Bodies.rectangle(
          width / 2, height + thickness / 2 - 8,
          width * 2, thickness,
          { isStatic: true }
        ),
        M.Bodies.rectangle(
          width / 2, -thickness / 2,
          width * 2, thickness,
          { isStatic: true }
        )
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
            if (!node.nodeValue.trim()) {
              return NodeFilter.FILTER_REJECT;
            }

            const parent = node.parentElement;

            if (!parent) return NodeFilter.FILTER_REJECT;

            if (parent.closest(
              "script, style, noscript, textarea, input, select, " +
              "button, svg, canvas, .text-physics-layer, " +
              "[data-text-physics-ignore]"
            )) {
              return NodeFilter.FILTER_REJECT;
            }

            return NodeFilter.FILTER_ACCEPT;
          }
        }
      );

      const nodes = [];

      while (walker.nextNode()) {
        nodes.push(walker.currentNode);
      }

      const range = document.createRange();

      for (const node of nodes) {
        const regex = /\S+/g;
        let match;

        while ((match = regex.exec(node.nodeValue))) {
          range.setStart(node, match.index);
          range.setEnd(node, match.index + match[0].length);

          const rect = range.getBoundingClientRect();

          if (
            rect.width <= 0 ||
            rect.height <= 0 ||
            rect.bottom <= 0 ||
            rect.top >= global.innerHeight ||
            rect.right <= 0 ||
            rect.left >= global.innerWidth
          ) {
            continue;
          }

          const style = global.getComputedStyle(node.parentElement);

          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            Number(style.opacity) === 0
          ) {
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
      }

      return words;
    }

    function removeParticles() {
      for (const particle of particles) {
        particle.el.remove();
      }

      particles = [];
    }

    function recover() {
      active = false;
      generation++;

      cancelAnimationFrame(raf);
      removeParticles();

      if (layer) {
        layer.replaceChildren();
        layer.style.display = "none";
      }

      target.style.visibility = originalVisibility;

      if (resetButton) {
        resetButton.style.visibility = originalButtonVisibility;
      }

      if (engine && global.Matter) {
        global.Matter.Composite.clear(engine.world, false);
        addWalls();
      }
    }

    function breakText(direction, speed) {
      if (
        active ||
        destroyed ||
        !armed ||
        !engine ||
        !layer
      ) {
        return;
      }

      let words;

      try {
        words = collectWords();

        if (!words.length) return;

        active = true;
        armed = false;

        layer.replaceChildren();
        layer.style.display = "block";
        layer.style.visibility = "visible";

        removeParticles();

        const M = global.Matter;

        M.Composite.clear(engine.world, false);
        addWalls();

        // Hide the original content only after word collection succeeds.
        // The animation layer is outside the body so it stays visible.
        target.style.visibility = "hidden";

        // Keep the reset control available when the body is the target.
        if (resetButton && target.contains(resetButton)) {
          resetButton.style.visibility = "visible";
        }

        const kick = Math.min(32, speed * 5);
        const sign = direction === "down" ? 1 : -1;

        for (const word of words) {
          const el = document.createElement("span");

          el.className = "text-physics-particle";
          el.textContent = word.text;

          Object.assign(el.style, {
            position: "absolute",
            left: "0",
            top: "0",
            display: "inline-block",
            whiteSpace: "pre",
            font: word.font,
            color: word.color,
            letterSpacing: word.letterSpacing,
            lineHeight: "1",
            transformOrigin: "center",
            userSelect: "none",
            willChange: "transform",
            visibility: "visible"
          });

          layer.appendChild(el);

          const width = Math.max(word.width, 8);
          const height = Math.max(word.height, 12);

          const x = Math.max(
            width / 2,
            Math.min(
              global.innerWidth - width / 2,
              word.x + width / 2
            )
          );

          const y = Math.max(
            height / 2,
            Math.min(
              global.innerHeight - height / 2,
              word.y + height / 2
            )
          );

          const body = M.Bodies.rectangle(
            x, y, width, height,
            {
              friction: 0.35,
              frictionStatic: 0.5,
              frictionAir: config.airFriction,
              restitution: config.restitution,
              density: 0.0015,
              chamfer: { radius: 2 }
            }
          );

          M.Body.setVelocity(body, {
            x: (Math.random() - 0.5) * kick,
            y: sign * (5 + Math.random() * kick)
          });

          M.Body.setAngularVelocity(
            body,
            (Math.random() - 0.5) * 0.4
          );

          M.Composite.add(engine.world, body);

          particles.push({
            el,
            body,
            width,
            height
          });
        }

        const currentGeneration = ++generation;
        let lastFrame = performance.now();

        function tick(now) {
          if (
            !active ||
            destroyed ||
            currentGeneration !== generation
          ) {
            return;
          }

          try {
            const delta = Math.min(now - lastFrame, 33.3);
            lastFrame = now;

            M.Engine.update(engine, delta || 16.667);

            for (const particle of particles) {
              const { el, body, width, height } = particle;

              el.style.transform =
                `translate3d(` +
                `${body.position.x - width / 2}px,` +
                `${body.position.y - height / 2}px,0) ` +
                `rotate(${body.angle}rad)`;
            }

            raf = requestAnimationFrame(tick);
          } catch (error) {
            console.error("TextPhysics animation failed:", error);
            recover();
            armed = true;
          }
        }

        raf = requestAnimationFrame(tick);
      } catch (error) {
        console.error("TextPhysics could not start:", error);
        recover();
        armed = true;
      }
    }

    function reset() {
      if (destroyed) return;

      recover();
      samples = [];
      armed = false;

      if (resetTimer !== null) {
        clearTimeout(resetTimer);
      }

      resetTimer = setTimeout(() => {
        resetTimer = null;

        if (!destroyed) {
          samples = [];
          armed = true;
        }
      }, 250);
    }

    function destroy() {
      if (destroyed) return;

      reset();
      destroyed = true;

      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onResize);

      if (resetTimer !== null) {
        clearTimeout(resetTimer);
        resetTimer = null;
      }

      if (layer) {
        layer.remove();
        layer = null;
      }

      if (engine && global.Matter) {
        global.Matter.Engine.clear(engine);
        engine = null;
      }

      target.style.visibility = originalVisibility;

      if (resetButton) {
        resetButton.style.visibility = originalButtonVisibility;
      }
    }

    function onScroll() {
      if (destroyed || active || !armed) return;

      const now = performance.now();
      const y = global.scrollY;

      samples.push({ y, time: now });

      samples = samples.filter(
        sample => now - sample.time <= config.sampleWindow
      );

      if (samples.length < 2) return;

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

    function onResize() {
      if (!active) return;
      addWalls();
    }

    api.ready = loadMatter()
      .then(M => {
        if (destroyed) return api;

        engine = M.Engine.create({
          gravity: {
            x: 0,
            y: config.gravity
          }
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
          visibility: "visible",
          border: "8px solid #171717",
          borderTop: "0",
          boxSizing: "border-box"
        });

        // Place the layer outside body so hiding body cannot hide particles.
        document.documentElement.appendChild(layer);

        if (!document.getElementById("text-physics-styles")) {
          const style = document.createElement("style");

          style.id = "text-physics-styles";
          style.textContent = `
            .text-physics-layer {
              pointer-events: none !important;
              visibility: visible !important;
            }

            .text-physics-particle {
              position: absolute;
              top: 0;
              left: 0;
              white-space: pre;
              transform-origin: center;
              line-height: 1;
              user-select: none;
              will-change: transform;
              visibility: visible;
            }
          `;

          document.head.appendChild(style);
        }

        addWalls();

        addEventListener("scroll", onScroll, { passive: true });
        addEventListener("resize", onResize);

        return api;
      })
      .catch(error => {
        console.error("TextPhysics initialization failed:", error);
        throw error;
      });

    return api;
  }

  global.TextPhysics = { apply };
})(window);