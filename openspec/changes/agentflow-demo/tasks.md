# 1. Project Setup

- [x] 1.1 Initialize SvelteKit project with TypeScript, Svelte 5, and adapter-node. Verify `npm run dev` starts the dev server at localhost:5173
- [x] 1.2 Install dependencies: `@openai/agents`, `@xyflow/svelte`, `langfuse` SDK. Verify `npm install` completes without errors and `package.json` lists all deps
- [x] 1.3 Create `.env.example` with all required env vars: `OPENROUTER_API_KEY`, `OLLAMA_CLOUD_API_KEY`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `AGENTFLOW_MCP_URL` (`https://agentflow-mcp.fly.dev/mcp` for remote). Note that `BRANDFETCH_API_KEY`, `LOGO_DEV_SECRET_KEY`, `LOGO_DEV_PUBLISHABLE_KEY` are consumed by agentflow-mcp, not agentflow. Verify the file exists and documents each var's purpose
- [x] 1.4 Create a new Langfuse project in the existing self-hosted instance for this app. Verify the project appears in the Langfuse dashboard with its own API keys
- [x] 1.5 Set up project structure: `src/lib/agents/` for agent definitions, `src/lib/mcp/` for MCP client config, `src/lib/pipeline/` for orchestration, `src/routes/api/` for API endpoints, `src/lib/components/` for UI components, `src/styles/` for theme tokens. Verify directories exist
- [x] 1.6 Set up the frontend design system from `docs/design/design.md` + `wireframe.md`: configure `src/styles/theme.css` with the OKLCH color tokens (rebeccapurple, darkcyan, darkgrey, sienna, dodgerblue, palevioletred scales), load Cabin (400/500/600) and Inconsolata (400/500) fonts via Google Fonts, and set up the base typography scale. Verify tokens resolve in Tailwind and fonts load in the browser

# 2. Agent Pipeline Core

- [x] 2.1 Define TypeScript types for each agent's output schema (QualifierOutput, ArchitectOutput, RiskCheckerOutput) matching the JSON schemas in `specs/agent-pipeline/spec.md`. Verify types compile with `npm run check`
- [x] 2.2 Create the Qualifier Agent prompt template and agent definition using `@openai/agents`. The prompt instructs the agent to extract structured requirements from a free-text pre-sales ask. Verify the agent definition imports and instantiates without error
- [x] 2.3 Create the Architect Agent prompt template and agent definition. The prompt instructs the agent to translate structured requirements into a deployment architecture + POC plan. Verify the agent definition imports and instantiates without error
- [x] 2.4 Create the Risk Checker Agent prompt template and agent definition. The prompt instructs the agent to evaluate the POC plan against a rubric with 7 scored dimensions. Verify the agent definition imports and instantiates without error
- [x] 2.5 Configure two model providers in the Agents SDK: Ollama Cloud (`gpt-oss:20b`) and OpenRouter (`claude-opus-4-8`). Verify both providers can be instantiated with their respective API keys from env vars
- [x] 2.6 Implement the routing toggle logic: cost mode (all agents → Ollama Cloud) vs. intelligence mode (Architect → OpenRouter, others → Ollama Cloud). Verify the routing function returns the correct provider for each agent in both modes
- [x] 2.7 Implement the sequential pipeline orchestrator (Qualifier → Architect → Risk Checker) using the Agents SDK, passing each agent's JSON output as the next agent's input. Verify the orchestrator function compiles and exports a `runPipeline(prompt, routingMode)` function
- [x] 2.8 Create the pipeline API endpoint (`POST /api/run`) that accepts `{ prompt, routingMode }` and triggers the pipeline. Verify `curl -X POST localhost:5173/api/run -d '{"prompt":"test","routingMode":"cost"}'` returns a structured response with all 3 agents' outputs
- [x] 2.9 Pre-load the 4 scenarios as prompt constants (Agency, Healthcare, Retail Lakehouse, FSI Governance). Verify the scenario constants match the `docs/mcp/Overview.md` demo scenarios and are importable from the pipeline module

# 3. MCP Tool Integration

