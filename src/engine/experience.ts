import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { AfterimagePass } from "three/addons/postprocessing/AfterimagePass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { World } from "./world";
import { AudioEngine } from "./audio";
import { BEATS, OBSERVER_MESSAGES, WHISPERS, eraTag, SCROLL_LENGTH } from "../story";

const ss = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const ease = (x: number) => x * x * (3 - 2 * x);

export interface EngineCallbacks {
  onClock: (time: string, label: string, glitch: string[]) => void;
  onSubtitle: (text: string, kind: string) => void;
  onChoice: (show: boolean) => void;
  onIntegrity: (pct: number, reversals: number) => void;
  onEndingDone: (action: "keep" | "back") => void;
}

interface CamKey { s: number; p: [number, number, number]; l: [number, number, number]; f: number; }

const CAM: CamKey[] = [
  { s: 0.0, p: [-2.4, 1.8, 30], l: [2, 2.4, 4], f: 55 },
  { s: 0.032, p: [-1.8, 1.7, 17], l: [4, 1.5, 14.5], f: 55 },
  { s: 0.05, p: [0.6, 1.9, 8], l: [17, 13, -8], f: 50 },
  { s: 0.078, p: [3.4, 2.1, -1.5], l: [17, 11, -8], f: 46 },
  { s: 0.097, p: [0.6, 1.9, -3], l: [1, 2.4, -40], f: 50 },
  { s: 0.118, p: [1.2, 1.8, -9], l: [9, 2, -46], f: 42 },
  { s: 0.15, p: [2.4, 1.8, -12.5], l: [9, 2, -30], f: 38 },
  { s: 0.166, p: [7, 28, -26], l: [0, 6, 0], f: 55 },
  { s: 0.205, p: [26, 72, 42], l: [0, 32, -10], f: 55 },
  { s: 0.262, p: [12, 98, -28], l: [-6, 66, -60], f: 58 },
  { s: 0.3, p: [0, 122, -4], l: [0, 62, 0], f: 60 },
  { s: 0.33, p: [-42, 92, 42], l: [0, 18, 0], f: 55 },
  { s: 0.368, p: [-3, 32, 26], l: [0, 2, -12], f: 55 },
  { s: 0.402, p: [-1.6, 2.1, 13], l: [4, 1.8, -12], f: 52 },
  { s: 0.458, p: [2.6, 2.5, 5], l: [-7, 3, -26], f: 52 },
  { s: 0.528, p: [11, 15, 23], l: [-4, 2, -10], f: 52 },
  { s: 0.598, p: [-15, 8, -5], l: [6, 3, 6], f: 50 },
  { s: 0.652, p: [9, 5.5, -16], l: [0, 2, 2], f: 50 },
  { s: 0.728, p: [-22, 10, 32], l: [12, 6, -24], f: 55 },
  { s: 0.788, p: [0, 28, 62], l: [0, 3, -60], f: 55 },
  { s: 0.836, p: [0, 9, 26], l: [0, 5, -30], f: 50 },
  { s: 0.868, p: [0, 2.5, 4], l: [0, 2.6, -10], f: 45 },
  { s: 0.9, p: [0.4, 2.0, -2.4], l: [-0.2, 1.7, -7], f: 40 },
  { s: 0.93, p: [0.5, 1.9, -3.4], l: [-0.6, 1.6, -6.4], f: 36 },
  { s: 0.956, p: [0, 10, 8], l: [0, 2, -6], f: 50 },
  { s: 1.001, p: [0, 160, 230], l: [0, 26, 0], f: 62 },
];

export class Experience {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;
  private afterimage: AfterimagePass;
  private bloom: UnrealBloomPass;
  private grade: ShaderPass;
  private world: World;
  private audio = new AudioEngine();
  private cbs: EngineCallbacks;
  private raf = 0;
  private clock3 = new THREE.Clock();
  private quality: number;

