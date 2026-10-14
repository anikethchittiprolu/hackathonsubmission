// Scroll-driven sky → space scene for the participant page.
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const root = document.documentElement, body = document.body;
  const $ = (s) => document.querySelector(s);
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

  // ----- scene markup -----
  const scene = document.createElement('div'); scene.className = 'scene'; scene.setAttribute('aria-hidden', 'true');
  scene.innerHTML = `<canvas id="stars"></canvas>
    <div class="body moon"></div><div class="body planet"></div><div class="body gas"></div><div class="earth"></div>
    <div class="cloud" data-s=".55" style="width:320px;height:70px;left:6%;top:14%"></div>
    <div class="cloud" data-s=".8" style="width:420px;height:90px;right:4%;top:30%"></div>
    <div class="cloud" data-s="1.1" style="width:280px;height:60px;left:38%;top:52%"></div>
    <div class="cloud" data-s="1.4" style="width:520px;height:110px;left:-6%;top:74%"></div>`;
  body.prepend(scene);
  const rocket = document.createElement('div'); rocket.className = 'rocket';
  rocket.innerHTML = `<svg viewBox="0 0 60 140"><g class="flame"><path d="M22 100 Q30 150 38 100Z" fill="#38bdf8"/><path d="M25 100 Q30 130 35 100Z" fill="#fff"/></g>
    <path d="M30 4 C46 24 48 52 46 84 L14 84 C12 52 14 24 30 4Z" fill="#fff" stroke="#bcd3ff" stroke-width="2"/>
    <path d="M30 4 C38 14 42 24 44 34 L16 34 C18 24 22 14 30 4Z" fill="#2563eb"/><circle cx="30" cy="54" r="9" fill="#38bdf8" stroke="#1d4ed8" stroke-width="3"/>
    <path d="M14 66 L2 96 L14 90Z M46 66 L58 96 L46 90Z" fill="#2563eb"/><rect x="22" y="84" width="16" height="14" rx="3" fill="#1d4ed8"/></svg>`;
  body.append(rocket);
  const hud = document.createElement('div'); hud.className = 'hud'; hud.innerHTML = '<small>Altitude</small><b id="altKm">0 km</b><em id="altStage">Launchpad</em>'; body.append(hud);
  const rail = document.createElement('div'); rail.className = 'rail';
  rail.innerHTML = '<i></i>' + [['0', 'GROUND'], ['.12', 'SKY'], ['.38', 'EDGE'], ['.7', 'ORBIT'], ['.97', 'DEEP SPACE']].map(([p, l]) => `<b style="top:${p * 100}%">${l}</b>`).join('');
  body.append(rail);
  const totop = document.createElement('button'); totop.className = 'totop'; totop.textContent = '↑'; totop.title = 'Back to launchpad'; totop.onclick = () => scrollTo({ top: 0, behavior: 'smooth' }); body.append(totop);
  rail.onclick = (e) => { const r = rail.getBoundingClientRect(); const p = clamp((e.clientY - r.top) / r.height); scrollTo({ top: p * (root.scrollHeight - innerHeight), behavior: 'smooth' }); };

  // ----- starfield -----
  const cv = $('#stars'), ctx = cv.getContext('2d'); let W, H, stars = [], mx = 0, my = 0, tx = 0, ty = 0, shoot = [];
  function size() {
    const d = Math.min(devicePixelRatio || 1, 2); W = cv.width = innerWidth * d; H = cv.height = innerHeight * d; cv.style.width = innerWidth + 'px'; cv.style.height = innerHeight + 'px';
    const n = Math.round((innerWidth * innerHeight) / 5500); stars = Array.from({ length: n }, () => ({ x: Math.random() * W, y: Math.random() * H, z: Math.random() * 0.9 + 0.1, tw: Math.random() * 6.28, c: Math.random() < .18 ? '#bfe3ff' : '#ffffff' }));
  }
  size(); addEventListener('resize', size);
  addEventListener('mousemove', (e) => { tx = (e.clientX / innerWidth - .5); ty = (e.clientY / innerHeight - .5); }, { passive: true });

  // ----- scroll state -----
  let sp = 0, target = 0;
  const clouds = [...scene.querySelectorAll('.cloud')], moon = $('.body.moon'), planet = $('.body.planet'), gas = $('.body.gas'), earth = $('.earth');
  const stage = (km) => km < 1 ? 'Launchpad' : km < 12 ? 'Troposphere' : km < 50 ? 'Stratosphere' : km < 85 ? 'Mesosphere' : km < 300 ? 'Thermosphere' : 'Low Earth orbit';
  function readScroll() {
    const max = root.scrollHeight - innerHeight; target = body.classList.contains('anon') ? 0.93 : (max > 0 ? clamp(scrollY / max) : 0);
  }
  addEventListener('scroll', readScroll, { passive: true }); addEventListener('resize', readScroll);
  new ResizeObserver(readScroll).observe(body);
  new MutationObserver(readScroll).observe(body, { attributes: true, attributeFilter: ['class'] });

  let t0 = performance.now(), last = 0;
  function frame(t) {
    requestAnimationFrame(frame); if (document.hidden) return;
    sp += (target - sp) * (reduce ? 1 : .09); const anon = body.classList.contains('anon');
    root.style.setProperty('--sp', sp.toFixed(4));
    body.classList.toggle('night', sp > .36);
    const y = scrollY, vh = innerHeight;
    clouds.forEach((c) => { c.style.transform = `translateY(${-(y * c.dataset.s)}px)`; c.style.opacity = clamp(1 - (sp - .12) / .22); });
    const f = (a, b) => clamp((sp - a) / (b - a));
    moon.style.opacity = f(.3, .5); moon.style.transform = `translate(${-tx * 30}px,${-(y * .06) - ty * 20}px)`;
    planet.style.opacity = f(.45, .65); planet.style.transform = `translate(${tx * 40}px,${-(y * .1)}px) rotate(${y * .01}deg)`;
    gas.style.opacity = f(.55, .75); gas.style.transform = `translate(${-tx * 50}px,${-(y * .14)}px)`;
    earth.style.opacity = f(.6, .8) * .9; earth.style.transform = `translateY(${-(f(.6, 1)) * 18}vh)`;
    // rocket + HUD
    const km = Math.round(sp * 420 * (anon ? 0 : 1)); const ry = anon ? 0.4 + Math.sin(t / 900) * .01 : 0.07 + sp * 0.78;
    rocket.style.bottom = (ry * 100) + 'vh'; rocket.style.transform = `rotate(${(tx * 6).toFixed(1)}deg) translateX(${Math.sin(t / 700) * 2}px)`;
    $('#altKm').textContent = km + ' km'; $('#altStage').textContent = anon ? 'Awaiting launch' : stage(km);
    rail.firstChild.style.top = (sp * 100) + '%'; totop.classList.toggle('show', y > 500);
    // stars
    mx += (tx - mx) * .05; my += (ty - my) * .05; const a = clamp((sp - .2) / .45);
    ctx.clearRect(0, 0, W, H);
    if (a > .01) {
      const d = W / innerWidth;
      for (const s of stars) {
        const px = ((s.x - mx * 60 * s.z * d) % W + W) % W, py = ((s.y - y * .25 * s.z * d - my * 40 * s.z * d) % H + H) % H;
        ctx.globalAlpha = a * (.45 + .55 * Math.sin(t / 700 + s.tw)) * (.5 + s.z * .5); ctx.fillStyle = s.c; ctx.beginPath(); ctx.arc(px, py, s.z * 1.6 * d, 0, 6.283); ctx.fill();
      }
      if (!reduce && Math.random() < .004 && shoot.length < 2) shoot.push({ x: Math.random() * W * .8, y: Math.random() * H * .4, l: 0 });
      shoot = shoot.filter((s) => s.l < 1); ctx.lineWidth = 2 * d;
      for (const s of shoot) { s.l += .025; const x = s.x + s.l * 260 * d, yy = s.y + s.l * 130 * d, g = ctx.createLinearGradient(x, yy, x - 90 * d, yy - 45 * d); g.addColorStop(0, '#fff'); g.addColorStop(1, 'transparent'); ctx.globalAlpha = a * (1 - s.l); ctx.strokeStyle = g; ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x - 90 * d, yy - 45 * d); ctx.stroke(); }
      ctx.globalAlpha = 1;
    }
  }
  readScroll(); sp = target; requestAnimationFrame(frame);

  // ----- reveal on scroll -----
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .08 });
  document.querySelectorAll('main section').forEach((s) => { s.classList.add('rv'); io.observe(s); });

  // ----- scrollspy -----
  const navBtns = [...document.querySelectorAll('#nav button')];
  addEventListener('scroll', () => {
    let cur = navBtns[0]; for (const b of navBtns) { const el = document.getElementById(b.dataset.go); if (el && el.getBoundingClientRect().top < innerHeight * .4) cur = b; }
    navBtns.forEach((b) => b.classList.toggle('on', b === cur));
  }, { passive: true });

  // ----- 3D tilt on problem cards (event delegation) -----
  const grid = $('#probs');
  if (grid && !reduce) {
    grid.addEventListener('mousemove', (e) => { const c = e.target.closest('.ps'); if (!c) return; const r = c.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5; c.style.transform = `perspective(700px) rotateY(${x * 7}deg) rotateX(${-y * 7}deg) translateY(-3px)`; });
    grid.addEventListener('mouseout', (e) => { const c = e.target.closest('.ps'); if (c) c.style.transform = ''; });
  }

  // ----- celebration: rocket launch + confetti -----
  window.celebrate = () => {
    if (reduce) return;
    const r = document.createElement('div'); r.className = 'launch'; r.innerHTML = rocket.innerHTML; body.append(r); setTimeout(() => r.remove(), 2600);
    const c = document.createElement('canvas'); c.id = 'confetti'; c.width = innerWidth; c.height = innerHeight; body.append(c); const g = c.getContext('2d');
    const P = Array.from({ length: 160 }, () => ({ x: innerWidth / 2, y: innerHeight * .85, vx: (Math.random() - .5) * 16, vy: -Math.random() * 18 - 6, s: Math.random() * 7 + 3, col: ['#2563eb', '#38bdf8', '#ffffff', '#93c5fd', '#1d4ed8'][Math.floor(Math.random() * 5)], r: Math.random() * 6 }));
    let n = 0; (function step() { g.clearRect(0, 0, c.width, c.height); P.forEach((p) => { p.vy += .45; p.x += p.vx; p.y += p.vy; p.r += .2; g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.fillStyle = p.col; g.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * .6); g.restore(); }); if (++n < 140) requestAnimationFrame(step); else c.remove(); })();
  };
})();
