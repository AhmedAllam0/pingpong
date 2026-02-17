import { useCallback, useEffect, useRef, useState } from 'react';

export type Difficulty = 'easy' | 'medium' | 'hard' | 'impossible';

// Game modes: single player (vs AI) or multi player (two human players)
export type GameMode = 'single' | 'multi';

interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
  radius: number;
}

interface Paddle {
  x: number;
  y: number;
  width: number;
  height: number;
  speed: number;
  score: number;
  dy: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

interface Trail {
  x: number;
  y: number;
  alpha: number;
}

// Possible power-up types that can spawn on the court.
// - enlarge: makes the last hitter's paddle larger
// - shrink: makes the opponent's paddle smaller
// - slow: slows the ball down
// - fast: speeds the ball up
export type PowerUpType = 'enlarge' | 'shrink' | 'slow' | 'fast';

// Power-up object stored in game state
interface PowerUp {
  x: number;
  y: number;
  radius: number;
  type: PowerUpType;
  // How long this power-up remains on the court (seconds)
  ttl: number;
  // Initial TTL (used for drawing a countdown ring)
  maxTtl: number;
}

interface GameState {
  ball: Ball;
  player: Paddle;
  ai: Paddle;
  particles: Particle[];
  trails: Trail[];
  gameStatus: 'menu' | 'playing' | 'paused' | 'gameOver';
  winner: string;
  rallyCount: number;
  maxRally: number;
  combo: number;
  lastHitTime: number;
  screenShake: { x: number; y: number; intensity: number };
  winScore: number;
  difficulty: Difficulty;
  isPowerHit: boolean;
  powerHitTimer: number;

  // Game mode (single vs multi)
  mode: GameMode;

  // Current theme key
  theme: keyof typeof THEMES;

  /** Power-ups currently on the court */
  powerUps: PowerUp[];
  /** Timer in seconds until the next power-up spawns */
  powerUpSpawnTimer: number;
  /** Tracks which paddle last hit the ball (player or ai) */
  lastHitBy: 'player' | 'ai';
  /** Timer for an active paddle-size power-up affecting the player; when >0 the player's paddle is enlarged */
  playerPowerUpTimer: number;
  /** Timer for an active paddle-size power-up affecting the AI */
  aiPowerUpTimer: number;
  /** Timer for an active slow effect on the ball */
  ballSlowTimer: number;
  /** Factor by which the ball's speed is reduced during a slow effect (1 if no slow effect) */
  ballSlowFactor: number;

  /** Timer for an active fast effect on the ball */
  ballFastTimer: number;
  /** Factor by which the ball's speed is increased during a fast effect (1 if no fast effect) */
  ballFastFactor: number;
  /** Timer for an active shrink effect on the player paddle */
  playerShrinkTimer: number;
  /** Timer for an active shrink effect on the opponent paddle */
  aiShrinkTimer: number;

  /** Serve countdown in seconds. When >0 ball stays still and we render a big countdown. */
  serveCountdown: number;
  /** Direction to launch the ball after the serve countdown (1 = right, -1 = left). */
  serveDirection: 1 | -1;
  /** Tracks the last integer countdown value to trigger beeps only once per second */
  serveCountdownLastInt: number;

  /** Accessibility/performance option: reduce heavy effects */
  reducedMotion: boolean;
  /** When enabled, AI adapts difficulty based on score difference */
  adaptiveAI: boolean;
  /** Enable/disable spawning of power-ups */
  powerUpsEnabled: boolean;
  /** Power-up spawn rate */
  powerUpSpawnRate: 'low' | 'normal' | 'high';

  /** Match start timestamp (ms) for summary */
  matchStartMs: number;
  /** Match end timestamp (ms). Set when the match ends to freeze duration. */
  matchEndMs: number;
  /** Total power-ups collected this match */
  powerUpsCollected: { player: number; ai: number };
}

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 500;
const PADDLE_WIDTH = 14;
const PADDLE_HEIGHT = 90;
const BALL_RADIUS = 8;
const PADDLE_MARGIN = 30;
const BALL_INITIAL_SPEED = 5;

const DIFFICULTY_SETTINGS: Record<Difficulty, { aiSpeed: number; aiReaction: number; aiError: number; ballSpeedMul: number }> = {
  easy: { aiSpeed: 3, aiReaction: 0.03, aiError: 60, ballSpeedMul: 0.85 },
  medium: { aiSpeed: 4.5, aiReaction: 0.06, aiError: 30, ballSpeedMul: 1 },
  hard: { aiSpeed: 6, aiReaction: 0.1, aiError: 10, ballSpeedMul: 1.15 },
  impossible: { aiSpeed: 8, aiReaction: 0.18, aiError: 2, ballSpeedMul: 1.3 },
};

// Theme definitions. Each theme defines the colours for various game elements.
const THEMES = {
  neon: {
    ball: '#00f0ff',
    ballGlow: '#00f0ff',
    player: '#00ff88',
    playerGlow: '#00ff88',
    ai: '#ff4488',
    aiGlow: '#ff4488',
    net: '#ffffff',
    bg: '#0a0e1a',
    court: '#111827',
    text: '#ffffff',
    accent: '#6366f1',
    powerHit: '#ffaa00',
  },
  classic: {
    ball: '#ffffff',
    ballGlow: '#ffffff',
    player: '#ffffff',
    playerGlow: '#ffffff',
    ai: '#ffffff',
    aiGlow: '#ffffff',
    net: '#ffffff',
    bg: '#000000',
    court: '#1a1a1a',
    text: '#ffffff',
    accent: '#ffffff',
    powerHit: '#ffcc00',
  },
  retro: {
    ball: '#ffcc00',
    ballGlow: '#ffcc00',
    player: '#00ff00',
    playerGlow: '#00ff00',
    ai: '#ff00ff',
    aiGlow: '#ff00ff',
    net: '#ffffff',
    bg: '#000030',
    court: '#202060',
    text: '#ffffff',
    accent: '#ff00ff',
    powerHit: '#ffcc00',
  },
} as const;

export function useGameEngine() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const keysRef = useRef<Set<string>>(new Set());
  const mouseYRef = useRef<number>(CANVAS_HEIGHT / 2);
  const useMouseRef = useRef<boolean>(false);

  // Track device pixel ratio for crisp rendering on high‑DPI screens
  const dprRef = useRef<number>(1);

  // Track previous paddle positions to compute dy accurately (especially for touch input)
  const prevPlayerYRef = useRef<number>(CANVAS_HEIGHT / 2 - PADDLE_HEIGHT / 2);
  const prevAiYRef = useRef<number>(CANVAS_HEIGHT / 2 - PADDLE_HEIGHT / 2);

  // Indicates if multi‑touch control is currently active. When true in multi‑player
  // mode we bypass keyboard control and rely on touch input to set paddle
  // positions directly. This ensures that touches on mobile devices do not
  // conflict with keyboard inputs and allows both paddles to be controlled
  // independently via the screen. It is reset when all touches end.
  const touchActiveRef = useRef<boolean>(false);

