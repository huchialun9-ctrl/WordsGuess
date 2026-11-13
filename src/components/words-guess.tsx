import { useCallback, useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ChartColumn, CircleHelp, Delete, Volume2, VolumeX, X } from "lucide-react";
import { clsx } from "clsx";
import { isAllowedGuess } from "@/lib/words";
import {
  EMPTY_STATS,
  WIN_LINES,
  evaluateGuess,
  formatRemaining,
  gameLink,
  hasSeenHelp,
  keyboardMarks,
  loadGame,
  loadMuted,
  loadStats,
  markHelpSeen,
  msUntilNextUtcDay,
  puzzleNumber,
  recordResult,
  saveGame,
  saveMuted,
  saveStats,
  shareText,
  solutionFor,
  utcDateKey,
  type LetterStatus,
  type Phase,
  type Stats,
} from "@/lib/game";
import { installAudioResume, playInvalid, playKey, playLose, playSubmit, playWin, syncMuted, unlockAudio } from "@/lib/sfx";

const ROWS = [
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["Enter", "z", "x", "c", "v", "b", "n", "m", "Back"],
] as const;

const REVEAL_MS = 1560;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function WordsGuess() {
  const [date, setDate] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [guesses, setGuesses] = useState<string[]>([]);
  const [current, setCurrent] = useState("");
  const [phase, setPhase] = useState<Phase>("playing");
  const [popIndex, setPopIndex] = useState(-1);
  const [shake, setShake] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [revealing, setRevealing] = useState<number | null>(null);
  const [dancing, setDancing] = useState<number | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareBody, setShareBody] = useState("");
  const [copied, setCopied] = useState(false);
  const [muted, setMuted] = useState(false);
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [now, setNow] = useState(() => Date.now());
  const [booted, setBooted] = useState(false);

  const toastTimer = useRef(0);
  const revealTimer = useRef(0);
  const busy = useRef(false);
  const dateRef = useRef<string | null>(null);
  dateRef.current = date;
  const dialogOpen = helpOpen || statsOpen || shareOpen;

  const flash = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1700);
  }, []);

  useEffect(() => {
    const today = utcDateKey();
    const saved = loadGame();
    let nextStats = loadStats();
    const nextAnswer = solutionFor(today);
    let nextGuesses: string[] = [];
    let nextPhase: Phase = "playing";

    if (saved && saved.date === today) {
      nextGuesses = saved.guesses;
      nextPhase = saved.status;
      if (nextPhase === "playing") {
        if (nextGuesses.some((guess) => guess === nextAnswer)) nextPhase = "won";
        else if (nextGuesses.length >= 6) nextPhase = "lost";
      }
      if (nextPhase !== "playing") {
        nextStats = recordResult(nextStats, today, nextPhase === "won", nextGuesses.length);
        saveStats(nextStats);
      }
    }

    const nextMuted = loadMuted();
    syncMuted(nextMuted);
    setDate(today);
    setAnswer(nextAnswer);
    setGuesses(nextGuesses);
    setPhase(nextPhase);
    setStats(nextStats);
    setMuted(nextMuted);
    setHelpOpen(!hasSeenHelp());
    setBooted(true);
    return installAudioResume();
  }, []);

  useEffect(() => {
    if (!booted || !date) return;
    saveGame({ date, guesses, status: phase });
  }, [booted, date, guesses, phase]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const tick = Date.now();
      setNow(tick);
      const today = utcDateKey(new Date(tick));
      const prev = dateRef.current;
      if (!prev || prev === today) return;
      dateRef.current = today;
      busy.current = false;
      setDate(today);
      setAnswer(solutionFor(today));
      setGuesses([]);
      setCurrent("");
      setPhase("playing");
      setRevealing(null);
      setDancing(null);
      setStatsOpen(false);
      setShareOpen(false);
      flash("A new word is ready");
    }, 1000);
    return () => window.clearInterval(id);
  }, [flash]);

  useEffect(() => {
    return () => {
      window.clearTimeout(toastTimer.current);
      window.clearTimeout(revealTimer.current);
    };
  }, []);

  const finishRow = useCallback(
    (guess: string, row: number, next: string[]) => {
      if (!date) return;
      const won = guess === answer;
      const lost = !won && next.length >= 6;
      const reduce = prefersReducedMotion();
      if (!reduce) setRevealing(row);
      playSubmit();
      window.clearTimeout(revealTimer.current);
      revealTimer.current = window.setTimeout(() => {
        busy.current = false;
        setRevealing(null);
        if (!won && !lost) return;
        const nextPhase: Phase = won ? "won" : "lost";
        setPhase(nextPhase);
        if (won && !reduce) setDancing(row);
        const nextStats = recordResult(loadStats(), date, won, next.length);
        saveStats(nextStats);
        setStats(nextStats);
        flash(won ? (WIN_LINES[next.length - 1] ?? "Great") : answer.toUpperCase());
        if (won) playWin();
        else playLose();
        setStatsOpen(true);
      }, reduce ? 40 : REVEAL_MS);
    },
    [answer, date, flash],
  );

  const onKey = useCallback(
    (key: string) => {
      unlockAudio();
      if (!date || !answer || dialogOpen || revealing !== null || phase !== "playing" || busy.current) return;

      if (key === "Back") {
        if (!current) return;
        setCurrent((value) => value.slice(0, -1));
        setPopIndex(-1);
        playKey();
        return;
      }

      if (key === "Enter") {
        if (current.length < 5) {
          setShake((n) => n + 1);
          flash("Not enough letters");
          playInvalid();
          return;
        }
        if (!isAllowedGuess(current)) {
          setShake((n) => n + 1);
          flash("Not in word list");
          playInvalid();
          return;
        }
        const next = [...guesses, current];
        const row = guesses.length;
        busy.current = true;
        setGuesses(next);
        setCurrent("");
        setPopIndex(-1);
        finishRow(current, row, next);
        return;
      }

      if (/^[a-z]$/.test(key) && current.length < 5) {
        setCurrent((value) => {
          if (value.length >= 5) return value;
          setPopIndex(value.length);
          return value + key;
        });
        playKey();
      }
    },
    [answer, current, date, dialogOpen, finishRow, flash, guesses, phase, revealing],
  );

  const onKeyRef = useRef(onKey);
  onKeyRef.current = onKey;

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (document.querySelector("[role='dialog']")) return;
      if (event.key === "Enter") {
        event.preventDefault();
        onKeyRef.current("Enter");
      } else if (event.key === "Backspace") {
        event.preventDefault();
        onKeyRef.current("Back");
      } else if (/^[a-zA-Z]$/.test(event.key)) {
        event.preventDefault();
        onKeyRef.current(event.key.toLowerCase());
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const toggleMute = () => {
    unlockAudio();
    setMuted((value) => {
      const next = !value;
      syncMuted(next);
      saveMuted(next);
      return next;
    });
  };

  const dismissHelp = (open: boolean) => {
    setHelpOpen(open);
    if (!open) markHelpSeen();
  };

  const openShare = async () => {
    if (!date) return;
    const body = shareText({
      puzzle: puzzleNumber(date),
      guesses,
      answer,
      won: phase === "won",
      link: gameLink(),
    });
    setShareBody(body);
    let ok = false;
    try {
      await navigator.clipboard.writeText(body);
      ok = true;
    } catch {
      ok = false;
    }
    setCopied(ok);
    setShareOpen(true);
    if (ok) flash("Copied to clipboard");
  };

  const openReddit = () => {
    if (!date) return;
    const score = phase === "won" ? String(guesses.length) : "X";
    const title = `WordsGuess No.${puzzleNumber(date)} ${score}/6`;
    const url = `https://www.reddit.com/r/WordsGuess/submit?title=${encodeURIComponent(title)}&text=${encodeURIComponent(shareBody)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const marks = keyboardMarks(guesses, answer);
  const puzzle = date ? puzzleNumber(date) : null;
  const remain = formatRemaining(msUntilNextUtcDay(now));
  const winRate = stats.played === 0 ? 0 : Math.round((stats.wins / stats.played) * 100);
  const maxDist = Math.max(1, ...stats.dist);

  return (
    <main className="app-shell">
      <header className="app-header">
        <button
          type="button"
          className="icon-btn"
          aria-label={muted ? "Unmute sounds" : "Mute sounds"}
          aria-pressed={muted}
          onClick={toggleMute}
        >
          <span className="icon-swap" key={muted ? "off" : "on"}>
            {muted ? <VolumeX size={22} strokeWidth={2} /> : <Volume2 size={22} strokeWidth={2} />}
          </span>
        </button>
        <div className="brand">
          <h1 className="wordmark">
            <span>Words</span>
            <span className="guess">Guess</span>
          </h1>
          <p className="puzzle-no">{puzzle ? `No. ${puzzle}` : "Daily"}</p>
        </div>
        <div className="icon-cluster">
          <button type="button" className="icon-btn" aria-label="How to play" onClick={() => setHelpOpen(true)}>
            <CircleHelp size={22} strokeWidth={2} />
          </button>
          <button type="button" className="icon-btn" aria-label="Statistics" onClick={() => setStatsOpen(true)}>
            <ChartColumn size={22} strokeWidth={2} />
          </button>
        </div>
      </header>

      <section className="stage">
        {toast ? (
          <div className="toast" role="status">
            {toast}
          </div>
        ) : null}
        <p className="result-line">
          {phase === "won" ? (
            <>
              Solved in {guesses.length} <span className="next-word">· next in {remain}</span>
            </>
          ) : null}
          {phase === "lost" ? (
            <>
              The word was <strong>{answer}</strong> <span className="next-word">· next in {remain}</span>
            </>
          ) : null}
        </p>
        <div className="board" role="grid" aria-label="Guesses">
          {Array.from({ length: 6 }, (_, row) => {
            const submitted = guesses[row];
            const isCurrent = !submitted && row === guesses.length && phase === "playing";
            const letters = submitted ?? (isCurrent ? current : "");
            const scored = submitted && answer ? evaluateGuess(submitted, answer) : null;
            const pending = revealing === row;
            return (
              <div
                key={submitted ? `row-${row}` : `draft-${row}-${isCurrent ? shake : 0}`}
                className={clsx("board-row", isCurrent && shake > 0 && "is-shake")}
                role="row"
              >
                {Array.from({ length: 5 }, (_, col) => {
                  const letter = letters[col] ?? "";
                  const status: LetterStatus | "empty" = scored ? (scored[col] ?? "absent") : "empty";
                  const settled = Boolean(scored) && !pending;
                  return (
                    <div
                      key={col}
                      role="gridcell"
                      className={clsx(
                        "tile",
                        letter && !scored && col === popIndex && isCurrent && "is-pop",
                        pending && "is-reveal",
                        settled && "is-settled",
                        dancing === row && settled && "is-dance",
                      )}
                      data-status={status}
                      data-filled={letter && !scored ? "true" : undefined}
                      aria-label={letter ? `${letter}${scored ? ` ${status}` : ""}` : "Empty"}
                    >
                      {letter}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </section>

      <div className="keyboard" aria-label="Keyboard">
        {ROWS.map((row) => (
          <div className="key-row" key={row.join("")}>
            {row.map((key) => {
              const wide = key === "Enter" || key === "Back";
              const mark = key.length === 1 ? marks[key] : undefined;
              return (
                <button
                  key={key}
                  type="button"
                  className="keycap"
                  data-wide={wide ? "true" : undefined}
                  data-status={mark}
                  aria-label={key === "Back" ? "Backspace" : key === "Enter" ? "Enter" : key.toUpperCase()}
                  onClick={() => onKey(key === "Enter" ? "Enter" : key === "Back" ? "Back" : key)}
                >
                  {key === "Back" ? <Delete size={22} strokeWidth={2} /> : key === "Enter" ? "Enter" : key}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <HelpDialog open={helpOpen} onOpenChange={dismissHelp} />
      <StatsDialog
        open={statsOpen}
        onOpenChange={setStatsOpen}
        stats={stats}
        winRate={winRate}
        maxDist={maxDist}
        phase={phase}
        guesses={guesses}
        answer={answer}
        remain={remain}
        onShare={() => void openShare()}
      />
      <ShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        copied={copied}
        body={shareBody}
        onReddit={openReddit}
        onCopy={() => void openShare()}
      />
    </main>
  );
}

function HelpDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim" />
        <Dialog.Content className="modal-panel" aria-describedby="how-copy">
          <Dialog.Close asChild>
            <button type="button" className="icon-btn modal-close" aria-label="Close">
              <X size={20} strokeWidth={2} />
            </button>
          </Dialog.Close>
          <Dialog.Title className="modal-title">How to play</Dialog.Title>
          <p className="modal-copy" id="how-copy">
            Guess the daily five-letter word in six tries. Every guess has to be a real English word. The same word is
            used worldwide and changes at 00:00 UTC.
          </p>
          <Lesson word="plant" index={0} status="correct" text="P is in the word and in the correct spot." />
          <Lesson word="align" index={1} status="present" text="L is in the word, but in the wrong spot." />
          <Lesson word="viola" index={0} status="absent" text="V is not in the word at all." />
          <p className="modal-copy">
            Duplicate letters are scored in two passes. Greens are locked first, then leftover letters can turn gold.
            An extra copy stays gray.
          </p>
          <div className="lesson">
            <ScoredRow guess="alley" answer="apple" />
            <p>Against APPLE, the first L is gold and the extra L is gray. E is gold too, because one E is still left.</p>
          </div>
          <button type="button" className="share-btn" onClick={() => onOpenChange(false)}>
            Got it
          </button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Lesson({
  word,
  index,
  status,
  text,
}: {
  word: string;
  index: number;
  status: LetterStatus;
  text: string;
}) {
  return (
    <div className="lesson">
      <div className="board-row" aria-hidden="true">
        {word.split("").map((letter, i) => (
          <div
            key={`${word}-${i}`}
            className={clsx("tile", i === index && "is-settled")}
            data-status={i === index ? status : "empty"}
            data-filled={i === index ? undefined : "true"}
          >
            {letter}
          </div>
        ))}
      </div>
      <p>{text}</p>
    </div>
  );
}

function ScoredRow({ guess, answer }: { guess: string; answer: string }) {
  const scored = evaluateGuess(guess, answer);
  return (
    <div className="board-row" aria-hidden="true">
      {guess.split("").map((letter, i) => (
        <div key={`${guess}-${i}`} className="tile is-settled" data-status={scored[i]}>
          {letter}
        </div>
      ))}
    </div>
  );
}

function StatsDialog({
  open,
  onOpenChange,
  stats,
  winRate,
  maxDist,
  phase,
  guesses,
  answer,
  remain,
  onShare,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stats: Stats;
  winRate: number;
  maxDist: number;
  phase: Phase;
  guesses: string[];
  answer: string;
  remain: string;
  onShare: () => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim" />
        <Dialog.Content className="modal-panel" aria-describedby="stats-next">
          <Dialog.Close asChild>
            <button type="button" className="icon-btn modal-close" aria-label="Close">
              <X size={20} strokeWidth={2} />
            </button>
          </Dialog.Close>
          <Dialog.Title className="modal-title">Statistics</Dialog.Title>
          <div className="stat-grid">
            <Stat value={stats.played} label="Played" />
            <Stat value={winRate} label="Win %" />
            <Stat value={stats.currentStreak} label="Streak" />
            <Stat value={stats.maxStreak} label="Max streak" />
          </div>
          <p className="dist-head">Guess distribution</p>
          {stats.dist.map((count, index) => {
            const width = Math.max(8, Math.round((count / maxDist) * 100));
            const isWin = phase === "won" && guesses.length === index + 1;
            return (
              <div className="dist-row" key={index}>
                <span>{index + 1}</span>
                <div className={clsx("dist-bar", isWin && "is-win")} style={{ width: `${width}%` }}>
                  {count}
                </div>
              </div>
            );
          })}
          {phase !== "playing" ? (
            <p className="answer-callout">
              The word was <strong>{answer}</strong>
            </p>
          ) : null}
          <p className="modal-copy" id="stats-next">
            Next word in {remain}
          </p>
          {phase !== "playing" ? (
            <button type="button" className="share-btn" onClick={onShare}>
              Share Score to Reddit
            </button>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <div className="stat-num">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function ShareDialog({
  open,
  onOpenChange,
  copied,
  body,
  onReddit,
  onCopy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  copied: boolean;
  body: string;
  onReddit: () => void;
  onCopy: () => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim" />
        <Dialog.Content className="modal-panel" aria-describedby="share-copy">
          <Dialog.Close asChild>
            <button type="button" className="icon-btn modal-close" aria-label="Close">
              <X size={20} strokeWidth={2} />
            </button>
          </Dialog.Close>
          <Dialog.Title className="modal-title">{copied ? "Score copied" : "Copy your score"}</Dialog.Title>
          <p className="modal-copy" id="share-copy">
            {copied
              ? "Paste it into the daily thread. Open r/WordsGuess now?"
              : "Clipboard was blocked. Select the score below, then open the thread."}
          </p>
          <pre className="share-pre">{body}</pre>
          <div className="stack stack-top">
            <button type="button" className="share-btn" onClick={onReddit}>
              Open r/WordsGuess
            </button>
            {!copied ? (
              <button type="button" className="ghost-btn" onClick={onCopy}>
                Copy again
              </button>
            ) : (
              <button type="button" className="ghost-btn" onClick={() => onOpenChange(false)}>
                Stay here
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
