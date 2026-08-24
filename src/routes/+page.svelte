<script lang="ts">
  import "@xyflow/svelte/dist/style.css";
  import {
    Background,
    BackgroundVariant,
    Controls,
    type Edge,
    type EdgeTypes,
    type Node,
    type NodeTypes,
    SvelteFlow,
  } from "@xyflow/svelte";
  import { onDestroy, onMount } from "svelte";
  import type {
    ArchitectOutput,
    PocPlan,
    QualifierOutput,
    RiskCheckerOutput,
  } from "$lib/agents/types";
  import AgentNodeCard from "$lib/components/pipeline/agent-node-card.svelte";
  import ChatPanel from "$lib/components/pipeline/chat-panel.svelte";
  import ConnectorEdge from "$lib/components/pipeline/connector-edge.svelte";
  import TracePanel from "$lib/components/pipeline/trace-panel.svelte";
  import type {
    AgentId,
    AgentNodeData,
    AgentNodeState,
    ChatMessage,
    FinalPocOutputView,
    HitlCompletionResponse,
    PipelineView,
    TraceObservationRow,
    TraceTotals,
  } from "$lib/components/pipeline/types";
  import {
    type DiagramUnavailableReason,
    diagramSourceFromToolCalls,
    renderDiagramHtml,
  } from "$lib/diagram/render";
  import type { RunTraceSummary } from "$lib/pipeline/langfuse";
  import type { RoutingMode } from "$lib/pipeline/routing";

  const nodeTypes: NodeTypes = {
    agent: AgentNodeCard,
  };
  const edgeTypes: EdgeTypes = {
    connector: ConnectorEdge,
  };
  /**
   * Top-down flow: HITL (user) at top, Orchestrator below,
   * agents in horizontal row, MCP Tools at bottom (called by agents).
   * Clear top-to-bottom flow matching the architecture diagram.
   * `fitView` centers the group in the viewport on init.
   */
  const nodePositions: Record<AgentId, { x: number; y: number }> = {
    hitl: { x: 0, y: -200 },
    orchestrator: { x: 0, y: -50 },
    qualifier: { x: -200, y: 100 },
    architect: { x: 0, y: 100 },
    riskChecker: { x: 200, y: 100 },
    mcpTools: { x: 0, y: 250 },
  };

  let routingMode: RoutingMode = $state("cost");
  let runState:
    | "idle"
    | "running"
    | "paused"
    | "awaiting-confirmation"
    | "completed"
    | "error" = $state("idle");
  let pendingAgent: AgentId | null = $state(null);
  let messages = $state<ChatMessage[]>([]);
  const initialAgentNodes = createInitialAgentNodes();
  let agentNodes = $state.raw<AgentNodeData[]>(initialAgentNodes);
  let nodes = $state.raw<Node<AgentNodeData>[]>(
    buildFlowNodes(initialAgentNodes),
  );
  let edges = $state.raw<Edge[]>(buildFlowEdges(initialAgentNodes));
  let traceRows = $state<TraceObservationRow[]>(createInitialTraceRows());
  let traceTotals = $state<TraceTotals>({
    latency: "--",
    tokens: "--",
    cost: "--",
    eval: "--",
  });
  let finalOutput = $state<FinalPocOutputView | null>(null);
  let diagramHtml = $state<string | null>(null);
  let diagramUnavailable = $state<DiagramUnavailableReason | null>(null);
  let activeRunId = $state<string | null>(null);
  let editPlanOpen = $state(false);
  let editPlanText = $state("");
  /**
   * Output handed from one incremental step to the next. The riskChecker step
   * sends all of it back so the server can assemble the run and open the gate.
   */
  let qualifierOutput: QualifierOutput | null = null;
  let architectOutput: ArchitectOutput | null = null;
  let runToolCalls: PipelineView["toolCalls"] = [];
  /** The ask and customer domain for the run in flight, reused by every step. */
  let activePrompt = "";
  let activeDomain: string | undefined;
  let responseAppliedToken = $state(0);
  /** Gap between trace refreshes; each poll starts only after the last lands. */
  const TRACE_POLL_INTERVAL_MS = 1500;
  let runToken = 0;
  let tracePollTimer: ReturnType<typeof setTimeout> | null = null;
  let tracePollActive = false;

  const isInteractionLocked = $derived(
    runState === "running" ||
      runState === "paused" ||
      runState === "awaiting-confirmation",
  );
  onMount(() => {
    const handleApprove = (): void => {
      approvePlan().catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : "Failed to approve plan.";
        addMessage("system", message);
      });
    };
    const handleEdit = (): void => {
      openEditPlan();
    };

    window.addEventListener("agentflow:approve", handleApprove);
    window.addEventListener("agentflow:edit", handleEdit);

    return () => {
      window.removeEventListener("agentflow:approve", handleApprove);
      window.removeEventListener("agentflow:edit", handleEdit);
    };
  });

  onDestroy(() => {
    stopTracePolling();
  });

  function createInitialAgentNodes(): AgentNodeData[] {
    return [
      {
        id: "orchestrator",
        label: "Orchestrator",
        subtitle: "Dispatches and coordinates agents",
        state: "idle",
      },
      {
        id: "qualifier",
        label: "Requirements Agent",
        subtitle: "Extract structured requirements",
        state: "idle",
        steps: [
          {
            id: "extract",
            label: "extract_requirements",
            status: "pending",
          },
        ],
        currentStep: 0,
      },
      {
        id: "architect",
        label: "Architect Agent",
        subtitle: "Design deployment and POC plan",
        state: "idle",
        steps: [
          {
            id: "arch_pattern",
            label: "arch_pattern_lookup",
            status: "pending",
          },
          {
            id: "tool_selection",
            label: "tool_selection_lookup",
            status: "pending",
          },
          {
            id: "brand_context",
            label: "brand_context_lookup",
            status: "pending",
          },
          {
            id: "synthesize",
            label: "synthesize_plan",
            status: "pending",
          },
        ],
        currentStep: 0,
      },
      {
        id: "riskChecker",
        label: "Risk Agent",
        subtitle: "Evaluate controls and risks",
        state: "idle",
        steps: [
          {
            id: "risk_policy",
            label: "risk_policy_lookup",
            status: "pending",
          },
          {
            id: "evaluate",
            label: "evaluate_rubric",
            status: "pending",
          },
          {
            id: "assess",
            label: "produce_assessment",
            status: "pending",
          },
        ],
        currentStep: 0,
      },
      {
        id: "hitl",
        label: "HITL Gate",
        subtitle: "Human approval checkpoint",
        state: "idle",
      },
      {
        id: "mcpTools",
        label: "MCP Tools",
        subtitle:
          "Architecture patterns, tool selection, brand context, risk policies",
        state: "idle",
      },
    ];
  }

  function createInitialTraceRows(): TraceObservationRow[] {
    return [];
  }

  function buildFlowNodes(source: AgentNodeData[]): Node<AgentNodeData>[] {
    return source.map((node) => ({
      id: node.id,
      type: "agent",
      position: nodePositions[node.id],
      data: node,
      draggable: false,
      selectable: false,
    }));
  }

  function buildFlowEdges(source: AgentNodeData[]): Edge[] {
    const stateById = new Map(source.map((node) => [node.id, node.state]));
    const edges: Edge[] = [
      // HITL → Orchestrator (user initiates)
      buildEdge("hitl", "orchestrator", stateById),
      // Orchestrator dispatch edges (one-way, top-to-bottom, agents only)
      buildDispatchEdge("orchestrator", "qualifier", 1, stateById),
      buildDispatchEdge("orchestrator", "architect", 2, stateById),
      buildDispatchEdge("orchestrator", "riskChecker", 3, stateById),
      // MCP gateway edges (from Architect and Risk Checker to MCP)
      buildMcpEdge("architect", "mcpTools", stateById),
      buildMcpEdge("riskChecker", "mcpTools", stateById),
    ];
    return edges;
  }

  function buildEdge(
    source: AgentId,
    target: AgentId,
    stateById: Map<AgentId, AgentNodeState>,
  ): Edge {
    const active =
      stateById.get(source) === "done" ||
      stateById.get(target) === "running" ||
      stateById.get(target) === "done" ||
      stateById.get(target) === "paused";
    return {
      id: `${source}-${target}`,
      source,
      target,
      type: "connector",
      data: { active },
    };
  }

  function buildDispatchEdge(
    source: AgentId,
    target: AgentId,
    _number: number,
    stateById: Map<AgentId, AgentNodeState>,
  ): Edge {
    // Only active if the target agent is currently running
    const active = stateById.get(target) === "running";
    return {
      id: `${source}-${target}-dispatch`,
      source,
      target,
      type: "connector",
      data: { active },
    };
  }

  function buildReturnEdge(
    source: AgentId,
    target: AgentId,
    stateById: Map<AgentId, AgentNodeState>,
  ): Edge {
    const active = stateById.get(source) === "done";
    return {
      id: `${source}-${target}-return`,
      source,
      target,
      type: "connector",
      data: { active, dashed: true },
    };
  }

  function buildMcpEdge(
    source: AgentId,
    target: AgentId,
    stateById: Map<AgentId, AgentNodeState>,
  ): Edge {
    // Only active while the source agent is running (making tool calls)
    const active = stateById.get(source) === "running";
    return {
      id: `${source}-${target}-mcp`,
      source,
      target,
      type: "connector",
      data: { active, dashed: true, mcp: true },
    };
  }

  function syncFlow(): void {
    nodes = buildFlowNodes(agentNodes);
    edges = buildFlowEdges(agentNodes);
  }

  function updateAgent(
    id: AgentId,
    update: Partial<Omit<AgentNodeData, "id">>,
  ): void {
    agentNodes = agentNodes.map((node) =>
      node.id === id ? { ...node, ...update } : node,
    );
    syncFlow();
  }

  function updateAgentStep(
    agentId: AgentId,
    stepIndex: number,
    status: "running" | "done",
    detail?: string,
  ): void {
    agentNodes = agentNodes.map((node) => {
      if (node.id !== agentId || !node.steps) {
        return node;
      }
      const updatedSteps = node.steps.map((step, i) => {
        if (i === stepIndex) {
          return { ...step, status, detail };
        }
        return step;
      });
      return {
        ...node,
        steps: updatedSteps,
        currentStep: status === "done" ? stepIndex + 1 : stepIndex,
      };
    });
    syncFlow();
  }

  function addMessage(role: ChatMessage["role"], text: string): void {
    messages = [...messages, { id: crypto.randomUUID(), role, text }];
  }

  function resetTraceTotals(): void {
    traceTotals = { latency: "--", tokens: "--", cost: "--", eval: "--" };
  }

  function resetConversation(): void {
    stopTracePolling();
    runState = "idle";
    messages = [];
    agentNodes = createInitialAgentNodes();
    syncFlow();
    traceRows = createInitialTraceRows();
    resetTraceTotals();
    finalOutput = null;
    diagramHtml = null;
    diagramUnavailable = null;
    activeRunId = null;
    editPlanOpen = false;
    editPlanText = "";
    clearHandoffState();
    runToken += 1;
    responseAppliedToken = runToken;
  }

  function clearHandoffState(): void {
    qualifierOutput = null;
    architectOutput = null;
    runToolCalls = [];
    pendingAgent = null;
    activePrompt = "";
    activeDomain = undefined;
  }

  function resetRunVisuals(): void {
    stopTracePolling();
    agentNodes = createInitialAgentNodes();
    syncFlow();
    traceRows = createInitialTraceRows();
    resetTraceTotals();
    finalOutput = null;
    diagramHtml = null;
    diagramUnavailable = null;
    activeRunId = null;
    editPlanOpen = false;
    editPlanText = "";
    clearHandoffState();
  }

  function isCancelled(token: number): boolean {
    return responseAppliedToken === token || token !== runToken;
  }

  const AGENT_LABELS: Record<string, string> = {
    qualifier: "Requirements Agent",
    architect: "Architect Agent",
    riskChecker: "Risk Agent",
  };

  /** Order the orchestrator dispatches in; "hitl" ends the agent chain. */
  const NEXT_AGENT: Record<AgentId, AgentId | null> = {
    qualifier: "architect",
    architect: "riskChecker",
    riskChecker: "hitl",
    hitl: null,
    orchestrator: null,
    mcpTools: null,
  };

  interface AgentStepResponse {
    status: "agent-complete" | "paused" | "completed";
    output: unknown;
    toolCalls: PipelineView["toolCalls"];
    gate?: {
      proposedPlan: PocPlan;
      highSeverityRisks: RiskCheckerOutput["risks"];
      review_reason?: string;
    };
    finalOutput?: FinalPocOutputView;
  }

  function startRunNarrative(token: number): void {
    updateAgent("orchestrator", { state: "running" });
    addMessage("system", "Orchestrator starting pipeline...");
    // The first agent runs without a confirmation click; every later one waits.
    pendingAgent = "qualifier";
    runState = "awaiting-confirmation";
    confirmNextAgent().catch((error: unknown) => {
      failRun(error, token);
    });
  }

  function failRun(error: unknown, token: number): void {
    if (isCancelled(token)) {
      return;
    }
    stopTracePolling();
    runState = "error";
    pendingAgent = null;
    addMessage(
      "system",
      error instanceof Error ? error.message : "Pipeline run failed.",
    );
  }

  /**
   * Runs one agent through the incremental /api/run endpoint. Throws on
   * failure so the chain stops at the agent that broke instead of handing
   * undefined to the next one.
   */
  async function runAgentStep(
    agentId: AgentId,
    prompt: string,
    previousOutput: unknown,
  ): Promise<AgentStepResponse> {
    updateAgent(agentId, { state: "running" });

    const response = await fetch("/api/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt,
        routingMode,
        agentId,
        previousOutput,
        domain: activeDomain,
        runId: activeRunId,
        // Only the final step needs the accumulated run state.
        ...(agentId === "riskChecker"
          ? { qualifierOutput, priorToolCalls: runToolCalls }
          : {}),
      }),
    });
    const payload = (await response.json()) as
      | AgentStepResponse
      | { error: string };
    if (!response.ok || "error" in payload) {
      updateAgent(agentId, { state: "warning" });
      throw new Error("error" in payload ? payload.error : "Agent run failed");
    }

    updateAgent(agentId, { state: "done" });
    const agent = agentNodes.find((node) => node.id === agentId);
    if (agent?.steps) {
      agent.steps.forEach((_, index) => {
        updateAgentStep(agentId, index, "done");
      });
    }
    runToolCalls = [...runToolCalls, ...payload.toolCalls];
    return payload;
  }

  /** Each agent takes the previous one's structured output as its input. */
  function previousOutputFor(agentId: AgentId): unknown {
    if (agentId === "architect") {
      return qualifierOutput;
    }
    if (agentId === "riskChecker") {
      return architectOutput;
    }
    return undefined;
  }

  /**
   * Runs the pending agent, shows its result, then either parks on the next
   * confirmation or opens the HITL gate. This is the whole orchestration loop
   * the demo is meant to show, so each transition gets its own chat line.
   */
  async function confirmNextAgent(): Promise<void> {
    if (!pendingAgent || runState !== "awaiting-confirmation" || !activeRunId) {
      return;
    }
    const agentId = pendingAgent;
    const runId = activeRunId;
    pendingAgent = null;
    runState = "running";
    const token = runToken;

    addMessage("system", `Orchestrator → ${AGENT_LABELS[agentId]}: running...`);

    try {
      const payload = await runAgentStep(
        agentId,
        activePrompt,
        previousOutputFor(agentId),
      );
      if (isCancelled(token)) {
        return;
      }

      if (agentId === "qualifier") {
        qualifierOutput = payload.output as QualifierOutput;
      } else if (agentId === "architect") {
        architectOutput = payload.output as ArchitectOutput;
        applyDiagram(architectOutput, runToolCalls);
      }

      addMessage(
        "system",
        formatAgentResult(
          AGENT_LABELS[agentId],
          payload.output as
            | QualifierOutput
            | ArchitectOutput
            | RiskCheckerOutput,
        ),
      );
      await refreshTraceTable(runId);

      const next = NEXT_AGENT[agentId];
      if (next === "hitl") {
        openHitlGate(payload);
        return;
      }
      if (!next) {
        return;
      }

      pendingAgent = next;
      runState = "awaiting-confirmation";
      addMessage(
        "system",
        `Ready to dispatch ${AGENT_LABELS[next]}. Confirm to continue.`,
      );
    } catch (error) {
      failRun(error, token);
    }
  }

  /**
   * Final step landed. A paused run has a server-side pending HITL record that
   * Approve/Edit resolve; a clean run skips the gate and finishes here.
   */
  function openHitlGate(payload: AgentStepResponse): void {
    updateAgent("orchestrator", { state: "done" });

    if (payload.status !== "paused" || !payload.gate) {
      stopTracePolling();
      updateAgent("hitl", { state: "done" });
      runState = "completed";
      finalOutput = payload.finalOutput ?? null;
      addMessage(
        "system",
        "No high-severity risks found — the HITL gate was skipped. The POC plan is ready.",
      );
      return;
    }

    const { gate } = payload;
    updateAgent("hitl", {
      state: "paused",
      proposedPlan: gate.proposedPlan,
      reviewReason: gate.review_reason,
      riskSummary: gate.highSeverityRisks,
    });
    if (gate.highSeverityRisks.length > 0) {
      updateAgent("riskChecker", { state: "warning" });
    }
    editPlanText = JSON.stringify(gate.proposedPlan, null, 2);
    runState = "paused";
    addMessage(
      "system",
      "Pipeline paused at the HITL gate — approve or edit the POC plan to continue.",
    );
  }

  function applyTraceSummary(summary: RunTraceSummary): void {
    const observations: TraceObservationRow[] = [];
    let rowId = 0;

    // Add pipeline SPAN
    observations.push({
      id: `obs-${rowId++}`,
      name: "agentflow.pipeline",
      type: "SPAN",
      latency:
        summary.aggregate.latencyMs === null
          ? "--"
          : `${(summary.aggregate.latencyMs / 1000).toFixed(1)}s`,
      tokens:
        summary.aggregate.totalTokens === null
          ? "--"
          : summary.aggregate.totalTokens.toLocaleString("en-US"),
      cost:
        summary.aggregate.costUsd === null
          ? "--"
          : `$${summary.aggregate.costUsd.toFixed(4)}`,
      level: "DEFAULT",
    });

    // Add agent observations
    for (const agent of summary.agents) {
      // AGENT observation
      observations.push({
        id: `obs-${rowId++}`,
        name: `agentflow.agent.${agent.agent}`,
        type: "AGENT",
        latency:
          agent.latencyMs === null
            ? "--"
            : `${(agent.latencyMs / 1000).toFixed(1)}s`,
        tokens:
          agent.tokenCount === null
            ? "--"
            : agent.tokenCount.toLocaleString("en-US"),
        cost: agent.costUsd === null ? "--" : `$${agent.costUsd.toFixed(4)}`,
        level:
          agent.evalScore !== null && agent.evalScore < 3
            ? "WARNING"
            : "DEFAULT",
      });

      // GENERATION observation
      observations.push({
        id: `obs-${rowId++}`,
        name: `${agent.label} generation`,
        type: "GENERATION",
        latency:
          agent.latencyMs === null
            ? "--"
            : `${(agent.latencyMs / 1000).toFixed(1)}s`,
        tokens:
          agent.tokenCount === null
            ? "--"
            : agent.tokenCount.toLocaleString("en-US"),
        cost: agent.costUsd === null ? "--" : `$${agent.costUsd.toFixed(4)}`,
        level:
          agent.evalScore !== null && agent.evalScore < 3
            ? "WARNING"
            : "DEFAULT",
      });
    }

    // Add HITL EVENT if present
    if (summary.hitl) {
      observations.push({
        id: `obs-${rowId++}`,
        name: "hitl_gate_decision",
        type: "EVENT",
        latency: `${(summary.hitl.humanLatencyMs / 1000).toFixed(1)}s`,
        tokens: "--",
        cost: "--",
        level: "DEFAULT",
      });
    }

    traceRows = observations;

    traceTotals = {
      latency:
        summary.aggregate.latencyMs === null
          ? "--"
          : `${(summary.aggregate.latencyMs / 1000).toFixed(1)}s`,
      tokens:
        summary.aggregate.totalTokens === null
          ? "--"
          : summary.aggregate.totalTokens.toLocaleString("en-US"),
      cost:
        summary.aggregate.costUsd === null
          ? "--"
          : `$${summary.aggregate.costUsd.toFixed(4)}`,
      eval:
        summary.aggregate.evalScore === null
          ? "--"
          : summary.aggregate.evalScore.toFixed(1),
    };
  }

  async function refreshTraceTable(runId: string): Promise<void> {
    try {
      const response = await fetch(
        `/api/traces?runId=${encodeURIComponent(runId)}`,
      );
      const payload = (await response.json()) as
        | RunTraceSummary
        | { error: string };
      if (!response.ok || "error" in payload) {
        throw new Error(
          "error" in payload ? payload.error : "Failed to fetch traces",
        );
      }
      if (payload.available && payload.found && payload.runId === activeRunId) {
        applyTraceSummary(payload);
      }
    } catch {
      // Best-effort refresh — keep the narrative placeholders on failure.
    }
  }

  /**
   * Polls with a chained timeout rather than setInterval: a slow Langfuse
   * response would otherwise let requests overlap, and two in-flight refreshes
   * can resolve out of order and apply a stale summary over a newer one.
   */
  function startTracePolling(runId: string): void {
    stopTracePolling();
    tracePollActive = true;
    const scheduleNext = () => {
      tracePollTimer = setTimeout(async () => {
        await refreshTraceTable(runId);
        if (tracePollActive) {
          scheduleNext();
        }
      }, TRACE_POLL_INTERVAL_MS);
    };
    scheduleNext();
  }

  function stopTracePolling(): void {
    tracePollActive = false;
    if (tracePollTimer !== null) {
      clearTimeout(tracePollTimer);
      tracePollTimer = null;
    }
  }

  /**
   * Builds the architecture diagram from the run's MCP tool calls: diagram_data
   * from arch_pattern_lookup, header brand from brand_context_lookup. A
   * low-confidence pattern match carries no diagram_data and renders none.
   */
  function applyDiagram(
    architect: ArchitectOutput,
    toolCalls: PipelineView["toolCalls"],
  ): void {
    const source = diagramSourceFromToolCalls(toolCalls);
    diagramUnavailable = source.unavailable;
    diagramHtml = source.diagram
      ? renderDiagramHtml({
          diagram: source.diagram,
          brand: source.brand,
          fallbackTitle: architect.pattern_match.pattern_id.replace(/_/g, " "),
          subtitle: architect.architecture_summary,
        })
      : null;
  }

  /**
   * Renders an agent's structured output as a chat bubble. Fields must match
   * the zod schemas in $lib/agents/types — the chat panel prints plain text,
   * so no markdown markers here.
   */
  function formatAgentResult(
    agentName: string,
    output: QualifierOutput | ArchitectOutput | RiskCheckerOutput,
  ): string {
    if (agentName === "Requirements Agent") {
      const qualifier = output as QualifierOutput;
      return [
        `${agentName} — structured requirements`,
        "",
        "Use cases:",
        ...qualifier.named_use_cases.map((item) => `  • ${item}`),
        "Constraints:",
        ...qualifier.partner_constraints.map((item) => `  • ${item}`),
        "Success criteria:",
        ...qualifier.success_criteria.map((item) => `  • ${item}`),
        "Exit criteria:",
        ...qualifier.exit_criteria.map((item) => `  • ${item}`),
        ...(qualifier.ambiguity_flags.length > 0
          ? [
              "Needs clarification:",
              ...qualifier.ambiguity_flags.map((item) => `  • ${item}`),
            ]
          : []),
      ].join("\n");
    }
    if (agentName === "Architect Agent") {
      const architect = output as ArchitectOutput;
      return [
        `${agentName} — deployment architecture`,
        "",
        architect.architecture_summary,
        "",
        `Pattern: ${architect.pattern_match.pattern_id} (confidence ${architect.pattern_match.confidence.toFixed(2)})`,
        "",
        `Scope: ${architect.poc_plan.scope}`,
        `Timeline: ${architect.poc_plan.timeline}`,
        `Resourcing: ${architect.poc_plan.resource_estimate}`,
        "Data zones:",
        ...architect.poc_plan.data_zones.map((zone) => `  • ${zone}`),
        "Integrations:",
        ...architect.poc_plan.integrations.map((item) => `  • ${item}`),
        "",
        `Deployment notes: ${architect.deployment_notes}`,
      ].join("\n");
    }
    if (agentName === "Risk Agent") {
      const riskChecker = output as RiskCheckerOutput;
      return [
        `${agentName} — risk and controls review`,
        "",
        `Overall score: ${riskChecker.overall_score.toFixed(1)}/5`,
        `Recommendation: ${riskChecker.recommendation}`,
        "",
        "Risks:",
        ...riskChecker.risks.map(
          (risk) => `  • [${risk.severity.toUpperCase()}] ${risk.issue}`,
        ),
      ].join("\n");
    }
    return `${agentName} results: ${JSON.stringify(output, null, 2)}`;
  }

  /**
   * Starts a run. The orchestrator dispatches the first agent immediately and
   * then waits for a confirmation click before each subsequent one, so the
   * hand-off between agents is visible rather than hidden inside one request.
   */
  function runPipeline(prompt: string, domain?: string): void {
    if (isInteractionLocked) {
      return;
    }
    resetRunVisuals();
    runState = "running";
    addMessage("user", prompt);
    addMessage("system", `Running pipeline in ${routingMode} mode.`);
    runToken += 1;
    responseAppliedToken = 0;
    activePrompt = prompt;
    activeDomain = domain;
    const runId = crypto.randomUUID();
    activeRunId = runId;
    startTracePolling(runId);
    startRunNarrative(runToken);
  }

  function openEditPlan(): void {
    editPlanOpen = true;
  }

  async function approvePlan(): Promise<void> {
    if (!activeRunId || runState !== "paused") {
      return;
    }
    await completeHitl("/api/hitl/approve", { runId: activeRunId });
  }

  async function submitEditedPlan(): Promise<void> {
    if (!activeRunId || runState !== "paused") {
      return;
    }
    let pocPlan: PocPlan;
    try {
      pocPlan = JSON.parse(editPlanText) as PocPlan;
    } catch {
      addMessage("system", "Edited POC plan must be valid JSON.");
      return;
    }
    await completeHitl("/api/hitl/edit", { runId: activeRunId, pocPlan });
  }

  async function completeHitl(
    url: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    runState = "running";
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as
        | HitlCompletionResponse
        | { error: string };
      if (!response.ok || "error" in payload) {
        throw new Error(
          "error" in payload ? payload.error : "HITL action failed",
        );
      }
      ({ finalOutput } = payload);
      runState = "completed";
      editPlanOpen = false;
      updateAgent("hitl", { state: "done" });
      if (activeRunId) {
        void refreshTraceTable(activeRunId);
      }
      addMessage(
        "system",
        `HITL ${payload.decision}. Final POC plan is ready.`,
      );
    } catch (error) {
      runState = "paused";
      addMessage(
        "system",
        error instanceof Error ? error.message : "HITL action failed.",
      );
    }
  }
