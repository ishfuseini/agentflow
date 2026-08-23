## Purpose

Provides MCP-based tool calling for the agent pipeline — the Architect and Risk Checker agents call the agentflow-mcp server for architecture patterns, tool selection, brand context, and risk policies. The Qualifier Agent makes no tool calls.

## ADDED Requirements

### Requirement: MCP Client Registration

The pipeline SHALL register the agentflow-mcp server as an MCP tool provider (for architecture patterns, tool selection, brand context, and risk policies). The server is deployed at `agentflow-mcp.fly.dev/mcp` (Fly.io, HTTP stream transport) and is an external dependency consumed via HTTP transport (remote) or stdio transport (local dev via MCP Inspector).

#### Scenario: MCP server registered as tool provider

- **WHEN** the pipeline initializes
- **THEN** the agentflow-mcp server SHALL be registered as a tool provider available to agents

### Requirement: Architect Agent Pattern Lookup

The Architect Agent SHALL call the agentflow-mcp `arch_pattern_lookup` tool with `industry`, `data_stack`, `cloud`, `constraints`, and `latency` derived from the Qualifier's output. The tool returns a `pattern_id`, `architecture_summary`, `recommended_components`, `data_zones`, `integration_notes`, `confidence`, `source_references`, and optional `diagram_data`.

#### Scenario: Pattern lookup returns curated match

- **WHEN** the Architect Agent calls `arch_pattern_lookup` with industry=healthcare, data_stack=[databricks], constraints=[HIPAA, PHI, US data residency]
- **THEN** the tool SHALL return a pattern with confidence >= 0.85, including diagram_data with components, connections, and boundaries

#### Scenario: Pattern lookup returns fallback match

- **WHEN** the Architect Agent calls `arch_pattern_lookup` with inputs from a custom prompt that don't match any curated pattern
- **THEN** the tool SHALL return a generic fallback pattern with confidence < 0.5
- **AND** the Architect Agent SHALL flag the weak match in its output

### Requirement: Architect Agent Tool Selection

The Architect Agent SHALL call the agentflow-mcp `tool_selection_lookup` tool with `use_case`, `data_stack`, `constraints`, and `latency`. The tool returns `recommended_platform`, `cloud_fit`, `reasoning`, and `alternatives`.

#### Scenario: Tool selection returns platform recommendation

- **WHEN** the Architect Agent calls `tool_selection_lookup` with use_case=audience_segmentation, data_stack=[bigquery, snowflake], constraints=[EU data residency], latency=batch
- **THEN** the tool SHALL return a recommended_platform, cloud_fit, reasoning, and at least one alternative platform

### Requirement: Architect Agent Brand Context

The Architect Agent SHALL call the agentflow-mcp `brand_context_lookup` tool with the `domain` extracted from the scenario or prompt. The tool returns `company_name`, `domain`, `industry_hint`, `description`, `tags`, `positioning` (with `value_proposition`, `target_audience`, `products_and_services`), `brand` (with `voice`, `style`), `logo_url`, and `confidence`.

#### Scenario: Brand context returns logo and company info

- **WHEN** the Architect Agent calls `brand_context_lookup` with a domain
- **THEN** the tool SHALL return company_name, logo_url, and brand positioning data

### Requirement: Risk Checker Agent Risk Policy Lookup

The Risk Checker Agent SHALL call the agentflow-mcp `risk_policy_lookup` tool with `industry`, `data_classification`, `region`, `deployment`, and `constraints`. The tool returns `required_controls`, `risk_flags`, `hitl_required` (boolean), and `review_reason` (string).

#### Scenario: Risk policy lookup for healthcare data

- **WHEN** the Risk Checker Agent calls `risk_policy_lookup` with industry=healthcare, data_classification=[PHI], region=US, deployment=cloud
- **THEN** the tool SHALL return required_controls including HIPAA safeguards
- **AND** hitl_required SHALL be true
- **AND** review_reason SHALL contain a human-readable explanation for the HITL gate

#### Scenario: Risk policy lookup for non-regulated data

- **WHEN** the Risk Checker Agent calls `risk_policy_lookup` with industry=retail, data_classification=[non-regulated], region=US, deployment=cloud
- **THEN** the tool SHALL return risk_flags and required_controls
- **AND** hitl_required SHALL be false or true based on data sensitivity

#### Scenario: Risk policy lookup for regulated financial data

- **WHEN** the Risk Checker Agent calls `risk_policy_lookup` with industry=financial_services, data_classification=[PII, regulated financial data], region=US, deployment=cloud
- **THEN** the tool SHALL return required_controls including audit log and financial compliance safeguards
- **AND** hitl_required SHALL be true
- **AND** review_reason SHALL contain a human-readable explanation for the HITL gate

### Requirement: HITL Trigger from Risk Policy

When `risk_policy_lookup` returns `hitl_required` as true, the pipeline SHALL trigger the HITL gate and display the `review_reason` to the user.

#### Scenario: HITL triggered by regulated data

- **WHEN** `risk_policy_lookup` returns hitl_required=true with review_reason="PHI data classification requires human review of governance controls"
- **THEN** the pipeline SHALL pause and trigger the HITL gate
- **AND** the review_reason SHALL be displayed to the user in the HITL gate UI

### Requirement: Graceful Fallback for Brand Context

When `brand_context_lookup` returns unavailable (no cached data and Brandfetch/logo.dev unreachable), the pipeline SHALL continue without brand context rather than failing. The architecture diagram SHALL render without a branded header.

#### Scenario: Brand context unavailable

- **WHEN** `brand_context_lookup` returns a graceful unavailable response
- **THEN** the pipeline SHALL continue execution without brand context
- **AND** the architecture diagram SHALL render without a company logo in the header
- **AND** no tool error SHALL be surfaced to the user

### Requirement: Graceful Fallback for Low-Confidence Pattern Match

When `arch_pattern_lookup` returns a fallback pattern with confidence < 0.5, the Architect Agent SHALL flag the weak match in its output and the pipeline SHALL continue with the fallback pattern rather than failing.

#### Scenario: Low-confidence pattern match

- **WHEN** `arch_pattern_lookup` returns confidence=0.3 with a generic fallback pattern
- **THEN** the Architect Agent SHALL proceed with the fallback pattern
- **AND** the Architect Agent SHALL include a note in its output that the match is low-confidence
- **AND** diagram_data SHALL be omitted (no architecture diagram rendered)
