import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Mood, Stats } from '../types'

// Frames are PNGs rendered from the Clank clips by tools/frames.sh into frames/<mood>/NNNN.png.
// The terminal reads each file itself (kitty graphics); only the path crosses $.
const MOODS: Mood[] = ['idle', 'typing', 'thinking', 'reading', 'working', 'sleeping', 'celebrating', 'error', 'waiting']
const FRAME_MS = 50 // 20 fps, what tools/frames.sh renders
const ROWS = 5
const COLUMNS = 16 // the frames are 258×176: 5 rows of ~35 px, cells about half as wide as tall
const SLEEP_AFTER_MS = 3 * 60_000

// there is no idle clip: between turns Clank waits for you
const dir = (m: Mood) => (m === 'idle' ? 'waiting' : m)

// Animation costs the terminal a PNG decode per frame, so it only runs while something happens:
// a resting mood plays its loop once, then holds still and stirs again after RESTING[mood] ms.
const RESTING: Partial<Record<Mood, number>> = { idle: 40_000, sleeping: 90_000 }

const LABEL: Record<Mood, string> = {
  idle: 'ready',
  typing: 'writing…',
  thinking: 'thinking…',
  reading: 'reading…',
  working: 'running…',
  sleeping: 'zzz',
  celebrating: 'done!',
  error: 'oops',
  waiting: 'needs you',
}

const mood = atom({ plugin: 'clank', key: 'mood' } as const, 'idle' as Mood)
const stats = atom({ plugin: 'clank', key: 'stats' } as const, null as Stats | null)

