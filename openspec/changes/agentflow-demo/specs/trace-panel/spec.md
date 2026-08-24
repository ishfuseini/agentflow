## Purpose

Displays Langfuse trace data for a pipeline run as a flat observation table below the node diagram, providing observability into each agent run and HITL decision. Rows are the run's Langfuse observations — one row each, in chronological order, with no per-agent grouping or nesting. The trace panel is a full-width `rounded-md border border-darkgrey-300 bg-background` card. MCP tool-call detail is not shown here; it lives inside the agent NodeCards.

## ADDED Requirements

### Requirement: Flat Observation Rows

The trace panel SHALL display one row per Langfuse observation in the run, showing: observation name, type (`SPAN` / `AGENT` / `GENERATION` / `EVENT`), latency (seconds), token count, cost (USD), and level. Rows SHALL be listed in chronological order and SHALL NOT be grouped, nested, or aggregated by agent. The data SHALL be fetched from the Langfuse API.

#### Scenario: Observations render as individual rows

- **WHEN** a pipeline run produces observations
- **THEN** each observation SHALL render as its own row with name, type, latency, tokens, cost, and level
- **AND** the pipeline `SPAN`, per-agent `AGENT` spans, and per-agent `GENERATION` rows SHALL each appear as separate sibling rows

#### Scenario: No per-agent grouping

- **WHEN** the pipeline completes
- **THEN** the panel SHALL NOT render agent headings, agent groups, or one summarized row per agent
- **AND** two observations belonging to the same agent SHALL appear as two independent rows

### Requirement: HITL Trace Row

The run's `hitl_gate_decision` observation SHALL render as a row showing human latency (time from gate display to user action) and the user's decision (approved or edited).

#### Scenario: HITL approved trace

- **WHEN** the user approves the POC plan at the HITL gate
- **THEN** the trace panel SHALL display a HITL row showing the human latency and decision: approved

#### Scenario: HITL edited trace

- **WHEN** the user edits the POC plan at the HITL gate and submits
- **THEN** the trace panel SHALL display a HITL row showing the human latency and decision: edited

### Requirement: Pipeline Aggregate Footer

The trace panel footer SHALL display pipeline aggregate totals: total compute time, total cost, and a pipeline-level eval score (aggregate of all node eval scores).

#### Scenario: Aggregate footer after full run

- **WHEN** the pipeline completes end-to-end
- **THEN** the trace panel footer SHALL display total compute time (sum of agent latencies), total cost (sum of agent costs), and pipeline eval score

### Requirement: Real-Time Trace Updates

Trace data SHALL appear in the panel as each node completes, not all at once after the full pipeline finishes.

#### Scenario: Trace appears as agent completes

- **WHEN** the Qualifier Agent completes
- **THEN** its observation rows SHALL appear in the panel immediately
- **AND** the user SHALL see trace data accumulating progressively as the pipeline runs

### Requirement: Langfuse API Data Source

All trace data displayed in the panel SHALL be fetched from the Langfuse API, not from in-memory pipeline state. This ensures displayed data matches what is visible in the Langfuse dashboard.

#### Scenario: Trace data matches Langfuse dashboard

- **WHEN** a pipeline run completes
- **THEN** the observation rows shown in the panel SHALL match the observations visible in the Langfuse dashboard (and in a `lf-events-export` JSON) for the same run
