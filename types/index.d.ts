export type Mood = 'idle' | 'typing' | 'thinking' | 'reading' | 'working' | 'sleeping' | 'celebrating' | 'error' | 'waiting'

/** What the band shows beside Clank: the turn's time, and whether it is thinking right now. */
export type Stats = { seconds: number; isThinking: boolean; isDone: boolean }

declare module 'claude-code' {
  interface PluginState {
    clank: { mood: Mood; stats: Stats | null }
  }
}
