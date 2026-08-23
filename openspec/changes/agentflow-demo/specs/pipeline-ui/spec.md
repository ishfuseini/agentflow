## Purpose

Interactive web UI built with SvelteKit that renders the agent pipeline as a live node diagram, provides a chat-based interface for triggering pipeline runs, displays structured output, and provides a routing strategy toggle. The binding visual spec is `docs/design/design.md` + `wireframe.md` (typography: Cabin/Inconsolata; OKLCH color tokens in `src/styles/theme.css`; 3-column layout).

## ADDED Requirements

### Requirement: Three-Column Layout

The UI SHALL render a three-column grid at full viewport: Chat (25%) | Pipeline (50%) | Output (25%). Columns SHALL be separated by `divide-x-2`. The Pipeline column SHALL be split vertically: node graph (flex: 3, top) and trace + token stream panel (flex: 1, bottom), separated by `border-b-2`.

#### Scenario: Three-column layout renders

- **WHEN** the page loads
- **THEN** the Chat, Pipeline, and Output columns SHALL render at 25%/50%/25% width
- **AND** the Pipeline column SHALL show the node graph above the trace panel

### Requirement: Node Diagram with Live Agent States

The UI SHALL render a node graph using Svelte Flow showing 4 nodes in sequence: Qualifier → Architect → Risk Checker → HITL Gate. Each node SHALL visually transition through 5 states: `idle` (darkcyan border, grey dot), `running` (rebeccapurple border + glow ring, pulsing purple StatusDot), `done` (darkcyan border, CheckCircle2), `warning` (sienna border, AlertTriangle), and `paused` (sienna border + amber glow, AlertTriangle). Nodes SHALL connect vertically via ConnectorLine components (animated scaleY, with a downward ChevronRight arrow when active).

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

#### Scenario: HITL gate enters paused state

- **WHEN** the pipeline reaches the HITL gate
- **THEN** the HITL NodeCard SHALL enter `paused` state (sienna border + amber glow, AlertTriangle)
- **AND** SHALL display "PAUSED — awaiting review" with Approve (primary) and Edit (ghost) buttons
- **AND** the gate SHALL NOT auto-advance — it waits for explicit user action

### Requirement: Tool Calls as Collapsible Rows Inside NodeCards

Tool calls SHALL appear as collapsible rows inside the agent NodeCard that made the call (not as separate tool-call nodes). Each row SHALL show a Zap icon + `tool_name()` + ChevronDown. Expanding a row SHALL reveal the result text with a `→` prefix, animated via AnimatePresence (height). Rows SHALL be visible once the parent node is active.

#### Scenario: Architecture lookup tool call expands inside NodeCard

- **WHEN** the Architect Agent's `arch_pattern_lookup` tool call completes
- **THEN** a collapsible row inside the Architect NodeCard SHALL show `arch_pattern_lookup()` with a ChevronDown toggle
- **AND** expanding the row SHALL reveal the matched pattern ID and result text with a `→` prefix

#### Scenario: Tool calls do not render as separate nodes

- **WHEN** the Architect Agent calls `arch_pattern_lookup`, `tool_selection_lookup`, and `brand_context_lookup`
- **THEN** the tool calls SHALL appear as collapsible rows inside the Architect NodeCard
- **AND** no separate tool-call nodes SHALL be rendered in the node graph

### Requirement: Running Progress Indicator on NodeCards

While an agent NodeCard is in `running` state, it SHALL display a compact progress indicator that fills as each of the agent's execution tasks completes. The indicator SHALL show a step count (e.g., `2/4`) and a row of step markers: completed tasks filled (`darkcyan-600` CheckCircle2), the active task pulsing (`rebeccapurple-500`), pending tasks dim (`darkgrey-400`). The NodeCard SHALL expand vertically as each task completes and its detail row appears. The tracker SHALL reflect the agent's actual execution steps (tool calls and synthesis milestones); the step count is agent-specific (Architect: 4 steps; Risk Checker: 3 steps; Qualifier: 1 step). The progress tracker complements the tool-call collapsible rows (detail) and the LLMStreamBlock (streaming text).

#### Scenario: Progress fills as Architect executes

- **WHEN** the Architect Agent is `running` and completes `arch_pattern_lookup`
- **THEN** the Architect NodeCard progress indicator SHALL advance to `1/4` with one filled step
- **AND** the card SHALL expand to show the `arch_pattern_lookup` detail row
- **WHEN** the Architect subsequently completes `tool_selection_lookup` and `brand_context_lookup`
- **THEN** the indicator SHALL advance to `3/4` and the card SHALL expand with each new row

