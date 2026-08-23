# PRD: agentflow.ishlab.dev — Interactive Agentic Workflow Demo

## Status: Draft
**Author:** Ish Fuseini
**Date:** 2026-08-22

---

## Problem

The candidate's portfolio has strong infrastructure proof (ishlab inference lab: routing, evals, traces) and incoming voice AI (ElevenLabs). The gap: no showable demo of **multi-agent orchestration, tool use, and HITL escalation** — the core competency every agentic/forward-deployed role in the pipeline tests for (Akkio, Anthropic, Sierra, Decagon, Vapi).

Interviews at these companies include "build something small with an agent, live" sessions. A live URL that demonstrates agent orchestration with observable traces is the strongest possible answer to that prompt.

## Solution

A live, interactive node-graph web app where a user submits a prompt (pre-loaded with pre-sales scenarios) and watches it flow through a 3-agent pipeline in real-time. Each agent lights up as it fires, tool calls expand inline, and a HITL gate pauses for human input. The diagram IS the demo — a recruiter opens the URL and immediately sees systems-level thinking without reading code.

## Goals

- Prove agent orchestration (multi-agent routing, tool use, HITL) in a showable, live format
- Demonstrate pre-sales domain expertise (POC qualification workflow) operationalized with AI
- Reuse existing infrastructure (OpenRouter, Langfuse, ishlab.dev) — minimal new infra
- Deploy in days, not weeks — this is a demo, not a product
- Pass the "build something small with an agent, live" interview test before it happens

## Non-Goals

- General-purpose agent framework — this is a demo with 3 fixed agents, not LangGraph competitors
- Multi-tenant, auth, persistence — single-user demo app
- More than 3 agents — clarity of the diagram beats complexity of the pipeline
- Mobile-responsive — interviewers open this on laptops
- Production reliability — if it's down, you restart it; it's a homelab demo

---

## The Demo

### Visual layout

```
┌──────────────────────────────────────────────────────────────────┐
│  agents.ishlab.dev                                               │
│  Agentic POC Qualification Pipeline                              │
├──────────────┬────────────────────────────────┬─────────────────┤
│              │                                │                  │
│  SCENARIO    │     LIVE NODE DIAGRAM          │  STRUCTURED      │
│  PICKER      │                                │  OUTPUT          │
│              │   ┌─────────┐                  │                  │
│  [Scenario 1]│   │ QUALIFIER│                  │  POC Plan:       │
│  [Scenario 2]│   │  agent   │                  │  ─────────       │
│  [Scenario 3]│   └────┬────┘                  │  Use cases:      │
│              │        │                       │  • ...            │
│  ── OR ──    │   ┌────┴────┐                  │  Success criteria:│
│              │   │ ARCHITECT│                  │  • ...            │
│  Custom      │   │  agent   │                  │  Exit criteria:  │
│  prompt:     │   └────┬────┘                  │  • ...            │
│  [textarea]  │        │                       │  Risks:          │
│              │   ┌────┴────┐                  │  • ...            │
│              │   │ RISK     │                  │                  │
│              │   │ CHECKER  │                  │                  │
│              │   └────┬────┘                  │                  │
│              │        │                       │                  │
│              │   ┌────┴────┐                  │                  │
│              │   │ HITL    │ ⚠️ PAUSED        │                  │
│              │   │ GATE    │ [Approve] [Edit] │                  │
│              │   └─────────┘                  │                  │
│              │                                │                  │
│              │  ── TRACE PANEL ──             │                  │
│              │  Node 1: 0.8s · $0.002 · ✓    │                  │
│              │  Tool call: search → 2 results │                  │
│              │  Node 2: 1.2s · $0.004 · ✓    │                  │
│              │  Node 3: 0.6s · $0.001 · ⚠️   │                  │
│              │  Total: 2.6s · $0.007 · eval: 4.2/5│              │
└──────────────┴────────────────────────────────┴─────────────────┘
```

