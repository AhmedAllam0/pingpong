import { useState, useEffect, useRef } from 'react';
import { useGameEngine, type Difficulty, type GameMode } from './hooks/useGameEngine';

const DIFFICULTY_OPTIONS: { value: Difficulty; label: string; desc: string; color: string }[] = [
  { value: 'easy', label: 'Easy', desc: 'Relaxed pace, forgiving AI', color: 'text-green-400 border-green-500/30 bg-green-500/10 hover:bg-green-500/20' },
  { value: 'medium', label: 'Medium', desc: 'Balanced challenge', color: 'text-yellow-400 border-yellow-500/30 bg-yellow-500/10 hover:bg-yellow-500/20' },
  { value: 'hard', label: 'Hard', desc: 'Fast and precise AI', color: 'text-orange-400 border-orange-500/30 bg-orange-500/10 hover:bg-orange-500/20' },
  { value: 'impossible', label: 'Impossible', desc: 'Near-perfect AI', color: 'text-red-400 border-red-500/30 bg-red-500/10 hover:bg-red-500/20' },
];

const WIN_SCORE_OPTIONS = [3, 5, 7, 11, 21];

export function App() {
  const {
    canvasRef,
    scores,
    gameStatus,
    maxRally,
    combo,
    difficulty,
    winScore,
    startGame,
    togglePause,
    returnToMenu,
    CANVAS_WIDTH,
    CANVAS_HEIGHT,
    mode,
    theme,
    setTheme,
    soundEnabled,
    setSoundEnabled,
    playerPowerUpTimer,
    aiPowerUpTimer,
    playerShrinkTimer,
    aiShrinkTimer,
    ballSlowTimer,
    ballFastTimer,

    reducedMotion,
    setReducedMotion,
    adaptiveAI,
    setAdaptiveAI,
    powerUpsEnabled,
    setPowerUpsEnabled,
    powerUpSpawnRate,
    setPowerUpSpawnRate,

    matchStartMs,
    matchEndMs,
    powerUpsCollected,
    winner,
  } = useGameEngine();

  const [selectedDifficulty, setSelectedDifficulty] = useState<Difficulty>('medium');
  const [selectedWinScore, setSelectedWinScore] = useState(7);
  const [selectedMode, setSelectedMode] = useState<GameMode>('single');

  // Fullscreen toggle (useful on mobile)
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const handler = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const toggleFullscreen = async () => {
    try {
      const el = canvasRef.current;
      if (!el) return;
      if (!document.fullscreenElement) {
        await (el as any).requestFullscreen?.();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // ignore
    }
  };

  // Theme options for selection. Each provides a label and some Tailwind colour classes.
  const THEME_OPTIONS: { value: typeof theme; label: string; color: string; desc: string }[] = [
    { value: 'neon', label: 'Neon', desc: 'Futuristic glowing colours', color: 'text-cyan-400 border-cyan-500/40 bg-cyan-500/15 hover:bg-cyan-500/25' },
    { value: 'classic', label: 'Classic', desc: 'Old school black & white', color: 'text-gray-300 border-gray-500/40 bg-gray-500/15 hover:bg-gray-500/25' },
    { value: 'retro', label: 'Retro', desc: '80s arcade vibes', color: 'text-yellow-400 border-yellow-500/40 bg-yellow-500/15 hover:bg-yellow-500/25' },
  ];

  // Local theme selection state
  const [selectedTheme, setSelectedTheme] = useState<typeof theme>(theme);

  // Keep menu selection in sync with the actual theme (e.g. when changed while paused)
  useEffect(() => {
    setSelectedTheme(theme);
  }, [theme]);

  // Persisted high scores
  const [bestRally, setBestRally] = useState(0);
  const [bestCombo, setBestCombo] = useState(0);

  // Lifetime stats
  const [lifetimeStats, setLifetimeStats] = useState({
    matchesPlayed: 0,
    winsPlayer: 0,
    winsAI: 0,
    winsP1: 0,
    winsP2: 0,
    totalPowerUps: 0,
  });
  const lastProcessedMatchEndRef = useRef<number>(0);

  // Load high scores from localStorage on first render
  useEffect(() => {
    try {
      const stored = localStorage.getItem('pingpongHighScores');
      if (stored) {
        const parsed = JSON.parse(stored);
        setBestRally(parsed.bestRally ?? 0);
        setBestCombo(parsed.bestCombo ?? 0);
      }
    } catch (err) {
      // Ignore JSON parse errors and fall back to defaults
    }
  }, []);

  // Load lifetime stats from localStorage on first render
  useEffect(() => {
    try {
      const stored = localStorage.getItem('pingpongLifetimeStats');
      if (stored) {
        const parsed = JSON.parse(stored);
        setLifetimeStats(prev => ({
          ...prev,
          matchesPlayed: parsed.matchesPlayed ?? 0,
          winsPlayer: parsed.winsPlayer ?? 0,
          winsAI: parsed.winsAI ?? 0,
          winsP1: parsed.winsP1 ?? 0,
          winsP2: parsed.winsP2 ?? 0,
          totalPowerUps: parsed.totalPowerUps ?? 0,
        }));
      }
    } catch {
      // ignore
    }
  }, []);

  // Update best rally when a new maxRally is reached
  useEffect(() => {
    if (maxRally > bestRally) {
      setBestRally(maxRally);
      try {
        const stored = localStorage.getItem('pingpongHighScores');
        const existing = stored ? JSON.parse(stored) : {};
        const updated = { ...existing, bestRally: maxRally };
        localStorage.setItem('pingpongHighScores', JSON.stringify(updated));
      } catch (err) {
        // If storage fails, silently ignore
      }
    }
  }, [maxRally, bestRally]);

  // Update best combo when a new combo is achieved
  useEffect(() => {
    if (combo > bestCombo) {
      setBestCombo(combo);
      try {
        const stored = localStorage.getItem('pingpongHighScores');
        const existing = stored ? JSON.parse(stored) : {};
        const updated = { ...existing, bestCombo: combo };
        localStorage.setItem('pingpongHighScores', JSON.stringify(updated));
      } catch (err) {
        // Ignore storage errors
      }
    }
  }, [combo, bestCombo]);

  // Update lifetime stats when a match ends
  useEffect(() => {
    if (gameStatus !== 'gameOver') return;
    if (!matchEndMs) return;
    if (matchEndMs === lastProcessedMatchEndRef.current) return;
    lastProcessedMatchEndRef.current = matchEndMs;

    const collected = (powerUpsCollected?.player ?? 0) + (powerUpsCollected?.ai ?? 0);

    setLifetimeStats(prev => {
      const next = { ...prev };
      next.matchesPlayed += 1;
      next.totalPowerUps += collected;

      if (mode === 'single') {
        if (winner === 'Player') next.winsPlayer += 1;
        if (winner === 'AI') next.winsAI += 1;
      } else {
        if (winner === 'P1') next.winsP1 += 1;
        if (winner === 'P2') next.winsP2 += 1;
      }

      try {
        localStorage.setItem('pingpongLifetimeStats', JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, [gameStatus, matchEndMs, winner, mode, powerUpsCollected]);

  // Reset high scores
  const resetHighScores = () => {
    setBestRally(0);
    setBestCombo(0);
    try {
      localStorage.removeItem('pingpongHighScores');
    } catch (err) {
      // Ignore
    }
  };

  const resetLifetimeStats = () => {
    const empty = { matchesPlayed: 0, winsPlayer: 0, winsAI: 0, winsP1: 0, winsP2: 0, totalPowerUps: 0 };
    setLifetimeStats(empty);
    try {
      localStorage.removeItem('pingpongLifetimeStats');
    } catch {
      // ignore
    }
  };

  const formatDuration = (sec: number) => {
    const s = Math.max(0, Math.floor(sec));
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  };

  const matchDurationSec = matchStartMs && matchEndMs ? Math.max(0, Math.floor((matchEndMs - matchStartMs) / 1000)) : 0;

  return (
    <div className="min-h-[100dvh] bg-[#060a14] flex flex-col items-center justify-center p-2 sm:p-4 selection:bg-cyan-500/30 overflow-hidden">
      {/* Ambient background glow */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-indigo-500/5 rounded-full blur-3xl" />
      </div>

      {/* Header scoreboard */}
      {(gameStatus === 'playing' || gameStatus === 'paused') && (
        <div className="relative z-10 mb-3 sm:mb-4 flex flex-wrap items-center justify-center gap-3 sm:gap-6">
          <div className="flex items-center gap-3 bg-black/40 backdrop-blur-sm border border-white/10 rounded-xl px-5 py-2.5">
            <div className="text-center">
              <div className={`text-[10px] uppercase tracking-[0.2em] font-semibold ${mode === 'multi' ? 'text-green-400/70' : 'text-green-400/70'}`}>{mode === 'multi' ? 'P1' : 'Player'}</div>
              <div className={`text-2xl sm:text-3xl font-bold font-mono tabular-nums ${mode === 'multi' ? 'text-green-400' : 'text-green-400'}`}>{scores.player}</div>
            </div>
            <div className="text-white/20 text-2xl font-thin mx-1">:</div>
            <div className="text-center">
              <div className={`text-[10px] uppercase tracking-[0.2em] font-semibold ${mode === 'multi' ? 'text-purple-400/70' : 'text-pink-400/70'}`}>{mode === 'multi' ? 'P2' : 'AI'}</div>
              <div className={`text-2xl sm:text-3xl font-bold font-mono tabular-nums ${mode === 'multi' ? 'text-purple-400' : 'text-pink-400'}`}>{scores.ai}</div>
            </div>
          </div>

          {mode === 'single' && combo > 1 && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-1.5 animate-pulse">
              <div className="text-amber-400 text-sm font-bold font-mono">🔥 x{combo}</div>
            </div>
          )}

          <button
            onClick={togglePause}
            className="bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg p-2 transition-all cursor-pointer"
            title="Pause (Space)"
          >
            {gameStatus === 'paused' ? (
              <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
            ) : (
              <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
            )}
          </button>

          <button
            onClick={returnToMenu}
            className="bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg p-2 transition-all cursor-pointer"
            title="Back to Menu"
          >
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4" />
            </svg>
          </button>

          <button
            onClick={toggleFullscreen}
            className="bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg p-2 transition-all cursor-pointer"
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? (
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 9H5V5m14 0v4h-4M5 19v-4h4m10 4h-4v-4" />
              </svg>
            ) : (
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3M8 21H5a2 2 0 01-2-2v-3m18 0v3a2 2 0 01-2 2h-3" />
              </svg>
            )}
          </button>
        </div>
      )}

      {/* Canvas */}
      <div className="relative z-10">
        <canvas
          ref={canvasRef}
          className="block rounded-2xl border border-white/10 shadow-2xl shadow-black/50 w-full max-w-full"
          // Responsive sizing while keeping the game aspect ratio.
          style={{
            imageRendering: 'auto',
            touchAction: 'none',
            width: 'min(92vw, 800px)',
            aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}`,
            height: 'auto',
          }}
        />

        {/* Menu Overlay - rendered in DOM for interactivity */}
        {gameStatus === 'menu' && (
          <div className="absolute inset-0 flex flex-col items-center justify-start sm:justify-center rounded-2xl px-3 py-3 overflow-y-auto">
            {/* Spacer to push controls below the canvas-rendered title */}
            <div className="h-20 sm:h-40" />

            {/* Difficulty Selection */}
            <div className="mb-4">
              <div className="text-xs uppercase tracking-[0.25em] text-white/40 text-center mb-2 font-semibold">Difficulty</div>
              <div className="flex flex-wrap justify-center gap-2">
                {DIFFICULTY_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setSelectedDifficulty(opt.value)}
                    className={`px-3 py-2 rounded-lg border text-sm font-mono font-bold transition-all cursor-pointer ${
                      selectedDifficulty === opt.value
                        ? opt.color + ' ring-1 ring-white/20 scale-105'
                        : 'border-white/10 text-white/40 bg-white/5 hover:bg-white/10'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <div className="text-center mt-1.5 text-[11px] text-white/30">
                {DIFFICULTY_OPTIONS.find(o => o.value === selectedDifficulty)?.desc}
              </div>
            </div>

            {/* Win Score Selection */}
            <div className="mb-6">
              <div className="text-xs uppercase tracking-[0.25em] text-white/40 text-center mb-2 font-semibold">First to</div>
              <div className="flex flex-wrap justify-center gap-2">
                {WIN_SCORE_OPTIONS.map(score => (
                  <button
                    key={score}
                    onClick={() => setSelectedWinScore(score)}
                    className={`w-10 h-10 rounded-lg border text-sm font-mono font-bold transition-all cursor-pointer ${
                      selectedWinScore === score
                        ? 'text-cyan-400 border-cyan-500/40 bg-cyan-500/15 ring-1 ring-cyan-400/20 scale-105'
                        : 'border-white/10 text-white/40 bg-white/5 hover:bg-white/10'
                    }`}
                  >
                    {score}
                  </button>
                ))}
              </div>
            </div>

            {/* Game Mode Selection */}
            <div className="mb-6">
              <div className="text-xs uppercase tracking-[0.25em] text-white/40 text-center mb-2 font-semibold">Mode</div>
              <div className="flex flex-wrap justify-center gap-2">
                <button
                  onClick={() => setSelectedMode('single')}
                  className={`flex-1 px-3 py-2 rounded-lg border text-sm font-mono font-bold transition-all cursor-pointer ${
                    selectedMode === 'single'
                      ? 'text-blue-400 border-blue-500/40 bg-blue-500/15 ring-1 ring-blue-400/20 scale-105'
                      : 'border-white/10 text-white/40 bg-white/5 hover:bg-white/10'
                  }`}
                >
                  1P vs AI
                </button>
                <button
                  onClick={() => setSelectedMode('multi')}
                  className={`flex-1 px-3 py-2 rounded-lg border text-sm font-mono font-bold transition-all cursor-pointer ${
                    selectedMode === 'multi'
                      ? 'text-purple-400 border-purple-500/40 bg-purple-500/15 ring-1 ring-purple-400/20 scale-105'
                      : 'border-white/10 text-white/40 bg-white/5 hover:bg-white/10'
                  }`}
                >
                  2P
                </button>
              </div>
              <div className="text-center mt-1.5 text-[11px] text-white/30">
                {selectedMode === 'single' ? 'Play against the computer AI' : 'Two players: keyboard or split-touch controls'}
              </div>
            </div>

            {/* Theme Selection */}
            <div className="mb-6">
              <div className="text-xs uppercase tracking-[0.25em] text-white/40 text-center mb-2 font-semibold">Theme</div>
              <div className="flex flex-wrap justify-center gap-2">
                {THEME_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => {
                      setSelectedTheme(opt.value);
                      setTheme(opt.value);
                    }}
                    className={`flex-1 px-3 py-2 rounded-lg border text-sm font-mono font-bold transition-all cursor-pointer ${
                      selectedTheme === opt.value
                        ? opt.color + ' ring-1 ring-white/20 scale-105'
                        : 'border-white/10 text-white/40 bg-white/5 hover:bg-white/10'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <div className="text-center mt-1.5 text-[11px] text-white/30">
                {THEME_OPTIONS.find(o => o.value === selectedTheme)?.desc}
              </div>
            </div>

            {/* Sound Toggle */}
            <div className="mb-6 flex flex-col items-center">
              <div className="text-xs uppercase tracking-[0.25em] text-white/40 mb-2 font-semibold">Sound</div>
              <button
                onClick={() => setSoundEnabled(!soundEnabled)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-mono font-bold transition-all cursor-pointer ${
                  soundEnabled
                    ? 'text-lime-400 border-lime-500/40 bg-lime-500/15 hover:bg-lime-500/25 ring-1 ring-lime-400/20'
                    : 'text-red-400 border-red-500/40 bg-red-500/15 hover:bg-red-500/25 ring-1 ring-red-400/20'
                }`}
              >
                {soundEnabled ? '🔊 ON' : '🔇 OFF'}
              </button>
            </div>

            {/* Gameplay Options */}
            <div className="mb-6">
              <div className="text-xs uppercase tracking-[0.25em] text-white/40 text-center mb-2 font-semibold">Options</div>

              <div className="flex flex-wrap justify-center gap-2">
                <button
                  onClick={() => setReducedMotion(!reducedMotion)}
                  className={`px-3 py-2 rounded-lg border text-sm font-mono font-bold transition-all cursor-pointer ${
                    reducedMotion
                      ? 'text-lime-400 border-lime-500/40 bg-lime-500/15 hover:bg-lime-500/25 ring-1 ring-lime-400/20'
                      : 'text-white/40 border-white/10 bg-white/5 hover:bg-white/10'
                  }`}
                >
                  Reduced Motion
                </button>

                {selectedMode === 'single' && (
                  <button
                    onClick={() => setAdaptiveAI(!adaptiveAI)}
                    className={`px-3 py-2 rounded-lg border text-sm font-mono font-bold transition-all cursor-pointer ${
                      adaptiveAI
                        ? 'text-lime-400 border-lime-500/40 bg-lime-500/15 hover:bg-lime-500/25 ring-1 ring-lime-400/20'
                        : 'text-white/40 border-white/10 bg-white/5 hover:bg-white/10'
                    }`}
                  >
                    Adaptive AI
                  </button>
                )}

                <button
                  onClick={() => setPowerUpsEnabled(!powerUpsEnabled)}
                  className={`px-3 py-2 rounded-lg border text-sm font-mono font-bold transition-all cursor-pointer ${
                    powerUpsEnabled
                      ? 'text-cyan-400 border-cyan-500/40 bg-cyan-500/15 hover:bg-cyan-500/25 ring-1 ring-cyan-400/20'
                      : 'text-white/40 border-white/10 bg-white/5 hover:bg-white/10'
                  }`}
                >
                  Power‑Ups
                </button>
              </div>

              <div className="mt-3 flex flex-col items-center gap-2">
                <div className="text-[11px] text-white/35 font-mono">Power‑Up Rate</div>
                <div className="flex gap-2">
                  {(['low', 'normal', 'high'] as const).map(rate => (
                    <button
                      key={rate}
                      onClick={() => setPowerUpSpawnRate(rate)}
                      className={`px-3 py-1.5 rounded-lg border text-xs font-mono font-bold transition-all cursor-pointer ${
                        powerUpSpawnRate === rate
                          ? rate === 'low'
                            ? 'text-blue-400 border-blue-500/40 bg-blue-500/15 ring-1 ring-blue-400/20'
                            : rate === 'normal'
                            ? 'text-cyan-400 border-cyan-500/40 bg-cyan-500/15 ring-1 ring-cyan-400/20'
                            : 'text-purple-400 border-purple-500/40 bg-purple-500/15 ring-1 ring-purple-400/20'
                          : 'border-white/10 text-white/40 bg-white/5 hover:bg-white/10'
                      }`}
                    >
                      {rate.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Start Button */}
            <button
              onClick={() => startGame(selectedDifficulty, selectedWinScore, selectedMode)}
              className="group relative px-8 sm:px-10 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold text-base sm:text-lg tracking-wide
                         hover:from-cyan-400 hover:to-blue-500 transition-all duration-300 cursor-pointer
                         shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40 hover:scale-105 active:scale-95"
            >
              <span className="relative z-10">▶ START GAME</span>
              <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-cyan-400 to-blue-500 opacity-0 group-hover:opacity-100 blur-xl transition-opacity" />
            </button>
          </div>
        )}

        {/* Game Over Overlay buttons */}
        {gameStatus === 'gameOver' && (
          <div className="absolute inset-0 flex flex-col items-center justify-end pb-10 sm:pb-16 rounded-2xl px-3">
            <div className="mb-4 bg-black/50 backdrop-blur-md border border-white/15 rounded-xl px-4 py-3 w-[min(92vw,420px)] text-center">
              <div className="text-sm font-bold text-white">Match Summary</div>
              <div className="mt-1 text-[12px] text-white/70 font-mono">
                Time: <span className="text-cyan-300">{formatDuration(matchDurationSec)}</span>
                <span className="text-white/20"> • </span>
                Power‑Ups: <span className="text-lime-300">P1 {powerUpsCollected.player}</span>
                <span className="text-white/20"> | </span>
                <span className="text-purple-300">{mode === 'single' ? 'AI' : 'P2'} {powerUpsCollected.ai}</span>
              </div>
              <div className="mt-1 text-[11px] text-white/35 font-mono">
                Shortcuts: <span className="text-white/50">R</span> rematch • <span className="text-white/50">M</span> menu
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => startGame(difficulty, winScore, mode)}
                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold
                           hover:from-cyan-400 hover:to-blue-500 transition-all duration-300 cursor-pointer
                           shadow-lg shadow-cyan-500/25 hover:scale-105 active:scale-95"
              >
                🔄 Rematch
              </button>
              <button
                onClick={returnToMenu}
                className="px-6 py-2.5 rounded-xl bg-white/10 border border-white/20 text-white font-bold
                           hover:bg-white/20 transition-all duration-300 cursor-pointer
                           hover:scale-105 active:scale-95"
              >
                🏠 Menu
              </button>
            </div>
          </div>
        )}

        {/* Pause Settings Overlay */}
        {gameStatus === 'paused' && (
          <div className="absolute inset-0 flex items-center justify-center rounded-2xl p-3">
            <div className="bg-black/60 backdrop-blur-md border border-white/20 rounded-xl p-5 w-[min(92vw,360px)] max-h-[85%] overflow-y-auto text-white flex flex-col gap-4">
              <div className="text-center text-lg font-bold">Settings</div>

              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-white/70">Reduced Motion</span>
                <button
                  onClick={() => setReducedMotion(!reducedMotion)}
                  className={`px-3 py-1.5 rounded-md border text-xs font-mono font-bold transition-all cursor-pointer ${
                    reducedMotion
                      ? 'text-lime-400 border-lime-500/40 bg-lime-500/15 hover:bg-lime-500/25 ring-1 ring-lime-400/20'
                      : 'text-red-400 border-red-500/40 bg-red-500/15 hover:bg-red-500/25 ring-1 ring-red-400/20'
                  }`}
                >
                  {reducedMotion ? 'ON' : 'OFF'}
                </button>
              </div>

              {mode === 'single' && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-white/70">Adaptive AI</span>
                  <button
                    onClick={() => setAdaptiveAI(!adaptiveAI)}
                    className={`px-3 py-1.5 rounded-md border text-xs font-mono font-bold transition-all cursor-pointer ${
                      adaptiveAI
                        ? 'text-lime-400 border-lime-500/40 bg-lime-500/15 hover:bg-lime-500/25 ring-1 ring-lime-400/20'
                        : 'text-red-400 border-red-500/40 bg-red-500/15 hover:bg-red-500/25 ring-1 ring-red-400/20'
                    }`}
                  >
                    {adaptiveAI ? 'ON' : 'OFF'}
                  </button>
                </div>
              )}

              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-white/70">Power‑Ups</span>
                <button
                  onClick={() => setPowerUpsEnabled(!powerUpsEnabled)}
                  className={`px-3 py-1.5 rounded-md border text-xs font-mono font-bold transition-all cursor-pointer ${
                    powerUpsEnabled
                      ? 'text-lime-400 border-lime-500/40 bg-lime-500/15 hover:bg-lime-500/25 ring-1 ring-lime-400/20'
                      : 'text-red-400 border-red-500/40 bg-red-500/15 hover:bg-red-500/25 ring-1 ring-red-400/20'
                  }`}
                >
                  {powerUpsEnabled ? 'ON' : 'OFF'}
                </button>
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-sm text-white/70">Power‑Up Rate</span>
                <div className="flex gap-2">
                  {(['low', 'normal', 'high'] as const).map(rate => (
                    <button
                      key={rate}
                      onClick={() => setPowerUpSpawnRate(rate)}
                      className={`flex-1 px-2 py-1.5 rounded-md border text-xs font-mono font-bold transition-all cursor-pointer ${
                        powerUpSpawnRate === rate
                          ? rate === 'low'
                            ? 'text-blue-400 border-blue-500/40 bg-blue-500/15 ring-1 ring-blue-400/20'
                            : rate === 'normal'
                            ? 'text-cyan-400 border-cyan-500/40 bg-cyan-500/15 ring-1 ring-cyan-400/20'
                            : 'text-purple-400 border-purple-500/40 bg-purple-500/15 ring-1 ring-purple-400/20'
                          : 'border-white/10 text-white/40 bg-white/5 hover:bg-white/10'
                      }`}
                    >
                      {rate.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-sm text-white/70">Theme</span>
                <div className="flex gap-2">
                  {(['neon', 'classic', 'retro'] as const).map(opt => (
                    <button
                      key={opt}
                      onClick={() => setTheme(opt)}
                      className={`flex-1 px-2 py-1.5 rounded-md border text-xs font-mono font-bold transition-all cursor-pointer ${
                        theme === opt
                          ? opt === 'neon'
                            ? 'text-cyan-400 border-cyan-500/40 bg-cyan-500/15 ring-1 ring-cyan-400/20'
                            : opt === 'classic'
                            ? 'text-gray-300 border-gray-500/40 bg-gray-500/15 ring-1 ring-gray-300/20'
                            : 'text-yellow-400 border-yellow-500/40 bg-yellow-500/15 ring-1 ring-yellow-400/20'
                          : 'border-white/10 text-white/40 bg-white/5 hover:bg-white/10'
                      }`}
                    >
                      {opt.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-white/70">Sound</span>
                <button
                  onClick={() => setSoundEnabled(!soundEnabled)}
                  className={`px-3 py-1.5 rounded-md border text-xs font-mono font-bold transition-all cursor-pointer ${
                    soundEnabled
                      ? 'text-lime-400 border-lime-500/40 bg-lime-500/15 hover:bg-lime-500/25 ring-1 ring-lime-400/20'
                      : 'text-red-400 border-red-500/40 bg-red-500/15 hover:bg-red-500/25 ring-1 ring-red-400/20'
                  }`}
                >
                  {soundEnabled ? 'ON' : 'OFF'}
                </button>
              </div>

              <button
                onClick={togglePause}
                className="mt-1 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 text-white font-bold transition-all cursor-pointer"
              >
                ▶ Resume
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer info */}
      {(gameStatus === 'playing' || gameStatus === 'paused') && (
        <div className="relative z-10 mt-3 flex flex-wrap items-center justify-center gap-3 sm:gap-4 text-xs text-white/30 font-mono px-2 text-center">
          {mode === 'single' ? (
            <span>
              Difficulty: <span className={
                difficulty === 'easy' ? 'text-green-400' :
                difficulty === 'medium' ? 'text-yellow-400' :
                difficulty === 'hard' ? 'text-orange-400' : 'text-red-400'
              }>{difficulty.toUpperCase()}</span>
            </span>
          ) : (
            <span>
              Mode: <span className="text-purple-400">2P</span>
            </span>
          )}
          <span className="text-white/10">|</span>
          <span>First to {winScore}</span>
          <span className="text-white/10">|</span>
          <span>Best Rally: <span className="text-cyan-400/70">{maxRally}</span></span>

          {/* Active power-ups indicator */}
          {(playerPowerUpTimer > 0 || aiPowerUpTimer > 0 || playerShrinkTimer > 0 || aiShrinkTimer > 0 || ballSlowTimer > 0 || ballFastTimer > 0) && (
            <>
              <span className="text-white/10">|</span>
              <span>
                {playerPowerUpTimer > 0 && <span className="text-lime-400">P1 +size {playerPowerUpTimer}s </span>}
                {aiPowerUpTimer > 0 && <span className="text-purple-400">P2 +size {aiPowerUpTimer}s </span>}
                {playerShrinkTimer > 0 && <span className="text-red-400">P1 -size {playerShrinkTimer}s </span>}
                {aiShrinkTimer > 0 && <span className="text-rose-400">P2 -size {aiShrinkTimer}s </span>}
                {ballSlowTimer > 0 && <span className="text-amber-400">Slow {ballSlowTimer}s </span>}
                {ballFastTimer > 0 && <span className="text-cyan-400">Fast {ballFastTimer}s</span>}
              </span>
            </>
          )}
        </div>
      )}

        {/* Game instructions and high scores */}
      {gameStatus === 'menu' && (
        <div className="relative z-10 mt-4 text-center flex flex-col items-center space-y-2">
          <div className="text-xs text-white/20 font-mono">
            {selectedMode === 'multi'
              ? 'P1: W/S or touch left  |  P2: ↑/↓ or touch right  |  ⏸️ Space to Pause'
              : '🖱️ Mouse / Touch  |  ⌨️ Arrow Keys / W,S  |  ⏸️ Space to Pause'}
          </div>
          <div className="text-[11px] text-white/18 font-mono">
            Power‑Ups: <span className="text-cyan-300">+</span> enlarge • <span className="text-rose-300">−</span> shrink • <span className="text-amber-300">S</span> slow • <span className="text-purple-300">F</span> fast
          </div>
          {/* Persisted high scores */}
          <div className="bg-black/40 backdrop-blur-sm border border-white/10 rounded-lg px-4 py-2 text-[11px] text-white/60 font-mono flex gap-4 items-center">
            <span>Best Rally: <span className="text-cyan-400 font-bold">{bestRally}</span></span>
            <span>Best Combo: <span className="text-amber-400 font-bold">{bestCombo}</span></span>
            <button
              onClick={resetHighScores}
              className="ml-2 px-2 py-1 bg-white/10 hover:bg-white/20 border border-white/20 rounded text-[10px] uppercase font-semibold text-white/50 transition-all"
            >Reset</button>
          </div>

          <div className="bg-black/30 backdrop-blur-sm border border-white/10 rounded-lg px-4 py-2 text-[11px] text-white/60 font-mono flex flex-wrap gap-3 items-center justify-center">
            <span>Matches: <span className="text-white font-bold">{lifetimeStats.matchesPlayed}</span></span>
            {lifetimeStats.matchesPlayed > 0 && (
              <>
                <span className="text-white/10">|</span>
                <span>1P W/L: <span className="text-lime-400 font-bold">{lifetimeStats.winsPlayer}</span>/<span className="text-rose-400 font-bold">{lifetimeStats.winsAI}</span></span>
                <span className="text-white/10">|</span>
                <span>2P P1/P2: <span className="text-green-400 font-bold">{lifetimeStats.winsP1}</span>/<span className="text-purple-400 font-bold">{lifetimeStats.winsP2}</span></span>
              </>
            )}
            <span className="text-white/10">|</span>
            <span>Power‑Ups: <span className="text-cyan-400 font-bold">{lifetimeStats.totalPowerUps}</span></span>
            <button
              onClick={resetLifetimeStats}
              className="ml-2 px-2 py-1 bg-white/10 hover:bg-white/20 border border-white/20 rounded text-[10px] uppercase font-semibold text-white/50 transition-all"
            >Reset</button>
          </div>
        </div>
      )}
    </div>
  );
}
