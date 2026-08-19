import * as THREE from "three";

// ─── THE WORLD BETWEEN SECONDS · deterministic world ────────────────────────
// Everything in the scene is a pure function of timeline state.
// Scroll back and the whole city walks backwards. Scroll forward and it resumes.

export interface WorldCtx {
  realT: number; dt: number;
  s: number; vel: number;
  year: number; yearVis: number;
  tau: number; animT: number; freeze: number;
  instability: number; branches: number; reveal: number;
  voidAmt: number; particleAmt: number;
  mouseX: number; mouseY: number;
  camPos: THREE.Vector3;
  altered: boolean;
}

const ss = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mulberry = (seed: number) => () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d")!;
  draw(g);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function roadTexture() {
  return canvasTex(1024, 1024, (g) => {
    g.fillStyle = "#151a20"; g.fillRect(0, 0, 1024, 1024); // blocks
    const toPx = (v: number) => ((v + 65) / 130) * 1024;
    const road = (x0: number, x1: number, y0: number, y1: number) => {
      g.fillStyle = "#0c0f13";
      g.fillRect(toPx(x0), toPx(y0), toPx(x1) - toPx(x0), toPx(y1) - toPx(y0));
    };
    road(-10, -2, -65, 65); road(2, 10, -65, 65);      // avenues (z runs vertically)
    road(-65, 65, -29, -19); road(-65, 65, 13, 23);    // cross streets
    // sidewalks
    g.fillStyle = "#1d232b";
    for (const [a, b] of [[-11.6, -10], [-2, -0.4], [0.4, 2], [10, 11.6]] as const) {
      g.fillRect(toPx(a), 0, toPx(b) - toPx(a), 1024);
    }
    // lane dashes
    g.strokeStyle = "#3d3a26"; g.lineWidth = 3; g.setLineDash([26, 30]);
    for (const x of [-6, 6]) {
      g.beginPath(); g.moveTo(toPx(x), 0); g.lineTo(toPx(x), 1024); g.stroke();
    }
    for (const z of [-24, 18]) {
      g.beginPath(); g.moveTo(0, toPx(z)); g.lineTo(1024, toPx(z)); g.stroke();
    }
    g.setLineDash([]);
    // crosswalks
    g.fillStyle = "#39414b";
    for (const zc of [-24, 18]) for (const xc of [-6, 6]) {
      for (let i = -3; i <= 3; i++) {
        g.fillRect(toPx(xc - 3.4), toPx(zc + i * 1.3 - 0.35), toPx(6.8) - toPx(0) , 7);
      }
    }
    // noise
    for (let i = 0; i < 5200; i++) {
      g.fillStyle = `rgba(${Math.random() > 0.5 ? 255 : 0},${Math.random() > 0.5 ? 255 : 0},255,0.012)`;
      g.fillRect(Math.random() * 1024, Math.random() * 1024, 2, 2);
    }
  });
}

function glowSpriteTex(inner: string, outer: string) {
  return canvasTex(128, 128, (g) => {
    const gr = g.createRadialGradient(64, 64, 2, 64, 64, 64);
    gr.addColorStop(0, inner);
    gr.addColorStop(0.35, outer);
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  });
}

function billboardTex(lines: string[], bg: string, fg: string, accent: string) {
  return canvasTex(512, 256, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, 512, 256);
    g.strokeStyle = accent; g.lineWidth = 6; g.strokeRect(8, 8, 496, 240);
    g.fillStyle = fg; g.textAlign = "center";
    g.font = "700 46px Michroma, 'Space Grotesk', sans-serif";
    lines.forEach((l, i) => g.fillText(l, 256, 118 + i * 58 - ((lines.length - 1) * 29)));
    g.fillStyle = accent;
    g.fillRect(40, 210, 432, 4);
  });
}

// window-grid emissive injection for instanced buildings
function windowMaterial(color: string, uni: { uLit: { value: number }; uWarm: { value: number }; uTimeW: { value: number } }) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0.22 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uLit = uni.uLit; sh.uniforms.uWarm = uni.uWarm; sh.uniforms.uTimeW = uni.uTimeW;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWpos;\nvarying vec3 vWnorm;\nvarying vec3 vSeedP;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        vec4 wpt = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wpt = instanceMatrix * wpt;
          vSeedP = instanceMatrix[3].xyz;
        #else
          vSeedP = vec3(0.0);
        #endif
        vWpos = (modelMatrix * wpt).xyz;
        vWnorm = normalize(mat3(modelMatrix) * normal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
        varying vec3 vWpos; varying vec3 vWnorm; varying vec3 vSeedP;
        uniform float uLit; uniform float uWarm; uniform float uTimeW;`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        {
          float wall = 1.0 - step(0.72, abs(vWnorm.y));
          float gy = fract(vWpos.y * 0.85);
          float gx = fract((abs(vWnorm.x) > 0.5 ? vWpos.z : vWpos.x) * 0.62);
          float win = step(gy, 0.52) * step(gx, 0.58) * step(2.2, vWpos.y) * wall;
          vec2 cell = floor(vec2(vWpos.y * 0.85, (abs(vWnorm.x) > 0.5 ? vWpos.z : vWpos.x) * 0.62));
          float h = fract(sin(dot(cell + floor(vSeedP.xz * 3.17), vec2(127.1, 311.7))) * 43758.5453);
          float lit = step(h, uLit) * win;
          float flick = 1.0 - 0.35 * step(0.93, h) * step(0.0, sin(uTimeW * 2.6 + h * 90.0));
          vec3 wcol = mix(vec3(0.62, 0.74, 0.95), vec3(1.0, 0.72, 0.4), uWarm);
          totalEmissiveRadiance += wcol * lit * flick * 1.35;
        }`);
  };
  return mat;
}

interface BData { x: number; z: number; w: number; d: number; h: number; }

export class World {
  group = new THREE.Group();
  private skyUni!: { uTop: { value: THREE.Color }; uBot: { value: THREE.Color }; uHor: { value: THREE.Color }; uStars: { value: number }; uGlitch: { value: number }; uTime: { value: number } };
  private winUni = { uLit: { value: 0.5 }, uWarm: { value: 0.1 }, uTimeW: { value: 0 } };
  private rainUni!: { uAnimT: { value: number }; uAmt: { value: number }; uDir: { value: number }; uPixel: { value: number } };
  private steamUni!: { uAnimT: { value: number }; uAmt: { value: number } };
  private refUni!: { uTurn: { value: number }; uGaze: { value: number }; uVanish: { value: number }; uTime: { value: number }; uLead: { value: number }; uAlpha: { value: number } };
  private fracUnis: { uTime: { value: number }; uOp: { value: number }; uColA: { value: THREE.Color }; uColB: { value: THREE.Color } }[] = [];

  private modern!: THREE.InstancedMesh; private modernData: BData[] = [];
  private meridian!: THREE.Mesh; private crane!: THREE.Group;
  private future!: THREE.InstancedMesh; private futureData: BData[] = [];
  private low!: THREE.InstancedMesh; private lowData: BData[] = [];
  private huts!: THREE.InstancedMesh; private hutData: BData[] = [];
  private trunks!: THREE.InstancedMesh; private crowns!: THREE.InstancedMesh; private treeData: BData[] = [];
  private mountains!: THREE.InstancedMesh;
  private cars!: THREE.InstancedMesh; private carData: { lane: number; x: number; dir: number; sp: number; off: number }[] = [];
  private ghostCars!: THREE.InstancedMesh;
  private peds!: THREE.InstancedMesh; private pedData: { axis: number; lane: number; sp: number; off: number; ph: number }[] = [];
  private ghostPeds!: THREE.InstancedMesh;
  private carts!: THREE.InstancedMesh;
  private darts!: THREE.InstancedMesh;
  private birds: THREE.Mesh[] = [];
  private train!: THREE.Group; private skytrain!: THREE.Group; private trainWinMat!: THREE.MeshBasicMaterial;
  private ocean!: THREE.Mesh; private ground!: THREE.Mesh; private groundMat!: THREE.MeshStandardMaterial;
  private lamps!: THREE.InstancedMesh; private lampHeads!: THREE.InstancedMesh; private lampPools!: THREE.InstancedMesh;
  private bbModern!: THREE.Mesh; private bb1998!: THREE.Mesh; private bbAnomaly!: THREE.Mesh; private bbHidden!: THREE.Mesh; private bbPast!: THREE.Mesh;
  private clockMesh!: THREE.Mesh; private clockCtx!: CanvasRenderingContext2D; private clockTex!: THREE.CanvasTexture; private clockMat!: THREE.MeshBasicMaterial;
  private tlMats: THREE.MeshBasicMaterial[] = [];
  private entity!: THREE.Group; private entityHead!: THREE.Mesh; private entityLight!: THREE.PointLight;
  private watcher!: THREE.Mesh;
  private particle!: THREE.Sprite;
  private fractures: THREE.Mesh[] = [];
  private branchesGrp: THREE.Group | null = null;
  private branchMat!: THREE.MeshBasicMaterial; private branchLineMat!: THREE.LineBasicMaterial;
  private hemi!: THREE.HemisphereLight; private moon!: THREE.DirectionalLight;
  private sodium!: THREE.PointLight; private fireLight!: THREE.PointLight;
  private dummy = new THREE.Object3D();
  private lastVis: Record<string, number> = {};
  private quality: number;
  private clockTimer = 0;

