import { SOLUTIONS, isAllowedGuess } from "@/lib/words";

export type LetterStatus = "correct" | "present" | "absent";
export type Phase = "playing" | "won" | "lost";

export type Stats = {
  played: number;
  wins: number;
  currentStreak: number;
  maxStreak: number;
  dist: [number, number, number, number, number, number];
  lastResultDate: string | null;
  lastWinDate: string | null;
};

export type SavedGame = {
  date: string;
  guesses: string[];
  status: Phase;
};

export const EMPTY_STATS: Stats = {
  played: 0,
  wins: 0,
  currentStreak: 0,
  maxStreak: 0,
  dist: [0, 0, 0, 0, 0, 0],
  lastResultDate: null,
  lastWinDate: null,
};

export const WIN_LINES = [
  "Genius",
  "Magnificent",
  "Impressive",
  "Splendid",
  "Great",
  "Phew",
] as const;

const EPOCH_UTC = Date.UTC(2026, 0, 1);
const DAY_MS = 86_400_000;
const GAME_KEY = "wordsguess-game-v1";
const STATS_KEY = "wordsguess-stats-v1";
const MUTE_KEY = "wordsguess-muted-v1";
const HELP_KEY = "wordsguess-help-v1";

const RANK: Record<LetterStatus, number> = { absent: 1, present: 2, correct: 3 };

export function utcDateKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function puzzleNumber(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  const t = Date.UTC(y!, (m ?? 1) - 1, d ?? 1);
  return Math.floor((t - EPOCH_UTC) / DAY_MS) + 1;
}

export function solutionFor(dateKey: string): string {
  const index = ((puzzleNumber(dateKey) - 1) % SOLUTIONS.length + SOLUTIONS.length) % SOLUTIONS.length;
  return SOLUTIONS[index] ?? "plant";
}

export function previousUtcDate(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1) - DAY_MS).toISOString().slice(0, 10);
}

export function msUntilNextUtcDay(now: number): number {
  const d = new Date(now);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return Math.max(0, next - now);
}

export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hh = String(Math.floor(total / 3600)).padStart(2, "0");
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/** Two-pass Wordle scoring. Greens are claimed first so duplicate letters stay honest. */
export function evaluateGuess(guess: string, answer: string): LetterStatus[] {
  const result: LetterStatus[] = Array.from({ length: guess.length }, () => "absent");
  const counts = new Map<string, number>();

  for (let i = 0; i < guess.length; i++) {
    if (guess[i] === answer[i]) result[i] = "correct";
    else {
      const ch = answer[i];
      if (ch) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    }
  }

  for (let i = 0; i < guess.length; i++) {
    if (result[i] === "correct") continue;
    const ch = guess[i];
    if (!ch) continue;
    const left = counts.get(ch) ?? 0;
    if (left > 0) {
      result[i] = "present";
      counts.set(ch, left - 1);
    }
  }

  return result;
}

export function keyboardMarks(guesses: string[], answer: string): Record<string, LetterStatus> {
  const marks: Record<string, LetterStatus> = {};
  for (const guess of guesses) {
    const scored = evaluateGuess(guess, answer);
    for (let i = 0; i < guess.length; i++) {
      const ch = guess[i];
      const status = scored[i];
      if (!ch || !status) continue;
      const prev = marks[ch];
      if (!prev || RANK[status] > RANK[prev]) marks[ch] = status;
    }
  }
  return marks;
}

export function shareText(opts: {
  puzzle: number;
  guesses: string[];
  answer: string;
  won: boolean;
  link: string;
}): string {
  const score = opts.won ? String(opts.guesses.length) : "X";
  const rows = opts.guesses.map((guess) =>
    evaluateGuess(guess, opts.answer)
      .map((status) => (status === "correct" ? "[G]" : status === "present" ? "[Y]" : "[X]"))
      .join(" "),
  );
  return [`WordsGuess No.${opts.puzzle} ${score}/6`, "", ...rows, "", opts.link].join("\n");
}