### Interaction flow

1. User picks a pre-loaded scenario (or types a custom prompt)
2. Clicks "Run Pipeline"
3. Qualifier agent fires — node lights up, shows streaming output, makes a tool call (search/lookup), produces structured requirements
4. Architect agent fires — receives qualifier output, produces deployment architecture + POC plan
5. Risk Checker agent fires — evaluates the plan against a rubric, flags risks
6. HITL gate pauses — shows the proposed POC plan, user clicks "Approve" or "Edit" (edit lets user modify the plan before final output)
7. Final structured output renders on the right: use cases, success criteria, exit criteria, risks, architecture summary
8. Trace panel below the diagram shows per-node: latency, cost, eval score, tool call results — all from Langfuse

---

## The 3 Agents

### 1. Qualifier Agent

**Role:** Extract structured requirements from a messy, underspecified partner ask.

**Input:** Free-text prompt (scenario or custom) — e.g., "We want to use AI to automate our media buying workflow across 3 brands."

**Output (JSON):**
```json
{
  "named_use_cases": ["audience segmentation", "campaign performance measurement", "budget allocation"],
  "partner_constraints": ["data residency in EU", "SSO required", "existing BigQuery warehouse"],
  "success_criteria": ["audience build time < 5 min", "measurement accuracy within 2% of baseline"],
  "exit_criteria": ["POC fails if build time > 30 min after 2 sprints"],
  "ambiguity_flags": ["budget allocation scope unclear — needs clarification"]
}
```

**Tool call:** MCP tool call to Tavily's hosted MCP server (`search` tool) — real web search, e.g. "media buying automation patterns," returning 2-3 results. Consuming an existing hosted MCP server proves real MCP protocol usage without writing a search backend.

**Model:** gpt-oss-20b (cost-optimized) via Ollama Cloud — same tool used in the ishlab homelab, cloud-hosted so the demo doesn't depend on the homelab being up.

### 2. Architect Agent

**Role:** Translate structured requirements into a deployment architecture + POC plan.

**Input:** Qualifier agent's JSON output.

**Output (JSON):**
```json
{
  "architecture_summary": "Deploy Akkio within partner's GCP environment, ingest from BigQuery, medallion-style data zones, governance inheritance via partner's IAM.",
  "poc_plan": {
    "scope": "2 named use cases: audience segmentation + campaign measurement",
    "timeline": "4-week POC",
    "data_zones": ["bronze: raw BigQuery ingest", "silver: transformed audience segments", "gold: measurement-ready outputs"],
    "integrations": ["BigQuery (ingestion)", "Partner IAM (governance)", "Looker (output)"],
    "resource_estimate": "1 SA (50%), 1 data engineer (30%), 2 weeks build + 2 weeks test"
  },
  "deployment_notes": "Inherit partner's SSO/SAML. Data residency: EU region GCP project."
}
```

**Tool call:** MCP tool call to a small self-hosted MCP server exposing `arch_lookup` — queries a static JSON of your own reference architecture patterns and returns the closest match. Kept self-hosted because this is your own domain knowledge (no remote MCP server has media-agency/BigQuery/medallion reference patterns) — also a stronger proof point than consuming someone else's server, since exposing an internal tool to an agent is closer to what these roles actually do.

**Model:** claude-opus-4-8 (intelligence-optimized) via OpenRouter — the routing strategy toggle in action.

### 3. Risk Checker Agent

**Role:** Evaluate the POC plan against a deterministic rubric and flag risks.

**Input:** Architect agent's JSON output.

**Output (JSON):**
```json
{
  "eval_scores": {
    "use_case_clarity": 4,
    "success_criteria_specificity": 3,
    "exit_criteria_present": 5,
    "timeline_realism": 3,
    "governance_coverage": 4,
    "data_zone_design": 5,
    "resource_feasibility": 2
  },
  "overall_score": 3.7,
  "risks": [
    {"severity": "high", "issue": "Resource estimate too lean for 2 use cases in 4 weeks"},
    {"severity": "medium", "issue": "Exit criteria not quantified — 'fails if build time > 30 min' needs a measurement baseline"},
    {"severity": "low", "issue": "Looker integration not in partner's current stack — verify"}
  ],
  "recommendation": "Proceed with adjusted timeline (6 weeks) and quantified exit criteria"
}
```

