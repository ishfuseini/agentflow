# Design System — Agentic POC Qualification Pipeline

## Typography

| Role | Font | Weights | Usage |
|------|------|---------|-------|
| Headings | Cabin | 400, 500, 600 | h1, h4 section labels, node labels, buttons |
| Body / UI | Inconsolata | 400, 500 | chat bubbles, metadata, tool call output, captions |

**Scale**
- Page title (h1): `text-xl / font-semibold` — primary color
- Section headers (h4): base size, `uppercase`, `tracking-wider` — accent color
- Node label: `text-sm / font-medium`
- Body / chat: `text-base`
- Metadata / sublabels: `text-[12px]`, `text-[11px]`, `text-[10px]`

---

## Color Tokens

### Semantic roles

| Token | Value | Usage |
|-------|-------|-------|
| Background | `#D8D4CD` | Page background |
| Foreground | `#131316` | Primary text, icons |
| Foreground Muted | `#444446` | Sublabels, metadata, placeholders |
| Primary (`rebeccapurple-500`) | `#522988` | Page title, CTAs, user chat bubbles, send button, tool call icons |
| Accent (`darkcyan-500`) | `#327367` | Section headings, idle node borders, connector lines, done states |
| Warning (`sienna-500`) | `oklch(0.58 0.17 44)` | HITL gate, risk warnings |

### Color scales (OKLCH, defined in `src/styles/theme.css`)

- `--color-rebeccapurple-*` (50–950)
- `--color-darkcyan-*` (50–950)
- `--color-darkgrey-*` (50–950)
- `--color-sienna-*` (50–950)
- `--color-dodgerblue-*` (50–950)
- `--color-palevioletred-*` (50–950)

---

## Layout

Three-column grid at full viewport. Columns separated by `divide-x-2 divide-darkgrey-400`.

```
┌──────────────┬────────────────────────────────┬──────────────┐
│  Chat        │  Live Pipeline   (flex: 3)     │  Structured  │
│  1/4         │                                │  Output      │
│              │────────────────────────────────│  1/4         │
│              │  Trace & Token Stream (flex:1) │              │
└──────────────┴────────────────────────────────┴──────────────┘
```

**Col 1 — Chat (25%)**
- Quick scenario buttons fixed at top
- `<hr>` (`border-t-2`) divider
- "Agent Chat" `<h4>` header
- Scrollable conversation thread (`flex flex-col justify-end`) — messages anchor to bottom, grow upward
- Input row + send button pinned to bottom (`border-t-2`)
- "← New conversation" reset link appears after a run

**Col 2 — Pipeline (50%)**
- Top `flex: 3` — node graph, `border-b-2 border-darkgrey-400`
- Bottom `flex: 1` — trace panel + LLM stream blocks

**Col 3 — Output (25%)**
- Section header with inline `text-sm` description ("Awaiting Results")
- Populates with POC plan sections after HITL gate clears

**Border weights**
- Header bottom: `border-b-4`
- Column dividers: `divide-x-2`
- Section separators (horizontal split, input area, HR): `border-2`

---

## Components

### NodeCard

Four nodes in sequence: Qualifier → Architect → Risk Checker → HITL Gate. Each is `border-2 rounded-xl`.

| Status | Border | Background | Glow ring |
|--------|--------|------------|-----------|
| idle | `darkcyan-500` | `darkgrey-100` | — |
| running | `rebeccapurple-500` | `rebeccapurple-50` | purple `0_0_0_3px` |
| done | `darkcyan-500` | `darkcyan-50` | — |
| warning | `sienna-400` | `sienna-50` | — |
| paused | `sienna-500` | `sienna-50` | amber `0_0_0_3px` |

**StatusDot** — inline indicator left of node label:
- idle: grey circle
- running: pulsing `rebeccapurple-400` ping + solid core
- done: `CheckCircle2` in `darkcyan-600`
- warning / paused: `AlertTriangle` in `sienna-500`

**Tool calls** — collapsible rows inside the card, visible once node is active. Each shows `Zap` icon + `name()` + `ChevronDown`. Expand reveals result text with `→` prefix. Uses `AnimatePresence` for height animation.

**HITL Gate** — when `paused`: shows "PAUSED — awaiting review" inline text + Approve (primary) / Edit (ghost) buttons. Auto-advances after 4s in demo mode.

### ConnectorLine

Vertical `w-px` line between nodes using `darkcyan-500`. Animates `scaleY 0→1` (top-to-bottom) via `motion`. Shows a `ChevronRight rotate-90` arrow at the bottom in `darkcyan-500` once active.

### TracePanel

Rendered inside a `rounded-xl border border-darkgrey-400 bg-darkgrey-100/60` card. One row per completed agent showing: status icon · label · latency · cost · ✓/⚠. Footer shows totals: time · cost · eval 4.2/5.

### LLMStreamBlock

Per-agent simulated token stream. Types out at 3 chars / 18ms. Shows a blinking `rebeccapurple-500` cursor while streaming, `CheckCircle2` in `darkcyan-600` when done. Card header uses `bg-darkgrey-200/50`.

### OutputPanel

Populates four sections (Use cases · Success criteria · Exit criteria · Risks) with staggered `motion` entrance (`delay: si * 0.12`). Each item has a `rebeccapurple-500` bullet dot. Shows "POC Plan" heading with a `darkcyan` "draft" pill. Returns `null` until pipeline completes.

### Chat Panel

- **Scenario buttons**: `border border-darkgrey-400`, hover → `bg-darkgrey-200 border-rebeccapurple-300`. Disabled during pipeline run.
- **User bubbles**: `bg-rebeccapurple-500 text-white rounded-br-sm`, right-aligned
- **System bubbles**: `bg-darkgrey-200 text-foreground rounded-bl-sm`, left-aligned
- **Input**: single-row textarea (`height: 36px`) + `w-9 h-9` send button, `items-center` aligned. `Enter` submits, `Shift+Enter` is a newline.

