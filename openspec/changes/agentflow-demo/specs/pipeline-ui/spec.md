## Purpose

Interactive web UI built with SvelteKit that renders the agent pipeline as a compact live node diagram, provides a chat-based interface for triggering pipeline runs, displays the final POC plan in a Results tab, and provides a routing strategy toggle. The binding visual spec is `docs/design/design.md` + `wireframe.md` (typography: Cabin/Inconsolata; OKLCH color tokens in `src/styles/theme.css`; 2-column layout).

## ADDED Requirements

### Requirement: Two-Column Layout

The UI SHALL render a two-column grid at full viewport: Chat (fixed 450px) | Pipeline (remaining width). Columns SHALL be separated by `divide-x-2`. The Pipeline column SHALL be split vertically: node graph (flex: 3, top) and full-width trace summary (flex: 1, bottom), separated by `border-b-2`. There SHALL be no third output column — the final POC plan renders in the Chat column's Results tab.

#### Scenario: Two-column layout renders

- **WHEN** the page loads
- **THEN** the Chat and Pipeline columns SHALL render at 450px / remaining width
- **AND** the Pipeline column SHALL show the node graph above the full-width trace summary

### Requirement: Node Diagram with Live Agent States

The UI SHALL render a node graph using Svelte Flow showing 4 compact nodes in sequence: Qualifier → Architect → Risk Checker → HITL Gate. Each node SHALL visually transition through 5 states: `idle` (darkcyan border, grey dot), `running` (rebeccapurple border + glow ring, pulsing purple StatusDot), `done` (darkcyan border, CheckCircle2), `warning` (sienna border, AlertTriangle), and `paused` (sienna border + amber glow, AlertTriangle). Nodes SHALL connect via ConnectorLine components (animated scaleY/edge draw, active connector highlighted when the target is reached). The default viewport SHALL fit the nodes then zoom out one click so the graph renders comfortably smaller than the container.

#### Scenario: Agent node transitions to running

- **WHEN** the Qualifier Agent begins execution
- **THEN** the Qualifier NodeCard SHALL transition from `idle` to `running` (rebeccapurple border + glow ring, pulsing StatusDot)
- **WHEN** the Qualifier Agent completes
- **THEN** the node SHALL transition to `done` (darkcyan border, CheckCircle2)
- **AND** the Architect node SHALL transition to `running`

#### Scenario: Sequential node activation

- **WHEN** a pipeline run is in progress
- **THEN** nodes SHALL light up sequentially: Qualifier → Architect → Risk Checker → HITL Gate
- **AND** only one node SHALL be `running` at a time (the currently executing agent)

### Requirement: Compact Node Cards

The Qualifier, Architect, and Risk Checker nodes SHALL render as compact cards (~160px wide) showing only the node label (`text-sm`) and status indicator; the subtitle SHALL be available as a hover tooltip. Detailed card content — step progress indicators, per-step detail rows, and tool-call collapsible rows — SHALL NOT render inside the graph nodes. The HITL Gate node SHALL render slightly wider (~200px) to host the interactive review panel when paused. All nodes SHALL remain readable.

#### Scenario: Agent nodes render compact

- **WHEN** the node graph renders
- **THEN** the Qualifier, Architect, and Risk Checker nodes SHALL show label and status indicator only, with the subtitle available as a hover tooltip
- **AND** no step-progress rows, step-detail rows, or tool-call rows SHALL render inside the agent nodes

#### Scenario: HITL gate renders wider for review

- **WHEN** the HITL Gate node enters `paused`
- **THEN** it SHALL render at ~200px wide with the interactive review panel (Approve / Edit, risk summary, proposed plan)

### Requirement: HITL Gate UI

When the pipeline reaches the HITL gate, the HITL NodeCard SHALL enter `paused` state (sienna border + amber glow) and display "PAUSED — awaiting review" with Approve (primary) and Edit (ghost) buttons, the risk summary, the `review_reason` (when available), and the proposed POC plan. The gate SHALL NOT auto-advance — it SHALL wait for explicit user action (Approve or Edit).

#### Scenario: HITL gate displays in UI

- **WHEN** the pipeline reaches the HITL gate
- **THEN** the HITL NodeCard SHALL enter `paused` state with "PAUSED — awaiting review" text
- **AND** Approve (primary) and Edit (ghost) buttons SHALL be shown
- **AND** the high-severity risks SHALL be displayed
- **AND** the proposed POC plan SHALL be rendered for review
- **AND** the gate SHALL NOT auto-advance until the user clicks Approve or Edit