**No tool call** — this agent evaluates, doesn't fetch. The eval scores map to Langfuse eval dimensions.

**Model:** gpt-oss-20b (cost-optimized) via Ollama Cloud — evaluation doesn't need the most intelligent model.

---

## HITL Gate

After the Risk Checker produces its evaluation, the pipeline **pauses**. The UI shows:

```
⚠️ HITL GATE — Review Required

The Risk Checker flagged 1 high-severity issue:
  • Resource estimate too lean for 2 use cases in 4 weeks

Proposed POC plan:
  [summary rendered]

[Approve and continue]  [Edit plan before continuing]
```

- **Approve:** pipeline continues to final output, HITL decision logged in Langfuse trace
- **Edit:** user can modify the POC plan JSON in a textarea, then continue — the modified plan becomes the final output, and the diff from the agent's original is logged

This is the human-in-the-loop checkpoint that proves you understand escalation, not just automation. The HITL decision is traced in Langfuse as an eval-able event.

---

## Pre-loaded Scenarios

3 scenarios, each a real-world pre-sales prompt:

### Scenario 1: Media Agency AI (Akkio-adjacent)
> "We're a top-5 media agency. We want to use AI to automate audience segmentation and campaign measurement across 3 client brands. We have BigQuery, Snowflake, and a custom reporting stack. Security review is required. How would we POC this?"

### Scenario 2: Enterprise CRM Migration (Adobe/Salesforce-adjacent)
> "Fortune 500 retail brand wants to migrate from Siebel to Salesforce and add Agentforce AI telephony for customer service. $30M project scope. We need a POC plan that proves the AI telephony use case before the full migration."

### Scenario 3: Data Platform Modernization
> "Healthcare company has 15 years of data in on-prem SQL Server. They want to modernize to a cloud data platform and add AI-powered patient insights. HIPAA compliance required. What does the POC look like?"

These map to your actual deal history ($30M Agentforce, $20M Siebel→Salesforce, Penn Medicine/Health Cloud). The scenarios aren't fabricated — they're reframed proof points.

---

## Trace Panel

Below the node diagram, a real-time trace panel showing Langfuse data per node:

```
── TRACE PANEL (Langfuse) ──────────────────────────────
Qualifier    0.8s · 1,240 tokens · $0.002 · eval: 4.5/5 ✓
  └─ tool: search("media buying automation") → 3 results
Architect    1.2s · 890 tokens · $0.004 · eval: 4.0/5 ✓
  └─ tool: arch_lookup("medallion + BigQuery") → 1 match
Risk Checker  0.6s · 410 tokens · $0.001 · eval: 3.7/5 ⚠️
HITL Gate    12.3s (human) · decision: approved
─────────────────────────────────────────────────────
Total        2.6s compute · $0.007 · pipeline eval: 4.1/5
```

- Each row is a Langfuse trace, fetched via the Langfuse API
- Eval scores come from Langfuse's evaluation system (score the outputs against the deterministic rubric)
- The HITL row shows human latency — proving you measure the human part, not just the machine part
- "pipeline eval" is an aggregate score — the overall quality of the final deliverable

