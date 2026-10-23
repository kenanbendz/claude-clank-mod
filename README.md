<div align="center">

<img src="assets/celebrating.gif" width="340" alt="Clank celebrating">

# clank

**A little robot that lives above your Claude Code prompt.**<br>
Thinks when Claude thinks, types when Claude writes, runs when tools run, celebrates when the work is done.

</div>

<br>

## Installation

Inside Claude Code:

```
/plugin install clank --marketplace kenanbendz/claude-clank-mod
```

Press `y` to add the marketplace, then pick **Install for you (user scope)**.

This repository is private: you need read access on GitHub and a git credential for github.com on your machine (`gh auth login` then `gh auth setup-git`, or an SSH key).

## Supported terminals

Clank is drawn with the kitty graphics protocol.

| Terminal | |
| --- | :-: |
| Ghostty · cmux · kitty · WezTerm | ✅ |
| Terminal.app · iTerm2 · VS Code terminal · tmux | draws nothing |

Needs 5 free rows above the prompt and about 30 columns.

## Moods

| thinking | typing | reading | working |
| :-: | :-: | :-: | :-: |
| <img src="assets/thinking.gif" width="150"> | <img src="assets/typing.gif" width="150"> | <img src="assets/reading.gif" width="150"> | <img src="assets/working.gif" width="150"> |

| waiting | error | celebrating | sleeping |
| :-: | :-: | :-: | :-: |
| <img src="assets/waiting.gif" width="150"> | <img src="assets/error.gif" width="150"> | <img src="assets/celebrating.gif" width="150"> | <img src="assets/sleeping.gif" width="150"> |

| Claude Code event | Mood |
| --- | --- |
| you send a prompt, or Claude reasons | `thinking` |
| Claude streams a reply, or edits a file | `typing` |
| `Read`, `Grep`, `Glob`, web lookups | `reading` |
| `Bash`, agents and long tools | `working` |
| a permission dialog needs you, or nothing is happening | `waiting` |
| a tool fails, or you interrupt the turn | `error` |
| a turn with tools finishes | `celebrating` |
| three quiet minutes | `sleeping` |

## Under the hood

- `frames/<mood>/NNNN.png` — 20 fps loops the terminal reads straight from disk. No pixel passes through Claude Code.
- `hooks/register.tsx` — watches session events and passes every one on unchanged. It can't block, rewrite or approve anything.
- `tools/frames.sh <dir>` — re-renders frames and GIFs from the source clips (`clank_<mood>.webm`, VP9 with alpha) with ffmpeg.

<br>

<div align="center"><sub>MIT licensed · unofficial fan project, not affiliated with Anthropic</sub></div>
