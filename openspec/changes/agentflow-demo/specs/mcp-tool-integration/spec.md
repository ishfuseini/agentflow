## Purpose

Provides MCP-based tool calling for the agent pipeline — the agents call the agentflow-mcp server's 7 tools for brand resolution, brand context, architecture patterns, pattern references, on-demand architecture diagrams, tool selection, and risk policies. Brand resolution happens first (surfacing a logo in the conversation), the architecture pattern is presented for confirmation, risk evaluation runs before any diagram, and architecture diagrams are fetched on demand only. The Qualifier Agent makes no tool calls.

## ADDED Requirements

### Requirement: MCP Client Registration

The pipeline SHALL register the agentflow-mcp server as an MCP tool provider. The server is deployed at `agentflow-mcp.fly.dev/mcp` (Fly.io, HTTP stream transport) and is an external dependency consumed via HTTP transport (remote) or stdio transport (local dev via MCP Inspector). All 7 tools SHALL be discoverable: `brand_search`, `brand_context_lookup`, `arch_pattern_lookup`, `arch_pattern_references`, `arch_diagram`, `tool_selection_lookup`, `risk_policy_lookup`.

#### Scenario: MCP server registered as tool provider

- **WHEN** the pipeline initializes
- **THEN** the agentflow-mcp server SHALL be registered as a tool provider available to agents
- **AND** all 7 tools SHALL be discoverable via tool listing

### Requirement: Tool Call Ordering

Tool calls SHALL follow this order: brand resolution (`brand_search` → `brand_context_lookup`) before architecture pattern lookup (`arch_pattern_lookup` → `arch_pattern_references`), and risk evaluation (`risk_policy_lookup`) before any diagram fetch (`arch_diagram`). A diagram SHALL be fetched only when requested. User confirmation gates for brand context and architecture pattern are specified in the HITL gate capability, not here.

#### Scenario: Risk evaluated before diagram fetch

- **WHEN** a pipeline run reaches the point where a diagram is requested
- **THEN** `risk_policy_lookup` SHALL already have been called
- **AND** `arch_diagram` SHALL NOT have been called before risk evaluation completed

### Requirement: Brand Resolution via Brand Search

The pipeline SHALL call the agentflow-mcp `brand_search` tool with `query` (a company name or prefix from the prompt or scenario) and optional `strategy` (`suggest` default, or `match`). The tool returns `query`, `strategy`, `candidates` (each with `name`, `domain`, `logo_url`), and `available`. The selected candidate's `logo_url` SHALL be displayed in the conversation immediately, before `brand_context_lookup` runs. The selected candidate's `domain` SHALL be used as the input to `brand_context_lookup`.

#### Scenario: Brand search returns candidates

- **WHEN** the pipeline calls `brand_search` with query="sweetgreen"
- **THEN** the tool SHALL return a list of candidates each with name, domain, and logo_url
- **AND** available SHALL be true

#### Scenario: Brand search domain feeds brand context

- **WHEN** a brand candidate is selected from `brand_search` results
- **THEN** the candidate's logo_url SHALL be shown in the conversation
- **AND** the candidate's domain SHALL be passed to `brand_context_lookup`

### Requirement: Architect Agent Brand Context

The pipeline SHALL call the agentflow-mcp `brand_context_lookup` tool after `brand_search`, with the `domain` from the confirmed `brand_search` candidate (or extracted directly from the prompt). It provides the deeper company context (positioning, voice, industry hint); the logo already displayed comes from the `brand_search` candidate. The tool returns `company_name`, `domain`, `industry_hint`, `description`, `tags`, `positioning` (with `value_proposition`, `target_audience`, `products_and_services`), `brand` (with `voice`, `style`), `logo_url`, and `confidence`.

#### Scenario: Brand context returns logo and company info

- **WHEN** the pipeline calls `brand_context_lookup` with a domain
- **THEN** the tool SHALL return company_name, logo_url, and brand positioning data

### Requirement: Architect Agent Pattern Lookup

The Architect Agent SHALL call the agentflow-mcp `arch_pattern_lookup` tool with `industry`, `data_stack`, `constraints`, and optionally `cloud` and `latency`, derived from the Qualifier's output. The tool returns `pattern_id`, `architecture_summary`, `recommended_components`, `data_zones`, `integration_notes`, and `confidence`. Diagram data and source references SHALL NOT be returned inline — they are fetched via `arch_diagram` and `arch_pattern_references` respectively.

