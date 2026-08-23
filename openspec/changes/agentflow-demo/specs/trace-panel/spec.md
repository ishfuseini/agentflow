## Purpose

Displays per-agent Langfuse trace data (latency, tokens, cost, eval scores) as a progress row per agent below the node diagram, providing observability into each agent run and HITL decision. The trace panel is a `rounded-xl border border-darkgrey-400 bg-darkgrey-100/60` card. Tool calls are not shown here (they appear as collapsible rows inside agent NodeCards).

## ADDED Requirements

### Requirement: Per-Agent Trace Row

The trace panel SHALL display a row per agent node showing: status icon, label, latency (seconds), token count, cost (USD), and eval score (with ✓/⚠ indicator). The data SHALL be fetched from the Langfuse API.

#### Scenario: Qualifier agent trace row

- **WHEN** the Qualifier Agent completes
- **THEN** the trace panel SHALL display a row for the Qualifier showing status icon, latency, token count, cost, and eval score

#### Scenario: All three agent trace rows

- **WHEN** the pipeline completes (all three agents have run)
- **THEN** the trace panel SHALL display three rows: Qualifier, Architect, and Risk Checker, each with latency, tokens, cost, and eval score

### Requirement: HITL Trace Row

The trace panel SHALL include a HITL row showing human latency (time from gate display to user action) and the user's decision (approved or edited).

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
- **THEN** its trace row SHALL appear in the panel immediately
- **AND** the user SHALL see trace data accumulating progressively as the pipeline runs

### Requirement: Langfuse API Data Source

All trace data displayed in the panel SHALL be fetched from the Langfuse API, not from in-memory pipeline state. This ensures displayed data matches what is visible in the Langfuse dashboard.

#### Scenario: Trace data matches Langfuse dashboard

- **WHEN** a pipeline run completes
- **THEN** the trace data shown in the panel SHALL match the traces visible in the Langfuse dashboard for the same run