  constructor(quality: number) {
    this.quality = quality;
    this.buildSky(); this.buildGround(); this.buildBuildings(); this.buildStreet();
    this.buildActors(); this.buildWeather(); this.buildReflection(); this.buildEntity();
    this.buildAnomalyBits(); this.buildFractures();
    this.group.add(this.modern, this.future, this.low, this.huts, this.trunks, this.crowns, this.mountains);
  }

  // ── construction ──────────────────────────────────────────────────────────
  private buildSky() {
    this.skyUni = {
      uTop: { value: new THREE.Color("#05070d") }, uBot: { value: new THREE.Color("#1a2334") },
      uHor: { value: new THREE.Color("#2c3a52") }, uStars: { value: 0.2 }, uGlitch: { value: 0 }, uTime: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false, uniforms: this.skyUni,
      vertexShader: `varying vec3 vDir;
        void main(){ vDir = (modelMatrix * vec4(position,1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying vec3 vDir;
        uniform vec3 uTop,uBot,uHor; uniform float uStars,uGlitch,uTime;
        float hash(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7)))*43758.5453); }
        void main(){
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = mix(uHor, uTop, smoothstep(0.02, 0.55, h));
          col = mix(uBot, col, smoothstep(-0.3, 0.04, h));
          float st = 0.0;
          if (h > 0.02 && uStars > 0.01) {
            vec3 c = floor(d * 210.0);
            float rn = hash(c);
            if (rn > 0.9965) st = (rn - 0.9965) / 0.0035 * (0.6 + 0.4 * sin(uTime * 2.0 + rn * 200.0));
          }
          col += vec3(0.8, 0.9, 1.0) * st * uStars;
          float band = step(0.965, sin(d.y * 42.0 + uTime * 2.4)) * uGlitch;
          col += vec3(0.6, 0.05, 0.16) * band;
          col += vec3(0.0, 0.5, 0.6) * step(0.985, sin(d.y * 130.0 - uTime * 5.0)) * uGlitch * 0.5;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(440, 24, 16), mat);
    dome.renderOrder = -10;
    this.group.add(dome);

    this.hemi = new THREE.HemisphereLight(0x26313f, 0x05060a, 0.55);
    this.moon = new THREE.DirectionalLight(0x9fb8d8, 0.6);
    this.moon.position.set(70, 90, -50);
    this.group.add(this.hemi, this.moon);
  }

  private buildGround() {
    this.groundMat = new THREE.MeshStandardMaterial({
      map: roadTexture(), color: 0x8b909a, roughness: 0.62, metalness: 0.3, transparent: true,
    });
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(130, 130), this.groundMat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ocean = new THREE.Mesh(
      new THREE.PlaneGeometry(1400, 1400),
      new THREE.MeshStandardMaterial({ color: 0x05131d, roughness: 0.28, metalness: 0.72, transparent: true, opacity: 0 })
    );
    this.ocean.rotation.x = -Math.PI / 2; this.ocean.position.y = -0.55;
    this.mountains = new THREE.InstancedMesh(
      new THREE.ConeGeometry(1, 1, 7),
      new THREE.MeshStandardMaterial({ color: 0x0a0f16, roughness: 1, transparent: true, opacity: 0 }),
      12
    );
    const r = mulberry(77);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + r() * 0.5;
      const rad = 175 + r() * 70;
      this.dummy.position.set(Math.cos(a) * rad, 0, Math.sin(a) * rad);
      this.dummy.scale.set(42 + r() * 46, 26 + r() * 60, 42 + r() * 46);
      this.dummy.rotation.set(0, r() * 3, 0);
      this.dummy.updateMatrix();
      this.mountains.setMatrixAt(i, this.dummy.matrix);
    }
    this.group.add(this.ground, this.ocean, this.mountains);
  }

  private makePlotBuildings(mat: THREE.Material, geo: THREE.BufferGeometry, data: BData[]) {
    const mesh = new THREE.InstancedMesh(geo, mat, data.length);
    data.forEach((b, i) => {
      this.dummy.position.set(b.x, b.h / 2, b.z);
      this.dummy.scale.set(b.w, b.h, b.d);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);
      const sh = 0.55 + Math.random() * 0.45;
      mesh.setColorAt(i, new THREE.Color(sh, sh, sh * 1.04));
    });
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    return mesh;
  }

  private buildBuildings() {
    const r = mulberry(1234);
    const xs = [-52, -38, -24, -14, 14, 24, 38, 52];
    const zs = [-52, -38, -14, 0, 8, 32, 45];
    for (const x of xs) for (const z of zs) {
      if (Math.abs(x - 14) < 4 && Math.abs(z - 8) < 4) continue;   // meridian plot
      if (Math.abs(x - 14) < 4 && Math.abs(z + 14) < 5) continue;  // reflection plot
      const n = 2 + Math.floor(r() * 2);
      for (let i = 0; i < n; i++) {
        const central = Math.exp(-(x * x + z * z) / 2600);
        this.modernData.push({
          x: x + (r() - 0.5) * 8, z: z + (r() - 0.5) * 8,
          w: 4.5 + r() * 4.5, d: 4.5 + r() * 4.5,
          h: 7 + central * 44 * (0.45 + r() * 0.75),
        });
      }
    }
    this.modern = this.makePlotBuildings(
      windowMaterial("#12161d", this.winUni), new THREE.BoxGeometry(1, 1, 1), this.modernData);

    // Meridian Spire — the construction-site time machine
    this.meridian = new THREE.Mesh(
      new THREE.BoxGeometry(7, 40, 7),
      windowMaterial("#181d26", this.winUni)
    );
    this.meridian.position.set(14, 20, 8);
    this.crane = new THREE.Group();
    const cm = new THREE.MeshStandardMaterial({ color: 0xc9a24a, roughness: 0.7, emissive: 0x2a2008, emissiveIntensity: 0.5 });
    const mast = new THREE.Mesh(new THREE.BoxGeometry(0.5, 34, 0.5), cm); mast.position.y = 17;
    const jib = new THREE.Mesh(new THREE.BoxGeometry(20, 0.4, 0.4), cm); jib.position.set(6, 33, 0);
    const tie = new THREE.Mesh(new THREE.BoxGeometry(0.12, 6, 0.12), cm); tie.position.set(12, 30.5, 0);
    this.crane.add(mast, jib, tie);
    this.crane.position.set(19.5, 0, 12);
    this.group.add(this.meridian, this.crane);

    // future spires
    const rf = mulberry(42);
    for (let i = 0; i < 30 * this.quality; i++) {
      const a = rf() * Math.PI * 2, rad = 26 + rf() * 48;
      this.futureData.push({
        x: Math.cos(a) * rad, z: Math.sin(a) * rad,
        w: 2.5 + rf() * 3, d: 2.5 + rf() * 3, h: 55 + rf() * 95,
      });
    }
    const fmat = windowMaterial("#0c141c", { uLit: { value: 0.34 }, uWarm: { value: 0 }, uTimeW: this.winUni.uTimeW });
    this.future = this.makePlotBuildings(fmat, new THREE.BoxGeometry(1, 1, 1), this.futureData);

    // 1700 town
    const rl = mulberry(9);
    for (let i = 0; i < 36; i++) {
      const a = rl() * Math.PI * 2, rad = 7 + rl() * 34;
      this.lowData.push({ x: Math.cos(a) * rad, z: Math.sin(a) * rad, w: 3 + rl() * 2.4, d: 3 + rl() * 2.4, h: 3 + rl() * 3.2 });
    }
    this.lowData.push({ x: -8, z: -6, w: 5, d: 5, h: 15 }); // chapel
    this.low = this.makePlotBuildings(
      windowMaterial("#1c1712", { uLit: { value: 0.5 }, uWarm: { value: 0.95 }, uTimeW: this.winUni.uTimeW }),
      new THREE.BoxGeometry(1, 1, 1), this.lowData);

    // year-500 huts
    const rh = mulberry(5);
    for (let i = 0; i < 13; i++) {
      const a = (i / 13) * Math.PI * 2 + rh() * 0.4, rad = 6 + rh() * 8;
      this.hutData.push({ x: Math.cos(a) * rad, z: Math.sin(a) * rad + 2, w: 2.6 + rh(), d: 2.6 + rh(), h: 2.6 + rh() * 1.2 });
    }
    this.huts = this.makePlotBuildings(
      new THREE.MeshStandardMaterial({ color: 0x241a10, roughness: 1 }), new THREE.ConeGeometry(0.72, 1, 6), this.hutData);

    // pre-human forest
    const rt = mulberry(31337);
    const nT = Math.floor(430 * this.quality);
    for (let i = 0; i < nT; i++) {
      const a = rt() * Math.PI * 2, rad = 16 + rt() * 200;
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      if (Math.abs(x) < 13 && Math.abs(z) < 34) continue;
      this.treeData.push({ x, z, w: 0.3 + rt() * 0.3, d: 0.3 + rt() * 0.3, h: 3.5 + rt() * 5.5 });
    }
    this.trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.14, 0.2, 1, 5),
      new THREE.MeshStandardMaterial({ color: 0x2a1f14, roughness: 1, transparent: true, opacity: 0 }), this.treeData.length);
    this.crowns = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 7),
      new THREE.MeshStandardMaterial({ color: 0x0e2418, roughness: 1, transparent: true, opacity: 0 }), this.treeData.length);
    this.treeData.forEach((t, i) => {
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.position.set(t.x, t.h * 0.3, t.z); this.dummy.scale.set(t.w * 2, t.h * 0.6, t.w * 2);
      this.dummy.updateMatrix(); this.trunks.setMatrixAt(i, this.dummy.matrix);
      this.dummy.position.set(t.x, t.h * 0.75, t.z); this.dummy.scale.set(t.w * 6.5, t.h * 1.15, t.w * 6.5);
      this.dummy.updateMatrix(); this.crowns.setMatrixAt(i, this.dummy.matrix);
      const g = 0.7 + rt() * 0.5;
      this.crowns.setColorAt(i, new THREE.Color(0.35 * g, 0.72 * g, 0.42 * g));
    });
    this.trunks.frustumCulled = this.crowns.frustumCulled = false;
  }

  private buildStreet() {
    // street lamps + sodium pools
    const n = 20;
    this.lamps = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.09, 5.4, 6),
      new THREE.MeshStandardMaterial({ color: 0x11151b, roughness: 0.8, transparent: true, opacity: 0 }), n);
    this.lampHeads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffc98a, transparent: true, opacity: 0 }), n);
    this.lampPools = new THREE.InstancedMesh(new THREE.PlaneGeometry(7, 7),
      new THREE.MeshBasicMaterial({ map: glowSpriteTex("rgba(255,190,120,0.5)", "rgba(255,170,90,0.12)"), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }), n);
    let li = 0;
    for (const x of [-2.4, 2.4]) for (let i = 0; i < 10; i++) {
      const z = -54 + i * 11 + (x > 0 ? 5 : 0);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.position.set(x, 2.7, z); this.dummy.scale.set(1, 1, 1); this.dummy.updateMatrix(); this.lamps.setMatrixAt(li, this.dummy.matrix);
      this.dummy.position.set(x, 5.45, z); this.dummy.updateMatrix(); this.lampHeads.setMatrixAt(li, this.dummy.matrix);
      this.dummy.rotation.x = -Math.PI / 2; this.dummy.position.set(x * 1.6, 0.03, z); this.dummy.updateMatrix(); this.lampPools.setMatrixAt(li, this.dummy.matrix);
      this.dummy.rotation.x = 0;
      li++;
    }
    this.group.add(this.lamps, this.lampHeads, this.lampPools);

    // traffic light at the taught intersection
    this.tlGrp = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4.6, 6), new THREE.MeshStandardMaterial({ color: 0x151a21 }));
    pole.position.set(10.8, 2.3, 13.6);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.4, 0.4), new THREE.MeshStandardMaterial({ color: 0x0a0d12 }));
    head.position.set(10.8, 4.4, 13.6);
    this.tlGrp.add(pole, head);
    const cols = [0xff4438, 0xffc24a, 0x3dff9a];
    for (let i = 0; i < 3; i++) {
      const m = new THREE.MeshBasicMaterial({ color: cols[i], transparent: true, opacity: 0.12 });
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.06), m);
      b.position.set(10.8, 4.85 - i * 0.45, 13.36);
      this.tlGrp.add(b); this.tlMats.push(m);
    }
    this.group.add(this.tlGrp);

    // elevated rail + train
    const rail = new THREE.Group();
    const beam = new THREE.Mesh(new THREE.BoxGeometry(340, 0.7, 2.2), new THREE.MeshStandardMaterial({ color: 0x171c24, roughness: 0.7, metalness: 0.4 }));
    beam.position.set(0, 9, -52);
    rail.add(beam);
    const pillars = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.6, 9, 6), new THREE.MeshStandardMaterial({ color: 0x12161d }), 22);
    for (let i = 0; i < 22; i++) {
      this.dummy.position.set(-160 + i * 15.2, 4.5, -52); this.dummy.scale.set(1, 1, 1); this.dummy.rotation.set(0, 0, 0);
      this.dummy.updateMatrix(); pillars.setMatrixAt(i, this.dummy.matrix);
    }
    rail.add(pillars);
    this.train = new THREE.Group();
    this.trainWinMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
    for (let c = 0; c < 5; c++) {
      const car = new THREE.Mesh(new THREE.BoxGeometry(9, 2.1, 2.3), new THREE.MeshStandardMaterial({ color: 0x1a2029, roughness: 0.4, metalness: 0.6 }));
      car.position.x = c * 9.6;
      const win = new THREE.Mesh(new THREE.BoxGeometry(8.2, 0.7, 2.36), this.trainWinMat);
      win.position.x = c * 9.6; win.position.y = 0.3;
      this.train.add(car, win);
    }
    this.train.position.set(0, 10.6, -52);
    rail.add(this.train);
    this.skytrain = this.train.clone();
    this.skytrain.position.y = 16.6; this.skytrain.scale.setScalar(0.7);
    rail.add(this.skytrain);
    this.railGrp = rail;
    this.group.add(rail);

    // sodium key light + fire light
    this.sodium = new THREE.PointLight(0xffb36b, 0, 34, 1.8); this.sodium.position.set(-6, 6.5, 12);
    this.fireLight = new THREE.PointLight(0xff8a3d, 0, 20, 1.8); this.fireLight.position.set(0, 1.6, 2);
    this.group.add(this.sodium, this.fireLight);
    const fireGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowSpriteTex("rgba(255,170,80,0.9)", "rgba(255,90,20,0.25)"), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    fireGlow.position.set(0, 0.9, 2); fireGlow.scale.setScalar(4.5);
    (fireGlow as unknown as { userData: { isFire: boolean } }).userData.isFire = true;
    this.group.add(fireGlow);
    this.fireGlowRef = fireGlow;
  }
  private fireGlowRef!: THREE.Sprite;
  private tlGrp!: THREE.Group;
  private railGrp!: THREE.Group;

  private buildActors() {
    const rc = mulberry(2026);
    const nC = Math.floor(72 * this.quality);
    this.cars = new THREE.InstancedMesh(new THREE.BoxGeometry(1.8, 1.15, 4.3),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.65, transparent: true, opacity: 1 }), nC);
    this.ghostCars = new THREE.InstancedMesh(new THREE.BoxGeometry(1.8, 1.15, 4.3),
      new THREE.MeshBasicMaterial({ color: 0x59f0ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }), Math.min(30, nC));
    const lanes = [
      { x: -8.2, dir: 1 }, { x: -3.8, dir: -1 }, { x: 3.8, dir: 1 }, { x: 8.2, dir: -1 },
    ];
    const palette = ["#39424e", "#5a4632", "#27333f", "#6e6a5e", "#3d2f3a", "#22303c", "#4a5560", "#7a5c3a"];
    for (let i = 0; i < nC; i++) {
      const l = lanes[i % 4];
      this.carData.push({ lane: i % 4, x: l.x, dir: l.dir, sp: 7 + rc() * 6, off: rc() * 240 });
      this.cars.setColorAt(i, new THREE.Color(palette[Math.floor(rc() * palette.length)]));
    }
    this.cars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.ghostCars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cars.frustumCulled = this.ghostCars.frustumCulled = false;

    // horse carts (1700)
    this.carts = new THREE.InstancedMesh(new THREE.BoxGeometry(2.1, 1.5, 3.6),
      new THREE.MeshStandardMaterial({ color: 0x3a2b1a, roughness: 0.95, transparent: true, opacity: 0 }), 10);
    this.carts.frustumCulled = false;

    // pedestrians (+1: the one who teaches you the mechanic)
    const nP = Math.floor(64 * this.quality);
    this.peds = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.17, 0.62, 3, 7),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, transparent: true, opacity: 1 }), nP + 1);
    this.ghostPeds = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.17, 0.62, 3, 7),
      new THREE.MeshBasicMaterial({ color: 0xdfe8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }), Math.min(24, nP));
    const coats = ["#232b36", "#3a3f4a", "#4a3b33", "#2c3a35", "#504a3c", "#33283a", "#26323e", "#5c564a"];
    for (let i = 0; i < nP; i++) {
      const axis = i % 2;
      const lane = axis === 0 ? (i % 4 < 2 ? -11.4 : 11.4) : (i % 4 < 2 ? -24 : 18);
      this.pedData.push({ axis, lane, sp: (0.9 + rc() * 0.8) * (rc() > 0.5 ? 1 : -1), off: rc() * 130, ph: rc() * 9 });
      this.peds.setColorAt(i, new THREE.Color(coats[Math.floor(rc() * coats.length)]));
    }
    // the one pedestrian who teaches the mechanic — crosses at z=16 between tau -4..6
    this.pedData.push({ axis: 2, lane: 16, sp: 1, off: 0, ph: 0 });
    this.peds.setColorAt(nP, new THREE.Color("#c8b090"));
    this.peds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.ghostPeds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.peds.frustumCulled = this.ghostPeds.frustumCulled = false;

    // future flying darts
    const nD = Math.floor(22 * this.quality);
    this.darts = new THREE.InstancedMesh(new THREE.ConeGeometry(0.4, 3, 6),
      new THREE.MeshStandardMaterial({ color: 0x0a1014, emissive: 0x6fd8ff, emissiveIntensity: 2.2, roughness: 0.3, transparent: true, opacity: 0 }), nD);
    this.darts.frustumCulled = false;

    // birds
    const bg = new THREE.ConeGeometry(0.14, 0.5, 4);
    for (let i = 0; i < 3; i++) {
      const b = new THREE.Mesh(bg, new THREE.MeshBasicMaterial({ color: 0x0a0d12 }));
      this.birds.push(b); this.group.add(b);
    }

    this.group.add(this.cars, this.ghostCars, this.carts, this.peds, this.ghostPeds, this.darts);

    // altered-timeline watcher (appears on revisits)
    this.watcher = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.62, 3, 7),
      new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 1 }));
    this.watcher.position.set(2.6, 0.74, 7);
    this.watcher.rotation.y = Math.PI;
    this.watcher.visible = false;
    this.group.add(this.watcher);
  }

  private buildWeather() {
    const nR = Math.floor(3400 * this.quality);
    const pos = new Float32Array(nR * 3), seed = new Float32Array(nR);
    const r = mulberry(88);
    for (let i = 0; i < nR; i++) {
      pos[i * 3] = (r() - 0.5) * 150; pos[i * 3 + 1] = r() * 62; pos[i * 3 + 2] = (r() - 0.5) * 150;
      seed[i] = r();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    this.rainUni = { uAnimT: { value: 0 }, uAmt: { value: 1 }, uDir: { value: 1 }, uPixel: { value: 1 } };
    const rm = new THREE.ShaderMaterial({
      uniforms: this.rainUni, transparent: true, depthWrite: false,
      vertexShader: `attribute float aSeed; uniform float uAnimT,uPixel,uDir; varying float vA;
        void main(){
          vec3 p = position;
          float sp = 15.0 + aSeed * 11.0;
          p.y = mod(p.y - uAnimT * sp * uDir, 62.0);
          p.x += sin(uAnimT * 0.6 + aSeed * 39.0) * 0.7;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = min((1.3 + aSeed * 1.7) * uPixel * (150.0 / max(1.0, -mv.z)), 4.5 * uPixel);
          vA = 0.28 + 0.5 * aSeed;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `varying float vA; uniform float uAmt;
        void main(){ gl_FragColor = vec4(0.62, 0.72, 0.84, vA * uAmt * 0.5); }`,
    });
    const rain = new THREE.Points(g, rm);
    rain.frustumCulled = false;
    this.group.add(rain);

    // steam vents
    const nS = 420;
    const sp2 = new Float32Array(nS * 3), ss2 = new Float32Array(nS);
    const vents = [[-13, 4], [12, -18], [-4, -32], [15, 26]];
    for (let i = 0; i < nS; i++) {
      const v = vents[i % 4];
      sp2[i * 3] = v[0] + (r() - 0.5) * 1.4; sp2[i * 3 + 1] = r(); sp2[i * 3 + 2] = v[1] + (r() - 0.5) * 1.4;
      ss2[i] = r();
    }
    const gs = new THREE.BufferGeometry();
    gs.setAttribute("position", new THREE.BufferAttribute(sp2, 3));
    gs.setAttribute("aSeed", new THREE.BufferAttribute(ss2, 1));
    this.steamUni = { uAnimT: { value: 0 }, uAmt: { value: 1 } };
    const smat = new THREE.ShaderMaterial({
      uniforms: this.steamUni, transparent: true, depthWrite: false,
      vertexShader: `attribute float aSeed; uniform float uAnimT; varying float vA;
        void main(){
          vec3 p = position;
          float h = mod(p.y * 7.0 + uAnimT * (1.1 + aSeed * 0.7), 7.0);
          p.y = h;
          p.x += sin(uAnimT * 0.8 + aSeed * 20.0) * h * 0.12;
          p.z += cos(uAnimT * 0.7 + aSeed * 17.0) * h * 0.12;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = (2.0 + h * 2.6) * (120.0 / max(1.0, -mv.z));
          vA = (1.0 - h / 7.0) * 0.5;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `varying float vA; uniform float uAmt;
        void main(){ gl_FragColor = vec4(0.55, 0.6, 0.66, vA * uAmt * 0.22); }`,
    });
    const steam = new THREE.Points(gs, smat);
    steam.frustumCulled = false;
    this.group.add(steam);
  }

  private buildReflection() {
    const tower = new THREE.Mesh(new THREE.BoxGeometry(10, 34, 6),
      new THREE.MeshStandardMaterial({ color: 0x0b1119, roughness: 0.14, metalness: 0.92 }));
    tower.position.set(17, 17, -8);
    this.group.add(tower);

    this.refUni = { uTurn: { value: 0 }, uGaze: { value: 0 }, uVanish: { value: 0 }, uTime: { value: 0 }, uLead: { value: 0 }, uAlpha: { value: 0 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.refUni, transparent: true, depthWrite: false,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying vec2 vUv;
        uniform float uTurn,uGaze,uVanish,uTime,uLead,uAlpha;
        void main(){
          vec2 p = vUv - 0.5; p.x *= 0.34;
          float fx = uLead;
          float bob = sin(uTime * 1.4) * 0.004;
          float head = length(vec2(p.x - fx, p.y - (0.28 + bob)) / vec2(0.052 * (1.0 - uTurn * 0.5), 0.066)) - 1.0;
          float body = length(vec2(p.x - fx, p.y + 0.03) / vec2(0.10 * (1.0 - uTurn * 0.55), 0.21)) - 1.0;
          float legs = length(vec2(p.x - fx, p.y + 0.31) / vec2(0.075, 0.11)) - 1.0;
          float fig = smoothstep(0.03, -0.04, min(head, min(body, legs)));
          float streak = 0.0;
          for (int i = 0; i < 5; i++) {
            float fi = float(i);
            float x = fract(sin(fi * 78.233) * 437.58) - 0.5;
            streak += smoothstep(0.014, 0.0, abs(p.x - x * 0.55)) * (0.12 + 0.06 * sin(uTime * 0.25 + fi * 2.0));
          }
          vec3 col = vec3(0.045, 0.06, 0.085) + vec3(0.5, 0.62, 0.78) * streak * 0.4;
          col = mix(col, vec3(0.01, 0.012, 0.018), fig);
          float eg = uGaze * step(0.72, uTurn);
          vec2 e1 = vec2(p.x - fx - 0.019 * (1.0 - uTurn * 0.8), p.y - (0.29 + bob));
          vec2 e2 = vec2(p.x - fx + 0.019 * (1.0 - uTurn * 0.8), p.y - (0.29 + bob));
          col += vec3(0.75, 0.95, 1.0) * (exp(-dot(e1, e1) * 110000.0) + exp(-dot(e2, e2) * 110000.0)) * eg * 3.2;
          float a = (0.5 + fig * 0.4 + streak * 0.25) * uAlpha * (1.0 - uVanish);
          gl_FragColor = vec4(col, a);
        }`,
    });
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 30), mat);
    pane.position.set(11.9, 15, -8);
    pane.rotation.y = -Math.PI / 2;
    this.group.add(pane);
  }

  private buildEntity() {
    this.entity = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x040406, roughness: 0.96, metalness: 0, emissive: 0x07131c, emissiveIntensity: 0.55 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.21, 1.02, 4, 10), mat);
    body.position.y = 0.76;
    this.entityHead = new THREE.Mesh(new THREE.SphereGeometry(0.165, 12, 10), mat);
    this.entityHead.position.y = 1.62;
    this.entityLight = new THREE.PointLight(0x7fd7ff, 0.5, 10, 1.8);
    this.entityLight.position.y = 1.2;
    this.entity.add(body, this.entityHead, this.entityLight);
    this.entity.visible = false;
    this.group.add(this.entity);
  }

  private buildAnomalyBits() {
    // billboards
    const mk = (w: number, h: number, tex: THREE.Texture, pos: [number, number, number], ry: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, side: THREE.DoubleSide }));
      m.position.set(...pos); m.rotation.y = ry;
      this.group.add(m);
      return m;
    };
    this.bbModern = mk(8, 4, billboardTex(["AION", "DRIVE TOMORROW"], "#04121c", "#9fd8ff", "#2b6a8a"), [-16.6, 16, -2], Math.PI / 2);
    this.bb1998 = mk(8, 4, billboardTex(["MERIDIAN COLA", "TASTE THE CENTURY"], "#170d04", "#ffc069", "#8a5a2b"), [-16.5, 16, -2], Math.PI / 2);
    this.bbAnomaly = mk(7, 3.4, billboardTex(["THIS HAS", "ALREADY HAPPENED."], "#000000", "#f2f5f7", "#3a3f45"), [9, 10.5, -33.4], 0);
    this.bbHidden = mk(7, 3.4, billboardTex(["YOU WERE NEVER", "ALONE HERE."], "#000000", "#9fd8ff", "#1c2733"), [9, 10.5, -33.2], 0);
    this.bbPast = mk(4.4, 2, billboardTex(["THE GOLDEN HOUR", "ALE · BREAD · REST"], "#120c06", "#e8b56a", "#5a4426"), [-9.5, 3.4, -3], Math.PI / 2.4);

    // impossible clock
    const c = document.createElement("canvas"); c.width = 256; c.height = 128;
    this.clockCtx = c.getContext("2d")!;
    this.clockTex = new THREE.CanvasTexture(c); this.clockTex.colorSpace = THREE.SRGBColorSpace;
    this.clockMat = new THREE.MeshBasicMaterial({ map: this.clockTex, transparent: true, opacity: 0 });
    this.clockMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.4), this.clockMat);
    this.clockMesh.position.set(-11.2, 4.4, 7); this.clockMesh.rotation.y = Math.PI / 2;
    this.group.add(this.clockMesh);
    this.drawClock("20:26:14", "#dfe8f2");

    // first second particle
    this.particle = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowSpriteTex("rgba(255,250,235,1)", "rgba(255,196,120,0.5)"),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0,
    }));
    this.particle.position.set(0, 2.6, -10);
    this.particle.scale.setScalar(0.5);
    this.group.add(this.particle);
  }

  private drawClock(text: string, color: string) {
    const g = this.clockCtx;
    g.fillStyle = "#04070b"; g.fillRect(0, 0, 256, 128);
    g.strokeStyle = "#24303c"; g.lineWidth = 4; g.strokeRect(4, 4, 248, 120);
    g.fillStyle = color; g.font = "400 44px Michroma, monospace"; g.textAlign = "center";
    g.fillText(text, 128, 80);
    this.clockTex.needsUpdate = true;
  }

  private buildFractures() {
    const geo = new THREE.PlaneGeometry(4.2, 6.4);
    const fragShader = `varying vec2 vUv; uniform float uTime,uOp; uniform vec3 uColA,uColB;
      void main(){
        vec2 p = vUv - 0.5;
        float c = abs(p.x * 0.9 + sin(p.y * 7.0) * 0.09);
        float c2 = abs(p.y * 0.8 + sin(p.x * 6.0 + 2.0) * 0.11);
        float m = min(c, c2);
        float crack = smoothstep(0.05, 0.0, m);
        float edge = smoothstep(0.17, 0.03, m);
        vec3 inside = mix(uColA, uColB, step(0.5, fract(p.y * 3.0 - uTime * 0.22 + p.x * 0.5)));
        vec3 col = inside * 0.3 + vec3(0.75, 0.95, 1.0) * crack * 1.7;
        gl_FragColor = vec4(col, (edge * 0.45 + crack) * uOp);
      }`;
    const vertShader = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
    const defs: [number, number, number, string, string][] = [
      [5.5, 3, -19, "#3a2a14", "#0d3341"],
      [-7.5, 3.4, -35, "#41101c", "#0a2a38"],
      [-14, 44, -46, "#2c1a08", "#123a4a"],
    ];
    for (const [x, y, z, ca, cb] of defs) {
      const uni = { uTime: { value: 0 }, uOp: { value: 0 }, uColA: { value: new THREE.Color(ca) }, uColB: { value: new THREE.Color(cb) } };
      const m = new THREE.Mesh(geo, new THREE.ShaderMaterial({
        uniforms: uni, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        vertexShader: vertShader, fragmentShader: fragShader,
      }));
      m.position.set(x, y, z);
      m.rotation.y = Math.atan2(x, z) * 0.4;
      this.fractures.push(m);
      this.fracUnis.push(uni);
      this.group.add(m);
    }
  }

  private buildBranches() {
    if (this.branchesGrp) return;
    const grp = new THREE.Group();
    const r = mulberry(4812);
    const nodes: THREE.Vector3[] = [new THREE.Vector3(0, 0, 0)];
    const parents: number[] = [-1];
    let frontier = [0];
    for (let depth = 0; depth < 6; depth++) {
      const next: number[] = [];
      for (const pi of frontier) {
        const kids = 2 + (r() > 0.55 ? 1 : 0);
        for (let k = 0; k < kids && nodes.length < 230; k++) {
          const dir = new THREE.Vector3(r() - 0.5, r() * 0.7 - 0.1, r() - 0.5).normalize();
          const len = (26 + r() * 16) * Math.pow(0.82, depth);
          const p = nodes[pi].clone().addScaledVector(dir, len);
          nodes.push(p); parents.push(pi); next.push(nodes.length - 1);
        }
      }
      frontier = next;
    }
    const perNode = 26;
    const total = nodes.length * perNode;
    this.branchMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 });
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.branchMat, total);
    let idx = 0;
    const col = new THREE.Color();
    nodes.forEach((n) => {
      const hue = 0.55 + r() * 0.1;
      for (let j = 0; j < perNode; j++) {
        const jx = (r() - 0.5) * 7, jz = (r() - 0.5) * 7;
        const h = 0.5 + r() * 3.4;
        this.dummy.position.set(n.x + jx, n.y + h / 2, n.z + jz);
        this.dummy.scale.set(0.5 + r() * 0.9, h, 0.5 + r() * 0.9);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.updateMatrix();
        inst.setMatrixAt(idx, this.dummy.matrix);
        col.setHSL(hue, 0.35, 0.4 + r() * 0.3);
        inst.setColorAt(idx, col);
        idx++;
      }
    });
    inst.frustumCulled = false;
    const lp: number[] = [];
    nodes.forEach((n, i) => {
      if (parents[i] >= 0) {
        const p = nodes[parents[i]];
        lp.push(p.x, p.y + 1, p.z, n.x, n.y + 1, n.z);
      }
    });
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.Float32BufferAttribute(lp, 3));
    this.branchLineMat = new THREE.LineBasicMaterial({ color: 0x3d5a70, transparent: true, opacity: 0 });
    grp.add(inst, new THREE.LineSegments(lg, this.branchLineMat));
    this.branchesGrp = grp;
    this.group.add(grp);
  }

  // ── public helpers ───────────────────────────────────────────────────────
  setSky(top: THREE.Color, bot: THREE.Color, hor: THREE.Color, stars: number) {
    (this.skyUni.uTop.value as THREE.Color).copy(top);
    (this.skyUni.uBot.value as THREE.Color).copy(bot);
    (this.skyUni.uHor.value as THREE.Color).copy(hor);
    this.skyUni.uStars.value = stars;
  }
  setPixelRatio(p: number) {
    this.rainUni.uPixel.value = p;
  }

  // ── per-frame update ─────────────────────────────────────────────────────
  update(ctx: WorldCtx) {
    const Y = ctx.yearVis;
    const { dummy: dm } = this;

    const modernVis = ss(1935, 1980, Y) * (1 - ss(2038, 2062, Y));
    const futureVis = ss(2045, 2090, Y);
    const analogVis = ss(1958, 1984, Y) * (1 - ss(2006, 2026, Y));
    const lowVis = ss(1450, 1600, Y) * (1 - ss(1880, 1940, Y));
    const hutVis = ss(-150, 250, Y) * (1 - ss(900, 1450, Y));
    const treeVis = 1 - ss(200, 800, Y);
    const mountVis = 1 - ss(-900, -150, Y);
    const oceanVis = 1 - ss(-4200, -2200, Y);
    const groundVis = 1 - ss(-2800, -1100, Y);

    // era atmosphere
    this.winUni.uTimeW.value = ctx.animT;
    this.winUni.uLit.value = 0.5 + 0.1 * Math.sin(ctx.animT * 0.05);
    this.winUni.uWarm.value = (1 - ss(1750, 2030, Y)) * 0.95;
    this.skyUni.uTime.value = ctx.realT;
    this.skyUni.uGlitch.value = Math.min(1, ctx.instability * 1.4) * (Y > 2150 ? 1 : 0.4) + (ctx.s > 0.27 && ctx.s < 0.305 ? 0.8 : 0);

    const setVis = (key: string, v: number, apply: (vis: number) => void) => {
      const prev = this.lastVis[key] ?? -1;
      if (Math.abs(prev - v) > 0.0025) { this.lastVis[key] = v; apply(v); }
    };

    setVis("modern", modernVis, (v) => {
      this.modernData.forEach((b, i) => {
        dm.position.set(b.x, (b.h * v) / 2, b.z); dm.scale.set(b.w, Math.max(0.001, b.h * v), b.d);
        dm.rotation.set(0, 0, 0); dm.updateMatrix(); this.modern.setMatrixAt(i, dm.matrix);
      });
      this.modern.instanceMatrix.needsUpdate = true;
      (this.lamps.material as THREE.Material & { opacity: number }).opacity = v;
      (this.lampHeads.material as THREE.Material & { opacity: number }).opacity = v;
      (this.lampPools.material as THREE.Material & { opacity: number }).opacity = v * 0.85;
      this.sodium.intensity = v * 26;
      this.bbModern.visible = v > 0.02;
      (this.bbModern.material as THREE.MeshBasicMaterial).opacity = v;
      this.clockMat.opacity = v * (1 - analogVis);
      this.watcher.visible = ctx.altered && v > 0.5;
    });

    setVis("meridian", Y, () => {
      const mv = ss(1994, 2024, Y);
      this.meridian.scale.y = Math.max(0.001, mv);
      this.meridian.position.y = 20 * mv;
      this.meridian.visible = mv > 0.01;
      this.crane.visible = ss(1990, 1998, Y) * (1 - ss(2020, 2026, Y)) > 0.05;
    });

    setVis("future", futureVis, (v) => {
      this.futureData.forEach((b, i) => {
        dm.position.set(b.x, (b.h * v) / 2, b.z); dm.scale.set(b.w, Math.max(0.001, b.h * v), b.d);
        dm.rotation.set(0, 0, 0); dm.updateMatrix(); this.future.setMatrixAt(i, dm.matrix);
      });
      this.future.instanceMatrix.needsUpdate = true;
      (this.darts.material as THREE.Material & { opacity: number }).opacity = v;
      this.skytrain.visible = v > 0.05;
    });

    setVis("analog", analogVis, (v) => {
      this.bb1998.visible = v > 0.02 || modernVis > 0.02;
      (this.bb1998.material as THREE.MeshBasicMaterial).opacity = v;
    });

    setVis("low", lowVis, (v) => {
      this.lowData.forEach((b, i) => {
        dm.position.set(b.x, (b.h * v) / 2, b.z); dm.scale.set(b.w, Math.max(0.001, b.h * v), b.d);
        dm.rotation.set(0, 0, 0); dm.updateMatrix(); this.low.setMatrixAt(i, dm.matrix);
      });
      this.low.instanceMatrix.needsUpdate = true;
      this.bbPast.visible = v > 0.03;
      (this.bbPast.material as THREE.MeshBasicMaterial).opacity = v;
    });

    setVis("huts", hutVis, (v) => {
      this.hutData.forEach((b, i) => {
        dm.position.set(b.x, (b.h * v) / 2 + 0.001, b.z + 2); dm.scale.set(b.w * 2, Math.max(0.001, b.h * v * 1.4), b.w * 2);
        dm.rotation.set(0, 0, 0); dm.updateMatrix(); this.huts.setMatrixAt(i, dm.matrix);
      });
      this.huts.instanceMatrix.needsUpdate = true;
      const fl = 0.75 + 0.25 * Math.sin(ctx.animT * 9 + Math.sin(ctx.animT * 23) * 2);
      this.fireLight.intensity = v * 30 * fl;
      (this.fireGlowRef.material as THREE.SpriteMaterial).opacity = v * fl;
    });

    setVis("trees", treeVis, (v) => {
      (this.trunks.material as THREE.Material & { opacity: number }).opacity = v;
      (this.crowns.material as THREE.Material & { opacity: number }).opacity = v;
    });
    setVis("mount", mountVis, (v) => { (this.mountains.material as THREE.Material & { opacity: number }).opacity = v; });
    setVis("ocean", oceanVis, (v) => { (this.ocean.material as THREE.Material & { opacity: number }).opacity = v * 0.96; });
    setVis("ground", groundVis, (v) => {
      this.ground.visible = v > 0.01;
      this.groundMat.opacity = v;
      const asphalt = new THREE.Color(0x8b909a), dirt = new THREE.Color(0x6a5a44), grass = new THREE.Color(0x2e4433), deep = new THREE.Color(0x14211b);
      const c = new THREE.Color();
      if (Y > 1500) c.copy(asphalt).lerp(dirt, 1 - ss(1500, 2030, Y));
      else if (Y > 200) c.copy(dirt).lerp(grass, 1 - ss(200, 1500, Y));
      else c.copy(grass).lerp(deep, 1 - ss(-3000, 200, Y));
      this.groundMat.color.copy(c);
    });

    // moon / hemi grade
    const warmEra = 1 - ss(1750, 2030, Y);
    this.moon.intensity = 0.6 * (1 - ctx.voidAmt) + 0.15;
    (this.moon.color as THREE.Color).setHSL(0.58 - warmEra * 0.5, 0.25, 0.72);
    this.hemi.intensity = 0.55 * (1 - ctx.voidAmt * 0.9);

    // ─ actors (pure functions of animT / tau) ─
    const carVis = modernVis;
    (this.cars.material as THREE.Material & { opacity: number }).opacity = carVis;
    this.cars.visible = carVis > 0.02;
    const laneX = [-8.2, -3.8, 3.8, 8.2];
    const laneDir = [1, -1, 1, -1];
    const carPos = (t: number, i: number, out: THREE.Object3D) => {
      const c = this.carData[i];
      const raw = t * c.sp * c.dir + c.off;
      const seg = Math.floor(raw / 60);
      let r = raw - seg * 60;
      if (r < 0) r += 60;
      const p = r > 44 ? seg * 60 + 44 + (r - 44) * 0.06 : seg * 60 + r;
      const z = ((p % 130) + 130) % 130 - 65;
      out.position.set(c.x, 0.72, laneDir[c.lane] > 0 ? z : -z);
      out.rotation.set(0, laneDir[c.lane] > 0 ? 0 : Math.PI, 0);
      out.scale.set(1, 1, 1);
    };
    if (this.cars.visible) {
      for (let i = 0; i < this.carData.length; i++) {
        carPos(ctx.animT, i, dm); dm.updateMatrix(); this.cars.setMatrixAt(i, dm.matrix);
        if (i < this.ghostCars.count) { carPos(ctx.animT + 0.7, i, dm); dm.updateMatrix(); this.ghostCars.setMatrixAt(i, dm.matrix); }
      }
      this.cars.instanceMatrix.needsUpdate = true;
      this.ghostCars.instanceMatrix.needsUpdate = true;
    }
    const ghostOp = ss(0.28, 0.6, ctx.instability) * 0.5 * carVis;
    (this.ghostCars.material as THREE.Material & { opacity: number }).opacity = ghostOp;
    this.ghostCars.visible = ghostOp > 0.02;

    const pedVis = modernVis;
    (this.peds.material as THREE.Material & { opacity: number }).opacity = pedVis;
    this.peds.visible = pedVis > 0.02;
    if (this.peds.visible) {
      for (let i = 0; i < this.pedData.length; i++) {
        const pd = this.pedData[i];
        if (pd.axis === 2) {
          const u = Math.min(1, Math.max(0, (ctx.animT + 4) / 10));
          dm.position.set(-14 + 28 * u, 0.74 + Math.abs(Math.sin(ctx.animT * 5)) * 0.05, 16);
          dm.rotation.set(0, u > 0.02 && u < 0.98 ? Math.PI / 2 : Math.PI / 2, 0);
        } else if (pd.axis === 0) {
          const p = ((ctx.animT * pd.sp + pd.off) % 120 + 120) % 120 - 60;
          dm.position.set(pd.lane, 0.74 + Math.abs(Math.sin(ctx.animT * 4.2 + pd.ph)) * 0.05, p);
          dm.rotation.set(0, pd.sp > 0 ? 0 : Math.PI, 0);
        } else {
          const p = ((ctx.animT * pd.sp + pd.off) % 120 + 120) % 120 - 60;
          dm.position.set(p, 0.74 + Math.abs(Math.sin(ctx.animT * 4.2 + pd.ph)) * 0.05, pd.lane);
          dm.rotation.set(0, pd.sp > 0 ? Math.PI / 2 : -Math.PI / 2, 0);
        }
        dm.scale.set(1, 1, 1);
        dm.updateMatrix(); this.peds.setMatrixAt(i, dm.matrix);
        if (i < this.ghostPeds.count) {
          dm.position.x += 0.5; dm.position.z += 0.4;
          dm.updateMatrix(); this.ghostPeds.setMatrixAt(i, dm.matrix);
        }
      }
      this.peds.instanceMatrix.needsUpdate = true;
      this.ghostPeds.instanceMatrix.needsUpdate = true;
    }
    const gpOp = ss(0.3, 0.65, ctx.instability) * 0.35 * pedVis;
    (this.ghostPeds.material as THREE.Material & { opacity: number }).opacity = gpOp;
    this.ghostPeds.visible = gpOp > 0.02;

    setVis("carts", lowVis, (v) => {
      (this.carts.material as THREE.Material & { opacity: number }).opacity = v;
      this.carts.visible = v > 0.03;
      if (this.carts.visible) for (let i = 0; i < 10; i++) {
        const dir = i % 2 === 0 ? 1 : -1;
        const p = ((ctx.animT * 2.2 * dir + i * 23) % 110 + 110) % 110 - 55;
        dm.position.set(laneX[i % 4], 0.85, dir > 0 ? p : -p);
        dm.rotation.set(0, dir > 0 ? 0 : Math.PI, 0); dm.scale.set(1, 1, 1);
        dm.updateMatrix(); this.carts.setMatrixAt(i, dm.matrix);
      }
      if (this.carts.visible) this.carts.instanceMatrix.needsUpdate = true;
    });

    // darts orbit
    if (futureVis > 0.02) {
      for (let i = 0; i < this.darts.count; i++) {
        const a = ctx.animT * (0.25 + (i % 7) * 0.05) + i * 1.7;
        const rad = 22 + (i % 9) * 4.6;
        dm.position.set(Math.cos(a) * rad, 30 + (i % 6) * 9 + Math.sin(ctx.animT * 0.5 + i) * 1.6, Math.sin(a) * rad);
        dm.rotation.set(Math.PI / 2, 0, -a);
        dm.scale.set(1, 1, 1); dm.updateMatrix(); this.darts.setMatrixAt(i, dm.matrix);
      }
      this.darts.instanceMatrix.needsUpdate = true;
      this.darts.visible = true;
    } else this.darts.visible = false;

    // birds — bird #1 lives outside the freeze
    for (let i = 0; i < 3; i++) {
      const t = i === 1 ? ctx.tau * (1 - 2 * ctx.freeze) : ctx.animT;
      const a = t * 0.24 + i * 2.1;
      this.birds[i].position.set(Math.cos(a) * 27, 24 + i * 3 + Math.sin(t * 0.8 + i) * 2, -18 + Math.sin(a) * 27);
      this.birds[i].rotation.set(0, -a, Math.sin(t * 6 + i) * 0.4);
      this.birds[i].visible = modernVis > 0.4;
    }

    // trains
    const tx = ((ctx.animT * 17) % 340 + 340) % 340 - 170;
    this.train.position.x = tx;
    this.train.visible = modernVis > 0.05;
    this.skytrain.position.x = ((ctx.animT * 40 + 120) % 340 + 340) % 340 - 170;
    (this.trainWinMat.color as THREE.Color).lerp(new THREE.Color(futureVis > 0.4 ? 0x9fe8ff : 0xffd9a0), 0.1);

    // traffic light cycle
    this.tlGrp.visible = modernVis > 0.05;
    this.railGrp.visible = modernVis + futureVis > 0.05;
    const phase = Math.floor(((ctx.animT / 5) % 3 + 3) % 3);
    this.tlMats.forEach((m, i) => { m.opacity = (i === phase ? 1 : 0.1) * modernVis; });

    // weather uniforms
    const rainAmt = Math.max(modernVis, lowVis * 0.5, futureVis * 0.4) * (1 - ctx.voidAmt);
    this.rainUni.uAnimT.value = ctx.animT;
    this.rainUni.uAmt.value = rainAmt;
    this.rainUni.uDir.value = ctx.s > 0.27 && ctx.s < 0.305 ? -1 : 1;
    this.steamUni.uAnimT.value = ctx.animT;
    this.steamUni.uAmt.value = modernVis * (1 - ctx.voidAmt);

    // reflection beat (deterministic in s — reversing replays it backwards)
    this.refUni.uTime.value = ctx.realT;
    this.refUni.uTurn.value = ss(0.066, 0.0765, ctx.s) ;
    this.refUni.uGaze.value = ss(0.0745, 0.08, ctx.s);
    this.refUni.uVanish.value = ss(0.0835, 0.0885, ctx.s);
    this.refUni.uLead.value = ctx.mouseX * 0.05 + Math.sin(ctx.s * 210) * 0.012 + (ctx.s - 0.07) * 1.1;
    this.refUni.uAlpha.value = ss(0.05, 0.058, ctx.s) * (1 - ss(0.09, 0.098, ctx.s)) * Math.max(modernVis, 1 - ss(0.1, 0.12, ctx.s));

    // fractures rise with instability
    this.fractures.forEach((f, i) => {
      const u = this.fracUnis[i];
      u.uTime.value = ctx.realT;
      const target = ss(0.14 + i * 0.1, 0.4 + i * 0.12, ctx.instability) * (i < 2 ? modernVis : futureVis + modernVis);
      u.uOp.value += (target - u.uOp.value) * Math.min(1, ctx.dt * 3);
      f.position.y += Math.sin(ctx.realT * 0.7 + i * 2) * 0.002;
      f.rotation.y += ctx.dt * 0.05;
    });

    // impossible clock
    this.clockTimer += ctx.dt;
    const scram = ctx.instability > 0.25 || (ctx.s > 0.27 && ctx.s < 0.305);
    if (this.clockTimer > 0.3) {
      this.clockTimer = 0;
      if (scram) {
        const opts = ["25:61:07", "88:13:42", "??:??:??", "26:67:14", "00:00:00", "20:26:86"];
        this.drawClock(opts[Math.floor(ctx.realT * 3) % opts.length], "#ff6a5a");
      } else if (Math.floor(ctx.animT) !== this.lastClockSec) {
        this.lastClockSec = Math.floor(ctx.animT);
        const sec = 14 + Math.floor(ctx.animT);
        const mm = 26 + Math.floor(sec / 60);
        this.drawClock(`20:${String(mm).padStart(2, "0")}:${String(((sec % 60) + 60) % 60).padStart(2, "0")}`, "#dfe8f2");
      }
    }

    // anomaly billboard flicker
    const anomBand = ctx.s > 0.268 && ctx.s < 0.306;
    const blink = Math.sin(ctx.realT * 13) > -0.4 ? 1 : 0.15;
    const aOp = Math.max(anomBand ? 0.95 : 0, ss(0.5, 0.85, ctx.instability) * 0.85) * blink * Math.max(modernVis, futureVis);
    (this.bbAnomaly.material as THREE.MeshBasicMaterial).opacity = aOp;
    this.bbAnomaly.visible = aOp > 0.02;
    const hiddenBlink = (ctx.realT % 19) < 0.12 ? 0.9 : 0;
    (this.bbHidden.material as THREE.MeshBasicMaterial).opacity = hiddenBlink * modernVis;
    this.bbHidden.visible = hiddenBlink > 0;

    // ghost tower — exists only when moving backward at exactly s≈0.415
    this.updateGhostTower(ctx);

    // entity
    this.updateEntity(ctx);

    // first-second particle
    const pAmt = ctx.particleAmt;
    (this.particle.material as THREE.SpriteMaterial).opacity = pAmt;
    this.particle.visible = pAmt > 0.01;
    this.particle.scale.setScalar(0.42 + 0.1 * Math.sin(ctx.realT * 2.1));

    // branches (the timelines you created)
    if (ctx.branches > 0.02) {
      this.buildBranches();
      if (this.branchesGrp) {
        this.branchMat.opacity = ctx.branches * 0.42;
        this.branchLineMat.opacity = ctx.branches * 0.3;
        this.branchesGrp.rotation.y = ctx.realT * 0.01;
      }
    }
  }
  private lastClockSec = -99;

  private ghostTower: THREE.Mesh | null = null;
  private updateGhostTower(ctx: WorldCtx) {
    if (!this.ghostTower) {
      this.ghostTower = new THREE.Mesh(new THREE.BoxGeometry(6, 30, 6),
        new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      this.ghostTower.position.set(-21, 15, -32);
      this.group.add(this.ghostTower);
    }
    const g = Math.exp(-Math.pow((ctx.s - 0.415) / 0.006, 2));
    const back = ctx.vel < -0.005 ? 1 : 0;
    const op = g * back * 0.5;
    (this.ghostTower.material as THREE.MeshBasicMaterial).opacity += (op - (this.ghostTower.material as THREE.MeshBasicMaterial).opacity) * Math.min(1, ctx.dt * 8);
    this.ghostTower.visible = (this.ghostTower.material as THREE.MeshBasicMaterial).opacity > 0.02;
  }

  private updateEntity(ctx: WorldCtx) {
    const e = this.entity;
    const sBand = ss(0.117, 0.124, ctx.s) * (1 - ss(0.152, 0.16, ctx.s));
    const glimpse =
      Math.exp(-Math.pow((ctx.s - 0.43) / 0.011, 2)) +
      Math.exp(-Math.pow((ctx.s - 0.565) / 0.011, 2)) +
      Math.exp(-Math.pow((ctx.s - 0.68) / 0.011, 2));
    const reveal = ctx.reveal;
    const vis = Math.max(sBand, Math.min(1, glimpse) * 0.85, reveal);
    e.visible = vis > 0.02;
    if (!e.visible) return;

    if (reveal > 0.01) {
      const u = ss(0.889, 0.932, ctx.s);
      e.position.set(-5 + 4.6 * u, 0, -14 + 7.6 * u);
      this.entityLight.color.set(0xffb27a);
      this.entityLight.intensity = 1.2 + reveal;
    } else if (sBand > 0.01) {
      const u = ss(0.117, 0.155, ctx.s);
      e.position.set(9, 0, -52 + 26 * u);
      this.entityLight.color.set(0x7fd7ff);
      this.entityLight.intensity = 0.55;
    } else {
      e.position.set(ctx.s < 0.5 ? -13 : 12, 0, -22);
      this.entityLight.color.set(0x7fd7ff);
      this.entityLight.intensity = 0.4;
    }
    // it walks slowly — outside your time
    e.position.y = Math.abs(Math.sin(ctx.realT * 1.4)) * 0.03;

    // awareness: the head finds the cursor
    const awareness = Math.max(reveal, ctx.instability * 0.5, sBand * 0.3);
    const target = new THREE.Vector3(
      ctx.camPos.x + ctx.mouseX * 14 - e.position.x,
      0,
      ctx.camPos.z + ctx.mouseY * 6 - e.position.z
    );
    const yaw = Math.atan2(target.x, target.z);
    const cur = e.rotation.y;
    let d = yaw - cur;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    e.rotation.y = cur + d * Math.min(1, ctx.dt * (0.6 + awareness * 2.2));
    this.entityHead.position.x = Math.sin(ctx.realT * 0.4) * 0.01 * awareness;
    const mats = e.children[0] as THREE.Mesh;
    (mats.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.55 + awareness * 0.8;
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = (m as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else if (mat) mat.dispose();
    });
  }
}
