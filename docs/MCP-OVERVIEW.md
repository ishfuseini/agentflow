# Enterprise Architecture Pattern MCP — Overview

## What This Is

A self-hosted MCP server (`enterprise-arch-mcp`) that acts as an internal architecture reference brain for enterprise AI POC scoping. Built with FastMCP + TypeScript, deployed on GCP Cloud Run.

The MCP receives company, industry, data stack, cloud, and governance constraints, then returns recommended architecture patterns, tool selections, risks, and POC success criteria. It is the **knowledge layer** — not the reasoning layer. The agents in the agentflow pipeline do the reasoning; the MCP grounds that reasoning in curated enterprise patterns.

## Role in the agentflow Demo

```
agentflow pipeline                          enterprise-arch-mcp
┌──────────────────────┐                   ┌───────────────────────┐
│  Qualifier Agent     │                   │  arch_pattern_lookup   │
│  - clarifies the ask │   ── no MCP calls ─│  tool_selection_lookup │
│  - flags ambiguity   │                   │  risk_policy_lookup    │
└──────┬───────────────┘                   │  brand_context_lookup  │
       │ handoff                          │                        │
┌──────▼───────────────┐                   │  Source pack (data/)   │
│  Architect Agent     │──── MCP calls ───▶│  92 markdown files     │
│  - pattern selection │                   │  with YAML frontmatter  │
│  - tool selection    │◀── JSON response ─│                        │
│  - diagram rendering │                   │  Brandfetch + logo.dev │
└──────┬───────────────┘                   │  (cached, additive)    │
       │ handoff                          └───────────────────────┘
┌──────▼───────────────┐
│  Risk Checker Agent  │──── risk_policy_lookup ──▶
│  - eval scoring      │◀── risk_flags, HITL ──
│  - HITL gate trigger  │
└──────────────────────┘
```

The MCP is a **tool provider**, not an agent orchestrator. Agent prompts and the architecture-diagram skill live in the agentflow project. The MCP provides structured data; the agents interpret and act on it.

## MCP Tools

### 1. `arch_pattern_lookup` (called by Architect Agent)

**Input**: industry, data_stack, cloud_preference, constraints

**Output**: pattern_id, architecture_summary, recommended_components, data_zones, integration_notes, confidence, optional diagram_data

**Behavior**: Matches the enterprise ask to a curated reference architecture pattern from the source pack. Uses deterministic rules-based matching (industry 40%, data stack overlap 30%, constraint coverage 30%). Returns a fallback generic pattern with low confidence (< 0.5) when no strong match is found.

**diagram_data**: For curated matches (confidence >= 0.85), the response includes a `diagram_data` object with:
- `components`: array of {name, type, sublabel, zone} — e.g., BigQuery (database, audience activation, gold), SAML SSO (security, identity provider)
- `connections`: array of {from, to, label, style} — e.g., Users → SAML SSO (OAuth 2.0, dashed)
- `boundaries`: array of {label, type} — e.g., GCP EU Region (region)

The Architect Agent passes `diagram_data` to the architecture-diagram skill (which lives in the agentflow project) to render a dark-themed SVG diagram as an HTML file. Fallback matches omit `diagram_data`.

### 2. `tool_selection_lookup` (called by Architect Agent)

**Input**: use_case, data_stack, constraints, latency_need

**Output**: recommended_platform, cloud_fit, reasoning, alternatives

**Behavior**: Recommends a platform (BigQuery, Snowflake, Databricks, AWS/GCP/Azure) based on workload type and constraints. Includes at least one alternative platform with rationale. Constraint-aware reasoning factors HIPAA, PII, data residency, SSO/SAML, and latency into the recommendation.

### 3. `risk_policy_lookup` (called by Risk Checker Agent)

**Input**: industry, data_classification, region, deployment_model

**Output**: required_controls, risk_flags, hitl_required, review_reason

**Behavior**: Returns industry-specific risk and governance checks. Sets `hitl_required` to true when data classification includes regulated types (PHI, PII, regulated financial data). The `review_reason` field provides a human-readable explanation for the HITL gate.

**HITL trigger**: At least 3 of the 4 demo scenarios trigger meaningful HITL review:
- Healthcare (HIPAA, PHI) → HITL required
- FSI Governance (PII, regulated financial data) → HITL required
- Media Agency (cross-client governance) → HITL required or cross-client risk flags
- Retail Lakehouse → HITL based on data sensitivity

### 4. `brand_context_lookup` (called by Architect Agent)

**Input**: domain

**Output**: company_name, domain, industry_hint, description, tags, positioning, brand, logo_url, confidence

**Behavior**: Retrieves rich company context from two sources:
1. **Brandfetch Brand Context API** — identity (tagline, mission, description, tags), positioning (value proposition, target audience, products & services), brand voice/style attributes. API key via `BRANDFETCH_API_KEY` env var. 100 requests/month free tier.
2. **logo.dev** — company logo URL (`GET https://api.logo.dev/v1/logo?domain={domain}`). No API key required for basic retrieval.

Both responses are cached locally (file cache with TTL + Brandfetch `cachedOnly=true` mode for pre-populated domains). When either source is unavailable, the tool returns cached data or a graceful unavailable response — never a tool error.

