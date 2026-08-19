import { useEffect, useRef, useState } from "react";
import { Experience } from "./engine/experience";
import {
  LOADING_LINES, INTRO_LINES, INTRO_LINES_ALTERED, ENTER_LABEL, ENTER_LABEL_ALTERED,
  ENDING_KEEP, ENDING_BACK, CHOICE, SCROLL_LENGTH,
} from "./story";

type Phase = "boot" | "intro" | "live";

interface Sub { text: string; kind: string; id: number; }
interface ClockState { time: string; label: string; glitch: string[]; }

const HOLD: Record<string, number> = { normal: 4.2, entity: 4.4, warning: 4.6, whisper: 3.8 };

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const expRef = useRef<Experience | null>(null);
  const [phase, setPhase] = useState<Phase>("boot");
  const [bootLines, setBootLines] = useState<string[]>([]);
  const [introStep, setIntroStep] = useState(0); // how many intro lines are visible
  const [bursting, setBursting] = useState(false);
  const [altered, setAltered] = useState(false);
  const [sub, setSub] = useState<Sub | null>(null);
  const [clock, setClock] = useState<ClockState>({ time: "20:26:00", label: "CURRENT MOMENT", glitch: [] });
  const [integrity, setIntegrity] = useState({ pct: 100, rev: 0 });
  const [showChoice, setShowChoice] = useState(false);
  const [endingLines, setEndingLines] = useState<string[] | null>(null);
  const [endingStep, setEndingStep] = useState(0);
  const [muted, setMuted] = useState(false);
  const [hintGone, setHintGone] = useState(false);
  const subId = useRef(0);

  // engine lifecycle
  useEffect(() => {
    if (!canvasRef.current) return;
    try { setAltered((parseInt(localStorage.getItem("tws.loop") || "0", 10) || 0) > 0); } catch { /* noop */ }
    const exp = new Experience(canvasRef.current, {
      onClock: (time, label, glitch) => setClock({ time, label, glitch }),
      onSubtitle: (text, kind) => {
        subId.current++;
        setSub({ text, kind, id: subId.current });
        window.setTimeout(() => setSub((cur) => (cur && cur.id === subId.current ? null : cur)), HOLD[kind] * 1000 || 4200);
      },
      onChoice: (show) => setShowChoice(show),
      onIntegrity: (pct, rev) => setIntegrity({ pct, rev }),
      onEndingDone: (action) => {
        setEndingLines(action === "keep" ? ENDING_KEEP : ENDING_BACK);
        setEndingStep(0);
      },
    });
    expRef.current = exp;
    document.body.classList.add("locked");
    return () => {
      document.body.classList.remove("locked");
      exp.dispose();
      expRef.current = null;
    };
  }, []);

  // boot sequence
  useEffect(() => {
    if (phase !== "boot") return;
    let i = 0;
    const iv = window.setInterval(() => {
      i++;
      setBootLines(LOADING_LINES.slice(0, i));
      if (i >= LOADING_LINES.length) {
        clearInterval(iv);
        window.setTimeout(() => setPhase("intro"), 1300);
      }
    }, 520);
    return () => clearInterval(iv);
  }, [phase]);

  // intro lines
  useEffect(() => {
    if (phase !== "intro") return;
    setIntroStep(0);
    const lines = altered ? INTRO_LINES_ALTERED : INTRO_LINES;
    let i = 0;
    const iv = window.setInterval(() => {
      i++;
      setIntroStep(i);
      if (i >= lines.length) clearInterval(iv);
    }, 1700);
    return () => clearInterval(iv);
  }, [phase, altered]);

  // ending lines → then reset into the altered intro
  useEffect(() => {
    if (!endingLines) return;
    if (endingStep >= endingLines.length) {
      const to = window.setTimeout(() => {
        expRef.current?.resetWorld();
        setEndingLines(null);
        setAltered(true);
        setPhase("intro");
        setShowChoice(false);
        setHintGone(false);
        document.body.classList.add("locked");
        window.scrollTo(0, 0);
      }, 1600);
      return () => clearTimeout(to);
    }
    const to = window.setTimeout(() => setEndingStep((s) => s + 1), 1500);
    return () => clearTimeout(to);
  }, [endingLines, endingStep]);

  const enter = () => {
    setBursting(true);
    window.setTimeout(() => {
      expRef.current?.begin();
      setPhase("live");
      document.body.classList.remove("locked");
      window.scrollTo(0, 0);
    }, 650);
  };

  const pick = (action: "keep" | "back") => {
    expRef.current?.choose(action);
    document.body.classList.add("locked");
    window.setTimeout(() => setHintGone(true), 0);
  };

  const introLines = altered ? INTRO_LINES_ALTERED : INTRO_LINES;
  const integrityColor = integrity.pct > 70 ? "#7fd7ff" : integrity.pct > 40 ? "#ffb36b" : "#ff5a4a";
  const suspended = clock.label.includes("SUSPENDED");

  return (
    <div className="relative min-h-screen bg-black text-[#e8edf2]">
      <canvas ref={canvasRef} className="stage" />
      <div className="film-lines fixed inset-0 z-40" />

      {/* scrollable timeline — the scroll IS time */}
      {phase === "live" && !endingLines && (
        <div style={{ height: SCROLL_LENGTH }} aria-hidden="true" />
      )}

      {/* ── BOOT ── */}
      {phase === "boot" && (
        <div className="fixed inset-0 z-50 flex flex-col items-start justify-center bg-black px-10 md:px-24">
          <div className="space-y-3 font-mono text-[11px] md:text-xs tracking-[0.28em] text-[#66707c]">
            {bootLines.map((l, i) => (
              <div key={l} className="line-in flex items-center gap-3">
                <span className={i === bootLines.length - 1 ? "tick-mark text-[#7fd7ff]" : ""}>▍</span>
                <span className={l.includes("ANOMALY") ? "text-[#ff5a4a]" : l.includes("GRANTED") ? "text-[#e8edf2]" : ""}>{l}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── INTRO ── */}
      {phase === "intro" && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black">
          <div className="relative mb-16 flex items-center justify-center">
            <div className={`the-point ${bursting ? "burst" : ""}`} />
            {bursting && <div className="burst-ring" />}
          </div>
          <div className="flex min-h-[190px] flex-col items-center gap-7 px-6 text-center">
            {introLines.slice(0, introStep).map((l, i) => (
              <p
                key={l}
                className={`line-in font-display text-[13px] md:text-lg leading-relaxed ${
                  altered && i === 1 ? "text-[#7fd7ff]" : l.includes("SOMETHING LIVES") || l.includes("IT REMEMBERS") ? "text-[#ff5a4a]" : "text-[#e8edf2]"
                }`}
                style={{ letterSpacing: "0.3em" }}
              >
                {l}
              </p>
            ))}
            {introStep >= introLines.length && !bursting && (
              <button className="enter-btn line-in mt-8 font-display text-[11px] md:text-xs text-[#e8edf2]" onClick={enter}>
                {altered ? ENTER_LABEL_ALTERED : ENTER_LABEL}
              </button>
            )}
          </div>
          <p className="absolute bottom-8 text-[10px] tracking-[0.34em] text-[#3c454f]">
            THE WORLD BETWEEN SECONDS
          </p>
        </div>
      )}

      {/* ── LIVE UI ── */}
      {phase === "live" && !endingLines && (
        <>
          {/* temporal clock */}
          <div className="pointer-events-none fixed left-1/2 top-7 z-30 -translate-x-1/2 text-center">
            {clock.glitch.length > 0 ? (
              <div className="font-display text-sm md:text-base">
                {clock.glitch.map((g, i) => (
                  <div key={i} className="glitch-line" style={{ color: i % 2 ? "#ff5a4a" : "#7fd7ff", animationDelay: `${i * 0.07}s` }}>
                    {g}
                  </div>
                ))}
              </div>
            ) : (
              <div className={`font-display text-sm md:text-lg ${suspended ? "tick-mark text-[#7fd7ff]" : clock.time === "TIME: UNKNOWN" ? "text-[#ff5a4a] flicker" : "text-[#e8edf2]"}`}>
                {clock.time}
              </div>
            )}
            <div className="mt-2 flex items-center justify-center gap-2 text-[9px] tracking-[0.4em] text-[#66707c]">
              <span className="h-px w-6 bg-[#3c454f]" />
              <span>{clock.label}</span>
              <span className="h-px w-6 bg-[#3c454f]" />
            </div>
          </div>

          {/* title whisper */}
          <div className="pointer-events-none fixed left-7 top-7 z-30 hidden md:block">
            <div className="font-display text-[10px] tracking-[0.4em] text-[#4a545f]">THE WORLD</div>
            <div className="font-display text-[10px] tracking-[0.4em] text-[#4a545f]">BETWEEN SECONDS</div>
          </div>

          {/* integrity + reversals */}
          <div className="pointer-events-none fixed bottom-7 left-7 z-30 space-y-2">
            <div className="text-[9px] tracking-[0.34em] text-[#66707c]">TIMELINE INTEGRITY</div>
            <div className="h-px w-36 bg-[#242c35]">
              <div className="h-px transition-all duration-700" style={{ width: `${integrity.pct}%`, background: integrityColor, boxShadow: `0 0 8px ${integrityColor}` }} />
            </div>
            <div className="text-[9px] tracking-[0.3em] text-[#3c454f]">
              REVERSALS <span className="text-[#66707c]">{String(integrity.rev).padStart(3, "0")}</span>
            </div>
          </div>

          {/* sound + nature of scroll */}
          <div className="fixed bottom-7 right-7 z-30 flex items-center gap-5">
            <div className="pointer-events-none text-right text-[9px] tracking-[0.3em] text-[#3c454f]">
              SCROLL = TIME
              <div className="text-[#66707c]">BOTH DIRECTIONS</div>
            </div>
            <button
              onClick={() => { const m = !muted; setMuted(m); expRef.current?.setMuted(m); }}
              className="cursor-pointer border border-[#242c35] px-3 py-2 text-[9px] tracking-[0.3em] text-[#66707c] transition-colors hover:border-[#66707c] hover:text-[#e8edf2]"
            >
              SOUND {muted ? "OFF" : "ON"}
            </button>
          </div>

          {/* first hint */}
          {!hintGone && (
            <div className="pointer-events-none fixed bottom-24 left-1/2 z-30 -translate-x-1/2 text-center">
              <div className="hint-drift text-[10px] tracking-[0.5em] text-[#8a95a0]">SCROLL</div>
              <div className="mx-auto mt-3 h-8 w-px bg-gradient-to-b from-[#8a95a0] to-transparent" />
            </div>
          )}

          {/* subtitle */}
          {sub && (
            <div key={sub.id} className="pointer-events-none fixed inset-x-0 bottom-[16vh] z-30 flex justify-center px-6">
              <p
                className={`subtitle ${sub.kind} max-w-3xl text-center font-display text-[12px] md:text-[15px] leading-loose text-[#e8edf2]`}
                style={{ ["--hold" as string]: `${HOLD[sub.kind] || 4.2}s`, letterSpacing: "0.3em" }}
              >
                {sub.text}
              </p>
            </div>
          )}

          {/* the choice */}
          {showChoice && (
            <div className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-black/70 px-6">
              <p className="mb-14 text-center font-display text-[13px] md:text-xl text-[#e8edf2]" style={{ letterSpacing: "0.34em" }}>
                {CHOICE.question}
              </p>
              <div className="flex flex-col items-stretch gap-6 md:flex-row md:gap-10">
                <button className="choice-btn font-display text-[11px] md:text-sm text-[#e8edf2]" onClick={() => pick("keep")}>
                  {CHOICE.keep}
                </button>
                <button className="choice-btn danger font-display text-[11px] md:text-sm text-[#e8edf2]" onClick={() => pick("back")}>
                  {CHOICE.back}
                </button>
              </div>
              <p className="mt-12 max-w-md text-center text-[10px] leading-relaxed tracking-[0.24em] text-[#66707c]">
                THE BRANCHES ARE STILL GROWING BEHIND YOU.
              </p>
            </div>
          )}
        </>
      )}

      {/* ── ENDING LINES ── */}
      {endingLines && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black px-6">
          <div className="flex flex-col items-center gap-8 text-center">
            {endingLines.slice(0, endingStep + 1).map((l, i) => (
              <p
                key={l}
                className={`line-in font-display text-[12px] md:text-base ${i === endingLines.length - 1 ? "text-[#7fd7ff]" : "text-[#e8edf2]"}`}
                style={{ letterSpacing: "0.32em" }}
              >
                {l}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
