# agentflow-mcp

An enterprise architecture knowledge MCP server for the agentflow demo pipeline. Built with [FastMCP](https://github.com/punkpeye/fastmcp) + TypeScript, deployed on GCP Cloud Run.

The server exposes four tools that ground an Architecture Agent and Risk Checker Agent in curated enterprise patterns rather than generic LLM reasoning:

| Tool | Called by | Returns |
|---|---|---|
| `arch_pattern_lookup` | Architect Agent | Reference architecture pattern, components, diagram data |
| `tool_selection_lookup` | Architect Agent | Platform recommendation with constraint-aware reasoning |
| `risk_policy_lookup` | Risk Checker Agent | Required controls, risk flags, HITL trigger |
| `brand_context_lookup` | Architect Agent | Company identity, positioning, logo (via Brandfetch + logo.dev) |

## How It Fits In

```
agentflow pipeline                          agentflow-mcp
┌──────────────────────┐                   ┌───────────────────────┐
│  Qualifier Agent     │                   │  arch_pattern_lookup   │
│  - clarifies the ask │                   │  tool_selection_lookup │
└──────┬───────────────┘                   │  risk_policy_lookup    │
       │ handoff                          │  brand_context_lookup  │
┌──────▼───────────────┐                   │                        │
│  Architect Agent     │──── MCP calls ───▶│  Source pack (data/)   │
│  - pattern selection │                   │  102 markdown files    │
│  - tool selection    │◀── JSON response ─│  with YAML frontmatter  │
│  - diagram rendering │                   │                        │
└──────┬───────────────┘                   │  Brandfetch + logo.dev │
       │ handoff                          │  (cached, additive)    │
┌──────▼───────────────┐                   └───────────────────────┘
│  Risk Checker Agent  │──── risk_policy_lookup ──▶
│  - HITL gate trigger  │◀── risk_flags, HITL ──
└──────────────────────┘
```

The MCP is a **tool provider**, not an agent orchestrator. Agent prompts and the architecture-diagram skill live in the agentflow project. The MCP provides structured data; the agents interpret and act on it.

## Quickstart

### Prerequisites

- Node.js >= 20
- (Optional) Brandfetch API key and logo.dev key for `brand_context_lookup`

### Install & Run

```bash
npm install
npm run dev          # stdio transport (local dev + MCP Inspector)
```

### HTTP transport (Cloud Run)

```bash
MCP_TRANSPORT=http-stream PORT=8080 npm run dev
# agentflow-mcp listening on http://0.0.0.0:8080/mcp
```

### Run Tests

```bash
npm test             # 31 unit + integration tests
npm run typecheck    # tsc --noEmit
npm run check        # biome lint + format
```

## Environment Variables

Copy `.env.example` to `.env` and fill in the keys. Only `brand_context_lookup` needs external API keys — the other three tools work offline from the source pack.

| Variable | Required by | Purpose |
|---|---|---|
| `BRANDFETCH_API_KEY` | `brand_context_lookup` | Bearer token for Brandfetch Brand Context API |
| `LOGO_DEV_SECRET_KEY` | `brand_context_lookup` | Bearer token for logo.dev Brand API |
| `LOGO_DEV_PUBLISHABLE_KEY` | `brand_context_lookup` | Publishable key for logo.dev CDN URLs |
| `MCP_TRANSPORT` | Server | `stdio` (default) or `http-stream` |
| `PORT` | Server | HTTP port (default 8080, used when transport is `http-stream`) |

When API keys are missing, `brand_context_lookup` returns cached responses for cached domains or a graceful unavailable response for uncached domains. The other three tools continue to function normally.

## Tools

### `arch_pattern_lookup`

Match an enterprise ask to a curated reference architecture pattern.

**Input:**

```json
{
  "industry": "media_agency",
  "data_stack": ["BigQuery", "Snowflake"],
  "cloud": "GCP",
  "constraints": ["SAML SSO", "EU data residency", "cross-client governance"],
  "latency": "batch"
}
```

**Output:**

```json
{
  "pattern_id": "media_agency_audience_measurement",
  "architecture_summary": "...",
  "recommended_components": ["BigQuery", "Snowflake", "SAML SSO", "GCP EU Region"],
  "data_zones": ["bronze", "silver", "gold"],
  "integration_notes": ["..."],
  "confidence": 0.87,
  "diagram_data": {
    "components": [{ "name": "BigQuery", "type": "database", "sublabel": "...", "zone": "gold" }],
    "connections": [{ "from": "Users", "to": "SAML SSO", "label": "OAuth 2.0", "style": "dashed" }],
    "boundaries": [{ "label": "GCP EU Region", "type": "region" }]
  },
  "source_references": [{ "path": "data/patterns/...", "title": "...", "source_url": "..." }]
}
```

**Matching logic:** Deterministic, rules-based — industry match (40%) → data stack overlap (30%) → constraint coverage (30%). Curated matches (confidence >= 0.85) include `diagram_data` and source references. Weak matches fall back to a generic enterprise AI POC pattern with confidence < 0.5.

### `tool_selection_lookup`

Recommend a platform based on workload, data stack, constraints, and latency.

**Input:**

```json
{
  "use_case": "AI-powered patient insights",
  "data_stack": ["Databricks"],
  "constraints": ["HIPAA", "PHI", "US data residency"],
  "latency": "batch"
}
```

**Output:**

```json
{
  "recommended_platform": "Databricks",
  "cloud_fit": "Azure or AWS",
  "reasoning": "Strong lakehouse fit for healthcare AI with HIPAA-compliant governance...",
  "alternatives": [{ "platform": "Snowflake", "rationale": "..." }, { "platform": "BigQuery", "rationale": "..." }]
}
```

### `risk_policy_lookup`

Return industry-specific risk and governance checks, including HITL triggers for regulated data.

**Input:**

```json
{
  "industry": "healthcare",
  "data_classification": ["PHI", "PII"],
  "region": "US",
  "deployment": "cloud",
  "constraints": ["HIPAA"]
}
```

**Output:**

```json
{
  "required_controls": ["RBAC", "audit logs", "data lineage", "SAML SSO"],
  "risk_flags": ["prompt leakage", "overbroad analyst access"],
  "hitl_required": true,
  "review_reason": "PHI access requires human approval before final architecture signoff"
}
```

HITL is triggered for regulated data types (PHI, PII, regulated financial data) with a human-readable `review_reason`.

### `brand_context_lookup`

Retrieve rich company context from Brandfetch and a logo from logo.dev, with layered caching.

**Input:**

```json
{
  "domain": "havas.com"
}
```

**Output:**

```json
{
  "company_name": "Havas",
  "domain": "havas.com",
  "industry_hint": "media_agency",
  "description": "...",
  "tags": ["advertising", "marketing", "media"],
  "positioning": { "value_proposition": "...", "target_audience": "...", "products_and_services": "..." },
  "brand": { "voice": "...", "style": "..." },
  "logo_url": "https://...",
  "confidence": 0.85
}
```

**Caching layers:** (1) Brandfetch `cachedOnly=true` for instant cache-only lookups, (2) local file cache with TTL. Repeated lookups return cached data without consuming API quota. Graceful fallback when APIs are unreachable.

## Source Pack

The `data/` directory contains 102 markdown files with structured YAML frontmatter, organized into:

```
data/
├── industry/      # Industry-specific architecture notes
├── vendors/        # Vendor documentation (GCP, AWS, Azure, Snowflake, Databricks)
└── patterns/       # Curated reference architecture patterns (4 demo scenarios)
```

Frontmatter fields: `type`, `title`, `source_url`, `vendor`, `industry`, `data_stack`, `cloud`, `constraints`, `compliance`, `region`, `data_zones`, `latency`, `pattern_id`, `architecture_summary`, `recommended_components`, `integration_notes`, `confidence_baseline`, `diagram_data`.

The source pack is loaded into an in-memory index at server startup, keyed by industry, data stack, constraints, and pattern_id.

### Demo Scenarios

| Scenario | Industry | Pattern ID |
|---|---|---|
| Media agency audience measurement | `media_agency` | `media_agency_audience_measurement` |
| Healthcare patient insights | `healthcare` | `healthcare_patient_insights` |
| Retail lakehouse personalization | `retail` | `retail_lakehouse_personalization` |
| FSI governance copilot | `financial_services` | `fsi_governance_copilot` |

## Deployment

### Docker

```bash
docker build -t agentflow-mcp .
docker run -p 8080:8080 agentflow-mcp
```

### Fly.io

Simplest deployment path — no IAM setup, deploys your Dockerfile directly:

```bash
# Install Fly CLI (if not already)
curl -L https://fly.io/install.sh | sh

# Create the app (one-time)
fly launch --no-deploy

# Set secrets
fly secrets set BRANDFETCH_API_KEY=your-key-here
fly secrets set LOGO_DEV_SECRET_KEY=your-key-here
fly secrets set LOGO_DEV_PUBLISHABLE_KEY=your-key-here

# Deploy
fly deploy
```

`fly.toml` is already configured: Node 22 Docker image, HTTP transport on port 8080, scale-to-zero when idle. The MCP endpoint will be at `https://agentflow-mcp.fly.dev/mcp`.

### GCP Cloud Run

```bash
gcloud run deploy agentflow-mcp \
  --source . \
  --region run.googleapis.com \
  --port 8080 \
  --set-env-vars "MCP_TRANSPORT=http-stream" \
  --set-secrets "BRANDFETCH_API_KEY=brandfetch-api-key:latest,LOGO_DEV_SECRET_KEY=logo-dev-secret-key:latest,LOGO_DEV_PUBLISHABLE_KEY=logo-dev-publishable-key:latest"
```

See `cloud-run.yaml` for the full service configuration.

### Google App Engine

App Engine Standard doesn't run a build step — compile locally first, then deploy:

```bash
npm run build          # compile src/ -> dist/

# (Optional) Warm brand cache for demo domains before deploy
npx tsx scripts/brand-cache-warm.ts

gcloud app deploy      # deploys with dist/ and data/ included
```

`app.yaml` sets `MCP_TRANSPORT=http-stream` and scales to zero when idle (cheaper for a demo). App Engine sets `PORT` automatically — the server already reads it.

For secrets, use Secret Manager:

```bash
# Create secrets
gcloud secrets create brandfetch-api-key --data-file=<(echo -n "$BRANDFETCH_API_KEY")
gcloud secrets create logo-dev-secret-key --data-file=<(echo -n "$LOGO_DEV_SECRET_KEY")
gcloud secrets create logo-dev-publishable-key --data-file=<(echo -n "$LOGO_DEV_PUBLISHABLE_KEY")

# Reference them in app.yaml (uncomment the includes: section)
```

See `app.yaml` and `.gcloudignore` for the full configuration.

## Scripts

| Script | Purpose |
|---|---|
| `scripts/validate-source-pack.ts` | Validate all markdown files in `data/` have valid YAML frontmatter |
| `scripts/generate-frontmatter.mjs` | Generate frontmatter for source pack files |
| `scripts/mcp-list-check.ts` | Verify all four tools are discoverable via MCP tool listing |
| `scripts/brand-cache-warm.ts` | Pre-populate the brand cache for the four demo domains |

```bash
npx tsx scripts/validate-source-pack.ts   # validate source pack
npx tsx scripts/mcp-list-check.ts          # verify tool discovery
npx tsx scripts/brand-cache-warm.ts        # warm brand cache
```

## Testing with MCP Inspector

```bash
npx @modelcontextprotocol/inspector npm run dev
```

This launches the MCP Inspector UI where you can call tools interactively and verify responses.

## Project Structure

```
agentflow-mcp/
├── src/
│   ├── index.ts                    # MCP server entry point (stdio + http-stream)
│   ├── tools/
│   │   ├── archPatternLookup.ts    # Pattern matching + confidence scoring
│   │   ├── toolSelectionLookup.ts  # Platform recommendation
│   │   ├── riskPolicyLookup.ts     # Risk/governance checks + HITL
│   │   └── brandContextLookup.ts   # Brandfetch + logo.dev with caching
│   ├── data/
│   │   ├── loader.ts                # Source pack parser + in-memory index
│   │   ├── brandfetchClient.ts     # Brandfetch Brand Context API client
│   │   ├── logoDevClient.ts         # logo.dev Brand API client
│   │   └── brandCache.ts            # Local file cache with TTL
│   └── types/
│       ├── source.ts                # Source pack entry types
│       ├── arch-pattern.ts          # arch_pattern_lookup types
│       ├── tool-selection.ts        # tool_selection_lookup types
│       ├── risk-policy.ts           # risk_policy_lookup types
│       └── brand-context.ts        # brand_context_lookup types
├── data/                            # Source pack (102 markdown files)
│   ├── industry/
│   ├── vendors/
│   └── patterns/
├── tests/                           # Unit + integration tests
├── docs/                            # PRD, MCP overview
├── scripts/                         # Validation + cache warming scripts
├── openspec/                        # OpenSpec specs (4 capabilities)
│   ├── specs/                       # Main specs (synced from archived change)
│   └── changes/archive/            # Archived change proposals
├── Dockerfile                       # Multi-stage build for Cloud Run
├── cloud-run.yaml                  # Cloud Run service config
└── package.json
```

## Tech Stack

- **Runtime:** Node.js >= 20
- **MCP framework:** [FastMCP](https://github.com/punkpeye/fastmcp) v4
- **Language:** TypeScript (strict)
- **Validation:** Zod v4
- **Linting/formatting:** Biome
- **Testing:** Node.js built-in test runner
- **Deployment:** Docker + GCP Cloud Run

## OpenSpec

This project uses [OpenSpec](https://github.com/Fission-AI/OpenSpec) for spec-driven development. The four tool capabilities are specified under `openspec/specs/`:

- `arch-pattern-lookup` (7 requirements)
- `brand-context-lookup` (6 requirements)
- `risk-policy-lookup` (4 requirements)
- `tool-selection-lookup` (5 requirements)

Validate specs with:

```bash
openspec validate --specs
openspec doctor
```

## License

MIT