- [x] 3.1 Register the agentflow-mcp server as a tool provider at `https://agentflow-mcp.fly.dev/mcp` (HTTP stream transport for remote; stdio for local dev via MCP Inspector). Verify the 4 MCP tools (`arch_pattern_lookup`, `tool_selection_lookup`, `brand_context_lookup`, `risk_policy_lookup`) are discoverable via `scripts/mcp-list-check.ts` or MCP Inspector
- [x] 3.2 Wire the Architect Agent to call `arch_pattern_lookup` with `industry`, `data_stack`, `cloud`, `constraints`, and `latency` (derived from Qualifier output). Verify the tool call returns `pattern_id`, `architecture_summary`, `recommended_components`, `data_zones`, `integration_notes`, `confidence`, `source_references`, and `diagram_data` (for high-confidence matches with confidence >= 0.85)
- [x] 3.3 Wire the Architect Agent to call `tool_selection_lookup` with `use_case`, `data_stack`, `constraints`, and `latency`. Verify the tool call returns `recommended_platform`, `cloud_fit`, `reasoning`, and `alternatives`
- [x] 3.4 Wire the Architect Agent to call `brand_context_lookup` with `domain` (extracted from the scenario or prompt). Verify the tool call returns `company_name`, `domain`, `industry_hint`, `description`, `tags`, `positioning` (`value_proposition`, `target_audience`, `products_and_services`), `brand` (`voice`, `style`), `logo_url`, and `confidence`
- [x] 3.5 Wire the Risk Checker Agent to call `risk_policy_lookup` with `industry`, `data_classification`, `region`, `deployment`, and `constraints`. Verify the tool call returns `required_controls`, `risk_flags`, `hitl_required`, and `review_reason`
- [x] 3.6 Implement graceful fallback for `brand_context_lookup` unavailable: pipeline continues without brand context, architecture diagram renders without branded header. Verify the pipeline completes successfully when `brand_context_lookup` returns unavailable
- [x] 3.7 Implement graceful fallback for low-confidence `arch_pattern_lookup` match (confidence < 0.5): Architect Agent flags weak match, no diagram_data, pipeline continues. Verify a custom prompt that doesn't match any curated pattern completes with a weak-match flag and no diagram
- [x] 3.8 Verify end-to-end MCP integration: run the Healthcare scenario and confirm all MCP tool calls fire (arch_pattern_lookup, tool_selection_lookup, brand_context_lookup, risk_policy_lookup) with correct data flowing between agents

# 4. HITL Gate

- [x] 4.1 Implement the pipeline pause/resume state machine: after Risk Checker completes, pipeline pauses and holds state server-side. Verify the pipeline API endpoint returns a "paused" status with the HITL gate data (risks, POC plan, review_reason) when HITL is triggered
- [x] 4.2 Implement HITL trigger logic: gate triggers when `risk_policy_lookup` returns `hitl_required=true` OR Risk Checker flags any high-severity risk. Verify the trigger logic evaluates both conditions correctly
- [x] 4.3 Implement the approve action (`POST /api/hitl/approve`): pipeline resumes and produces final output using the agent-produced plan unchanged. Verify approving the gate returns the final structured POC plan
- [x] 4.4 Implement the edit action (`POST /api/hitl/edit`): user submits modified POC plan JSON, modified plan becomes final output. Verify editing the gate returns the modified plan as final output
- [x] 4.5 Log the HITL decision to Langfuse as an eval-able event, including decision type (approve/edit), human latency (time from gate display to action), and diff (when edited). Verify the HITL event appears in Langfuse traces with decision and latency
- [x] 4.6 Verify HITL gate fires for the Healthcare scenario (PHI → hitl_required=true from risk_policy_lookup) and the FSI Governance scenario (regulated financial data → hitl_required=true), and the gate displays the review_reason and high-severity risks for both

# 5. Langfuse Tracing

- [x] 5.1 Configure the Agents SDK's Langfuse tracing integration with the app's dedicated Langfuse project keys. Verify the SDK is initialized with the correct public/secret keys from env vars
- [x] 5.2 Verify each agent run produces a Langfuse trace with latency, token count, cost, and metadata. Run the pipeline and confirm 3 traces appear in the Langfuse dashboard
- [x] 5.3 Verify the Langfuse traces are scoped to this app's project and do not interleave with other apps on the same instance. Confirm traces only appear in the agentflow Langfuse project dashboard

# 6. Node Diagram UI

