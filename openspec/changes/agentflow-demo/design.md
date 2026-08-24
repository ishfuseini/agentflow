## Context

This is a greenfield SvelteKit project. The repo currently contains only planning docs (`docs/PRD.md`, `docs/mcp/Overview.md`, `docs/agent/`) and an initialized OpenSpec directory. No code exists yet.

The project reuses existing infrastructure: a self-hosted Langfuse instance (new project scoped for this app), OpenRouter API keys (already wired in ishlab), and ishlab.dev subdomain. The agentflow-mcp server is a separate project consumed as an external MCP tool provider — this change does not build it.

Key reference documents:
- `docs/PRD.md` — full product requirements, visual layout, agent I/O schemas, tech stack, phased build plan
- `docs/mcp/Overview.md` — agentflow-mcp tool contracts, integration contract, environment variables
- `docs/agent/architecture-diagram/SKILL.md` — design system for SVG diagram rendering (color palette, layout, template)

## Goals / Non-Goals

**Goals:**
- Build a working end-to-end demo where a user picks a scenario, watches 3 agents fire sequentially, sees tool calls expand, hits a HITL gate, and gets a structured POC plan — all with live Langfuse traces
- Use the OpenAI Agents SDK (`@openai/agents`) as the orchestration layer, with MCP client support and HITL primitives
- Render a live Svelte Flow node diagram that visually communicates agent orchestration to a non-technical viewer in <30 seconds
- Demonstrate cost-optimized model routing (not every agent needs the expensive model)
- Deploy to Fly.io at `agents.ishlab.dev`

**Non-Goals:**
- Build the agentflow-mcp server or its source pack (separate project)
- Multi-tenant, auth, persistence — single-user demo app
- More than 3 agents — diagram clarity beats pipeline complexity
- Mobile-responsive design — interviewers open this on laptops
- Production reliability — if it's down, restart it; it's a demo
- General-purpose agent framework — 3 fixed agents, not a LangGraph competitor

## Decisions

### 1. SvelteKit as full-stack framework

**Choice:** SvelteKit (TypeScript) for both frontend and backend.

**Rationale:** Already familiar with SvelteKit from prior work. SvelteKit API routes handle server-side Agents SDK calls — no separate backend needed. Svelte stores manage agent execution state, node statuses, and HITL pending state without adding a state management library.

**Alternatives considered:**
- Next.js (React) — would work, but Svelte Flow is the node diagram library of choice and SvelteKit is the natural fit
- Separate Express/Hono backend + SvelteKit frontend — unnecessary complexity for a demo; SvelteKit API routes suffice

### 2. OpenAI Agents SDK for orchestration

**Choice:** `@openai/agents` (TypeScript) for agent definitions, tool calling, and HITL.

**Rationale:** TS-native, provider-agnostic (works with OpenRouter and Ollama Cloud), built-in MCP client support, and HITL primitives. The SDK's Langfuse tracing integration handles trace wrapping without custom instrumentation. The SDK is designed for exactly this pattern: sequential agents with handoffs and tool use.

**Alternatives considered:**
- LangGraph (Python) — would require a separate Python backend, breaking the single-app SvelteKit model
- Letta (agent OS) — too heavy for a 3-agent demo; stateful agent-OS adds complexity without value
- Raw fetch calls to LLM APIs — would need to build MCP client, tracing, and HITL from scratch

### 3. MCP integration via SDK's built-in MCP client

**Choice:** Use the Agents SDK's built-in MCP client to register the agentflow-mcp server. The server is built and deployed at `agentflow-mcp.fly.dev/mcp` (HTTP stream transport for remote; stdio for local dev via MCP Inspector).

**Rationale:** The SDK already knows how to call MCP tools, parse responses, and handle errors. Agents declare which tools they can call; the SDK handles the protocol. This avoids writing a custom MCP client. The server (FastMCP v4 + TypeScript, 102-file source pack, Brandfetch + logo.dev caching) is a separate project whose I/O contracts are defined in `docs/mcp/Overview.md`.

The integration contract from `docs/mcp/Overview.md`:
- Qualifier Agent: no tool calls (pure reasoning step)
- Architect Agent: `arch_pattern_lookup` (input: `industry`, `data_stack`, `cloud`, `constraints`, `latency`), `tool_selection_lookup` (input: `use_case`, `data_stack`, `constraints`, `latency`), `brand_context_lookup` (input: `domain`)
- Risk Checker Agent: `risk_policy_lookup` (input: `industry`, `data_classification`, `region`, `deployment`, `constraints`)
- `diagram_data` from `arch_pattern_lookup` → passed to architecture-diagram rendering
- `hitl_required` + `review_reason` from `risk_policy_lookup` → triggers HITL gate
- Matching is deterministic, rules-based: industry match (40%) → data stack overlap (30%) → constraint coverage (30%). Curated matches (confidence >= 0.85) include `diagram_data` + `source_references`. Weak matches fall back to a generic enterprise AI POC pattern with confidence < 0.5.