</script>

<svelte:head>
  <title>Agentic POC Qualification Pipeline</title>
</svelte:head>

<main class="flex h-screen flex-col overflow-hidden bg-[#F5F5F5] p-4">
  <div
    class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-darkgrey-400 bg-background"
  >
    <header
      class="flex shrink-0 items-center gap-3 border-b-2 border-darkgrey-400 bg-background px-5 py-3"
    >
      <span class="text-sm font-medium text-foreground-muted">
        agents.ishlab.dev
      </span>
      <span aria-hidden="true" class="h-5 w-px bg-darkgrey-400"></span>
      <h1 class="text-lg">Agentic POC Qualification Pipeline</h1>
    </header>

    <div
      class="grid min-h-0 flex-1 grid-cols-[450px_minmax(0,1fr)] divide-x-2 divide-darkgrey-400 overflow-hidden"
    >
      <ChatPanel
        awaitingConfirmation={runState === "awaiting-confirmation"}
        canReset={runState !== "idle" || messages.length > 0}
        {diagramHtml}
        {diagramUnavailable}
        disabled={isInteractionLocked}
        {messages}
        onConfirm={confirmNextAgent}
        onReset={resetConversation}
        onRoutingModeChange={(mode) => {
          routingMode = mode;
        }}
        onSend={runPipeline}
        output={finalOutput}
        {routingMode}
      />

      <section class="flex min-h-0 flex-col bg-darkgrey-50">
        <div class="min-h-0 flex-[3] border-b-2 border-darkgrey-400">
          <SvelteFlow
            class="agent-flow"
            colorMode="light"
            {edges}
            {edgeTypes}
            elementsSelectable={false}
            fitView
            fitViewOptions={{ padding: 0.08, maxZoom: 1.15 }}
            {nodes}
            nodesConnectable={false}
            nodesDraggable={false}
            {nodeTypes}
            panOnDrag={false}
            zoomOnScroll={false}
          >
            <svg style="position: absolute; width: 0; height: 0;">
              <defs>
                <marker
                  id="arrowhead"
                  markerHeight="5"
                  markerWidth="6"
                  orient="auto"
                  refX="5"
                  refY="2.5"
                >
                  <polygon
                    fill="oklch(0.66 0.008 260)"
                    points="0 0, 6 2.5, 0 5"
                  />
                </marker>
                <marker
                  id="arrowhead-active"
                  markerHeight="5"
                  markerWidth="6"
                  orient="auto"
                  refX="5"
                  refY="2.5"
                >
                  <polygon
                    fill="oklch(0.55 0.16 250)"
                    points="0 0, 6 2.5, 0 5"
                  />
                </marker>
              </defs>
            </svg>
            <Background gap={18} size={1.2} variant={BackgroundVariant.Dots} />
            <Controls showInteractive={false} />
          </SvelteFlow>
        </div>

        <div class="min-h-0 flex-1 overflow-hidden p-4">
          <TracePanel {routingMode} rows={traceRows} totals={traceTotals} />
        </div>
      </section>
    </div>
  </div>
