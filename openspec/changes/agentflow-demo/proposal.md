## Why

The candidate's portfolio has strong infrastructure proof (routing, evals, traces) but no showable demo of **multi-agent orchestration, tool use, and HITL escalation** — the core competency every agentic/forward-deployed role tests for (Akkio, Anthropic, Sierra, Decagon, Vapi). A live, interactive URL where a recruiter opens the page and immediately sees systems-level thinking is the strongest possible answer to "build something small with an agent, live."

## What Changes

- Build a 3-agent sequential pipeline (Qualifier → Architect → Risk Checker) using the OpenAI Agents SDK (TypeScript), where each agent receives the previous agent's structured JSON output and produces its own
- Integrate the agentflow-mcp server (4 tools called by Architect and Risk Checker agents) as an external MCP tool provider — the server is now built and deployed at `agentflow-mcp.fly.dev/mcp` (Fly.io, HTTP stream transport; stdio for local dev). This change consumes its tools but does not build the server, source pack, or brand caching layer. The Qualifier Agent is a pure reasoning step with no tool calls.
- Implement a model routing toggle: cost mode (all agents use `gpt-oss:20b` via Ollama Cloud) vs. intelligence mode (Architect uses `claude-opus-4-8` via OpenRouter, others use `gpt-oss:20b`)
- Add a human-in-the-loop gate that pauses the pipeline after the Risk Checker produces its evaluation — user can approve or edit the POC plan before final output
- Wrap every agent run in Langfuse traces (latency, tokens, cost, eval scores) in a new Langfuse project scoped to this app
- Build a SvelteKit frontend (design system in `docs/design/design.md` + `wireframe.md`: Cabin/Inconsolata typography, OKLCH color tokens, 3-column chat/pipeline/output layout) with a Svelte Flow node diagram showing agents lighting up sequentially, tool calls expanding inline as collapsible rows inside agent node cards, a chat panel (conversation thread, scenario quick-buttons, chat input), structured output panel
- Render per-agent Langfuse trace data (latency, tokens, cost, eval score) as a progress row per agent in a trace panel below the diagram
- Render a dark-themed SVG architecture diagram from `diagram_data` returned by agentflow-mcp's `arch_pattern_lookup` tool, branded with the company logo from `brand_context_lookup`
- Pre-load 4 scenarios from `docs/mcp/Overview.md` demo scenarios (Agency, Healthcare, Retail Lakehouse, FSI Governance) — each maps to a curated MCP pattern with high confidence
- Deploy to Fly.io with a custom domain (agents.ishlab.dev)

### Assumptions

- **Scenarios**: Using the 4 demo scenarios from `docs/mcp/Overview.md` (Agency, Healthcare, Retail Lakehouse, FSI Governance) — each maps to a curated MCP pattern with high confidence and exercises the full pipeline including HITL. The fallback path (low-confidence match) is exercised by custom prompts that don't match any curated pattern.
- **Tavily removed**: The Qualifier Agent is a pure reasoning step with no tool calls, per the agentflow-mcp diagram (Qualifier makes no MCP calls). Tavily search was dropped to simplify the demo and remove a non-deterministic external dependency. Tool-use is demonstrated by the Architect Agent's 3 MCP tool calls.
- **Architecture diagram**: Included per the agentflow-mcp integration contract — the Architect Agent passes `diagram_data` to the architecture-diagram skill and renders a branded SVG.
- **agentflow-mcp**: Built and deployed (Fly.io at `agentflow-mcp.fly.dev/mcp`, HTTP stream transport; stdio for local dev via MCP Inspector). Tool I/O contracts are defined in `docs/mcp/Overview.md`. This change consumes its tools but does not build the server, source pack (102 markdown files), or brand caching layer (Brandfetch + logo.dev).

## Capabilities

### New Capabilities
- `agent-pipeline`: 3-agent sequential pipeline (Qualifier → Architect → Risk Checker) with structured JSON I/O between agents, model routing toggle (cost vs. intelligence), and Langfuse tracing per agent run
- `mcp-tool-integration`: MCP client registration and tool calling — Architect calls `arch_pattern_lookup` + `tool_selection_lookup` + `brand_context_lookup`, Risk Checker calls `risk_policy_lookup`; includes graceful fallback handling for unavailable tools and low-confidence matches. The Qualifier Agent makes no tool calls.
- `hitl-gate`: Pipeline pause/resume state machine after Risk Checker evaluation — user approves or edits the POC plan, decision and diff logged to Langfuse as an eval-able event
- `pipeline-ui`: SvelteKit frontend (design system: `docs/design/design.md` + `wireframe.md`) — Svelte Flow node diagram with live agent states (idle → running → done, plus warning/paused) rendered as compact nodes, full-width trace summary, tabbed chat panel (conversation thread, scenario quick-buttons, chat input, results tab)
- `trace-panel`: Per-agent progress rows (status icon, label, latency, cost, eval score) with pipeline aggregate footer, fetched via Langfuse API
- `architecture-diagram`: Dark-themed SVG architecture diagram rendering from MCP `diagram_data` (components, connections, boundaries) combined with brand logo from `brand_context_lookup`, rendered via the architecture-diagram skill as inline HTML

### Modified Capabilities
<!-- No existing capabilities — this is a new project. -->

## Impact

- **New codebase**: SvelteKit app (frontend + API routes for backend pipeline execution)
- **Dependencies**: `@openai/agents` (Agents SDK), Svelte Flow, Langfuse SDK, MCP client libraries
- **External services**: Ollama Cloud (gpt-oss:20b), OpenRouter API (claude-opus-4-8), agentflow-mcp server (built + deployed at `agentflow-mcp.fly.dev/mcp`), self-hosted Langfuse instance (new project + API key)
- **Existing reuse**: Langfuse instance (same self-hosted infra, new project), OpenRouter keys (already wired in ishlab), ishlab.dev subdomain
- **Deployment**: Fly.io (adapter-node), custom domain `agents.ishlab.dev`, `.env` for secrets (not committed)
- **Environment variables**: `OPENROUTER_API_KEY`, `OLLAMA_CLOUD_API_KEY` (or equivalent), `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `AGENTFLOW_MCP_URL` (`https://agentflow-mcp.fly.dev/mcp` for remote; stdio config for local). For local MCP dev, the brand keys (`BRANDFETCH_API_KEY`, `LOGO_DEV_SECRET_KEY`, `LOGO_DEV_PUBLISHABLE_KEY`) are consumed by agentflow-mcp, not agentflow.