---

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Frontend | SvelteKit (TypeScript) | Used before |
| Node diagram | Svelte Flow |
| Agent orchestration | OpenAI Agents SDK (TypeScript, `@openai/agents`) | TS-native, provider-agnostic, built-in MCP client + HITL primitives — fits the pipeline without a stateful agent-OS like Letta |
| LLM calls (cost tier) | Ollama Cloud (`gpt-oss:20b`) | Same tool already used in the ishlab homelab, cloud-hosted so the demo doesn't depend on the homelab being up; Pro tier ($20/mo) for headroom so interview-day quota isn't at risk from rehearsal runs |
| LLM calls (intelligence tier) | OpenRouter API (`claude-opus-4-8`) | Already wired in ishlab — same routing, same keys |
| Tool calls | Tavily hosted MCP server (`search`) + small self-hosted MCP server (`arch_lookup`) | Search reuses an existing remote MCP server — no backend to write. `arch_lookup` is your own domain data, so it stays self-hosted; also a stronger signal (exposing an internal tool to an agent) than only consuming someone else's server |
| Traces/evals | Langfuse API, **new project** in the existing self-hosted instance | Same instance/infra as your other app, but a separate project + API key so traces don't interleave with the other app's dashboard; use the Agents SDK's Langfuse tracing integration rather than its own dashboard |
| Hosting | ishlab.dev subdomain | Same infra as inference.ishlab.dev |
| Backend | SvelteKit API routes | No separate backend needed — server-side Agents SDK calls from the SvelteKit app |
| State | Svelte stores | Agent execution state, node statuses, HITL pending state |

**Reuse map:**
- Langfuse instance → same self-hosted instance as your other app, new project scoped for this one
- Tavily MCP → existing hosted server, no build

**New work:**
- OpenAI Agents SDK (TS) integration — https://openai.github.io/openai-agents-js/
- Small self-hosted MCP server exposing only `arch_lookup`
- Langfuse: new project + API key for this app
- Node UI for SvelteKit - https://svelteflow.dev/
- 3 agent prompt templates with JSON-structured output
- HITL gate UI (pause + approve/edit)
- Langfuse trace fetch + render in panel

---

## Routing Strategy Toggle

Same as ishlab: a toggle between "Cost: Ollama Cloud (gpt-oss:20b)" and "Intelligence: OpenRouter (claude-opus-4-8)". When toggled:
- Cost mode: all 3 agents use gpt-oss:20b via Ollama Cloud
- Intelligence mode: Qualifier uses gpt-oss:20b via Ollama Cloud, Architect uses claude-opus-4-8 via OpenRouter, Risk Checker uses gpt-oss:20b via Ollama Cloud

This shows you understand cost-optimization in agent pipelines — not every agent needs the most expensive model, and the two-provider split (self-hosted-style open model vs. frontier model) mirrors a real production routing decision rather than just picking two OpenRouter models.

---

## Phased Build

### Phase 1: Backend pipeline (1 day)
- 3 agent prompt templates with JSON output schemas
- OpenRouter integration (copy from ishlab)
- Langfuse trace wrapping (copy from ishlab)
- 2 mock tool endpoints (search, arch_lookup)
- HITL pause/resume state machine
- Run pipeline end-to-end via CLI — verify JSON outputs are correct

**Exit criteria:** `curl localhost:5173/api/run -d '{"prompt":"..."}' | jq` returns structured POC plan with all 3 agents fired, 2 tool calls made, HITL gate triggered, Langfuse traces visible.

### Phase 2: Node diagram UI (1-2 days)
- React Flow (or custom SVG) node graph with 3 agent nodes + 1 HITL node + 2 tool call nodes
- Animate node states: idle → active → complete (lit up border color)
- Tool call nodes expand inline showing the query + result count
- Scenario picker + custom prompt textarea on the left
- Structured output panel on the right

**Exit criteria:** Open browser, pick scenario 1, click run, watch all 3 nodes light up sequentially, see tool calls expand, HITL gate pauses, click approve, final output renders on the right.

### Phase 3: Trace panel + polish (half day)
- Langfuse trace fetch per node (latency, tokens, cost, eval score)
- Render trace panel below diagram
- Pipeline aggregate eval score
- Loading states, error handling, edge cases
- Visual polish: consistent with ishlab design language (dark theme, monospace traces)