The `logo_url` is used by the architecture-diagram skill to render a branded diagram header (company logo + name). The semantic component color palette (cyan=frontend, emerald=backend, violet=database, etc.) stays intact — brand colors are not used for components, only for the diagram header accent.

## Source Pack

92 markdown files under `data/` with structured YAML frontmatter. The MCP parses frontmatter at runtime for pattern matching and uses the markdown body as detailed reference content.

```
data/
  industry/    7 files — retail, healthcare, automotive, energy, etc.
  vendors/     37 files — aws/, azure/, databricks/, gcp/, snowflake/
               (+ new BigQuery content in gcp/)
  patterns/    31 files — IAM, API security, event-driven, microservices, etc.
               (+ 4 new scenario pattern definitions)
```

**No separate policies directory**. HIPAA, PII, data-residency, and cross-client governance are tagged via frontmatter fields (`compliance`, `constraints`) on existing vendor docs and access management/tenant isolation pattern files.

### Frontmatter schema (key fields)

```yaml
type: pattern | vendor | industry
industry: [healthcare]
data_stack: [databricks, unity-catalog]
cloud: [aws, azure]
constraints: [HIPAA, PHI, US data residency]
compliance: [hipaa]
region: [US]
data_zones: [bronze, silver, gold]
latency: batch
# Pattern-specific:
pattern_id: healthcare_patient_insights
architecture_summary: ...
recommended_components: [...]
integration_notes: [...]
confidence_baseline: 0.90
```

## Demo Scenarios

| Scenario | Industry | Data Stack | Key Constraints | Pattern ID | HITL? |
|----------|----------|-----------|------------------|------------|-------|
| Agency | media_agency | BigQuery, Snowflake | SAML SSO, EU data residency, cross-client governance | `media_agency_audience_measurement` | Yes (cross-client) |
| Healthcare | healthcare | Databricks | HIPAA, PHI, US data residency | `healthcare_patient_insights` | Yes (PHI) |
| Retail Lakehouse | retail | Databricks, Snowflake | real-time personalization | `retail_lakehouse_personalization` | Depends on data class |
| FSI Governance | financial_services | Snowflake | PII, regulated financial data, audit logs | `fsi_governance_copilot` | Yes (regulated data) |

Each scenario exercises the full pipeline: Qualifier → Architect (calls arch_pattern_lookup + tool_selection_lookup + brand_context_lookup) → Risk Checker (calls risk_policy_lookup) → HITL gate.

## Offline Behavior

The MCP is local-first. The three core tools work fully offline:

| Tool | Offline? | Notes |
|------|----------|-------|
| `arch_pattern_lookup` | Yes | Reads from local source pack |
| `tool_selection_lookup` | Yes | Reads from local source pack |
| `risk_policy_lookup` | Yes | Reads from local source pack |
| `brand_context_lookup` | Partial | Returns cached context if available; graceful unavailable if no cache and Brandfetch/logo.dev are unreachable |

This ensures the demo never breaks if Brandfetch or logo.dev are down. Pre-populate the cache for the 4 demo domains before the demo.

## Integration Contract (for the agentflow project)

The agentflow pipeline needs to:

1. **Register the MCP server** as a tool provider (via HTTP transport for deployed, or stdio for local dev)
2. **Call MCP tools from the right agents**:
   - Architect Agent calls `arch_pattern_lookup`, `tool_selection_lookup`, `brand_context_lookup`
   - Risk Checker Agent calls `risk_policy_lookup`
   - Qualifier Agent does not call the MCP
3. **Pass `diagram_data` from `arch_pattern_lookup` to the architecture-diagram skill** to render branded HTML/SVG diagrams (combine with `logo_url` from `brand_context_lookup` for the diagram header)
4. **Use `hitl_required` and `review_reason` from `risk_policy_lookup` to trigger the HITL gate** in the pipeline
5. **Handle graceful fallbacks** — when `brand_context_lookup` returns unavailable, the pipeline continues without brand context; when `arch_pattern_lookup` returns a fallback pattern (confidence < 0.5), the agent should flag the weak match

### Environment variables

| Variable | Purpose | Required? |
|----------|---------|-----------|
| `BRANDFETCH_API_KEY` | Brandfetch Brand Context API auth | Required for live brand context; not needed if cache is pre-populated |

logo.dev does not require an API key for basic logo retrieval.

### Deployment

- **Remote**: GCP Cloud Run, HTTP transport
- **Local**: stdio transport for development and MCP Inspector testing

## What Belongs Where

| Concern | Lives in | Why |
|---------|----------|-----|
| Architecture patterns, tool data, risk policies | enterprise-arch-mcp (source pack) | It's the knowledge layer |
| MCP tool implementations | enterprise-arch-mcp (src/) | Tools expose the knowledge |
| Agent system prompts | agentflow project | Prompts define agent behavior, which is pipeline concern |
| Architecture-diagram skill | agentflow project | The skill renders diagrams, which is presentation, not knowledge |
| HITL gate logic | agentflow project | The gate is pipeline orchestration |
| Pipeline orchestration | agentflow project | The pipeline owns agent flow |

The MCP provides structured data. The agentflow pipeline interprets it, reasons with it, and renders it. Clean separation.
