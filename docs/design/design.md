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

Two-column grid at full viewport. Columns separated by `divide-x-2 divide-darkgrey-400`. There is no third output column — the final POC plan renders in the Chat column's Results tab.

```
┌──────────────────┬──────────────────────────────────────┐
│  Chat (450px)    │  Live Pipeline                       │
│                  │                                      │
│  Quick scenarios │  Node graph (compact nodes, flex: 3) │
│  [Chat | Results]│──────────────────────────────────────│
│  tabs            │  Trace Summary (full width, flex: 1) │
│  conversation /  │                                      │
│  POC plan        │                                      │
└──────────────────┴──────────────────────────────────────┘
```

**Col 1 — Chat (450px)**
- Quick scenario buttons fixed at top
- `<hr>` (`border-t-2`) divider
- `Chat | Results` tab bar — Chat tab shows the conversation thread, Results tab shows the POC plan
- Scrollable conversation thread (`flex flex-col justify-end`) — messages anchor to bottom, grow upward
- Input row + send button pinned to bottom (`border-t-2`)
- "← New conversation" reset link appears after a run

**Col 2 — Pipeline (remaining width)**
- Top `flex: 3` — node graph with compact nodes, `border-b-2 border-darkgrey-400`
- Bottom `flex: 1` — full-width trace summary with aggregate footer

**Border weights**
- Header bottom: `border-b-4`
- Column dividers: `divide-x-2`
- Section separators (horizontal split, input area, HR): `border-2`

---

## Components

### NodeCard (compact)

Four compact nodes in sequence: Qualifier → Architect → Risk Checker → HITL Gate. Each is `border-2 rounded-md`. Agent nodes render at ~160px wide and show only the label (`text-sm`) + status indicator — the subtitle appears as a hover tooltip. No step progress, no tool-call rows, no streaming text inside the graph. The HITL Gate node renders ~200px wide so it can host the interactive review panel when paused. All nodes stay readable.

| Status | Border | Background | Glow ring |
|--------|--------|------------|-----------|
| idle | `darkcyan-500` | `darkgrey-100` | — |
| running | `rebeccapurple-500` | `rebeccapurple-50` | purple `0_0_0_3px` |
| done | `darkcyan-500` | `darkcyan-50` | — |
| warning | `sienna-400` | `sienna-50` | — |
| paused | `sienna-500` | `sienna-50` | amber `0_0_0_3px` |

**StatusDot** — inline indicator right of node label:
- idle: grey circle
- running: pulsing `rebeccapurple-400` ping + solid core
- done: `CheckCircle2` in `darkcyan-600`
- warning / paused: `AlertTriangle` in `sienna-500`

**Node tooltip** — hovering a node shows its subtitle as a `text-[10px]` tooltip above the card.

**HITL Gate** — when `paused`: shows "PAUSED — awaiting review" inline text + Approve (primary) / Edit (ghost) buttons, the risk summary, the `review_reason`, and the proposed POC plan scope. The gate waits for explicit user action (no auto-advance in the live demo).

### ConnectorLine

Vertical `w-px` line between nodes using `darkcyan-500`. Animates `scaleY 0→1` (top-to-bottom) via `motion`. Shows a `ChevronRight rotate-90` arrow at the bottom in `darkcyan-500` once active.

### TracePanel

Rendered full-width below the node graph inside a `rounded-md border border-darkgrey-300 bg-background` card. One row per completed agent showing: status icon · label · latency · cost · eval ✓/⚠. Footer shows totals: time · cost · eval 4.2/5. The routing mode displays in the panel header.

### LLMStreamBlock

Removed from the live layout — the trace summary and chat system messages carry per-agent progress. The component remains in the repo for optional reuse.

### OutputPanel

Renders inside the Chat column's Results tab. Populates four sections (Use cases · Success criteria · Exit criteria · Risks) with staggered `motion` entrance (`delay: si * 0.12`). Each item has a `rebeccapurple-500` bullet dot. Shows "POC Plan" heading with a `darkcyan` "draft" pill. Shows an "Awaiting Results" empty state until the pipeline completes.

### Chat Panel

- **Tabs**: `Chat | Results` segmented toggle below the scenario buttons. Chat shows the conversation thread + input; Results shows the OutputPanel.
- **Scenario buttons**: `border border-darkgrey-400`, hover → `bg-darkgrey-200 border-rebeccapurple-300`. Disabled during pipeline run.
- **User bubbles**: `bg-rebeccapurple-500 text-white rounded-br-sm`, right-aligned
- **System bubbles**: `bg-darkgrey-200 text-foreground rounded-bl-sm`, left-aligned
- **Input**: single-row textarea (`height: 36px`) + `w-9 h-9` send button, `items-center` aligned. `Enter` submits, `Shift+Enter` is a newline.