**Exit criteria:** Full end-to-end run shows diagram + trace panel + structured output. Langfuse traces match what's displayed. No unhandled errors on any of the 3 scenarios.

### Phase 4: Deploy (half day)
- Caddy reverse proxy config for `agents.ishlab.dev`
- Deploy to homelab Proxmox VM
- Smoke test from external network
- Add to CV as project bullet

**Exit criteria:** `agents.ishlab.dev` loads, runs all 3 scenarios, traces visible in both the app and Langfuse dashboard.

**Total estimate: 3-4 days.**

---

## Risks & Mitigations

The demo now depends on four live external/self-hosted services during a run (Ollama Cloud, OpenRouter, Tavily's hosted MCP server, your own small MCP server) plus Langfuse for traces. That's fine for a homelab side project, but this app's one truly high-stakes run is live, in front of an interviewer — so failure modes deserve explicit handling rather than "restart it" (fine for casual use, not for that one run).

| Risk | Mitigation |
|------|------------|
| Ollama Cloud session/weekly quota exhausted by rehearsal runs before the real interview | Pro tier ($20/mo) for headroom; do a final rehearsal pass the morning of, not the night before, so the quota window is fresh |
| Tavily (or any of the 4 live dependencies) is down/slow/rate-limited during the actual interview | Record a 60-90s screen capture of a clean successful run as a fallback to show if live fails; keep it ready but don't lead with it |
| Cold-start latency on first run (Proxmox VM, self-hosted MCP server, provider warm-up) makes the live demo feel slow in front of the interviewer | Do a throwaway warm-up run a few minutes before the call to prime connections/caches |
| Secrets/API keys (OpenRouter, Ollama Cloud, Tavily, new Langfuse project key) — none of this is specified yet | `.env` on the Proxmox VM, not committed; document which keys are required in the repo README for anyone (including future-you) redeploying |

## Success Metrics

| Metric | Target | How to measure |
|--------|--------|----------------|
| Live demo works | All 3 scenarios complete end-to-end without error | Manual test |
| Langfuse traces present | Every agent run has a trace with eval score | Langfuse dashboard |
| HITL gate fires | Pipeline pauses on every run, user can approve or edit | Manual test |
| Tool calls visible | At least 2 tool call nodes expand in the diagram | Manual test |
| Routing toggle works | Cost vs. intelligence mode changes model selection and is visible in traces | Manual test + Langfuse trace |
| Interview-ready | A hiring manager can open the URL and understand what it does in <30 seconds | Show to a non-technical person |

---

## CV Bullet (after deploy)

```
- **ishlab Agentic Workflow Lab** ([agents.ishlab.dev](https://agents.ishlab.dev)) — live multi-agent orchestration demo (OpenAI Agents SDK) with 3-agent POC qualification pipeline (Qualifier → Architect → Risk Checker), MCP-based tool use (search, pattern lookup), human-in-the-loop gate with approve/edit, cost/intelligence routing toggle (Ollama Cloud ↔ OpenRouter), and Langfuse traceability with per-node eval scoring; deployed on homelab infrastructure.
```

---

## What This Proves (for interviews)

| Interview ask | How this project answers it |
|---------------|---------------------------|
| "Show us something you've built with AI agents" | Live URL — open it, play with it |
| "Build something small with an agent, live" | Already built — can walk through the architecture in real-time |
| "How do you handle agent orchestration?" | 3-agent pipeline with routing, tool use, HITL escalation |
| "Where do agents break?" | Risk Checker agent + Langfuse evals show you know where failures happen |
| "How do you evaluate agent quality?" | Deterministic rubric + Langfuse eval scores per node |
| "How do you manage cost in agent pipelines?" | Routing strategy toggle — not every agent needs the expensive model |
| "Do you understand HITL?" | Explicit pause/approve/edit gate with decision logged in traces |
| "Can you do pre-sales with AI?" | The 3 scenarios are real pre-sales use cases from your deal history |