  const [scores, setScores] = useState({ player: 0, ai: 0 });
  const [gameStatus, setGameStatus] = useState<'menu' | 'playing' | 'paused' | 'gameOver'>('menu');
  const [winner, setWinner] = useState('');
  const [rallyCount, setRallyCount] = useState(0);
  const [maxRally, setMaxRally] = useState(0);
  const [combo, setCombo] = useState(0);
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [winScore, setWinScore] = useState(7);
  // Game mode: single or multi
  const [mode, setMode] = useState<GameMode>('single');
  // Current theme key (persisted)
  const [theme, setTheme] = useState<keyof typeof THEMES>(() => {
    if (typeof window === 'undefined') return 'neon';
    try {
      const stored = localStorage.getItem('pingpongSettings');
      if (stored) {
        const parsed = JSON.parse(stored);
        const t = parsed?.theme;
        if (t === 'neon' || t === 'classic' || t === 'retro') return t;
      }
    } catch {
      // ignore
    }
    return 'neon';
  });
  // Sound enabled flag (persisted)
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try {
      const stored = localStorage.getItem('pingpongSettings');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (typeof parsed?.soundEnabled === 'boolean') return parsed.soundEnabled;
      }
    } catch {
      // ignore
    }
    return true;
  });

  // Accessibility/performance and advanced gameplay toggles (persisted)
  const [reducedMotion, setReducedMotion] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      const stored = localStorage.getItem('pingpongSettings');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (typeof parsed?.reducedMotion === 'boolean') return parsed.reducedMotion;
      }
    } catch {
      // ignore
    }
    // Default to OS preference if no saved setting
    try {
      return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
    } catch {
      return false;
    }
  });
  const [adaptiveAI, setAdaptiveAI] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      const stored = localStorage.getItem('pingpongSettings');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (typeof parsed?.adaptiveAI === 'boolean') return parsed.adaptiveAI;
      }
    } catch {
      // ignore
    }
    return false;
  });
  const [powerUpsEnabled, setPowerUpsEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try {
      const stored = localStorage.getItem('pingpongSettings');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (typeof parsed?.powerUpsEnabled === 'boolean') return parsed.powerUpsEnabled;
      }
    } catch {
      // ignore
    }
    return true;
  });
  const [powerUpSpawnRate, setPowerUpSpawnRate] = useState<'low' | 'normal' | 'high'>(() => {
    if (typeof window === 'undefined') return 'normal';
    try {
      const stored = localStorage.getItem('pingpongSettings');
      if (stored) {
        const parsed = JSON.parse(stored);
        const r = parsed?.powerUpSpawnRate;
        if (r === 'low' || r === 'normal' || r === 'high') return r;
      }
    } catch {
      // ignore
    }
    return 'normal';
  });

  // Rounded (seconds) timers for active effects (power-ups), used for UI.
  // We keep these as React state so the UI updates even if nothing else changes.
  type EffectTimers = {
    p1Enlarge: number;
    p2Enlarge: number;
    p1Shrink: number;
    p2Shrink: number;
    slow: number;
    fast: number;
  };
  const effectTimersRef = useRef<EffectTimers>({ p1Enlarge: 0, p2Enlarge: 0, p1Shrink: 0, p2Shrink: 0, slow: 0, fast: 0 });
  const [effectTimers, setEffectTimers] = useState<EffectTimers>(effectTimersRef.current);

  // Audio context for sound effects
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Helper to play a short beep sound
  const playBeep = useCallback(
    (frequency: number, duration: number = 0.1, volume: number = 0.4) => {
      if (!soundEnabled) return;
      if (typeof window === 'undefined') return;
      try {
        if (!audioCtxRef.current) {
          audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        const ctx = audioCtxRef.current!;
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();
        oscillator.frequency.value = frequency;
        oscillator.type = 'sine';
        gainNode.gain.value = volume;
        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);
        oscillator.start();
        oscillator.stop(ctx.currentTime + duration);
      } catch (err) {
        // ignore audio errors (e.g. user gesture required)
      }
    },
    [soundEnabled]
  );

  // Keep the current theme in the game state for access inside update/render
  useEffect(() => {
    stateRef.current.theme = theme;
  }, [theme]);

  // Sync toggles into the game state so the engine can use them without
  // adding React state to hot paths (update/render).
  useEffect(() => {
    stateRef.current.reducedMotion = reducedMotion;
    if (reducedMotion) {
      // Clear heavy visual buffers immediately
      stateRef.current.particles = [];
      stateRef.current.trails = [];
      stateRef.current.screenShake = { x: 0, y: 0, intensity: 0 };
    }
  }, [reducedMotion]);

  useEffect(() => {
    stateRef.current.adaptiveAI = adaptiveAI;
  }, [adaptiveAI]);

  useEffect(() => {
    stateRef.current.powerUpsEnabled = powerUpsEnabled;
    if (!powerUpsEnabled) {
      // Immediately clear existing power-ups when disabled
      stateRef.current.powerUps = [];
    }
  }, [powerUpsEnabled]);

  useEffect(() => {
    stateRef.current.powerUpSpawnRate = powerUpSpawnRate;
  }, [powerUpSpawnRate]);

  // Persist settings so they stick across refreshes.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(
        'pingpongSettings',
        JSON.stringify({
          theme,
          soundEnabled,
          reducedMotion,
          adaptiveAI,
          powerUpsEnabled,
          powerUpSpawnRate,
        })
      );
    } catch {
      // ignore
    }
  }, [theme, soundEnabled, reducedMotion, adaptiveAI, powerUpsEnabled, powerUpSpawnRate]);

  // Make the canvas crisp on high‑DPI displays by scaling its internal buffer.
  // We keep the logical coordinate system (CANVAS_WIDTH/HEIGHT) unchanged.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (typeof window === 'undefined') return;

    const resizeForDPR = () => {
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      dprRef.current = dpr;
      // Increase internal resolution; CSS size is controlled separately via layout.
      canvas.width = Math.floor(CANVAS_WIDTH * dpr);
      canvas.height = Math.floor(CANVAS_HEIGHT * dpr);
    };

    resizeForDPR();
    window.addEventListener('resize', resizeForDPR);
    window.addEventListener('orientationchange', resizeForDPR);
    return () => {
      window.removeEventListener('resize', resizeForDPR);
      window.removeEventListener('orientationchange', resizeForDPR);
    };
  }, []);

  const stateRef = useRef<GameState>({
    ball: { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2, vx: BALL_INITIAL_SPEED, vy: 0, speed: BALL_INITIAL_SPEED, radius: BALL_RADIUS },
    player: { x: PADDLE_MARGIN, y: CANVAS_HEIGHT / 2 - PADDLE_HEIGHT / 2, width: PADDLE_WIDTH, height: PADDLE_HEIGHT, speed: 7, score: 0, dy: 0 },
    ai: { x: CANVAS_WIDTH - PADDLE_MARGIN - PADDLE_WIDTH, y: CANVAS_HEIGHT / 2 - PADDLE_HEIGHT / 2, width: PADDLE_WIDTH, height: PADDLE_HEIGHT, speed: 4.5, score: 0, dy: 0 },
    particles: [],
    trails: [],
    gameStatus: 'menu',
    winner: '',
    rallyCount: 0,
    maxRally: 0,
    combo: 0,
    lastHitTime: 0,
    screenShake: { x: 0, y: 0, intensity: 0 },
    winScore: 7,
    difficulty: 'medium',
    isPowerHit: false,
    powerHitTimer: 0,

    // default game mode
    mode: 'single',
    // default theme
    theme: 'neon',

    // Power-up state
    powerUps: [],
    powerUpSpawnTimer: 5, // spawn first power-up after 5 seconds of gameplay
    lastHitBy: 'player',
    playerPowerUpTimer: 0,
    aiPowerUpTimer: 0,
    ballSlowTimer: 0,
    ballSlowFactor: 1,

    ballFastTimer: 0,
    ballFastFactor: 1,
    playerShrinkTimer: 0,
    aiShrinkTimer: 0,

    serveCountdown: 0,
    serveDirection: 1,
    serveCountdownLastInt: 0,

    reducedMotion: false,
    adaptiveAI: false,
    powerUpsEnabled: true,
    powerUpSpawnRate: 'normal',

    matchStartMs: 0,
    matchEndMs: 0,
    powerUpsCollected: { player: 0, ai: 0 },
  });

  const createParticles = useCallback((x: number, y: number, color: string, count: number, spread: number = 1) => {
    const state = stateRef.current;
    const rm = state.reducedMotion;
    // Reduce particle count and velocity when reduced motion is enabled
    const finalCount = rm ? Math.max(1, Math.floor(count * 0.35)) : count;
    const velMul = rm ? 0.7 : 1;
    const sizeMul = rm ? 0.85 : 1;
    for (let i = 0; i < finalCount; i++) {
      state.particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 8 * spread * velMul,
        vy: (Math.random() - 0.5) * 8 * spread * velMul,
        life: 1,
        maxLife: 0.5 + Math.random() * 0.8,
        color,
        size: (2 + Math.random() * 4) * sizeMul,
      });
    }
  }, []);

  const addTrail = useCallback((x: number, y: number) => {
    const state = stateRef.current;
    if (state.reducedMotion) {
      // In reduced motion mode, keep trails shorter and fainter
      state.trails.push({ x, y, alpha: 0.45 });
      if (state.trails.length > 8) state.trails.shift();
      return;
    }
    state.trails.push({ x, y, alpha: 0.7 });
    if (state.trails.length > 20) {
      state.trails.shift();
    }
  }, []);

  const addScreenShake = useCallback((intensity: number) => {
    const state = stateRef.current;
    const finalIntensity = state.reducedMotion ? intensity * 0.35 : intensity;
    state.screenShake.intensity = finalIntensity;
  }, []);

  const resetBall = useCallback((direction: number = 1) => {
    const state = stateRef.current;
    const settings = DIFFICULTY_SETTINGS[state.difficulty];
    const speed = BALL_INITIAL_SPEED * settings.ballSpeedMul;

    // Launch the ball with the base speed for the current difficulty.
    // Any active power-up speed factors (slow/fast) are applied via factors
    // during collisions and via direct velocity multiplication when collected.

    state.ball = {
      x: CANVAS_WIDTH / 2,
      y: CANVAS_HEIGHT / 2,
      vx: speed * direction,
      vy: (Math.random() - 0.5) * 3,
      speed,
      radius: BALL_RADIUS,
    };
    state.trails = [];
    state.rallyCount = 0;
    state.combo = 0;
    state.isPowerHit = false;
    state.powerHitTimer = 0;
    setRallyCount(0);
    setCombo(0);
  }, []);

  /**
   * Reset per-point temporary effects (power-ups and speed modifiers) and start
   * a 3 second serve countdown. The ball stays centered until the countdown
   * completes.
   */
  const prepareServe = useCallback((direction: 1 | -1) => {
    const state = stateRef.current;
    const settings = DIFFICULTY_SETTINGS[state.difficulty];
    const speed = BALL_INITIAL_SPEED * settings.ballSpeedMul;

    // Clear temporary effects between points for fairness and clarity
    state.powerUps = [];
    state.powerUpSpawnTimer = 4;
    state.player.height = PADDLE_HEIGHT;
    state.ai.height = PADDLE_HEIGHT;
    state.playerPowerUpTimer = 0;
    state.aiPowerUpTimer = 0;
    state.playerShrinkTimer = 0;
    state.aiShrinkTimer = 0;
    state.ballSlowTimer = 0;
    state.ballSlowFactor = 1;
    state.ballFastTimer = 0;
    state.ballFastFactor = 1;

    // Reset match counters for the new rally
    state.rallyCount = 0;
    state.combo = 0;
    setRallyCount(0);
    setCombo(0);

    // Reset UI timers
    effectTimersRef.current = { p1Enlarge: 0, p2Enlarge: 0, p1Shrink: 0, p2Shrink: 0, slow: 0, fast: 0 };
    setEffectTimers(effectTimersRef.current);

    // Store serve countdown state
    state.serveDirection = direction;
    state.serveCountdown = 3;
    state.serveCountdownLastInt = 0;

    // Center ball with zero velocity during countdown
    state.ball = {
      x: CANVAS_WIDTH / 2,
      y: CANVAS_HEIGHT / 2,
      vx: 0,
      vy: 0,
      speed,
      radius: BALL_RADIUS,
    };
    state.trails = [];
  }, []);

  const startGame = useCallback((diff: Difficulty, winAt: number, gameMode: GameMode = 'single') => {
    const state = stateRef.current;
    const settings = DIFFICULTY_SETTINGS[diff];
    state.difficulty = diff;
    state.winScore = winAt;
    // Set mode and update external state
    state.mode = gameMode;
    setMode(gameMode);
    // Apply current theme to state
    state.theme = theme;
    // Apply runtime options
    state.reducedMotion = reducedMotion;
    state.adaptiveAI = adaptiveAI;
    state.powerUpsEnabled = powerUpsEnabled;
    state.powerUpSpawnRate = powerUpSpawnRate;
    // Initialise paddles
    state.player = { x: PADDLE_MARGIN, y: CANVAS_HEIGHT / 2 - PADDLE_HEIGHT / 2, width: PADDLE_WIDTH, height: PADDLE_HEIGHT, speed: 7, score: 0, dy: 0 };
    // If in multi-player mode, second player's paddle uses same speed as player; otherwise use AI speed based on difficulty
    const aiSpeed = gameMode === 'multi' ? 7 : settings.aiSpeed;
    state.ai = { x: CANVAS_WIDTH - PADDLE_MARGIN - PADDLE_WIDTH, y: CANVAS_HEIGHT / 2 - PADDLE_HEIGHT / 2, width: PADDLE_WIDTH, height: PADDLE_HEIGHT, speed: aiSpeed, score: 0, dy: 0 };

    // Reset previous Y trackers so dy is correct from the first frame
    prevPlayerYRef.current = state.player.y;
    prevAiYRef.current = state.ai.y;
    touchActiveRef.current = false;
    state.particles = [];
    state.trails = [];
    state.gameStatus = 'playing';
    state.winner = '';
    state.rallyCount = 0;
    state.maxRally = 0;
    state.combo = 0;
    state.lastHitTime = 0;
    state.screenShake = { x: 0, y: 0, intensity: 0 };
    state.isPowerHit = false;
    state.powerHitTimer = 0;
    // Reset power-up state
    state.powerUps = [];
    // Start spawn timer at 5 seconds for first spawn
    state.powerUpSpawnTimer = 5;
    state.lastHitBy = 'player';
    state.playerPowerUpTimer = 0;
    state.aiPowerUpTimer = 0;
    state.ballSlowTimer = 0;
    state.ballSlowFactor = 1;

    state.ballFastTimer = 0;
    state.ballFastFactor = 1;
    state.playerShrinkTimer = 0;
    state.aiShrinkTimer = 0;

    state.serveCountdown = 0;
    state.serveDirection = 1;

    // Match stats
    state.matchStartMs = Date.now();
    state.matchEndMs = 0;
    state.powerUpsCollected = { player: 0, ai: 0 };

    // Reset UI timers
    effectTimersRef.current = { p1Enlarge: 0, p2Enlarge: 0, p1Shrink: 0, p2Shrink: 0, slow: 0, fast: 0 };
    setEffectTimers(effectTimersRef.current);

    // Start with a serve countdown for a more arcade/competitive feel
    prepareServe(Math.random() > 0.5 ? 1 : -1);
    setScores({ player: 0, ai: 0 });
    setGameStatus('playing');
    setWinner('');
    setMaxRally(0);
    setDifficulty(diff);
    setWinScore(winAt);

    // Try to unlock/resume audio on mobile browsers (must be called from a user gesture).
    if (soundEnabled && typeof window !== 'undefined') {
      try {
        if (!audioCtxRef.current) {
          audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        if (audioCtxRef.current.state === 'suspended') {
          void audioCtxRef.current.resume();
        }
      } catch {
        // ignore
      }
    }
  }, [prepareServe, theme, soundEnabled, reducedMotion, adaptiveAI, powerUpsEnabled, powerUpSpawnRate]);

  const togglePause = useCallback(() => {
    const state = stateRef.current;
    if (state.gameStatus === 'playing') {
      state.gameStatus = 'paused';
      setGameStatus('paused');
    } else if (state.gameStatus === 'paused') {
      state.gameStatus = 'playing';
      setGameStatus('playing');
    }
  }, []);

  const returnToMenu = useCallback(() => {
    stateRef.current.gameStatus = 'menu';
    setGameStatus('menu');
  }, []);

  // Game update loop
  const update = useCallback(() => {
    const state = stateRef.current;
    // Resolve the current theme colors for use during the update cycle
    const colors = THEMES[state.theme];
    if (state.gameStatus !== 'playing') return;

    const keys = keysRef.current;
    const settings = DIFFICULTY_SETTINGS[state.difficulty];

    // Adaptive AI (single player only)
    if (state.mode === 'single') {
      const base = settings.aiSpeed;
      if (state.adaptiveAI) {
        // If the player is ahead, increase AI speed; if behind, ease slightly.
        const diff = state.player.score - state.ai.score;
        let target = base + diff * 0.45;
        const min = base * 0.6;
        const max = base * 2.0;
        if (target < min) target = min;
        if (target > max) target = max;
        state.ai.speed = target;
      } else {
        state.ai.speed = base;
      }
    }

    // Player and opponent movement based on mode
    if (state.mode === 'multi') {
      // In multiplayer mode, disable mouse control
      useMouseRef.current = false;
      // If touch control is active (e.g. on mobile), we skip keyboard movement.
      // The touch handlers have already updated paddle positions and set
      // touchActiveRef.current accordingly. We still clamp the paddles to
      // ensure they remain within the court bounds.
      if (touchActiveRef.current) {
        state.player.y = Math.max(0, Math.min(CANVAS_HEIGHT - state.player.height, state.player.y));
        state.ai.y = Math.max(0, Math.min(CANVAS_HEIGHT - state.ai.height, state.ai.y));
      } else {
        // No active touches: fallback to keyboard controls.
        // Player 1 uses W/S keys
        state.player.dy = 0;
        if (keys.has('w') || keys.has('W')) {
          state.player.y -= state.player.speed;
          state.player.dy = -state.player.speed;
        }
        if (keys.has('s') || keys.has('S')) {
          state.player.y += state.player.speed;
          state.player.dy = state.player.speed;
        }
        // Player 2 (right paddle) uses Arrow keys
        state.ai.dy = 0;
        if (keys.has('ArrowUp')) {
          state.ai.y -= state.ai.speed;
          state.ai.dy = -state.ai.speed;
        }
        if (keys.has('ArrowDown')) {
          state.ai.y += state.ai.speed;
          state.ai.dy = state.ai.speed;
        }
        // Clamp both paddles
        state.player.y = Math.max(0, Math.min(CANVAS_HEIGHT - state.player.height, state.player.y));
        state.ai.y = Math.max(0, Math.min(CANVAS_HEIGHT - state.ai.height, state.ai.y));
      }
    } else {
      // Single player mode: player vs AI
      // Player paddle movement
      if (useMouseRef.current) {
        const targetY = mouseYRef.current - state.player.height / 2;
        const diff = targetY - state.player.y;
        state.player.dy = diff * 0.15;
        state.player.y += state.player.dy;
      } else {
        state.player.dy = 0;
        if (keys.has('ArrowUp') || keys.has('w') || keys.has('W')) {
          state.player.y -= state.player.speed;
          state.player.dy = -state.player.speed;
        }
        if (keys.has('ArrowDown') || keys.has('s') || keys.has('S')) {
          state.player.y += state.player.speed;
          state.player.dy = state.player.speed;
        }
      }
      // Clamp player paddle
      state.player.y = Math.max(0, Math.min(CANVAS_HEIGHT - state.player.height, state.player.y));
      // AI paddle movement
      const aiCenter = state.ai.y + state.ai.height / 2;
      const aiError = (Math.random() - 0.5) * settings.aiError;
      let targetY = state.ball.y + aiError;
      // Predictive AI - predict where ball will be
      if (state.ball.vx > 0) {
        const timeToReach = (state.ai.x - state.ball.x) / state.ball.vx;
        let predictedY = state.ball.y + state.ball.vy * timeToReach;
        // Bounce prediction
        while (predictedY < 0 || predictedY > CANVAS_HEIGHT) {
          if (predictedY < 0) predictedY = -predictedY;
          if (predictedY > CANVAS_HEIGHT) predictedY = 2 * CANVAS_HEIGHT - predictedY;
        }
        targetY = predictedY + aiError;
      }
      const aiDiff = targetY - aiCenter;
      state.ai.dy = Math.sign(aiDiff) * Math.min(Math.abs(aiDiff) * settings.aiReaction + 0.5, state.ai.speed);
      state.ai.y += state.ai.dy;
      state.ai.y = Math.max(0, Math.min(CANVAS_HEIGHT - state.ai.height, state.ai.y));
    }

    // Compute paddle dy based on actual movement between frames.
    // This makes "power hits" work correctly for touch controls (which set y directly).
    state.player.dy = state.player.y - prevPlayerYRef.current;
    state.ai.dy = state.ai.y - prevAiYRef.current;
    prevPlayerYRef.current = state.player.y;
    prevAiYRef.current = state.ai.y;

    // Power hit timer
    if (state.powerHitTimer > 0) {
      state.powerHitTimer -= 1 / 60;
      if (state.powerHitTimer <= 0) {
        state.isPowerHit = false;
        state.powerHitTimer = 0;
      }
    }

    // Power-ups: spawn, TTL, and active effect timers
    {
      const dt = 1 / 60;
      const maxPowerUps = 3;

      // Decide spawn interval based on user setting
      const nextSpawnInterval = () => {
        switch (state.powerUpSpawnRate) {
          case 'low':
            return 12 + Math.random() * 8; // 12–20s
          case 'high':
            return 4 + Math.random() * 4; // 4–8s
          default:
            return 8 + Math.random() * 6; // 8–14s
        }
      };

      // Spawn power-ups only during active play (not during serve countdown)
      if (state.powerUpsEnabled && state.serveCountdown <= 0) {
        state.powerUpSpawnTimer -= dt;
        if (state.powerUpSpawnTimer <= 0) {
          // Weighted random selection (keeps gameplay balanced)
          const r = Math.random();
          const type: PowerUpType =
            r < 0.3 ? 'enlarge' :
            r < 0.55 ? 'slow' :
            r < 0.8 ? 'fast' :
            'shrink';

          // Place within court boundaries away from edges
          const px = 90 + Math.random() * (CANVAS_WIDTH - 180);
          const py = 55 + Math.random() * (CANVAS_HEIGHT - 110);

          // Avoid clutter on small screens
          if (state.powerUps.length >= maxPowerUps) state.powerUps.shift();

          const ttl = 10;
          state.powerUps.push({ x: px, y: py, radius: 12, type, ttl, maxTtl: ttl });
          state.powerUpSpawnTimer = nextSpawnInterval();
        }
      }

      // Decrease TTL for existing power-ups and remove expired ones
      if (state.powerUps.length > 0) {
        for (const pu of state.powerUps) pu.ttl -= dt;
        state.powerUps = state.powerUps.filter(pu => pu.ttl > 0);
      }

      // Enlarge timers
      if (state.playerPowerUpTimer > 0) {
        state.playerPowerUpTimer -= dt;
        if (state.playerPowerUpTimer <= 0) {
          state.player.height = PADDLE_HEIGHT;
          state.playerPowerUpTimer = 0;
        }
      }
      if (state.aiPowerUpTimer > 0) {
        state.aiPowerUpTimer -= dt;
        if (state.aiPowerUpTimer <= 0) {
          state.ai.height = PADDLE_HEIGHT;
          state.aiPowerUpTimer = 0;
        }
      }

      // Shrink timers
      if (state.playerShrinkTimer > 0) {
        state.playerShrinkTimer -= dt;
        if (state.playerShrinkTimer <= 0) {
          state.player.height = PADDLE_HEIGHT;
          state.playerShrinkTimer = 0;
        }
      }
      if (state.aiShrinkTimer > 0) {
        state.aiShrinkTimer -= dt;
        if (state.aiShrinkTimer <= 0) {
          state.ai.height = PADDLE_HEIGHT;
          state.aiShrinkTimer = 0;
        }
      }

      // Slow ball timer
      if (state.ballSlowTimer > 0) {
        state.ballSlowTimer -= dt;
        if (state.ballSlowTimer <= 0) {
          if (state.ballSlowFactor !== 1) {
            state.ball.vx /= state.ballSlowFactor;
            state.ball.vy /= state.ballSlowFactor;
            state.ballSlowFactor = 1;
          }
          state.ballSlowTimer = 0;
        }
      }

      // Fast ball timer
      if (state.ballFastTimer > 0) {
        state.ballFastTimer -= dt;
        if (state.ballFastTimer <= 0) {
          if (state.ballFastFactor !== 1) {
            state.ball.vx /= state.ballFastFactor;
            state.ball.vy /= state.ballFastFactor;
            state.ballFastFactor = 1;
          }
          state.ballFastTimer = 0;
        }
      }
    }

    // Update UI effect timers (rounded seconds) without causing 60fps React re-renders.
    // We only update when the displayed value changes.
    const nextEffectTimers = {
      p1Enlarge: Math.max(0, Math.ceil(state.playerPowerUpTimer)),
      p2Enlarge: Math.max(0, Math.ceil(state.aiPowerUpTimer)),
      p1Shrink: Math.max(0, Math.ceil(state.playerShrinkTimer)),
      p2Shrink: Math.max(0, Math.ceil(state.aiShrinkTimer)),
      slow: Math.max(0, Math.ceil(state.ballSlowTimer)),
      fast: Math.max(0, Math.ceil(state.ballFastTimer)),
    };
    const prevEffectTimers = effectTimersRef.current;
    if (
      nextEffectTimers.p1Enlarge !== prevEffectTimers.p1Enlarge ||
      nextEffectTimers.p2Enlarge !== prevEffectTimers.p2Enlarge ||
      nextEffectTimers.p1Shrink !== prevEffectTimers.p1Shrink ||
      nextEffectTimers.p2Shrink !== prevEffectTimers.p2Shrink ||
      nextEffectTimers.slow !== prevEffectTimers.slow ||
      nextEffectTimers.fast !== prevEffectTimers.fast
    ) {
      effectTimersRef.current = nextEffectTimers;
      setEffectTimers(nextEffectTimers);
    }

    // Serve countdown: keep ball stationary and give players time before the next rally.
    if (state.serveCountdown > 0) {
      const dt = 1 / 60;
      state.serveCountdown -= dt;
      const secLeft = Math.max(0, Math.ceil(state.serveCountdown));
      if (secLeft !== state.serveCountdownLastInt && secLeft > 0) {
        state.serveCountdownLastInt = secLeft;
        // Small tick each second
        playBeep(760, 0.06, 0.22);
      }
      if (state.serveCountdown <= 0) {
        state.serveCountdown = 0;
        state.serveCountdownLastInt = 0;
        // Launch ball in the stored direction
        resetBall(state.serveDirection);
        playBeep(950, 0.08, 0.32);
      }

      // Still update particles/trails/shake so visuals don't freeze during countdown
      state.particles = state.particles.filter(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.96;
        p.vy *= 0.96;
        p.life -= 1 / 60 / p.maxLife;
        return p.life > 0;
      });
      state.trails = state.trails.map(t => ({ ...t, alpha: t.alpha * 0.88 })).filter(t => t.alpha > 0.02);
      if (state.screenShake.intensity > 0) {
        state.screenShake.x = (Math.random() - 0.5) * state.screenShake.intensity;
        state.screenShake.y = (Math.random() - 0.5) * state.screenShake.intensity;
        state.screenShake.intensity *= 0.85;
        if (state.screenShake.intensity < 0.5) {
          state.screenShake = { x: 0, y: 0, intensity: 0 };
        }
      }
      return;
    }

    // Ball trail
    addTrail(state.ball.x, state.ball.y);

    // Ball movement
    state.ball.x += state.ball.vx;
    state.ball.y += state.ball.vy;

    // Top/bottom wall collision
    if (state.ball.y - state.ball.radius <= 0) {
      state.ball.y = state.ball.radius;
      state.ball.vy = Math.abs(state.ball.vy);
      createParticles(state.ball.x, state.ball.y, colors.ball, 5, 0.5);
      // Play a high-pitched beep when bouncing off the top wall
      playBeep(700);
    }
    if (state.ball.y + state.ball.radius >= CANVAS_HEIGHT) {
      state.ball.y = CANVAS_HEIGHT - state.ball.radius;
      state.ball.vy = -Math.abs(state.ball.vy);
      createParticles(state.ball.x, state.ball.y, colors.ball, 5, 0.5);
      // Play a high-pitched beep when bouncing off the bottom wall
      playBeep(700);
    }

    // Paddle collision helper
    const checkPaddleCollision = (paddle: Paddle, isPlayer: boolean) => {
      if (
        state.ball.x - state.ball.radius < paddle.x + paddle.width &&
        state.ball.x + state.ball.radius > paddle.x &&
        state.ball.y + state.ball.radius > paddle.y &&
        state.ball.y - state.ball.radius < paddle.y + paddle.height
      ) {
        // Calculate hit position (normalized -1 to 1)
        const hitPos = ((state.ball.y - (paddle.y + paddle.height / 2)) / (paddle.height / 2));
        const angle = hitPos * (Math.PI / 3); // Max 60 degree angle

        // Speed increase
        state.ball.speed = Math.min(state.ball.speed * 1.05, 14 * settings.ballSpeedMul);
        const speed = state.ball.speed;

        // Check for power hit (fast paddle movement)
        const paddleSpeed = Math.abs(paddle.dy);
        if (paddleSpeed > 4) {
          state.isPowerHit = true;
          state.powerHitTimer = 0.5;
          state.ball.speed = Math.min(state.ball.speed * 1.2, 16 * settings.ballSpeedMul);
          addScreenShake(8);
          createParticles(state.ball.x, state.ball.y, colors.powerHit, 25, 2);
          // Play a more intense beep for power hits
          playBeep(1000);
        }

        // Apply slow/fast factors (if active) by scaling velocities, while keeping
        // ball.speed as the logical base speed.
        const velMul = state.ballSlowFactor * state.ballFastFactor;
        state.ball.vx = Math.cos(angle) * speed * (isPlayer ? 1 : -1) * velMul;
        state.ball.vy = Math.sin(angle) * speed * velMul;

        // Push ball outside paddle
        if (isPlayer) {
          state.ball.x = paddle.x + paddle.width + state.ball.radius;
        } else {
          state.ball.x = paddle.x - state.ball.radius;
        }

        // Rally tracking
        state.rallyCount++;
        setRallyCount(state.rallyCount);
        if (state.rallyCount > state.maxRally) {
          state.maxRally = state.rallyCount;
          setMaxRally(state.maxRally);
        }

        // Combo
        const now = Date.now();
        if (now - state.lastHitTime < 2000 && isPlayer) {
          state.combo++;
          setCombo(state.combo);
        } else if (isPlayer) {
          state.combo = 1;
          setCombo(1);
        }
        state.lastHitTime = now;

        // Effects
        const color = isPlayer ? colors.player : colors.ai;
        createParticles(state.ball.x, state.ball.y, color, 15, 1.5);
        addScreenShake(state.isPowerHit ? 8 : 4);

        // Update last hit tracker so that power-ups are awarded to the correct side
        state.lastHitBy = isPlayer ? 'player' : 'ai';

        // Play a standard beep when the ball hits a paddle (different frequency for player vs AI)
        playBeep(isPlayer ? 600 : 500);
      }
    };

    // Check paddle collisions
    if (state.ball.vx < 0) {
      checkPaddleCollision(state.player, true);
    } else {
      checkPaddleCollision(state.ai, false);
    }

    // Scoring
    if (state.ball.x < -20) {
      state.ai.score++;
      setScores({ player: state.player.score, ai: state.ai.score });
      createParticles(0, state.ball.y, colors.ai, 30, 2);
      addScreenShake(10);
      if (state.ai.score >= state.winScore) {
        state.gameStatus = 'gameOver';
        state.winner = state.mode === 'multi' ? 'P2' : 'AI';
        state.matchEndMs = Date.now();
        setGameStatus('gameOver');
        setWinner(state.winner);
        createParticles(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2, colors.ai, 60, 3);
        // Play a low beep indicating the player lost the point
        playBeep(300);
      } else {
        // Serve towards the loser (left side)
        prepareServe(-1);
        // Play a reset beep
        playBeep(400);
      }
    }
    if (state.ball.x > CANVAS_WIDTH + 20) {
      state.player.score++;
      setScores({ player: state.player.score, ai: state.ai.score });
      createParticles(CANVAS_WIDTH, state.ball.y, colors.player, 30, 2);
      addScreenShake(10);
      if (state.player.score >= state.winScore) {
        state.gameStatus = 'gameOver';
        state.winner = state.mode === 'multi' ? 'P1' : 'Player';
        state.matchEndMs = Date.now();
        setGameStatus('gameOver');
        setWinner(state.winner);
        createParticles(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2, colors.player, 60, 3);
        // Play a celebratory beep when the player scores a point
        playBeep(900);
      } else {
        // Serve towards the loser (right side)
        prepareServe(1);
        // Play a reset beep
        playBeep(400);
      }
    }

    // Collision detection with power-ups
    state.powerUps = state.powerUps.filter(pu => {
      // Distance between ball and power-up
      const dx = state.ball.x - pu.x;
      const dy = state.ball.y - pu.y;
      const distSq = dx * dx + dy * dy;
      const rad = state.ball.radius + pu.radius;
      if (distSq <= rad * rad) {
        // Ball has collected this power-up
        // Play a special beep
        playBeep(800);
        // Pick a particle colour per type
        const effectColor =
          pu.type === 'enlarge' ? colors.player :
          pu.type === 'shrink' ? colors.ai :
          pu.type === 'fast' ? colors.accent :
          colors.powerHit;
        createParticles(pu.x, pu.y, effectColor, 25, 2);

        // Apply effect based on type and which side last hit the ball
        const beneficiary = state.lastHitBy; // 'player' (left) or 'ai' (right)
        if (beneficiary === 'player') state.powerUpsCollected.player += 1;
        else state.powerUpsCollected.ai += 1;

        if (pu.type === 'enlarge') {
          // Enlarge beneficiary paddle and clear shrink on that paddle
          if (beneficiary === 'player') {
            state.player.height = Math.min(PADDLE_HEIGHT * 1.6, CANVAS_HEIGHT - 20);
            state.playerPowerUpTimer = 6;
            state.playerShrinkTimer = 0;
          } else {
            state.ai.height = Math.min(PADDLE_HEIGHT * 1.6, CANVAS_HEIGHT - 20);
            state.aiPowerUpTimer = 6;
            state.aiShrinkTimer = 0;
          }
        } else if (pu.type === 'shrink') {
          // Shrink the opponent of the beneficiary and clear enlarge on that opponent
          if (beneficiary === 'player') {
            state.ai.height = Math.max(PADDLE_HEIGHT * 0.6, 22);
            state.aiShrinkTimer = 6;
            state.aiPowerUpTimer = 0;
          } else {
            state.player.height = Math.max(PADDLE_HEIGHT * 0.6, 22);
            state.playerShrinkTimer = 6;
            state.playerPowerUpTimer = 0;
          }
        } else if (pu.type === 'slow') {
          // Slow the ball down
          const factor = 0.6;
          if (state.ballSlowFactor === 1) {
            state.ball.vx *= factor;
            state.ball.vy *= factor;
            state.ballSlowFactor = factor;
            state.ballSlowTimer = 6;
          } else {
            state.ballSlowTimer = 6;
          }
        } else if (pu.type === 'fast') {
          // Speed the ball up
          const factor = 1.6;
          if (state.ballFastFactor === 1) {
            state.ball.vx *= factor;
            state.ball.vy *= factor;
            state.ballFastFactor = factor;
            state.ballFastTimer = 6;
          } else {
            state.ballFastTimer = 6;
          }
        }
        // Remove this power-up from array
        return false;
      }
      return true;
    });

    // Update particles
    state.particles = state.particles.filter(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.96;
      p.vy *= 0.96;
      p.life -= 1 / 60 / p.maxLife;
      return p.life > 0;
    });

    // Update trails
    state.trails = state.trails.map(t => ({ ...t, alpha: t.alpha * 0.88 })).filter(t => t.alpha > 0.02);

    // Update screen shake
    if (state.screenShake.intensity > 0) {
      state.screenShake.x = (Math.random() - 0.5) * state.screenShake.intensity;
      state.screenShake.y = (Math.random() - 0.5) * state.screenShake.intensity;
      state.screenShake.intensity *= 0.85;
      if (state.screenShake.intensity < 0.5) {
        state.screenShake = { x: 0, y: 0, intensity: 0 };
      }
    }
  }, [createParticles, addTrail, addScreenShake, resetBall, prepareServe, playBeep]);

  // Render loop
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const state = stateRef.current;

    // Apply device pixel ratio scaling so drawing uses the logical game
    // coordinate system (CANVAS_WIDTH/HEIGHT) while remaining crisp.
    const dpr = dprRef.current || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Resolve the current theme colours for this render cycle
    const colors = THEMES[state.theme];

    ctx.save();
    ctx.translate(state.screenShake.x, state.screenShake.y);

    // Background
    ctx.fillStyle = colors.bg;
    ctx.fillRect(-10, -10, CANVAS_WIDTH + 20, CANVAS_HEIGHT + 20);

    // Court background
    const courtGrad = ctx.createRadialGradient(
      CANVAS_WIDTH / 2,
      CANVAS_HEIGHT / 2,
      0,
      CANVAS_WIDTH / 2,
      CANVAS_HEIGHT / 2,
      400
    );
    courtGrad.addColorStop(0, '#1a1f3a');
    courtGrad.addColorStop(1, colors.bg);
    ctx.fillStyle = courtGrad;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Grid lines
    ctx.strokeStyle = 'rgba(100, 120, 200, 0.05)';
    ctx.lineWidth = 1;
    for (let x = 0; x < CANVAS_WIDTH; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, CANVAS_HEIGHT);
      ctx.stroke();
    }
    for (let y = 0; y < CANVAS_HEIGHT; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(CANVAS_WIDTH, y);
      ctx.stroke();
    }

    // Center line (dashed)
    ctx.setLineDash([10, 10]);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(CANVAS_WIDTH / 2, 0);
    ctx.lineTo(CANVAS_WIDTH / 2, CANVAS_HEIGHT);
    ctx.stroke();
    ctx.setLineDash([]);

    // Center circle
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2, 60, 0, Math.PI * 2);
    ctx.stroke();

    // Court border
    ctx.strokeStyle = 'rgba(100, 120, 255, 0.15)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, CANVAS_WIDTH - 2, CANVAS_HEIGHT - 2);

    // Draw active power-ups
    state.powerUps.forEach(pu => {
      // Choose color and icon based on type
      const puColor =
        pu.type === 'enlarge' ? colors.player :
        pu.type === 'shrink' ? colors.ai :
        pu.type === 'fast' ? colors.accent :
        colors.powerHit;
      const icon =
        pu.type === 'enlarge' ? '+' :
        pu.type === 'shrink' ? '−' :
        pu.type === 'fast' ? 'F' :
        'S';
      // Outer glow
      ctx.shadowColor = puColor;
      ctx.shadowBlur = 20;
      ctx.fillStyle = puColor;
      ctx.beginPath();
      ctx.arc(pu.x, pu.y, pu.radius + 2, 0, Math.PI * 2);
      ctx.fill();
      // Inner circle
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(pu.x, pu.y, pu.radius * 0.5, 0, Math.PI * 2);
      ctx.fill();

      // Countdown ring (shows how long before the power-up disappears)
      const pct = pu.maxTtl > 0 ? Math.max(0, Math.min(1, pu.ttl / pu.maxTtl)) : 0;
      ctx.strokeStyle = puColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(pu.x, pu.y, pu.radius + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct);
      ctx.stroke();

      // Icon
      ctx.font = 'bold 12px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = puColor;
      ctx.fillText(icon, pu.x, pu.y);
    });

    // Trails
    state.trails.forEach(trail => {
      ctx.beginPath();
      ctx.arc(trail.x, trail.y, state.ball.radius * 0.7, 0, Math.PI * 2);
      const trailColor = state.isPowerHit ? colors.powerHit : colors.ball;
      ctx.fillStyle = trailColor + Math.floor(trail.alpha * 80).toString(16).padStart(2, '0');
      ctx.fill();
    });

    // Particles
    state.particles.forEach(p => {
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    });
    ctx.globalAlpha = 1;

    if (state.gameStatus === 'playing' || state.gameStatus === 'paused' || state.gameStatus === 'gameOver') {
      // Draw paddles with glow
      const drawPaddle = (paddle: Paddle, color: string, glowColor: string) => {
        // Glow
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = 20;
        // Paddle body
        const grad = ctx.createLinearGradient(paddle.x, paddle.y, paddle.x, paddle.y + paddle.height);
        grad.addColorStop(0, color + 'cc');
        grad.addColorStop(0.5, color);
        grad.addColorStop(1, color + 'cc');
        ctx.fillStyle = grad;
        // Rounded rect
        const r = paddle.width / 2;
        ctx.beginPath();
        ctx.moveTo(paddle.x + r, paddle.y);
        ctx.lineTo(paddle.x + paddle.width - r, paddle.y);
        ctx.quadraticCurveTo(paddle.x + paddle.width, paddle.y, paddle.x + paddle.width, paddle.y + r);
        ctx.lineTo(paddle.x + paddle.width, paddle.y + paddle.height - r);
        ctx.quadraticCurveTo(paddle.x + paddle.width, paddle.y + paddle.height, paddle.x + paddle.width - r, paddle.y + paddle.height);
        ctx.lineTo(paddle.x + r, paddle.y + paddle.height);
        ctx.quadraticCurveTo(paddle.x, paddle.y + paddle.height, paddle.x, paddle.y + paddle.height - r);
        ctx.lineTo(paddle.x, paddle.y + r);
        ctx.quadraticCurveTo(paddle.x, paddle.y, paddle.x + r, paddle.y);
        ctx.closePath();
        ctx.fill();
        // Edge highlight
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.shadowBlur = 0;
      };

      drawPaddle(state.player, colors.player, colors.playerGlow);
      drawPaddle(state.ai, colors.ai, colors.aiGlow);

      // Ball
      if (state.gameStatus !== 'gameOver') {
        const ballColor = state.isPowerHit ? colors.powerHit : colors.ball;
        // Outer glow
        ctx.shadowColor = ballColor;
        ctx.shadowBlur = 30;
        const ballGrad = ctx.createRadialGradient(
          state.ball.x, state.ball.y, 0,
          state.ball.x, state.ball.y, state.ball.radius * (state.isPowerHit ? 1.5 : 1)
        );
        ballGrad.addColorStop(0, '#ffffff');
        ballGrad.addColorStop(0.3, ballColor);
        ballGrad.addColorStop(1, ballColor + '00');
        ctx.fillStyle = ballGrad;
        ctx.beginPath();
        ctx.arc(state.ball.x, state.ball.y, state.ball.radius * (state.isPowerHit ? 1.5 : 1), 0, Math.PI * 2);
        ctx.fill();
        // Inner white core
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(state.ball.x, state.ball.y, state.ball.radius * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }

      // Score display (large, behind gameplay)
      ctx.globalAlpha = 0.08;
      ctx.font = 'bold 180px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = colors.player;
      ctx.fillText(String(state.player.score), CANVAS_WIDTH / 4, CANVAS_HEIGHT / 2);
      ctx.fillStyle = colors.ai;
      ctx.fillText(String(state.ai.score), 3 * CANVAS_WIDTH / 4, CANVAS_HEIGHT / 2);
      ctx.globalAlpha = 1;

      // Rally counter
      if (state.rallyCount > 2) {
        ctx.font = 'bold 16px "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffffff88';
        ctx.fillText(`Rally: ${state.rallyCount}`, CANVAS_WIDTH / 2, 25);
      }

      // Power hit indicator
      if (state.isPowerHit) {
        ctx.font = 'bold 20px "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = colors.powerHit;
        ctx.shadowColor = colors.powerHit;
        ctx.shadowBlur = 15;
        ctx.fillText('⚡ POWER HIT ⚡', CANVAS_WIDTH / 2, 50);
        ctx.shadowBlur = 0;
      }

      // Serve countdown overlay
      if (state.gameStatus === 'playing' && state.serveCountdown > 0) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        const n = Math.max(1, Math.ceil(state.serveCountdown));
        ctx.font = 'bold 96px "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = colors.ball;
        ctx.shadowBlur = 30;
        ctx.fillText(String(n), CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
        ctx.shadowBlur = 0;

        ctx.font = '16px "Courier New", monospace';
        ctx.fillStyle = '#ffffffaa';
        ctx.fillText('Get Ready…', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 70);
      }

      // Paused overlay
      if (state.gameStatus === 'paused') {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        ctx.font = 'bold 48px "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = colors.accent;
        ctx.shadowBlur = 20;
        ctx.fillText('PAUSED', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 20);
        ctx.shadowBlur = 0;
        ctx.font = '18px "Courier New", monospace';
        ctx.fillStyle = '#aaaaaa';
        ctx.fillText('Press SPACE / ESC / P to resume', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 25);
      }

      // Game over overlay
      if (state.gameStatus === 'gameOver') {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        const leftWinner = state.winner === 'Player' || state.winner === 'P1';
        const winColor = leftWinner ? colors.player : colors.ai;
        const winText =
          state.mode === 'single'
            ? leftWinner
              ? '🏆 YOU WIN!'
              : '💀 AI WINS!'
            : leftWinner
              ? '🏆 P1 WINS!'
              : '🏆 P2 WINS!';

        ctx.font = 'bold 56px "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.shadowColor = winColor;
        ctx.shadowBlur = 25;
        ctx.fillStyle = winColor;
        ctx.fillText(winText, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 70);
        ctx.shadowBlur = 0;

        ctx.font = '22px "Courier New", monospace';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(`${state.player.score} - ${state.ai.score}`, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 5);

        const endMs = state.matchEndMs || Date.now();
        const durSec = Math.max(0, Math.floor((endMs - state.matchStartMs) / 1000));
        const mm = String(Math.floor(durSec / 60)).padStart(2, '0');
        const ss = String(durSec % 60).padStart(2, '0');

        ctx.font = '16px "Courier New", monospace';
        ctx.fillStyle = '#aaaaaa';
        ctx.fillText(`Best Rally: ${state.maxRally}`, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 30);
        ctx.fillText(`Time: ${mm}:${ss}`, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 52);
        const leftLabel = state.mode === 'multi' ? 'P1' : 'Player';
        const rightLabel = state.mode === 'multi' ? 'P2' : 'AI';
        ctx.fillText(
          `Power-Ups: ${leftLabel} ${state.powerUpsCollected.player} | ${rightLabel} ${state.powerUpsCollected.ai}`,
          CANVAS_WIDTH / 2,
          CANVAS_HEIGHT / 2 + 74
        );

        ctx.font = '13px "Courier New", monospace';
        ctx.fillStyle = '#777777';
        ctx.fillText('Tip: Press R for rematch, M for menu', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 105);
      }
    }

    // Menu
    if (state.gameStatus === 'menu') {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      // Title
      ctx.font = 'bold 60px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.shadowColor = colors.ball;
      ctx.shadowBlur = 30;
      ctx.fillStyle = '#ffffff';
      ctx.fillText('PING PONG', CANVAS_WIDTH / 2, 120);
      ctx.shadowBlur = 0;

      // Subtitle
      ctx.font = '16px "Courier New", monospace';
      ctx.fillStyle = colors.ball;
      ctx.fillText('P R O', CANVAS_WIDTH / 2, 155);

      // Animated ball icon
      const t = Date.now() / 1000;
      const animBallX = CANVAS_WIDTH / 2 + Math.sin(t * 2) * 30;
      const animBallY = 190 + Math.cos(t * 3) * 5;
      ctx.fillStyle = colors.ball;
      ctx.shadowColor = colors.ball;
      ctx.shadowBlur = 15;
      ctx.beginPath();
      ctx.arc(animBallX, animBallY, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Instructions
      ctx.font = '14px "Courier New", monospace';
      ctx.fillStyle = '#888888';
      ctx.fillText('Use ↑↓ keys, W/S keys, or Mouse to move', CANVAS_WIDTH / 2, CANVAS_HEIGHT - 50);
      ctx.fillText('SPACE to pause | Select options below', CANVAS_WIDTH / 2, CANVAS_HEIGHT - 28);
    }

    ctx.restore();
  }, []);

  // Main game loop
  const gameLoop = useCallback(() => {
    update();
    render();
    animationRef.current = requestAnimationFrame(gameLoop);
  }, [update, render]);

  useEffect(() => {
    animationRef.current = requestAnimationFrame(gameLoop);
    return () => cancelAnimationFrame(animationRef.current);
  }, [gameLoop]);

  // Keyboard input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      keysRef.current.add(e.key);
      useMouseRef.current = false;
      // Pause / resume
      if (e.key === ' ' || e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        if (stateRef.current.gameStatus === 'playing' || stateRef.current.gameStatus === 'paused') {
          togglePause();
        }
      }

      // Rematch (game over)
      if ((e.key === 'r' || e.key === 'R') && stateRef.current.gameStatus === 'gameOver') {
        e.preventDefault();
        const s = stateRef.current;
        startGame(s.difficulty, s.winScore, s.mode);
      }

      // Menu shortcut
      if (e.key === 'm' || e.key === 'M') {
        const s = stateRef.current;
        if (s.gameStatus === 'playing' || s.gameStatus === 'paused' || s.gameStatus === 'gameOver') {
          e.preventDefault();
          returnToMenu();
        }
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      keysRef.current.delete(e.key);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [togglePause, returnToMenu, startGame]);

  // Auto-pause when the tab/app goes to the background (mobile-friendly).
  useEffect(() => {
    const pauseIfPlaying = () => {
      const state = stateRef.current;
      if (state.gameStatus === 'playing') {
        state.gameStatus = 'paused';
        setGameStatus('paused');
      }
    };
    const handleVisibility = () => {
      if (typeof document !== 'undefined' && document.hidden) {
        pauseIfPlaying();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('blur', pauseIfPlaying);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('blur', pauseIfPlaying);
    };
  }, []);

  // Mouse input
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const scaleY = CANVAS_HEIGHT / rect.height;
      mouseYRef.current = (e.clientY - rect.top) * scaleY;
      useMouseRef.current = true;
    };
    canvas.addEventListener('mousemove', handleMouseMove);
    return () => canvas.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // Touch input
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    /**
     * Handle touch movement on the canvas.
     *
     * In single‑player mode the first touch controls the player's paddle
     * similar to the mouse: we compute a scaled Y coordinate and update
     * `mouseYRef`, enabling the existing mouse control logic.
     *
     * In multi‑player mode we allow two players to control their paddles
     * independently by splitting the canvas horizontally. Any touch on the
     * left half of the canvas will move the left paddle (P1) and touches on
     * the right half move the right paddle (P2). We iterate through all
     * active touches and update each paddle's Y position accordingly. This
     * approach works even when a single user controls both paddles (e.g. on
     * tablets) and ignores accidental touches outside the canvas area.
     */
    const handleTouch = (e: TouchEvent) => {
      // Prevent the browser from scrolling/zooming while playing
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      // Compute scale factors between the rendered canvas size and the
      // internal coordinate system. This ensures that paddles follow the
      // finger accurately even when the canvas is scaled down on mobile.
      const scaleY = CANVAS_HEIGHT / rect.height;
      const scaleX = CANVAS_WIDTH / rect.width;
      const state = stateRef.current;
      // Multi‑player: map each touch to the appropriate paddle
      if (state.mode === 'multi') {
        for (let i = 0; i < e.touches.length; i++) {
          const touch = e.touches[i];
          const x = (touch.clientX - rect.left) * scaleX;
          const y = (touch.clientY - rect.top) * scaleY;
          if (x < CANVAS_WIDTH / 2) {
            // Left half controls player 1
            const newY = y - state.player.height / 2;
            state.player.y = Math.max(0, Math.min(CANVAS_HEIGHT - state.player.height, newY));
          } else {
            // Right half controls player 2 (AI paddle in multi‑mode)
            const newY = y - state.ai.height / 2;
            state.ai.y = Math.max(0, Math.min(CANVAS_HEIGHT - state.ai.height, newY));
          }
        }
        // Indicate that touch control is active; keyboard input will be ignored in update
        touchActiveRef.current = true;
      } else {
        // Single‑player: follow the first touch like the mouse
        if (e.touches.length > 0) {
          const touch = e.touches[0];
          mouseYRef.current = (touch.clientY - rect.top) * scaleY;
          useMouseRef.current = true;
        }
      }
    };
    // Update positions immediately on touch start, then continuously on move.
    canvas.addEventListener('touchstart', handleTouch, { passive: false });
    canvas.addEventListener('touchmove', handleTouch, { passive: false });

    // When touches end, clear the touch active flag so keyboard controls take over again
    const handleTouchEnd = (e: TouchEvent) => {
      // If no touches remain on the canvas, deactivate touch control
      if (e.touches.length === 0) {
        touchActiveRef.current = false;
      }
    };
    canvas.addEventListener('touchend', handleTouchEnd);
    canvas.addEventListener('touchcancel', handleTouchEnd);

    return () => {
      canvas.removeEventListener('touchstart', handleTouch);
      canvas.removeEventListener('touchmove', handleTouch);
      canvas.removeEventListener('touchend', handleTouchEnd);
      canvas.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, []);

  return {
    canvasRef,
    scores,
    gameStatus,
    winner,
    rallyCount,
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
    // Effect timers (rounded seconds) for HUD
    playerPowerUpTimer: effectTimers.p1Enlarge,
    aiPowerUpTimer: effectTimers.p2Enlarge,
    playerShrinkTimer: effectTimers.p1Shrink,
    aiShrinkTimer: effectTimers.p2Shrink,
    ballSlowTimer: effectTimers.slow,
    ballFastTimer: effectTimers.fast,

    // Advanced toggles
    reducedMotion,
    setReducedMotion,
    adaptiveAI,
    setAdaptiveAI,
    powerUpsEnabled,
    setPowerUpsEnabled,
    powerUpSpawnRate,
    setPowerUpSpawnRate,

    // Match stats (from the engine state)
    matchStartMs: stateRef.current.matchStartMs,
    matchEndMs: stateRef.current.matchEndMs,
    powerUpsCollected: stateRef.current.powerUpsCollected,
  };
}
