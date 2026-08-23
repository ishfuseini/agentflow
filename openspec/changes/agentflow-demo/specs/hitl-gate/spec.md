## Purpose

Pauses the pipeline after the Risk Checker produces its evaluation, presenting the proposed POC plan and risk summary for human review. The user can approve the plan or edit it before the pipeline produces its final output.

## ADDED Requirements

### Requirement: Pipeline Pause After Risk Checker

The pipeline SHALL pause after the Risk Checker Agent produces its evaluation and SHALL NOT proceed to final output until the user takes an action at the HITL gate.

#### Scenario: Pipeline pauses for review

- **WHEN** the Risk Checker Agent completes its evaluation
- **THEN** the pipeline SHALL pause execution
- **AND** the HITL gate SHALL be displayed to the user
- **AND** the pipeline SHALL NOT produce final output until the user acts

### Requirement: HITL Gate Triggered by Risk Data

The HITL gate SHALL be triggered when either the `risk_policy_lookup` tool returns `hitl_required=true` OR the Risk Checker Agent flags any high-severity risk in its output.

#### Scenario: HITL triggered by regulated data classification

- **WHEN** `risk_policy_lookup` returns hitl_required=true
- **THEN** the HITL gate SHALL pause the pipeline and display the review_reason

#### Scenario: HITL triggered by high-severity risk

- **WHEN** the Risk Checker Agent produces a risk with severity="high"
- **THEN** the HITL gate SHALL pause the pipeline and display the high-severity risk

#### Scenario: HITL not triggered

- **WHEN** `risk_policy_lookup` returns hitl_required=false AND the Risk Checker produces no high-severity risks
- **THEN** the pipeline SHALL proceed to final output without pausing

### Requirement: Risk Summary Display

The HITL gate SHALL display the high-severity risks flagged by the Risk Checker and the `review_reason` from `risk_policy_lookup` (when available). The proposed POC plan SHALL be rendered for the user to review.

#### Scenario: HITL gate shows risks and plan

- **WHEN** the HITL gate is displayed
- **THEN** it SHALL show all high-severity risks from the Risk Checker output
- **AND** it SHALL show the review_reason from risk_policy_lookup (when hitl_required was true)
- **AND** it SHALL render the proposed POC plan for review

### Requirement: Approve Action

The user SHALL be able to approve the POC plan as-is. When approved, the pipeline SHALL continue to final output using the agent-produced plan unchanged.

#### Scenario: User approves plan

- **WHEN** the user clicks "Approve" at the HITL gate
- **THEN** the pipeline SHALL continue to final output using the POC plan as produced by the agents
- **AND** the HITL decision (approved) SHALL be logged to Langfuse

### Requirement: Edit Action

The user SHALL be able to edit the POC plan JSON in a textarea before continuing. When edited, the modified plan SHALL become the final output, and the diff between the agent's original plan and the edited plan SHALL be logged.

#### Scenario: User edits plan before continuing

- **WHEN** the user clicks "Edit" at the HITL gate
- **THEN** the POC plan JSON SHALL be displayed in an editable textarea
- **AND** the user SHALL be able to modify the JSON
- **WHEN** the user submits the edited plan
- **THEN** the modified plan SHALL become the final output
- **AND** the diff between the original and modified plan SHALL be logged to Langfuse

### Requirement: HITL Decision Logged to Langfuse

The HITL decision (approve or edit) SHALL be logged to Langfuse as an eval-able event. When the user edits the plan, the diff SHALL be included in the trace. The human latency (time from gate display to user action) SHALL be captured.

#### Scenario: Approve decision logged

- **WHEN** the user approves the POC plan
- **THEN** a Langfuse trace SHALL be created for the HITL event containing the decision (approved) and the human latency (time from gate display to approve click)

#### Scenario: Edit decision logged with diff

- **WHEN** the user edits the POC plan and submits
- **THEN** a Langfuse trace SHALL be created containing the decision (edited), the human latency, and the diff between the original and modified plan