- [x] 6.1 Set up the three-column layout (Chat 25% / Pipeline 50% / Output 25%) with `divide-x-2` column dividers. In the Pipeline column, split vertically: node graph (flex: 3) above, trace + token stream panel (flex: 1) below, separated by `border-b-2`. Verify the three columns render at the correct proportions and the Pipeline column splits vertically
- [x] 6.2 Set up the Svelte Flow canvas with 4 nodes in sequence (Qualifier → Architect → Risk Checker → HITL Gate) connected vertically via ConnectorLine components. Create NodeCard components with 5 states (idle: darkcyan border/grey dot, running: rebeccapurple border + glow + pulsing StatusDot, done: darkcyan + CheckCircle2, warning: sienna + AlertTriangle, paused: sienna + amber glow + AlertTriangle). Verify all 4 nodes render with correct labels and ConnectorLines animate scaleY 0→1
- [x] 6.3 Implement live agent state transitions: nodes transition through idle → running → done sequentially with visible border/glow/StatusDot changes per the design system. Verify triggering a pipeline run causes nodes to light up sequentially (one `running` at a time) and transition to `done` as each completes. The HITL node enters `paused` state when reached
- [x] 6.4 Implement tool calls as collapsible rows inside agent NodeCards (not separate tool-call nodes). Each row shows Zap icon + `tool_name()` + ChevronDown; expanding reveals result text with `→` prefix, animated via AnimatePresence (height). Verify `arch_pattern_lookup`, `tool_selection_lookup`, and `brand_context_lookup` rows appear inside the Architect NodeCard and expand/collapse correctly
- [x] 6.5 Implement a running progress indicator on each agent NodeCard: a step count (e.g., `2/4`) + a row of step markers that fill as each execution task completes (completed: `darkcyan-600` CheckCircle2; active: pulsing `rebeccapurple-500`; pending: `darkgrey-400`). The NodeCard expands vertically as each task's detail row appears. Steps are agent-specific (Architect: arch_pattern_lookup, tool_selection_lookup, brand_context_lookup, synthesize plan = 4; Risk Checker: risk_policy_lookup, evaluate rubric, produce assessment = 3; Qualifier: extract requirements = 1). Verify the Architect NodeCard shows the count advancing 1/4 → 2/4 → 3/4 → 4/4 and expands with each row during a run
- [x] 6.6 Build the chat panel (Col 1): quick scenario buttons fixed at top (4 scenarios, disabled during run), `hr` divider, "Agent Chat" header, scrollable conversation thread (user bubbles right-aligned purple `rounded-br-sm`, system bubbles left-aligned grey `rounded-bl-sm`, anchor to bottom/grow upward), input row + send button (`w-9 h-9`) pinned to bottom with `border-t-2`, Enter submits / Shift+Enter newline, "← New conversation" reset link after a run. Verify clicking a scenario button sends it as a user message and starts the pipeline; verify typing + Enter sends a custom message and starts the pipeline
- [x] 6.7 Implement the "← New conversation" reset: clicking it clears the conversation thread and resets the node diagram, trace panel, and output panel to idle. Verify all panels reset after clicking it
- [ ] 6.8 Implement the routing strategy toggle UI (Cost vs. Intelligence). Verify toggling the mode changes the label and the next pipeline run uses the selected routing
- [x] 6.9 Build the structured output panel (Col 3): renders final POC plan (use cases, success criteria, exit criteria, risks, architecture summary) with staggered `motion` entrance (`delay: si * 0.12`), `rebeccapurple-500` bullet dots, "POC Plan" heading with `darkcyan` "draft" pill. Panel returns `null` until pipeline completes. Verify the output renders after pipeline completion (post-HITL approval) with the staggered animation
- [x] 6.10 Implement the HITL gate UI inside the HITL NodeCard: `paused` state (sienna border + amber glow), "PAUSED — awaiting review" text, Approve (primary) / Edit (ghost) buttons, risk summary, proposed POC plan. No auto-advance — the gate waits for explicit action. Verify the HITL UI appears when the pipeline pauses and both buttons are functional
- [x] 6.11 Implement the LLMStreamBlock per agent: simulated token stream at 3 chars / 18ms, blinking `rebeccapurple-500` cursor while streaming, `CheckCircle2` in `darkcyan-600` when done, card header `bg-darkgrey-200/50`. Verify each agent's output streams progressively with the blinking cursor during execution
- [x] 6.12 Verify full UI flow end-to-end: open browser, click a scenario quick-button (sends chat message), watch all 4 nodes light up sequentially (Qualifier → Architect → Risk Checker → HITL Gate), see tool calls expand inside the Architect NodeCard, HITL gate pauses (no auto-advance), click approve, final output renders on the right with staggered animation

# 7. Trace Panel

- [ ] 7.1 Implement a Langfuse API client that fetches trace data for a given pipeline run. Verify the client authenticates and returns trace data from the Langfuse API
- [ ] 7.2 Create the trace panel component below the node diagram as a `rounded-xl border border-darkgrey-400 bg-darkgrey-100/60` card. One row per agent: status icon · label · latency · cost · ✓/⚠. Footer shows totals: time · cost · eval. Verify the panel renders with a header and empty state before a pipeline run
- [ ] 7.3 Render per-node trace data: each agent row shows agent name, latency (seconds), token count, cost (USD), and eval score. Verify the 3 agent rows appear with correct data after a pipeline run
- [ ] 7.4 Tool calls do not appear in the trace panel (they appear as collapsible rows inside agent NodeCards). Verify no tool-call child rows render in the trace panel
- [ ] 7.5 Render the HITL trace row showing human latency and decision (approved/edited). Verify the HITL row appears after the user acts at the gate
- [ ] 7.6 Render the pipeline aggregate row showing total compute time, total cost, and pipeline eval score. Verify the aggregate row sums agent latencies and costs correctly
- [ ] 7.7 Implement real-time trace updates: trace rows appear as each node completes, not all at once. Verify the Qualifier trace row appears immediately when the Qualifier completes, before the Architect finishes
- [ ] 7.8 Verify trace data in the panel matches traces visible in the Langfuse dashboard for the same run. Compare latency, tokens, and cost values between the panel and dashboard

