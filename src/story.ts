// ─── THE WORLD BETWEEN SECONDS · narrative data ─────────────────────────────
// All story text lives here. Beats are keyed to smoothed scroll progress s∈[0,1].

export const LOADING_LINES = [
  "CALIBRATING TEMPORAL FIELD…",
  "LOCATING CURRENT MOMENT…",
  "SEARCHING FOR MISSING SECOND…",
  "ANOMALY DETECTED.",
  "TEMPORAL ACCESS GRANTED.",
];

export const INTRO_LINES = [
  "YOU HAVE 86,400 SECONDS TODAY.",
  "YOU WILL NEVER NOTICE THE ONE THAT IS MISSING.",
  "EVERY SECOND HAS A GAP.",
  "SOMETHING LIVES THERE.",
];

export const INTRO_LINES_ALTERED = [
  "YOU HAVE 86,401 SECONDS TODAY.",
  "SOMETHING CHANGED.",
  "EVERY SECOND HAS A GAP.",
  "IT REMEMBERS YOU.",
];

export const ENTER_LABEL = "ENTER THE GAP";
export const ENTER_LABEL_ALTERED = "RE-ENTER THE GAP";

// Cinematic beats: { at: smoothed scroll position, text, hold seconds }
export interface Beat { at: number; text: string; hold?: number; kind?: "normal" | "entity" | "warning"; }

export const BEATS: Beat[] = [
  { at: 0.100, text: "THE CITY HAS STOPPED.", hold: 3.4 },
  { at: 0.113, text: "NOT PAUSED. HELD.", hold: 3 },
  { at: 0.127, text: "SOMETHING IS STILL MOVING.", hold: 3.4, kind: "entity" },
  { at: 0.149, text: "IT IS NOT BOUND BY YOUR TIMELINE.", hold: 3.6, kind: "entity" },
  { at: 0.167, text: "THE MOMENT SHATTERS.", hold: 2.6, kind: "warning" },
  { at: 0.196, text: "THE CITY REMEMBERS EVERY VERSION OF ITSELF.", hold: 3.6 },
  { at: 0.256, text: "YEAR 2200. NOTHING HERE IS AFRAID OF YOU.", hold: 3.6 },
  { at: 0.283, text: "THIS HAS ALREADY HAPPENED.", hold: 3, kind: "warning" },
  { at: 0.305, text: "THE TIMELINE HAS INVERTED.", hold: 3.2, kind: "warning" },
  { at: 0.320, text: "YOU ARE NOW SCROLLING TOWARD THE ORIGIN.", hold: 4 },
  { at: 0.372, text: "A FROZEN STREET. SOMEONE IS STANDING IN THE RAIN.", hold: 4.4 },
  { at: 0.448, text: "YEAR 1998. ANALOG LIGHT. SLOWER SECONDS.", hold: 3.6 },
  { at: 0.528, text: "YEAR 1700. THE CITY IS A TOWN. THE GAP IS WIDER HERE.", hold: 4.2 },
  { at: 0.628, text: "YEAR 500. SOMEONE WATCHES THE SAME SKY YOU DO.", hold: 4 },
  { at: 0.728, text: "BEFORE HUMANITY. THE SECONDS WERE NEVER COUNTED.", hold: 4.2 },
  { at: 0.800, text: "THE FURTHER BACK YOU GO, THE THINNER THE WORLD.", hold: 4 },
  { at: 0.848, text: "THIS IS THE FIRST SECOND.", hold: 3.4 },
  { at: 0.864, text: "BEFORE THIS, THERE WAS NOTHING.", hold: 3.2 },
  { at: 0.877, text: "EXCEPT THEM.", hold: 3.4, kind: "entity" },
  { at: 0.889, text: "YOU SHOULDN'T BE HERE.", hold: 3.2, kind: "entity" },
  { at: 0.900, text: "I WAS THE FIRST TO FIND THE GAP.", hold: 3.4, kind: "entity" },
  { at: 0.909, text: "I THOUGHT I COULD GO BACK.", hold: 3.2, kind: "entity" },
  { at: 0.917, text: "I WAS WRONG.", hold: 3.2, kind: "entity" },
  { at: 0.924, text: "EVERY TIME YOU SCROLL BACK, YOU CREATE ANOTHER BRANCH.", hold: 4.2, kind: "entity" },
  { at: 0.932, text: "YOU THINK I'VE BEEN FOLLOWING YOU.", hold: 3.4, kind: "entity" },
  { at: 0.940, text: "I'VE BEEN TRYING TO KEEP UP.", hold: 3.6, kind: "entity" },
  { at: 0.948, text: "EVERY TIME YOU WENT BACK…", hold: 3.2, kind: "entity" },
  { at: 0.955, text: "YOU LEFT SOMETHING BEHIND.", hold: 3.8, kind: "warning" },
  { at: 0.968, text: "EVERY CHOICE YOU MADE IS STILL HAPPENING.", hold: 4 },
  { at: 0.988, text: "", hold: 0 }, // slot: timeline count line, filled dynamically
  { at: 0.9965, text: "WHICH ONE DO YOU WANT TO KEEP?", hold: 999, kind: "warning" },
];

// The second observer — triggered by repeated reversals in the deep past.
export const OBSERVER_MESSAGES = [
  "DON'T GO BACK.",
  "I SAID DON'T.",
  "YOU'RE CHANGING THINGS.",
];

// Behavior-reactive whispers (the city remembers the visitor).
export const WHISPERS = {
  keepGoingBack: "YOU KEEP GOING BACK.",
  whyStop: "WHY DID YOU STOP?",
  beenHere: "YOU'VE BEEN HERE BEFORE.",
  sawThat: "YOU SAW THAT.",
  missed: "YOU DIDN'T NOTICE.",
  tooFast: "SLOW DOWN. TIME BRUISES.",
};

export const ENDING_KEEP = [
  "TIMELINE STABILIZED.",
  "MEMORY CONSOLIDATED.",
  "ANOMALIES CONTAINED.",
  "THANK YOU FOR CHOOSING.",
  "WE WILL SEE YOU BETWEEN SECONDS.",
];

export const ENDING_BACK = [
  "REVERSING.",
  "SOMETHING CHANGED.",
];

export const CHOICE = {
  question: "WHICH ONE DO YOU WANT TO KEEP?",
  keep: "KEEP THIS TIMELINE",
  back: "GO BACK",
};

export function eraTag(year: number, s: number): string {
  if (s > 0.845) return "T = 0 · THE FIRST SECOND";
  if (year < -3000) return "BEFORE HUMANITY";
  if (year < 200) return "YEAR 500 · EMBER SETTLEMENT";
  if (year < 1500) return "YEAR 1700 · THE SMALL TOWN";
  if (year < 2010) return "YEAR 1998 · ANALOG NIGHT";
  if (year < 2045) return "YEAR 2026 · NIGHT RAIN · DISTRICT 7";
  if (year < 2160) return "YEAR 2100 · THE QUIET ASCENT";
  return "YEAR 2200 · THE STILL METROPOLIS";
}

export const SCROLL_LENGTH = 17000; // px of raw timeline