export function isValidGuess(word: string): boolean {
  return word.length === 5 && isAllowedGuess(word);
}

export function recordResult(stats: Stats, date: string, won: boolean, guessCount: number): Stats {
  if (stats.lastResultDate === date) return stats;
  const dist = [...stats.dist] as Stats["dist"];
  if (won) {
    const slot = Math.min(6, Math.max(1, guessCount)) - 1;
    dist[slot] = (dist[slot] ?? 0) + 1;
  }
  const streak = won ? (stats.lastWinDate === previousUtcDate(date) ? stats.currentStreak + 1 : 1) : 0;
  return {
    played: stats.played + 1,
    wins: stats.wins + (won ? 1 : 0),
    currentStreak: streak,
    maxStreak: Math.max(stats.maxStreak, streak),
    dist,
    lastResultDate: date,
    lastWinDate: won ? date : stats.lastWinDate,
  };
}

function canStore(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function loadStats(): Stats {
  if (!canStore()) return { ...EMPTY_STATS, dist: [...EMPTY_STATS.dist] };
  try {
    const raw = window.localStorage.getItem(STATS_KEY);
    if (!raw) return { ...EMPTY_STATS, dist: [...EMPTY_STATS.dist] };
    const parsed = JSON.parse(raw) as Partial<Stats>;
    if (!parsed || typeof parsed.played !== "number" || !Array.isArray(parsed.dist) || parsed.dist.length !== 6) {
      return { ...EMPTY_STATS, dist: [...EMPTY_STATS.dist] };
    }
    return {
      played: parsed.played,
      wins: typeof parsed.wins === "number" ? parsed.wins : 0,
      currentStreak: typeof parsed.currentStreak === "number" ? parsed.currentStreak : 0,
      maxStreak: typeof parsed.maxStreak === "number" ? parsed.maxStreak : 0,
      dist: parsed.dist.map((n) => (typeof n === "number" ? n : 0)) as Stats["dist"],
      lastResultDate: typeof parsed.lastResultDate === "string" ? parsed.lastResultDate : null,
      lastWinDate: typeof parsed.lastWinDate === "string" ? parsed.lastWinDate : null,
    };
  } catch {
    return { ...EMPTY_STATS, dist: [...EMPTY_STATS.dist] };
  }
}

export function saveStats(stats: Stats): void {
  if (!canStore()) return;
  window.localStorage.setItem(STATS_KEY, JSON.stringify(stats));
}

export function loadGame(): SavedGame | null {
  if (!canStore()) return null;
  try {
    const raw = window.localStorage.getItem(GAME_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedGame>;
    if (!parsed || typeof parsed.date !== "string" || !Array.isArray(parsed.guesses)) return null;
    const guesses = parsed.guesses.filter((g): g is string => typeof g === "string" && g.length === 5).slice(0, 6);
    const status: Phase = parsed.status === "won" || parsed.status === "lost" ? parsed.status : "playing";
    return { date: parsed.date, guesses, status };
  } catch {
    return null;
  }
}

export function saveGame(game: SavedGame): void {
  if (!canStore()) return;
  window.localStorage.setItem(GAME_KEY, JSON.stringify(game));
}

export function loadMuted(): boolean {
  if (!canStore()) return false;
  return window.localStorage.getItem(MUTE_KEY) === "1";
}

export function saveMuted(muted: boolean): void {
  if (!canStore()) return;
  window.localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
}

export function hasSeenHelp(): boolean {
  if (!canStore()) return true;
  return window.localStorage.getItem(HELP_KEY) === "1";
}

export function markHelpSeen(): void {
  if (!canStore()) return;
  window.localStorage.setItem(HELP_KEY, "1");
}

export function gameLink(): string {
  if (typeof window === "undefined") return "";
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  return url.toString();
}