# 8. Architecture Diagram Rendering

- [ ] 8.1 Implement the diagram_data → SVG renderer following the architecture-diagram skill design system (`docs/agent/architecture-diagram/SKILL.md`): dark theme, grid background, JetBrains Mono font, rounded component rects. Verify a test diagram renders as standalone HTML with inline CSS/SVG
- [ ] 8.2 Implement component rendering from `diagram_data.components`: each component renders as a rounded rect with name, sublabel, and zone, using the double-rect masking technique. Verify components render with correct positioning and labels
- [ ] 8.3 Apply the semantic component color palette: cyan=frontend, emerald=backend, violet=database, amber=cloud, rose=security, orange=message bus, slate=external. Verify database components use violet and security components use rose
- [ ] 8.4 Implement connection rendering from `diagram_data.connections`: arrows with labels, dashed rose for security flows. Verify connections render as arrows with correct labels and styles
- [ ] 8.5 Implement boundary rendering from `diagram_data.boundaries`: large dashed amber boxes for regions. Verify boundary boxes render around the correct components
- [ ] 8.6 Implement the branded diagram header: company logo (from `brand_context_lookup` logo_url) and company name. Brand colors used only for header accent, not components. Verify the header shows logo + name for a scenario with brand context
- [ ] 8.7 Implement fallback when no diagram_data (low-confidence match): no diagram rendered, UI indicates no diagram available. Verify a custom prompt with no pattern match shows no diagram and a weak-match indicator
- [ ] 8.8 Implement fallback when brand context unavailable: diagram renders with default header (pattern name or scenario name), no logo. Verify a diagram renders without a logo when brand_context_lookup returns unavailable
- [ ] 8.9 Verify the Healthcare and FSI Governance scenarios render full architecture diagrams with components, connections, boundaries, and branded headers (matching the healthcare_patient_insights and fsi_governance_copilot patterns from the MCP)

# 9. Deployment

- [ ] 9.1 Configure Fly.io deployment (`fly.toml`) for the SvelteKit app with `adapter-node`. Verify the app deploys via `fly deploy` and is accessible on the Fly.io domain with automatic TLS
- [ ] 9.2 Configure custom domain `agents.ishlab.dev` on Fly.io. Verify the domain resolves and serves the app with automatic TLS
- [ ] 9.3 Smoke test from an external network: open `agents.ishlab.dev` in a browser. Verify the page loads and the chat panel is visible
- [ ] 9.4 Run all 4 scenarios end-to-end on the deployed instance. Verify each scenario completes without errors: pipeline runs, HITL gate fires, final output renders, traces appear in both the app and Langfuse dashboard
- [ ] 9.5 Record a 60-90s screen capture of a clean successful run as a fallback for interviews. Verify the recording exists and shows a full pipeline run from scenario selection to final output

# 10. UI Refinement — Decluttered Layout (phase 6 follow-up)

- [x] 10.1 Remove the Qualifier, Architect, and Risk Checker card UI (step progress, tool-call detail rows) from the node graph; render all four pipeline stages as compact, readable nodes (agents 160px, HITL gate 200px)
- [x] 10.2 Expand the Trace Summary to the full width of the pipeline column and add a totals footer (total time · cost · eval); remove the LLMStreamBlock row from the layout
- [x] 10.3 Remove the right-hand "Awaiting Results" output column; switch the layout to a two-column grid (Chat / Pipeline 1fr)
- [x] 10.4 Add Chat / Results tabs to the agent chat panel; the POC plan output renders in the Results tab (with the "Awaiting Results" empty state until a run completes)
- [x] 10.5 Keep the HITL gate interaction (Approve / Edit, risk summary, review reason, proposed plan) inside the compact HITL node card
- [x] 10.6 Default the node graph viewport to fit-then-one-click-out on load (fitView + zoomOut in oninit)
- [x] 10.7 Widen the Chat column to 360px; move node subtitles to hover tooltips (visible paragraph removed)
- [x] 10.8 Restructure Langfuse tracing to one trace per pipeline run (`agentflow.pipeline`, sessionId = runId) with nested per-agent observations; enrich trace records with token count, estimated cost, and eval score