### Requirement: Chat Panel with Tabs

The left column SHALL be a chat panel. Quick scenario buttons SHALL be fixed at the top (4 scenarios: Agency, Healthcare, Retail Lakehouse, FSI Governance), disabled during a pipeline run. Below an `hr` divider, a tab bar SHALL provide two tabs: "Chat" and "Results". The Chat tab SHALL show a scrollable conversation thread (`flex flex-col justify-end`) where user bubbles (right-aligned, `bg-rebeccapurple-500 text-white rounded-br-sm`) and system bubbles (left-aligned, `bg-darkgrey-200 text-foreground rounded-bl-sm`) anchor to the bottom and grow upward, with an input row + send button (`w-9 h-9`) pinned to the bottom with `border-t-2`. The Results tab SHALL render the final POC plan output. A "← New conversation" reset link SHALL appear after a run.

#### Scenario: User sends a scenario as a chat message

- **WHEN** the user clicks one of the 4 scenario quick-buttons
- **THEN** the scenario's pre-built prompt SHALL be sent as a user chat message
- **AND** the pipeline SHALL begin execution
- **AND** the scenario buttons SHALL be disabled for the duration of the run

#### Scenario: User types a custom prompt as a chat message

- **WHEN** the user types free text into the chat input and presses Enter (or clicks send)
- **THEN** the typed text SHALL be sent as a user chat message
- **AND** the pipeline SHALL begin execution using the typed text as input

#### Scenario: System responds in the conversation thread

- **WHEN** the pipeline produces output (agent results, HITL gate, final plan)
- **THEN** system bubbles SHALL appear in the conversation thread left-aligned
- **AND** the conversation thread SHALL scroll so the latest message is visible

#### Scenario: Results render in the Results tab

- **WHEN** the pipeline completes (after HITL gate approval)
- **THEN** the Results tab SHALL render the structured POC plan
- **AND** before completion the Results tab SHALL show an "Awaiting Results" empty state

#### Scenario: New conversation reset

- **WHEN** the user clicks "← New conversation" after a run
- **THEN** the conversation thread SHALL clear
- **AND** the node diagram, trace summary, and Results tab SHALL reset to idle state

### Requirement: Structured Output (Results Tab)

The Results tab SHALL render the final structured POC plan output with a "POC Plan" heading and a `darkcyan` "draft" pill, plus the architecture summary, scope, timeline, and resource estimate. The panel SHALL populate four sections (Use cases, Success criteria, Exit criteria, Risks) with staggered `motion` entrance (`delay: si * 0.12`), each item with a `rebeccapurple-500` bullet dot. The tab SHALL show an "Awaiting Results" empty state until the pipeline completes.

#### Scenario: Final output renders after pipeline completes

- **WHEN** the pipeline completes (after HITL gate approval)
- **THEN** the Results tab SHALL render the structured POC plan including named use cases, success criteria, exit criteria, risks, and architecture summary
- **AND** the four sections SHALL enter with a staggered animation

### Requirement: Routing Strategy Toggle

The UI SHALL provide a toggle between "Cost: Ollama Cloud (gpt-oss:20b)" and "Intelligence: OpenRouter (claude-opus-4-8)". The toggle state SHALL be visible in traces and SHALL affect model selection for the next pipeline run.

#### Scenario: User toggles to intelligence mode

- **WHEN** the user toggles from "Cost" to "Intelligence"
- **THEN** the next pipeline run SHALL use claude-opus-4-8 for the Architect Agent
- **AND** the toggle state SHALL be reflected in Langfuse traces

### Requirement: Full-Width Trace Summary

The bottom half of the Pipeline column SHALL render a trace summary card spanning the full column width. It SHALL display one row per agent: status icon · label · latency (seconds) · cost (USD) · eval score (with ✓/⚠ indicator), updating in real time as each node completes. A footer SHALL display pipeline aggregate totals: total compute time, total cost, and pipeline eval score. The routing mode SHALL display in the panel header.

#### Scenario: Trace rows appear as agents complete

- **WHEN** the Qualifier Agent completes
- **THEN** its trace row SHALL appear in the summary immediately
- **AND** trace rows SHALL accumulate progressively as the pipeline runs

#### Scenario: Aggregate footer after full run

- **WHEN** the pipeline completes end-to-end
- **THEN** the trace summary footer SHALL display total compute time (sum of agent latencies), total cost (sum of agent costs), and pipeline eval score (average of agent eval scores)
