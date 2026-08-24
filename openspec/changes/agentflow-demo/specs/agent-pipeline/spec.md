## Purpose

Orchestrates a 3-agent sequential pipeline (Qualifier → Architect → Risk Checker) that transforms a free-text pre-sales ask into a structured POC plan with risk evaluation, using the OpenAI Agents SDK with configurable model routing and Langfuse tracing.

## ADDED Requirements

### Requirement: Sequential Pipeline Execution

The pipeline SHALL execute three agents in fixed order: Qualifier Agent → Architect Agent → Risk Checker Agent. Each agent SHALL receive the structured JSON output of the previous agent as input. The Qualifier Agent receives the free-text user prompt as input.

#### Scenario: Full pipeline run

- **WHEN** a user submits a prompt and triggers a pipeline run
- **THEN** the Qualifier Agent executes first, producing structured requirements JSON
- **AND** the Architect Agent executes second, receiving the Qualifier's JSON and producing a deployment architecture + POC plan JSON
- **AND** the Risk Checker Agent executes third, receiving the Architect's JSON and producing an evaluation JSON with scores and risks

#### Scenario: Agent handoff data contract

- **WHEN** the Qualifier Agent completes and produces its JSON output
- **THEN** the Architect Agent SHALL receive the full Qualifier JSON as its input
- **AND** when the Architect Agent completes, the Risk Checker Agent SHALL receive the full Architect JSON as its input

### Requirement: Qualifier Agent Output Schema

The Qualifier Agent SHALL produce JSON output with the following fields: `named_use_cases` (array of strings), `partner_constraints` (array of strings), `success_criteria` (array of strings), `exit_criteria` (array of strings), and `ambiguity_flags` (array of strings).

#### Scenario: Qualifier produces structured requirements

- **WHEN** the Qualifier Agent receives a free-text prompt like "We want to use AI to automate our media buying workflow across 3 brands"
- **THEN** it SHALL produce JSON containing `named_use_cases`, `partner_constraints`, `success_criteria`, `exit_criteria`, and `ambiguity_flags`
- **AND** each field SHALL be an array of strings

### Requirement: Architect Agent Output Schema

The Architect Agent SHALL produce JSON output with an `architecture_summary` (string), a `poc_plan` object containing `scope`, `timeline`, `data_zones`, `integrations`, and `resource_estimate`, and `deployment_notes` (string).

#### Scenario: Architect produces POC plan

- **WHEN** the Architect Agent receives the Qualifier's JSON output
- **THEN** it SHALL produce JSON containing `architecture_summary`, `poc_plan` (with `scope`, `timeline`, `data_zones`, `integrations`, `resource_estimate`), and `deployment_notes`

### Requirement: Risk Checker Agent Output Schema

The Risk Checker Agent SHALL produce JSON output with an `eval_scores` object containing seven scored dimensions (use_case_clarity, success_criteria_specificity, exit_criteria_present, timeline_realism, governance_coverage, data_zone_design, resource_feasibility), an `overall_score` (number), a `risks` array (each entry with `severity` and `issue`), and a `recommendation` (string).

#### Scenario: Risk Checker produces evaluation

- **WHEN** the Risk Checker Agent receives the Architect's JSON output
- **THEN** it SHALL produce JSON containing `eval_scores` with all seven dimensions scored, `overall_score`, `risks` array with severity and issue per entry, and `recommendation`

### Requirement: Model Routing Toggle

The pipeline SHALL support a routing strategy toggle with two modes: "cost" and "intelligence". In cost mode, all three agents SHALL use `gpt-oss:20b` via Ollama Cloud. In intelligence mode, the Architect Agent SHALL use `claude-opus-4-8` via OpenRouter while the Qualifier and Risk Checker SHALL use `gpt-oss:20b` via Ollama Cloud.

#### Scenario: Cost mode routing

- **WHEN** the routing toggle is set to "cost" and a pipeline run is triggered
- **THEN** all three agents SHALL use `gpt-oss:20b` via Ollama Cloud

#### Scenario: Intelligence mode routing

- **WHEN** the routing toggle is set to "intelligence" and a pipeline run is triggered
- **THEN** the Architect Agent SHALL use `claude-opus-4-8` via OpenRouter
- **AND** the Qualifier and Risk Checker agents SHALL use `gpt-oss:20b` via Ollama Cloud

### Requirement: Pre-loaded Scenarios

The pipeline SHALL provide 4 pre-loaded scenarios as pre-built prompts: Agency (media agency audience measurement), Healthcare (patient insights), Retail Lakehouse (real-time personalization), and FSI Governance (AI governance copilot). Each maps to a curated MCP pattern.

#### Scenario: Agency scenario

- **WHEN** a user selects the Agency scenario
- **THEN** the pipeline SHALL use the pre-built prompt: "We're a top-5 media agency. We want to use AI to automate audience segmentation and campaign measurement across 3 client brands. We have BigQuery and Snowflake. SAML SSO is required, data must stay in EU, and we need cross-client governance controls."

#### Scenario: Healthcare scenario triggers HIPAA context

- **WHEN** a user selects the Healthcare scenario
- **THEN** the pipeline SHALL use the pre-built prompt: "A healthcare provider has 15 years of patient data on-prem. They want to modernize to Databricks on the cloud and add AI-powered patient insights. HIPAA compliance required, PHI data, US data residency."

#### Scenario: Retail Lakehouse scenario

- **WHEN** a user selects the Retail Lakehouse scenario
- **THEN** the pipeline SHALL use the pre-built prompt: "A large retailer wants to build a lakehouse on Databricks and Snowflake for real-time personalization across e-commerce and in-store channels. They need sub-second recommendations and a unified customer view."

#### Scenario: FSI Governance scenario

- **WHEN** a user selects the FSI Governance scenario
- **THEN** the pipeline SHALL use the pre-built prompt: "A financial services firm wants to build an AI governance copilot on Snowflake. They handle PII and regulated financial data, require audit logs for all AI decisions, and need compliance with financial regulations."

### Requirement: Custom Prompt Input

The pipeline SHALL accept a free-text custom prompt as an alternative to the pre-loaded scenarios.

#### Scenario: Custom prompt submission

- **WHEN** a user types a free-text prompt into the custom prompt input and triggers a pipeline run
- **THEN** the pipeline SHALL use the typed prompt as the Qualifier Agent's input instead of a pre-loaded scenario

### Requirement: Pipeline Run via API

The pipeline SHALL be triggered via an API endpoint that accepts a prompt and routing mode, executes the full pipeline, and returns the structured output.

#### Scenario: API triggers full pipeline

- **WHEN** a POST request is sent to the pipeline API endpoint with a prompt and routing mode
- **THEN** the pipeline SHALL execute all three agents sequentially and return the final structured POC plan with architecture, risks, and evaluation

### Requirement: Langfuse Tracing Per Run

Each pipeline run SHALL be wrapped in a single Langfuse trace (named `agentflow.pipeline`, scoped by sessionId = runId) containing one nested observation per agent run. Each agent observation SHALL capture latency, token count, cost, and eval score. The trace SHALL be scoped to a dedicated Langfuse project for this app, separate from other apps sharing the same Langfuse instance.

#### Scenario: Pipeline run produces one trace with agent observations

- **WHEN** the pipeline executes
- **THEN** a single Langfuse trace SHALL be created for the run, named `agentflow.pipeline` and scoped by the run id
- **AND** the trace SHALL contain one nested observation per agent (Qualifier, Architect, Risk Checker)
- **AND** each agent observation SHALL contain latency, token count, cost, and eval score
- **AND** the trace SHALL be associated with this app's dedicated Langfuse project