</main>

{#if editPlanOpen}
  <div
    aria-modal="true"
    class="fixed inset-0 z-50 grid place-items-center bg-foreground/35 p-6"
    role="dialog"
  >
    <form
      class="w-full max-w-2xl rounded-md border-2 border-sienna-400 bg-background p-4 shadow-2xl"
      onsubmit={(event) => {
				event.preventDefault();
				submitEditedPlan().catch((error: unknown) => {
					const message =
						error instanceof Error
							? error.message
							: "Failed to submit edited plan.";
					addMessage("system", message);
				});
			}}
    >
      <h2 class="font-heading text-lg font-semibold text-sienna-800">
        Edit POC Plan JSON
      </h2>
      <label class="sr-only" for="edited-plan">POC plan JSON</label>
      <textarea
        class="mt-3 h-80 w-full resize-none rounded-md border-2 border-darkgrey-300 bg-darkgrey-50 p-3 font-body text-sm outline-none focus:border-sienna-400"
        id="edited-plan"
        bind:value={editPlanText}
      ></textarea>
      <div class="mt-3 flex justify-end gap-2">
        <button
          class="rounded-sm border border-darkgrey-400 bg-darkgrey-50 px-3 py-2 text-sm font-semibold transition hover:border-rebeccapurple-300 hover:bg-darkgrey-200"
          onclick={() => {
						editPlanOpen = false;
					}}
          type="button"
        >
          Cancel
        </button>
        <button
          class="rounded-sm bg-rebeccapurple-500 px-3 py-2 text-sm font-semibold text-white"
          type="submit"
        >
          Submit Edit
        </button>
      </div>
    </form>
  </div>
{/if}

<style>
  :global(.agent-flow) {
    background: color-mix(in oklch, var(--color-darkgrey-50), white 18%);
  }

  :global(.agent-flow .svelte-flow__node) {
    background: transparent;
    border: 0;
    box-shadow: none;
  }

  :global(.agent-flow .svelte-flow__attribution) {
    display: none;
  }
</style>