**Alternatives considered:**
- Direct HTTP calls to MCP server endpoints — would need to implement MCP protocol manually
- Hardcode tool responses as mock data — loses the MCP protocol proof point

### 4. Svelte Flow for node diagram

**Choice:** Svelte Flow (`@xyflow/svelte`) for the interactive node graph.

**Rationale:** Purpose-built for node-graph UIs in Svelte. Supports custom node types, animated edges, and programmatic node state updates — exactly what's needed for agents lighting up sequentially with tool call expansion.

**Alternatives considered:**
- Custom SVG — more control but more work; Svelte Flow handles layout, panning, zooming for free
- D3.js — too low-level for this use case; would need to build node rendering and interaction from scratch

### 5. Langfuse tracing via SDK integration

**Choice:** Use the Agents SDK's Langfuse tracing integration. Create a new Langfuse project (separate API key) in the existing self-hosted Langfuse instance.

**Rationale:** The SDK handles trace creation per agent run automatically. A separate project ensures traces don't interleave with other apps on the same Langfuse instance. The trace panel fetches data via the Langfuse API, ensuring what's displayed matches the dashboard.

**Alternatives considered:**
- Custom OpenTelemetry instrumentation — redundant; the SDK already does this
- Langfuse's own dashboard as the only trace view — the PRD requires an in-app trace panel, not just a dashboard link

### 6. HITL as a state machine with pause/resume

**Choice:** Implement HITL as a pipeline pause/resume state machine. The pipeline runs Qualifier → Architect → Risk Checker, then pauses. The SvelteKit API route holds the pipeline state in a Svelte store (server-side). When the user approves or edits, the pipeline resumes to produce final output.

**Rationale:** The Agents SDK has HITL primitives. The pipeline needs to persist state across the HTTP request boundary (run pipeline → pause → user acts → resume). Svelte stores on the server side handle this for a single-user demo. No database needed.

**Alternatives considered:**
- Database-backed pipeline state — unnecessary for a single-user demo
- WebSocket-based real-time pipeline — adds complexity; the pipeline runs in seconds, so HTTP request/response with polling or SSE for streaming is sufficient

### 7. Streaming via Server-Sent Events (SSE)

**Choice:** Use SSE for streaming agent output to the frontend during pipeline execution.

**Rationale:** Agents stream tokens as they generate. SSE is simpler than WebSocket for one-way server-to-client streaming. SvelteKit supports SSE via API route streams. The trace panel and node diagram updates can also flow through SSE.

**Alternatives considered:**
- WebSocket — bidirectional, but the client doesn't need to send mid-stream messages (HITL is a separate HTTP request)
- Polling — simpler but doesn't give the real-time feel that makes the demo compelling

### 8. Architecture diagram rendering via the architecture-diagram skill

**Choice:** Use the architecture-diagram skill (`docs/agent/architecture-diagram/SKILL.md`) to render SVG diagrams from `diagram_data`. The skill defines a dark-themed design system with semantic component colors. The diagram is rendered as a standalone HTML file with inline CSS/SVG.

**Rationale:** The skill already exists in the repo and defines the exact visual language (color palette, typography, layout, connection rules). The `docs/mcp/Overview.md` integration contract specifies passing `diagram_data` to this skill. Using the skill ensures visual consistency.

The rendering flow:
1. Architect Agent calls `arch_pattern_lookup`, receives `diagram_data` (components, connections, boundaries)
2. Architect Agent calls `brand_context_lookup`, receives `logo_url` and `company_name`
3. Pipeline passes `diagram_data` + `logo_url` + `company_name` to the architecture-diagram renderer
4. Renderer produces an inline HTML/SVG diagram displayed in the structured output panel

**Alternatives considered:**
- Mermaid.js — different visual style; the architecture-diagram skill's dark theme matches the ishlab design language
- Structured JSON only (no visual diagram) — loses the visual proof point for interviews

### 9. Model routing via SDK provider configuration

**Choice:** Configure two model providers in the Agents SDK: Ollama Cloud (`gpt-oss:20b`) and OpenRouter (`claude-opus-4-8`). The routing toggle determines which provider each agent uses. In cost mode, all agents use Ollama Cloud. In intelligence mode, the Architect uses OpenRouter while Qualifier and Risk Checker use Ollama Cloud.