#### Scenario: Progress completes when agent finishes

- **WHEN** the Architect Agent completes its synthesis milestone and transitions to `done`
- **THEN** all step markers SHALL be filled (`darkcyan-600`)
- **AND** the step count SHALL show `4/4`

### Requirement: Chat Panel (Col 1)

The left column SHALL be a chat panel. Quick scenario buttons SHALL be fixed at the top (4 scenarios: Agency, Healthcare, Retail Lakehouse, FSI Governance), disabled during a pipeline run. Below an `hr` divider, an "Agent Chat" header SHALL precede a scrollable conversation thread (`flex flex-col justify-end`) where user bubbles (right-aligned, `bg-rebeccapurple-500 text-white rounded-br-sm`) and system bubbles (left-aligned, `bg-darkgrey-200 text-foreground rounded-bl-sm`) anchor to the bottom and grow upward. An input row + send button (`w-9 h-9`) SHALL be pinned to the bottom with `border-t-2`. Enter SHALL submit; Shift+Enter SHALL insert a newline. A "← New conversation" reset link SHALL appear after a run.

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

#### Scenario: New conversation reset

- **WHEN** the user clicks "← New conversation" after a run
- **THEN** the conversation thread SHALL clear
- **AND** the node diagram, trace panel, and output panel SHALL reset to idle state

### Requirement: Structured Output Panel

The right column (Col 3, 25%) SHALL render the final structured POC plan output with a section header containing an inline `text-sm` description ("Awaiting Results" before completion). The panel SHALL populate four sections (Use cases, Success criteria, Exit criteria, Risks) with staggered `motion` entrance (`delay: si * 0.12`), each item with a `rebeccapurple-500` bullet dot. A "POC Plan" heading SHALL show with a `darkcyan` "draft" pill. The panel SHALL return `null` (empty) until the pipeline completes.

#### Scenario: Final output renders after pipeline completes

- **WHEN** the pipeline completes (after HITL gate approval)
- **THEN** the right panel SHALL render the structured POC plan including named use cases, success criteria, exit criteria, risks, and architecture summary
- **AND** the four sections SHALL enter with a staggered animation

### Requirement: Routing Strategy Toggle

The UI SHALL provide a toggle between "Cost: Ollama Cloud (gpt-oss:20b)" and "Intelligence: OpenRouter (claude-opus-4-8)". The toggle state SHALL be visible in traces and SHALL affect model selection for the next pipeline run.

#### Scenario: User toggles to intelligence mode

- **WHEN** the user toggles from "Cost" to "Intelligence"
- **THEN** the next pipeline run SHALL use claude-opus-4-8 for the Architect Agent
- **AND** the toggle state SHALL be reflected in Langfuse traces

### Requirement: HITL Gate UI

When the pipeline reaches the HITL gate, the HITL NodeCard SHALL enter `paused` state (sienna border + amber glow) and display "PAUSED — awaiting review" with Approve (primary) and Edit (ghost) buttons, the risk summary, and the proposed POC plan. The gate SHALL NOT auto-advance — it SHALL wait for explicit user action (Approve or Edit).

#### Scenario: HITL gate displays in UI

- **WHEN** the pipeline reaches the HITL gate
- **THEN** the HITL NodeCard SHALL enter `paused` state with "PAUSED — awaiting review" text
- **AND** Approve (primary) and Edit (ghost) buttons SHALL be shown
- **AND** the high-severity risks SHALL be displayed
- **AND** the proposed POC plan SHALL be rendered for review
- **AND** the gate SHALL NOT auto-advance until the user clicks Approve or Edit

### Requirement: Streaming Agent Output (LLMStreamBlock)

As each agent executes, its output SHALL stream to the UI in real-time via an LLMStreamBlock per agent (simulated token stream at 3 chars / 18ms). A blinking `rebeccapurple-500` cursor SHALL show while streaming; a `CheckCircle2` in `darkcyan-600` SHALL show when done. The LLMStreamBlock card header SHALL use `bg-darkgrey-200/50`.

#### Scenario: Agent output streams live

- **WHEN** the Architect Agent is executing
- **THEN** its output SHALL stream to the UI progressively as tokens are generated (via the Architect's LLMStreamBlock)
- **AND** the user SHALL see partial output before the agent completes
- **AND** a blinking `rebeccapurple-500` cursor SHALL be visible while streaming