// a Bash command that writes files is writing code too (sed -i, a heredoc into a file, a script
// that saves one): it reads the command's text, so it is a good guess, not a certainty
// every repeat is bounded, so a huge command can't make a match slow (no backtracking blow-up)
const WRITES_FILES = [
  /\b(sed|perl)\s+(-\w{1,12}\s+){0,8}-\w{0,12}i/, // in-place edits
  /(^|\s)>>?\s{0,4}['"]?(?!\/dev\/)[\w~.\/-]{0,200}(\/|\.[a-z]\w{0,12}\b)/i, // > or >> into a path (not 2>&1, not > /dev/null)
  /\btee\s+(-a\s+)?(?!\/dev\/|-)[\w~.\/'"]/,
  /\bopen\([^)]{0,160},\s{0,4}\\?['"][wa]b?\\?['"]/, // python open(p, 'w'), quotes escaped or not
  /\.write_text\(|\bwriteFileSync\(|\bfs\.writeFile\(|\bgit\s+apply\b|\bpatch\s+-p/,
]
const writesFiles = (command: string) => WRITES_FILES.some(r => r.test(command))
// a piece of a JSON string's text, unescaped well enough for WRITES_FILES
const unescapeJson = (text: string) => text.replace(/\\(["\\/nrt])/g, (_, c: string) => ({ n: '\n', r: '\r', t: '\t' })[c] ?? c)

function moodForTool(tool: string, command?: string): Mood {
  if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(tool)) return 'typing'
  if (tool === 'Bash' && command && writesFiles(command)) return 'typing'
  if (/^(Read|Grep|Glob|LS|NotebookRead|WebFetch|WebSearch)$/.test(tool)) return 'reading'
  if (/^(Bash|Agent|Task|Monitor)$/.test(tool)) return 'working'
  if (/^(AskUserQuestion|ExitPlanMode)$/.test(tool)) return 'waiting'
  return 'thinking'
}

// module state: a hot reload starts it over; the mood itself lives in $.state
const bot = {
  counts: {} as Partial<Record<Mood, number>>,
  root: '',
  site: undefined as string | undefined,
  current: 'idle' as Mood,
  frame: 0,
  ticker: undefined as Timer | undefined,
  stir: undefined as Timer | undefined,
  later: undefined as Timer | undefined,
  tools: 0,
  canDraw: false, // the terminal draws pictures (kitty graphics); otherwise Clank stays out of the way
  // only what the band knows for sure: when the turn began and whether thinking streams now
  startedAt: -1, // unknown until a prompt starts a turn
  isThinking: false,
  isTurnDone: true,
  turnId: null as string | null, // the main loop's turn the band follows (steps of any other are not its)
  busy: 0, // the turn's steps and tool calls in flight, and a permission dialog waiting
  isAsking: false,
  quiet: undefined as Timer | undefined,
  statsTimer: undefined as Timer | undefined,
  shown: '',
}

/* ---------------- animation ---------------- */

// only the known moods ever become a path: a value from elsewhere can't point the terminal at another file
const isMood = (m: unknown): m is Mood => typeof m === 'string' && (MOODS as string[]).includes(m)

function file(m: Mood, i: number) {
  const mood: Mood = isMood(m) ? m : 'idle'
  return `${bot.root}/frames/${dir(mood)}/${String(Math.max(0, Math.floor(i) || 0)).padStart(4, '0')}.png`
}

async function canDrawPictures($: EngineInterface) {
  if (await $.env.get('TMUX')) return false // tmux passes no pictures through
  const program = ((await $.env.get('TERM_PROGRAM')) ?? '').toLowerCase()
  const term = ((await $.env.get('TERM')) ?? '').toLowerCase()
  if (/ghostty|wezterm|kitty/.test(program) || /kitty|ghostty|wezterm/.test(term)) return true // cmux reports ghostty
  return Boolean((await $.env.get('KITTY_WINDOW_ID')) || (await $.env.get('GHOSTTY_RESOURCES_DIR')) || (await $.env.get('WEZTERM_EXECUTABLE')))
}

function blit($: EngineInterface) {
  if (!bot.site || !bot.canDraw) return
  void $.ui
    .blit({ requestId: bot.site, key: 'bot', source: { file: file(bot.current, bot.frame), format: 'png' } })
    .then(r => {
      // the Image draws its alt here: this terminal shows no pictures after all (ssh, a
      // terminal that says it is Ghostty but isn't…) — step out of the way
      if (r?.deny && /\balt\b/.test(r.deny)) {
        bot.canDraw = false
        hold()
        $.ui.invalidate('ui.render')
      }
    })
    .catch(() => {})
}

function hold() {
  bot.ticker?.cancel()
  bot.ticker = undefined
}

function play($: EngineInterface) {
  bot.stir?.cancel()
  bot.stir = undefined
  if (bot.ticker || !bot.canDraw) return
  bot.ticker = $.clock.every(FRAME_MS, () => tick($))
}

function tick($: EngineInterface) {
  const n = bot.counts[bot.current]
  if (!n || !bot.canDraw) return hold()
  if (!bot.site) return hold() // not drawn yet: the first draw starts it
  bot.frame = (bot.frame + 1) % n
  blit($)
  const restFor = RESTING[bot.current]
  // a resting mood ends its loop on frame 0, the same pose it started from: hold it there
  if (restFor && bot.frame === 0) {
    hold()
    bot.stir = $.clock.after(restFor, () => play($))
  }
}

// `then` (after `ms`) lets a one-shot mood like celebrating fall back on its own
async function setMood($: EngineInterface, m: Mood, then?: { mood: Mood; ms: number }) {
  try {
    await moodNow($, m, then)
  } catch {}
}

async function moodNow($: EngineInterface, m: Mood, then?: { mood: Mood; ms: number }) {
  bot.later?.cancel()
  bot.later = undefined
  if (then) bot.later = $.clock.after(then.ms, () => void setMood($, then.mood))
  else if (m === 'idle') bot.later = $.clock.after(SLEEP_AFTER_MS, () => void setMood($, 'sleeping'))
  if (m === bot.current) return
  bot.current = m
  bot.frame = 0
  play($)
  await update($, mood, () => m)
}

/* ---------------- the turn beside Clank ---------------- */

async function pushStats($: EngineInterface, isDone = false) {
  try {
    await statsNow($, isDone)
  } catch {}
}

async function statsNow($: EngineInterface, isDone: boolean) {
  // a hot reload mid-turn forgets when the turn began: keep what the band showed
  if (bot.startedAt < 0) return
  const next: Stats = {
    seconds: Math.floor(((await $.clock.now()) - bot.startedAt) / 1000),
    isThinking: !isDone && bot.isThinking,
    isDone,
  }
  const key = JSON.stringify(next)
  if (key === bot.shown) return
  bot.shown = key
  await update($, stats, () => next)
}

async function startTurn($: EngineInterface) {
  bot.startedAt = await $.clock.now().catch(() => -1)
  bot.isThinking = false
  bot.statsTimer?.cancel()
  bot.statsTimer = $.clock.every(250, () => void pushStats($))
  await pushStats($)
}

async function endTurn($: EngineInterface) {
  bot.isThinking = false
  bot.statsTimer?.cancel()
  bot.statsTimer = undefined
  await pushStats($, true)
}

// a turn the engine started (turn.start), never a prompt: one delivered into a running turn
// (a message typed mid-turn, a notification, a meta prompt) is part of the turn it lands in
function beginTurn($: EngineInterface, turnId: string) {
  bot.turnId = turnId
  bot.tools = 0
  bot.busy = 0
  bot.isAsking = false
  bot.isTurnDone = false
  void setMood($, 'thinking')
  void startTurn($).catch(() => {})
}

// the turn goes on after the band thought it was over (a stop hook asked for more): pick it up again
function resumeTurn($: EngineInterface) {
  bot.isTurnDone = false
  if (!bot.statsTimer && bot.startedAt >= 0) bot.statsTimer = $.clock.every(250, () => void pushStats($))
}

// a step or tool call starts (+1) or ends (-1). With nothing in flight for a while the turn is over,
// even if turn.complete never reaches this module: the band never hangs on writing… or thinking…
const QUIET_MS = 30_000
function activity($: EngineInterface, delta: number) {
  bot.busy = Math.max(0, bot.busy + delta)
  bot.quiet?.cancel()
  bot.quiet = undefined
  if (bot.busy === 0 && !bot.isTurnDone) bot.quiet = $.clock.after(QUIET_MS, () => finishTurn($))
}

// a permission dialog keeps the turn busy until the tool runs or the model answers the refusal
function settleAsk($: EngineInterface) {
  if (!bot.isAsking) return
  bot.isAsking = false
  activity($, -1)
}

// once per turn, whichever comes first: the last response, turn.complete, or the quiet
function finishTurn($: EngineInterface) {
  bot.quiet?.cancel()
  bot.quiet = undefined
  if (bot.isTurnDone) return
  bot.isTurnDone = true
  void endTurn($).catch(() => {})
  void setMood($, bot.tools > 0 ? 'celebrating' : 'idle', bot.tools > 0 ? { mood: 'idle', ms: 2600 } : undefined)
}

function duration(s: number) {
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    bot.root = $.plugin.root
    bot.canDraw = await canDrawPictures($).catch(() => true)
    for (const m of MOODS) {
      const entries = await $.fs.list(`${bot.root}/frames/${dir(m)}`).catch(() => [])
      bot.counts[m] = entries.filter(x => x.kind === 'file' && x.name.endsWith('.png')).length
    }
    const saved = await read($, mood)
    bot.current = isMood(saved) ? saved : 'idle'
    hold()
    void setMood($, bot.current === 'sleeping' ? 'sleeping' : 'idle')
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.end', ($, e, next) => {
    hold()
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', ($, e, next) => {
    if (e.agentId === undefined) beginTurn($, e.turnId)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    // a subagent's steps are its own, and so is any request outside the turn the band follows
    if (e.agentId !== undefined) return yield* next(e)
    if (bot.turnId === null) bot.turnId = e.turnId // a reload mid-turn missed its start
    if (e.turnId !== bot.turnId) return yield* next(e)
    if (bot.isTurnDone) resumeTurn($)
    settleAsk($)
    activity($, 1)
    let calledTool = false
    const bash = new Map<number, string>() // Bash calls streaming in: their arguments so far
    const stream = next(e)[Symbol.asyncIterator]()
    for (let step = await stream.next(); ; step = await stream.next()) {
      if (step.done) {
        // a response that calls no tool is the turn's last: settle now, even if turn.complete
        // never reaches this module (a reload mid-turn misses it) — no "writing…" left hanging
        try {
          activity($, -1)
          if (!calledTool && !step.value?.toolUses?.length) finishTurn($)
        } catch {}
        return step.value
      }
      const c = step.value
      try {
        if (c.kind === 'thinking' || c.kind === 'text' || c.kind === 'tool') bot.isThinking = c.kind === 'thinking'
        if (c.kind === 'thinking') void setMood($, 'thinking')
        else if (c.kind === 'text') void setMood($, 'typing')
        else if (c.kind === 'tool') {
          calledTool = true
          if (c.name === 'Bash') bash.set(c.index, '')
          void setMood($, moodForTool(c.name))
        } else if (c.kind === 'input' && bash.has(c.index)) {
          // the code a Bash call writes into a file streams in here: Clank types along
          const sofar = bash.get(c.index)! + c.json
          if (writesFiles(unescapeJson(sofar.slice(-c.json.length - 400)))) {
            bash.delete(c.index)
            void setMood($, 'typing')
          } else bash.set(c.index, sofar)
        }
      } catch {}
      yield c
    }
  })

  // only when a dialog is really put to the person: tool.check's `ask` also covers the auto-mode classifier
  on('classic.PermissionRequest', ($, e, next) => {
    if (!bot.isTurnDone && !bot.isAsking) {
      bot.isAsking = true
      activity($, 1)
    }
    void setMood($, 'waiting')
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    // a tool that runs after the turn (a background agent's) doesn't wake the band
    if (bot.isTurnDone) return next(e)
    const isMain = e.agentId === undefined
    bot.tools += 1
    if (isMain) {
      settleAsk($)
      activity($, 1)
    }
    if (bot.current !== 'waiting') void setMood($, moodForTool(e.tool, e.tool === 'Bash' ? e.command : undefined))
    try {
      const r = await next(e)
      if (!bot.isTurnDone) {
        if (r.isError) void setMood($, 'error', { mood: 'thinking', ms: 1800 })
        else void setMood($, 'thinking')
      }
      return r
    } finally {
      if (isMain) activity($, -1)
    }
  }).catch(($, e, next) => next(e))

  on('turn.complete', ($, e, next) => {
    if (e.agentId === undefined && (bot.turnId === null || e.turnId === bot.turnId)) finishTurn($)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.abort', ($, e, next) => {
    if (bot.turnId !== null && e.turnId !== bot.turnId) return next(e) // not the turn the band follows
    bot.quiet?.cancel()
    bot.quiet = undefined
    bot.isTurnDone = true
    void endTurn($).catch(() => {})
    void setMood($, 'error', { mood: 'idle', ms: 1600 })
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!bot.canDraw || e.surface !== 'terminal' || e.props.hasSurvey || e.props.maxRows < ROWS) return next(e)
    if (e.props.bodyColumns < COLUMNS + 12) return next(e)
    if (bot.site !== e.requestId) {
      bot.site = e.requestId
      play($)
    }
    const saved = await read($, mood)
    const m: Mood = isMood(saved) ? saved : 'idle'
    const st = await read($, stats)
    const { Box, Image, Text } = $.ui.resolve(e)
    const line = !st ? null : `${st.isDone ? 'done in ' : ''}${duration(st.seconds)}${st.isThinking ? ' · thinking' : ''}`
    const n = bot.counts[m] ?? 0
    return (
      <Box flexDirection="row" alignItems="center">
        <Image key="bot" source={{ file: file(m, n ? bot.frame % n : 0), format: 'png' }} columns={COLUMNS} rows={ROWS} alt=" " />
        <Box marginLeft={1} flexDirection="column">
          <Text color="claude">{LABEL[m]}</Text>
          {line && <Text dimColor>{line}</Text>}
        </Box>
      </Box>
    )
  }).catch(($, e, next) => next(e)) // a picture that fails to draw: the band is the engine's own
}