**Rationale:** The SDK is provider-agnostic. The toggle demonstrates cost optimization: the Architect (which needs reasoning power) gets the frontier model, while the Qualifier (extraction) and Risk Checker (evaluation) use the cheaper model. This mirrors a real production routing decision.

**Alternatives considered:**
- All agents via OpenRouter — loses the cost-optimization proof point
- All agents via Ollama Cloud — loses the intelligence-tier proof point and the two-provider split

### 10. Deployment: Fly.io

**Choice:** Deploy the SvelteKit app to Fly.io with `adapter-node` at `agents.ishlab.dev`.

**Rationale:** Fly.io provides a full Node.js runtime (compatible with the OpenAI Agents SDK), long-running process for HITL state, and automatic TLS. The app runs as a Node.js process via SvelteKit's adapter-node. Fly.io's persistent VM handles the HITL gate's server-side state without external storage.

**Alternatives considered:**
- Cloudflare Pages/Workers — serverless runtime complicates HITL state management (no in-memory persistence between requests); Workers runtime may have Node.js API compatibility issues with the Agents SDK
- Vercel — would work, but serverless functions complicate HITL state persistence
- Homelab Proxmox — original plan, but cloud-hosted is simpler and more reliable for a demo

### 11. Frontend design system (binding)

**Choice:** The frontend follows the design system in `docs/design/design.md` + `wireframe.md`.

**Rationale:** These docs define the binding visual language — typography (Cabin for headings, Inconsolata for body/UI), OKLCH color tokens (`rebeccapurple`, `darkcyan`, `darkgrey`, `sienna`, `dodgerblue`, `palevioletred` scales defined in `src/styles/theme.css`), a 3-column layout (Chat 25% / Pipeline 50% / Output 25%), and a component inventory (NodeCard, ConnectorLine, TracePanel, LLMStreamBlock, OutputPanel, ChatPanel). The specs reference this design system as the authoritative visual spec; deviations require updating `docs/design/design.md` first.

**Key binding decisions captured by the design system:**
- **Chat-based interaction (Col 1):** The thread opens with an entry system bubble naming the three agents, the MCP tool step, and the HITL gate, plus a descriptive input placeholder. Scenarios are quick buttons that send a pre-built message into a conversation thread. User/system chat bubbles (right-aligned purple / left-aligned grey). Agent results and the final plan surface as system bubbles in the thread, not status lines alone. Single-row input + send button (Enter submits, Shift+Enter newline). Chat / Results tabs, with the panel auto-switching to Results when the run completes. "← New conversation" reset after a run.
- **Node graph topology:** Orchestrator hub — an Orchestrator node dispatches to Qualifier, Architect, Risk Checker, and the HITL Gate via numbered, labelled edges (`1 qualify` … `4 review`) with return edges, plus an MCP Tools node reached by dashed edges from the Architect and Risk Checker only. The flat 4-node chain in earlier drafts left the caller and the call order implicit; the hub makes both readable at a glance.
- **Node states:** 5 states — `idle`, `running`, `done`, `warning`, `paused` (not the 3-state model in earlier drafts). StatusDot indicators: pulsing purple ping for running, CheckCircle2 for done, AlertTriangle for warning/paused.
- **Tool calls and step progress:** Agent NodeCards show a step counter (e.g. `2/4`) + step markers, and each completed step appends a detail row. Tool-call steps are collapsible rows *inside* the NodeCard (not separate tool-call nodes, not trace-panel child rows). Each shows Zap icon + `name()` + ChevronDown; expand reveals result text with `→` prefix.
- **HITL gate (inside the HITL NodeCard):** Shows "PAUSED — awaiting review" + Approve (primary) / Edit (ghost) buttons. No auto-advance — the gate always waits for explicit user action.
- **TracePanel:** Flat Langfuse observation table — one row per observation (name · type · latency · tokens · cost · level), chronological, no per-agent grouping — + footer totals (time · cost · eval). No tool-call child rows; tool detail lives in the agent NodeCards.
- **LLMStreamBlock:** Per-agent simulated token stream (3 chars / 18ms) with blinking purple cursor while streaming, CheckCircle2 when done.
- **Architecture diagram:** Dark-themed SVG (from the architecture-diagram skill) embedded in the OutputPanel — distinct from the light-themed app chrome.

**Alternatives considered:**
- Form-based UI (scenario picker + custom prompt textarea + Run Pipeline button) — earlier draft; the chat-based model is more engaging for a live demo and lets scenarios and custom prompts share one input surface