  // timeline state
  private target = 0; private s = 0; private vel = 0; private velSm = 0;
  private instability = 0; private reversals = 0;
  private lastDir = 0; private lastReversalT = -10;
  private idleT = 0; private started = false; private entryStart = -1;
  private mode: "live" | "reversal" | "ended" = "live";
  private reversalFrom = 0; private reversalT = 0; private endAction: "keep" | "back" = "keep";
  private flash = 0; private fade = 0; private choiceShown = false;
  private altered: boolean;

  // beats / whispers
  private beatLast: number[] = BEATS.map(() => -999);
  private whisperLast: Record<string, number> = {};
  private globalWhisperT = -99;
  private obsCount = 0;
  private bandVisits: Record<string, number> = {};
  private lastBand = "";
  private dwellAnomaly = 0;
  private clockEmit = 0;
  private lastClockStr = "";
  private mouseX = 0; private mouseY = 0;
  private tmpP = new THREE.Vector3(); private tmpL = new THREE.Vector3();
  private right = new THREE.Vector3(); private up = new THREE.Vector3(); private fwd = new THREE.Vector3();
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, cbs: EngineCallbacks) {
    this.cbs = cbs;
    this.quality = window.innerWidth < 820 ? 0.6 : 1;
    let loop = 0;
    try { loop = parseInt(localStorage.getItem("tws.loop") || "0", 10) || 0; } catch { loop = 0; }
    this.altered = loop > 0;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality < 1 ? 1.5 : 1.75));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;

    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1300);
    this.camera.position.set(0, 380, -420);
    this.scene.fog = new THREE.FogExp2(0x0a0f16, 0.009);

    this.world = new World(this.quality);
    this.scene.add(this.world.group);
    this.world.setPixelRatio(this.renderer.getPixelRatio());

    // post chain: render → bloom → temporal ghosting → output → grade/grain
    const isWebGL2 = this.renderer.capabilities.isWebGL2;
    const rt = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
      type: THREE.HalfFloatType, samples: isWebGL2 ? 4 : 0,
    });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.62, 0.75, 0.55);
    this.composer.addPass(this.bloom);
    this.afterimage = new AfterimagePass(0);
    this.composer.addPass(this.afterimage);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null }, uTime: { value: 0 }, uGrain: { value: 0.05 },
        uVig: { value: 0.9 }, uChroma: { value: 0.0015 }, uDesat: { value: 0 },
        uFade: { value: 0 }, uFlash: { value: 0 }, uTint: { value: new THREE.Vector3(1, 0.98, 0.94) },
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying vec2 vUv;
        uniform sampler2D tDiffuse; uniform float uTime,uGrain,uVig,uChroma,uDesat,uFade,uFlash;
        uniform vec3 uTint;
        void main(){
          vec2 d = vUv - 0.5;
          float ca = uChroma;
          vec3 col;
          col.r = texture2D(tDiffuse, vUv + d * ca).r;
          col.g = texture2D(tDiffuse, vUv).g;
          col.b = texture2D(tDiffuse, vUv - d * ca).b;
          float l = dot(col, vec3(0.299, 0.587, 0.114));
          col = mix(vec3(l), col, 1.0 - uDesat);
          col *= uTint;
          col *= 1.0 - uVig * dot(d, d) * 1.9;
          float g = fract(sin(dot(vUv * vec2(1234.5, 987.6) + fract(uTime) * 61.7, vec2(12.9898, 78.233))) * 43758.5453);
          col += (g - 0.5) * uGrain;
          col += vec3(uFlash);
          col *= uFade;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.composer.addPass(this.grade);

    window.addEventListener("resize", this.onResize);
    window.addEventListener("scroll", this.onScroll, { passive: true });
    window.addEventListener("mousemove", this.onMouse, { passive: true });

    this.clock3.start();
    const loopFn = () => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loopFn);
      this.tick();
    };
    loopFn();
  }

  // ── public ───────────────────────────────────────────────────────────────
  begin() {
    this.started = true;
    this.entryStart = this.clock3.getElapsedTime();
    this.audio.begin();
  }

  setMuted(m: boolean) { this.audio.setMuted(m); }
  getAltered() { return this.altered; }
  scrollLength() { return SCROLL_LENGTH; }

  choose(action: "keep" | "back") {
    if (this.mode === "ended" || this.mode === "reversal") return;
    this.mode = action === "back" ? "reversal" : "ended";
    this.endAction = action;
    this.cbs.onChoice(false);
    try {
      const loop = parseInt(localStorage.getItem("tws.loop") || "0", 10) || 0;
      localStorage.setItem("tws.loop", String(loop + 1));
    } catch { /* private mode */ }
    if (action === "back") {
      this.reversalFrom = this.s;
      this.reversalT = 0;
    } else {
      this.fade = 0.0001; // triggers fade-out path in tick
    }
  }

  resetWorld() {
    // after an ending — the loop is subtly different now
    this.altered = true;
    this.s = 0; this.target = 0; this.vel = 0; this.velSm = 0;
    this.instability = 0; this.flash = 0; this.fade = 0;
    this.choiceShown = false; this.mode = "live";
    this.beatLast = BEATS.map(() => -999);
    this.obsCount = 0; this.dwellAnomaly = 0;
    window.scrollTo(0, 0);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("scroll", this.onScroll);
    window.removeEventListener("mousemove", this.onMouse);
    this.audio.dispose();
    this.world.dispose();
    this.renderer.dispose();
  }

  // ── input ────────────────────────────────────────────────────────────────
  private onResize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  };
  private onScroll = () => {
    if (this.mode === "reversal") return;
    const max = Math.max(1, SCROLL_LENGTH - window.innerHeight);
    this.target = Math.min(1, Math.max(0, window.scrollY / max));
  };
  private onMouse = (e: MouseEvent) => {
    this.mouseX = (e.clientX / window.innerWidth) * 2 - 1;
    this.mouseY = (e.clientY / window.innerHeight) * 2 - 1;
  };

  // ── timeline → year ──────────────────────────────────────────────────────
  private yearAt(s: number) {
    if (s < 0.16) return 2026;
    if (s < 0.3) return 2026 + ease((s - 0.16) / 0.14) * (2200 - 2026);
    if (s < 0.345) return 2200;
    if (s < 0.5) return 2200 - ease((s - 0.345) / 0.155) * (2200 - 1998);
    if (s < 0.62) return 1998 - ease((s - 0.5) / 0.12) * (1998 - 1700);
    if (s < 0.72) return 1700 - ease((s - 0.62) / 0.1) * (1700 - 500);
    if (s < 0.82) return 500 - ease((s - 0.72) / 0.1) * 12500;
    return -12000;
  }

  private bandOf(s: number) {
    if (s < 0.1) return "learning";
    if (s < 0.16) return "freeze";
    if (s < 0.3) return "future";
    if (s < 0.345) return "inversion";
    if (s < 0.5) return "descent";
    if (s < 0.62) return "town";
    if (s < 0.72) return "huts";
    if (s < 0.84) return "wild";
    if (s < 0.94) return "first";
    return "branches";
  }

  // ── main loop ────────────────────────────────────────────────────────────
  private tick() {
    const dt = Math.min(0.05, this.clock3.getDelta());
    const t = this.clock3.getElapsedTime();

    if (!this.started) {
      // idle void behind the intro
      this.grade.uniforms["uFade"].value = 0;
      this.composer.render();
      return;
    }

    // entry dive
    const entryT = this.entryStart >= 0 ? Math.min(1, (t - this.entryStart) / 4.2) : 1;
    const entryE = ease(entryT);

    // smooth timeline
    if (this.mode === "reversal") {
      this.reversalT += dt / 4.2;
      const u = Math.min(1, this.reversalT);
      this.target = this.reversalFrom * (1 - ease(u));
      if (u >= 1) {
        this.mode = "ended";
        this.cbs.onEndingDone("back");
      }
    }
    const prevS = this.s;
    const damp = this.mode === "reversal" ? 6.5 : 3.1;
    this.s += (this.target - this.s) * (1 - Math.exp(-dt * damp));
    this.s = Math.min(1, Math.max(0, this.s));
    this.vel = (this.s - prevS) / Math.max(dt, 0.0001);
    this.velSm += (this.vel - this.velSm) * Math.min(1, dt * 5);

    // reversal detection → instability + the observer
    const dir = Math.sign(this.velSm);
    if (dir !== 0 && dir !== this.lastDir && Math.abs(this.velSm) > 0.018 && t - this.lastReversalT > 0.7) {
      this.lastReversalT = t;
      if (this.lastDir !== 0) {
        this.reversals++;
        this.instability = Math.min(1, this.instability + 0.14);
        if (this.s > 0.4 && this.velSm < 0 && this.obsCount < 3) {
          this.whisper(OBSERVER_MESSAGES[this.obsCount], "warning");
          this.obsCount++;
          this.instability = Math.min(1, this.instability + 0.16);
        }
      }
      this.lastDir = dir;
    }
    // scrubbing hard bruises time
    if (Math.abs(this.velSm) > 0.3) this.instability = Math.min(1, this.instability + dt * 0.1);
    this.instability = Math.max(0, this.instability - dt * (0.012 + this.instability * 0.035));

    // derived timeline values
    const year = this.yearAt(this.s);
    const flick = this.instability > 0.04 ? Math.sin(t * 17) * this.instability * 380 + Math.sin(t * 3.1) * this.instability * 140 : 0;
    const yearVis = year + flick;
    const tau = this.s < 0.1 ? -14 + (this.s / 0.1) * 24 : 10;
    const freeze = ss(0.0995, 0.112, this.s) * (1 - ss(0.156, 0.166, this.s));
    const animT = tau * (1 - freeze) + 10 * freeze;
    const voidAmt = ss(0.815, 0.855, this.s);
    const particleAmt = ss(0.845, 0.868, this.s) * (1 - ss(0.955, 0.99, this.s) * 0.75);
    const reveal = ss(0.885, 0.905, this.s) * (1 - ss(0.948, 0.962, this.s));
    const branches = ss(0.955, 0.992, this.s);
    const modernVis = ss(1935, 1980, yearVis) * (1 - ss(2038, 2062, yearVis));
    const futureVis = ss(2045, 2090, yearVis);
    const lowVis = ss(1450, 1600, yearVis) * (1 - ss(1880, 1940, yearVis));
    const hutVis = ss(-150, 250, yearVis) * (1 - ss(900, 1450, yearVis));

    // shatter flash
    if ((prevS < 0.166 && this.s >= 0.166) || (prevS > 0.166 && this.s <= 0.166)) {
      this.flash = 0.9;
      this.instability = Math.min(1, this.instability + 0.2);
      this.audio.shatter();
    }
    this.flash = Math.max(0, this.flash - dt * 1.6);

    // camera along keyframes
    this.cameraPath(entryE, t, freeze);

    // world update
    this.world.update({
      realT: t, dt, s: this.s, vel: this.velSm, year, yearVis, tau, animT, freeze,
      instability: this.instability, branches, reveal, voidAmt, particleAmt,
      mouseX: this.mouseX, mouseY: this.mouseY, camPos: this.camera.position, altered: this.altered,
    });

    // atmosphere
    this.sky(year, this.s, voidAmt, freeze);
    const fog = this.scene.fog as THREE.FogExp2;
    fog.density = 0.0095 * (1 - voidAmt) * (1 - ss(0.3, 1, branches) * 0.9) + 0.0016;

    // beats — fired on timeline crossing, so fast scrubs never skip the story
    for (let i = 0; i < BEATS.length; i++) {
      const b = BEATS[i];
      const crossed = (prevS < b.at && this.s >= b.at) || (prevS > b.at && this.s <= b.at);
      if (crossed && t - this.beatLast[i] > 20) {
        this.beatLast[i] = t;
        if (b.at === 0.988) {
          const n = 4812 + this.reversals * 3;
          this.cbs.onSubtitle(`YOU HAVE CREATED ${n.toLocaleString("en-US")} TIMELINES.`, "warning");
        } else if (b.text) {
          this.cbs.onSubtitle(b.text, b.kind || "normal");
        }
      }
    }
    if (this.s > 0.9955 && !this.choiceShown && this.mode === "live") {
      this.choiceShown = true;
      this.cbs.onChoice(true);
    }

    // behavior memory
    this.behavior(t, dt);

    // ending fades
    let fadeTarget = 1;
    if (entryT < 1) fadeTarget = Math.min(entryT * 1.4, 1);
    if (this.mode === "ended" && this.endAction === "keep" && this.fade > 0) {
      this.fade = Math.min(1, this.fade + dt * 0.55);
      fadeTarget = 1 - this.fade;
      if (this.fade >= 1) {
        this.fade = 0;
        this.mode = "live";
        this.cbs.onEndingDone("keep");
      }
    }
    if (this.mode === "reversal") fadeTarget = 1 - ss(0.82, 1, this.reversalT) * 0.9;

    // audio mood
    this.audio.update({
      city: modernVis, rain: Math.max(modernVis, lowVis * 0.4, futureVis * 0.35), freeze,
      future: futureVis, past: lowVis + hutVis, void: voidAmt, instab: this.instability,
      vel: Math.min(1, Math.abs(this.velSm) * 2.4),
    }, dt);

    // post params
    const spd = Math.abs(this.velSm);
    (this.afterimage.uniforms["damp"] as { value: number }).value =
      Math.min(0.93, 0.42 + spd * 2.6 + (this.entryStart >= 0 && t - this.entryStart < 3 ? 0.4 : 0) + (this.mode === "reversal" ? 0.45 : 0));
    this.bloom.strength = 0.6 + freeze * 0.3 + reveal * 0.25 + branches * 0.2 + this.flash * 0.5;
    const gu = this.grade.uniforms;
    gu["uTime"].value = t;
    gu["uFade"].value = fadeTarget;
    gu["uFlash"].value = this.flash;
    gu["uGrain"].value = 0.045 + this.instability * 0.075 + voidAmt * 0.02;
    gu["uChroma"].value = 0.0013 + this.instability * 0.006 + spd * 0.005 + freeze * 0.0012;
    gu["uDesat"].value = Math.min(0.9, freeze * 0.5 + voidAmt * 0.8 + branches * 0.35);
    const tint = gu["uTint"].value as THREE.Vector3;
    tint.set(
      1 + futureVis * -0.06 + (lowVis + hutVis) * 0.06,
      0.98 + futureVis * 0.03 + (lowVis + hutVis) * 0.0,
      0.94 + futureVis * 0.12 + (lowVis + hutVis) * -0.08
    );

    // UI clock ~8Hz
    this.clockEmit += dt;
    if (this.clockEmit > 0.12) {
      this.clockEmit = 0;
      this.emitClock(year, freeze, t);
      this.cbs.onIntegrity(Math.round((1 - this.instability) * 100), this.reversals);
    }

    this.composer.render();
  }

  // ── camera ───────────────────────────────────────────────────────────────
  private cameraPath(entryE: number, t: number, freeze: number) {
    const s = this.s;
    let i = 0;
    while (i < CAM.length - 2 && CAM[i + 1].s < s) i++;
    const a = CAM[i], b = CAM[Math.min(i + 1, CAM.length - 1)];
    const u = ease(Math.min(1, Math.max(0, (s - a.s) / Math.max(0.0001, b.s - a.s))));
    this.tmpP.set(
      a.p[0] + (b.p[0] - a.p[0]) * u,
      a.p[1] + (b.p[1] - a.p[1]) * u,
      a.p[2] + (b.p[2] - a.p[2]) * u
    );
    this.tmpL.set(
      a.l[0] + (b.l[0] - a.l[0]) * u,
      a.l[1] + (b.l[1] - a.l[1]) * u,
      a.l[2] + (b.l[2] - a.l[2]) * u
    );
    const fov = a.f + (b.f - a.f) * u;

    // entry dive from the stratosphere
    if (entryE < 1) {
      this.tmpP.set(
        THREE.MathUtils.lerp(0, this.tmpP.x, entryE),
        THREE.MathUtils.lerp(380, this.tmpP.y, entryE),
        THREE.MathUtils.lerp(-420, this.tmpP.z, entryE)
      );
      this.tmpL.set(
        THREE.MathUtils.lerp(0, this.tmpL.x, entryE),
        THREE.MathUtils.lerp(0, this.tmpL.y, entryE),
        THREE.MathUtils.lerp(0, this.tmpL.z, entryE)
      );
    }

    // handheld breath (absent while frozen)
    const br = (1 - freeze) * 0.05;
    this.tmpP.x += Math.sin(t * 0.6) * br;
    this.tmpP.y += Math.sin(t * 0.83 + 1.7) * br * 0.7;

    this.camera.position.copy(this.tmpP);
    this.camera.fov += (fov - this.camera.fov) * 0.12;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.tmpL);

    // cursor parallax
    this.camera.getWorldDirection(this.fwd);
    this.right.crossVectors(this.fwd, this.camera.up).normalize();
    this.up.crossVectors(this.right, this.fwd).normalize();
    this.camera.position.addScaledVector(this.right, this.mouseX * 0.55);
    this.camera.position.addScaledVector(this.up, -this.mouseY * 0.4);
    this.tmpL.addScaledVector(this.right, this.mouseX * 0.22);
    this.tmpL.addScaledVector(this.up, -this.mouseY * 0.16);
    this.camera.lookAt(this.tmpL);
  }

  // ── sky / fog grading ────────────────────────────────────────────────────
  private cTop = new THREE.Color(); private cBot = new THREE.Color(); private cHor = new THREE.Color();
  private sky(year: number, s: number, voidAmt: number, freeze: number) {
    interface Stop { y: number; top: string; bot: string; hor: string; st: number; }
    const stops: Stop[] = [
      { y: 2200, top: "#02090f", bot: "#0a2833", hor: "#155a6d", st: 0.5 },
      { y: 2026, top: "#04060c", bot: "#141c2b", hor: "#35415a", st: 0.22 },
      { y: 1998, top: "#060508", bot: "#1d1712", hor: "#4a3421", st: 0.32 },
      { y: 1700, top: "#030509", bot: "#101826", hor: "#233246", st: 0.8 },
      { y: 500, top: "#050408", bot: "#1a120c", hor: "#3d2413", st: 0.9 },
      { y: -100, top: "#010409", bot: "#08161e", hor: "#123039", st: 1 },
      { y: -12000, top: "#000103", bot: "#04101a", hor: "#0a2230", st: 1 },
    ];
    let a = stops[stops.length - 1], b = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i++) {
      if (year <= stops[i].y && year >= stops[i + 1].y) { a = stops[i]; b = stops[i + 1]; break; }
    }
    if (year > stops[0].y) { a = stops[0]; b = stops[0]; }
    const u = a === b ? 0 : (a.y - year) / (a.y - b.y);
    this.cTop.set(a.top).lerp(new THREE.Color(b.top), u);
    this.cBot.set(a.bot).lerp(new THREE.Color(b.bot), u);
    this.cHor.set(a.hor).lerp(new THREE.Color(b.hor), u);
    let stars = a.st + (b.st - a.st) * u;

    // ??? band — wrong sky
    const wrong = ss(0.262, 0.28, s) * (1 - ss(0.3, 0.318, s));
    if (wrong > 0) {
      this.cTop.lerp(new THREE.Color("#14020b"), wrong);
      this.cBot.lerp(new THREE.Color("#310a1e"), wrong);
      this.cHor.lerp(new THREE.Color("#6d1231"), wrong);
    }
    // freeze drains the sky slightly
    this.cHor.lerp(new THREE.Color("#1c2330"), freeze * 0.4);
    // void
    const black = new THREE.Color("#000000");
    this.cTop.lerp(black, voidAmt); this.cBot.lerp(black, voidAmt); this.cHor.lerp(black, voidAmt);
    stars *= 1 - voidAmt;
    stars = Math.max(stars, ss(0.95, 0.99, s) * 0.55); // the branches glow against black

    this.world.setSky(this.cTop, this.cBot, this.cHor, stars);
    const fog = this.scene.fog as THREE.FogExp2;
    (fog.color as THREE.Color).copy(this.cBot).lerp(this.cHor, 0.5);
  }

  // ── behavior memory ──────────────────────────────────────────────────────
  private behavior(t: number, dt: number) {
    const w = (key: string, text: string, cooldown = 26) => {
      if (t - (this.whisperLast[key] ?? -999) > cooldown && t - this.globalWhisperT > 9) {
        this.whisperLast[key] = t;
        this.globalWhisperT = t;
        this.cbs.onSubtitle(text, "whisper");
      }
    };
    // idle
    if (Math.abs(this.velSm) < 0.004 && this.s > 0.01 && this.s < 0.99) {
      this.idleT += dt;
      if (this.idleT > 11) { w("idle" + Math.floor(t / 50), WHISPERS.whyStop, 40); this.idleT = 0; }
    } else this.idleT = 0;
    // keep going back
    if (this.reversals >= 6) w("back", WHISPERS.keepGoingBack, 34);
    // scrubbing too hard
    if (Math.abs(this.velSm) > 0.55) w("fast", WHISPERS.tooFast, 30);
    // missed the reflection
    if (this.s > 0.09 && this.lastBand === "learning" && this.bandVisits["reflection_fast"]) {
      w("missed", WHISPERS.missed, 999);
    }
    if (this.s > 0.05 && this.s < 0.09 && Math.abs(this.velSm) > 0.1) this.bandVisits["reflection_fast"] = 1;
    // noticed the anomaly billboard
    if (this.s > 0.268 && this.s < 0.306) {
      this.dwellAnomaly += dt;
      if (this.dwellAnomaly > 3) w("saw", WHISPERS.sawThat, 999);
    } else this.dwellAnomaly = Math.max(0, this.dwellAnomaly - dt * 2);
    // revisits
    const band = this.bandOf(this.s);
    if (band !== this.lastBand) {
      this.bandVisits[band] = (this.bandVisits[band] || 0) + 1;
      if (this.bandVisits[band] >= 3 && band !== "branches") w("visit" + band, WHISPERS.beenHere, 40);
      this.lastBand = band;
    }
  }

  private whisper(text: string, kind: string) {
    this.globalWhisperT = this.clock3.getElapsedTime();
    this.cbs.onSubtitle(text, kind);
  }

  // ── clock UI ─────────────────────────────────────────────────────────────
  private emitClock(year: number, freeze: number, t: number) {
    let time = "", label = "", glitch: string[] = [];
    const scrambled = this.instability > 0.42 || (this.s > 0.268 && this.s < 0.306);
    if (this.s > 0.84) {
      time = "TIME: UNKNOWN";
      label = "—";
    } else if (this.s < 0.16) {
      const sec = 14 + Math.round(this.s < 0.1 ? -14 + (this.s / 0.1) * 24 : 10);
      const mm = 26 + Math.floor(sec / 60);
      time = `20:${String(mm).padStart(2, "0")}:${String(((sec % 60) + 60) % 60).padStart(2, "0")}`;
      label = freeze > 0.5 ? "MOMENT SUSPENDED ‖" : "CURRENT MOMENT";
    } else {
      const y = Math.round(year);
      time = y < 0 ? `YEAR −${Math.abs(y).toLocaleString("en-US")}` : `YEAR ${y}`;
      label = eraTag(year, this.s);
    }
    if (scrambled && this.s < 0.84) {
      glitch = [time, "20:26:86", "?? : ?? : ??", String(Math.floor(t * 7) % 2 ? time : "26:67:14")];
    }
    const key = time + label + glitch.join(",");
    if (key !== this.lastClockStr) {
      this.lastClockStr = key;
      this.cbs.onClock(time, label, glitch);
    }
  }
}