#### Scenario: Pattern lookup returns curated match

- **WHEN** the Architect Agent calls `arch_pattern_lookup` with industry=healthcare, data_stack=[databricks], constraints=[HIPAA, PHI, US data residency]
- **THEN** the tool SHALL return a pattern with confidence >= 0.85
- **AND** the response SHALL NOT include diagram_data or source_references

#### Scenario: Pattern lookup returns fallback match

- **WHEN** the Architect Agent calls `arch_pattern_lookup` with inputs from a custom prompt that don't match any curated pattern
- **THEN** the tool SHALL return the generic fallback pattern `generic_enterprise_ai_poc` with confidence < 0.5
- **AND** the Architect Agent SHALL flag the weak match in its output

### Requirement: Architect Agent Pattern References

The Architect Agent SHALL call the agentflow-mcp `arch_pattern_references` tool with `pattern_id` plus the original `industry`, `data_stack`, and `constraints`. The tool returns `pattern_id`, `source_references` (each with `path`, `title`, `source_url`), and `available`. The references SHALL accompany the architecture pattern when it is presented for confirmation.

#### Scenario: Pattern references returned for curated pattern

- **WHEN** the Architect Agent calls `arch_pattern_references` with pattern_id=healthcare_patient_insights and the original lookup context
- **THEN** the tool SHALL return source_references with path, title, and source_url
- **AND** available SHALL be true

#### Scenario: Pattern references for fallback pattern

- **WHEN** the Architect Agent calls `arch_pattern_references` with pattern_id=generic_enterprise_ai_poc
- **THEN** the tool SHALL return an empty source_references list

### Requirement: On-Demand Architecture Diagram

The pipeline SHALL call the agentflow-mcp `arch_diagram` tool with `pattern_id` only when a diagram is requested, and only after risk evaluation has completed. The tool returns `pattern_id`, `diagram_data` (components, connections, boundaries), and `available`. For non-curated patterns the tool SHALL return `available` as false with a human-readable `message`, and no diagram SHALL be rendered.

#### Scenario: Diagram returned for curated pattern

- **WHEN** a diagram is requested for pattern_id=healthcare_patient_insights after risk evaluation
- **THEN** the tool SHALL return diagram_data with components, connections, and boundaries
- **AND** available SHALL be true

#### Scenario: Diagram unavailable for fallback pattern

- **WHEN** a diagram is requested for pattern_id=generic_enterprise_ai_poc
- **THEN** the tool SHALL return available=false with an explanatory message
- **AND** no architecture diagram SHALL be rendered

### Requirement: Architect Agent Tool Selection

The Architect Agent SHALL call the agentflow-mcp `tool_selection_lookup` tool with `use_case`, `data_stack`, `constraints`, and optionally `latency`. The tool returns `recommended_platform`, `cloud_fit`, `reasoning`, and `alternatives`.

#### Scenario: Tool selection returns platform recommendation

- **WHEN** the Architect Agent calls `tool_selection_lookup` with use_case=audience_segmentation, data_stack=[bigquery, snowflake], constraints=[EU data residency], latency=batch
- **THEN** the tool SHALL return a recommended_platform, cloud_fit, reasoning, and at least one alternative platform

### Requirement: Risk Checker Agent Risk Policy Lookup

The Risk Checker Agent SHALL call the agentflow-mcp `risk_policy_lookup` tool with `industry`, `data_classification`, `region`, `deployment`, and optionally `constraints`. The tool returns `required_controls`, `risk_flags`, `hitl_required` (boolean), and `review_reason` (string).

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

When `arch_pattern_lookup` returns the fallback pattern `generic_enterprise_ai_poc` with confidence < 0.5, the Architect Agent SHALL flag the weak match in its output and the pipeline SHALL continue with the fallback pattern rather than failing. No architecture diagram SHALL be fetched or rendered for the fallback pattern.

#### Scenario: Low-confidence pattern match

- **WHEN** `arch_pattern_lookup` returns confidence=0 with the generic fallback pattern
- **THEN** the Architect Agent SHALL proceed with the fallback pattern
- **AND** the Architect Agent SHALL include a note in its output that the match is low-confidence
- **AND** `arch_diagram` SHALL return available=false for the fallback pattern, so no architecture diagram is rendered