## Risks / Trade-offs

**[Demo depends on 3+ live external services during a run]** → Ollama Cloud, OpenRouter, agentflow-mcp, Langfuse. If any is down during an interview, the demo breaks. Mitigation: Record a 60-90s screen capture of a clean run as fallback. Do a warm-up run before the interview to prime connections.

**[Ollama Cloud quota exhaustion]** → Rehearsal runs could exhaust the weekly quota before the real interview. Mitigation: Pro tier ($20/mo) for headroom. Do final rehearsal the morning of, not the night before.

**[Cold-start latency]** → First run after Fly.io VM boot may feel slow (provider warm-up, MCP server cold start). Mitigation: Throwaway warm-up run a few minutes before the call.

**[agentflow-mcp availability]** → The MCP server is deployed at `agentflow-mcp.fly.dev/mcp` (Fly.io, scale-to-zero when idle). If it's down or cold, the Architect and Risk Checker agents can't call their tools. Mitigation: The MCP integration contract specifies graceful fallbacks (brand context unavailable, low-confidence pattern match). For local dev, the MCP runs via stdio (MCP Inspector). Do a warm-up run before the interview to wake the Fly.io instance. The MCP server has its own health checks (`scripts/mcp-list-check.ts` verifies all 4 tools are discoverable).

**[Single-user state (no persistence)]** → Pipeline state lives in Svelte stores on the server. If the server restarts mid-pipeline, state is lost. This is acceptable for a demo — restart and re-run. Not acceptable for production, but that's a non-goal.

**[HITL state across HTTP requests]** → The pipeline pauses at HITL, and the user's approve/edit is a separate HTTP request. The server must hold pipeline state between requests. Svelte stores work for single-user, but concurrent users would collide. Acceptable for a demo (single user), not for production.

## Migration Plan

No migration needed — this is a greenfield project. Deployment steps:

1. Initialize SvelteKit project with TypeScript
2. Install dependencies: `@openai/agents`, `@xyflow/svelte`, Langfuse SDK, MCP client libraries
3. Configure environment variables in `.env` (not committed): `OPENROUTER_API_KEY`, `OLLAMA_CLOUD_API_KEY`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `AGENTFLOW_MCP_URL` (`https://agentflow-mcp.fly.dev/mcp` for remote). For local MCP dev, set `BRANDFETCH_API_KEY`, `LOGO_DEV_SECRET_KEY`, `LOGO_DEV_PUBLISHABLE_KEY` (consumed by the MCP, not agentflow).
4. Create new Langfuse project for this app; obtain API keys
5. Build and test locally (stdio transport for agentflow-mcp via MCP Inspector)
6. Deploy to Fly.io: `fly deploy` with `adapter-node`
7. Configure custom domain `agents.ishlab.dev` on Fly.io
8. Smoke test from external network
9. Pre-populate brand context cache for demo domains (if using Brandfetch)

Rollback: Stop the Fly.io app. The app is stateless (no database), so rollback is just stopping the app. No data loss possible.

## Open Questions

1. **Ollama Cloud API specifics** — What's the exact API endpoint and auth model for Ollama Cloud? The PRD says "Ollama Cloud (gpt-oss:20b)" but the exact SDK provider configuration depends on Ollama Cloud's API format. This can be resolved during implementation by checking Ollama Cloud docs.

2. ~~**agentflow-mcp deployment URL**~~ — **Resolved.** The MCP server is built and deployed at `https://agentflow-mcp.fly.dev/mcp` (Fly.io, HTTP stream transport; scale-to-zero when idle). `AGENTFLOW_MCP_URL` is set to this value. For local dev, stdio transport via MCP Inspector.

3. **Svelte Flow custom node complexity** — How much custom styling is needed for Svelte Flow nodes to match the PRD's visual layout? Svelte Flow supports custom node components, but the exact effort depends on the animation requirements (border color transitions, tool call expansion). This can be refined during Phase 2 implementation.

4. ~~**Brandfetch API key**~~ — **Resolved.** `docs/mcp/Overview.md` documents three brand keys (`BRANDFETCH_API_KEY`, `LOGO_DEV_SECRET_KEY`, `LOGO_DEV_PUBLISHABLE_KEY`) used by agentflow-mcp's `brand_context_lookup` with layered caching (Brandfetch `cachedOnly=true` + local file cache with TTL). When keys are missing, the tool returns cached data for cached domains or a graceful unavailable response. The agentflow app does not need these keys; they live on the MCP server's Fly.io deployment. Pre-warm the brand cache for the 4 demo domains via `scripts/brand-cache-warm.ts` before the interview.
