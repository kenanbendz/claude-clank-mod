# clank

**A little robot that lives above your Claude Code prompt.** Clank thinks when Claude thinks, types when Claude writes, runs when tools run, and celebrates when the work is done. Built the same way as [floofbot](https://github.com/johnydec/floofbot), with Clank's own clips.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install clank --marketplace kenanbendz/claude-clank-mod
```

Answer `y` to add the marketplace, then pick **Install for you (user scope)**.

From a shell: `claude plugin install clank --marketplace kenanbendz/claude-clank-mod`

The repository is private: installing needs read access on GitHub and a git credential for github.com on your machine (an SSH key, or `gh auth login` then `gh auth setup-git`).

## Eight moods, driven by what Claude is doing

| Claude Code event | Mood | |
| --- | --- | --- |
| you send a prompt, or Claude reasons | `thinking` | <img src="assets/thinking.gif" width="160"> |
| Claude streams a reply, or edits a file | `typing` | <img src="assets/typing.gif" width="160"> |
| Claude reads files or looks something up (`Read`, `Grep`, `Glob`, web) | `reading` | <img src="assets/reading.gif" width="160"> |
| `Bash`, agents and long tools run | `working` | <img src="assets/working.gif" width="160"> |
| a permission dialog needs you, or nothing is happening | `waiting` | <img src="assets/waiting.gif" width="160"> |
| a tool fails, or you interrupt the turn | `error` | <img src="assets/error.gif" width="160"> |
| a turn with tools finishes | `celebrating` | <img src="assets/celebrating.gif" width="160"> |
| nothing happens for three minutes | `sleeping` | <img src="assets/sleeping.gif" width="160"> |

Beside Clank the band shows the mood and how long the turn has been running.

## Where it works

Clank is drawn with the kitty graphics protocol, so it shows in **Ghostty**, **cmux**, **kitty** and **WezTerm**. In a terminal without pictures (Terminal.app, iTerm2, VS Code's terminal, tmux) the plugin stays out of the way and draws nothing. It needs 5 free rows above the prompt and about 30 columns.

## How it is built

- `frames/<mood>/NNNN.png`: 20 fps loops, 258×176 px, 256 colours with transparency. The terminal reads each file straight from disk; no pixel passes through Claude Code.
- `assets/<mood>.gif`: the same loops as GIFs, for this README.
- `tools/frames.sh <dir>`: renders both from the source clips (`clank_<mood>.webm`, VP9 with alpha) with ffmpeg. One crop for every clip, the union of their bounding boxes, so Clank never jumps between moods.
- `hooks/register.tsx`: the hooks module. It watches the session's events and passes every one on unchanged; it can't block, rewrite or approve anything. Animation runs only while something happens; a resting mood plays once and holds still.

Unofficial fan project, not affiliated with Anthropic. MIT licensed.
