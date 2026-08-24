<script lang="ts">
  import "@xyflow/svelte/dist/style.css";
  import { AlertTriangle, CheckCircle2 } from "@lucide/svelte";
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
  import { onMount } from "svelte";
  import type { PocPlan } from "$lib/agents/types";
  import AgentNodeCard from "$lib/components/pipeline/agent-node-card.svelte";
  import ChatPanel from "$lib/components/pipeline/chat-panel.svelte";
  import ConnectorEdge from "$lib/components/pipeline/connector-edge.svelte";
  import type {
    AgentId,
    AgentNodeData,
    AgentNodeState,
    ChatMessage,
    FinalPocOutputView,
    HitlCompletionResponse,
    PipelineResponse,
    PipelineView,
    TraceSummaryRow,
    TraceTotals,
  } from "$lib/components/pipeline/types";
  import type { RoutingMode } from "$lib/pipeline/routing";

  const nodeTypes: NodeTypes = {
    agent: AgentNodeCard,
  };
  const edgeTypes: EdgeTypes = {
    connector: ConnectorEdge,
  };
  /**
   * Node row centered on the origin so the group sits mid-canvas; `fitView`
   * then centers it in the viewport on init. Offsets account for the wider
   * HITL card (220px) while keeping an even 20px gap between cards.
   */
  const nodePositions: Record<AgentId, { x: number; y: number }> = {
    qualifier: { x: -320, y: 0 },
    architect: { x: -120, y: 0 },
    riskChecker: { x: 80, y: 0 },
    hitl: { x: 300, y: 0 },
  };

  let routingMode: RoutingMode = $state("cost");
  let runState: "idle" | "running" | "paused" | "completed" | "error" =
    $state("idle");
  let messages = $state<ChatMessage[]>([]);
  const initialAgentNodes = createInitialAgentNodes();
  let agentNodes = $state.raw<AgentNodeData[]>(initialAgentNodes);
  let nodes = $state.raw<Node<AgentNodeData>[]>(
    buildFlowNodes(initialAgentNodes),
  );
  let edges = $state.raw<Edge[]>(buildFlowEdges(initialAgentNodes));
  let traceRows = $state<TraceSummaryRow[]>(createInitialTraceRows());
  let traceTotals = $state<TraceTotals>({ latency: "--", cost: "--", eval: "--" });
  let finalOutput = $state<FinalPocOutputView | null>(null);
  let activeRunId = $state<string | null>(null);
  let editPlanOpen = $state(false);
  let editPlanText = $state("");
  let responseAppliedToken = $state(0);
  let runToken = 0;

  const isInteractionLocked = $derived(
    runState === "running" || runState === "paused",
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

  function createInitialAgentNodes(): AgentNodeData[] {
    return [
      {
        id: "qualifier",
        label: "Qualifier",
        subtitle: "Extract structured requirements",
        state: "idle",
      },
      {
        id: "architect",
        label: "Architect",
        subtitle: "Design deployment and POC plan",
        state: "idle",
      },
      {
        id: "riskChecker",
        label: "Risk Checker",
        subtitle: "Evaluate controls and risks",
        state: "idle",
      },
      {
        id: "hitl",
        label: "HITL Gate",
        subtitle: "Human approval checkpoint",
        state: "idle",
      },
    ];
  }

  function createInitialTraceRows(): TraceSummaryRow[] {
    return [
      {
        id: "qualifier",
        label: "Qualifier",
        status: "pending",
        latency: "--",
        cost: "--",
        eval: "--",
      },
      {
        id: "architect",
        label: "Architect",
        status: "pending",
        latency: "--",
        cost: "--",
        eval: "--",
      },
      {
        id: "riskChecker",
        label: "Risk Checker",
        status: "pending",
        latency: "--",
        cost: "--",
        eval: "--",
      },
    ];
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
    return [
      buildEdge("qualifier", "architect", stateById),
      buildEdge("architect", "riskChecker", stateById),
      buildEdge("riskChecker", "hitl", stateById),
    ];
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

  function setTraceStatus(
    id: TraceSummaryRow["id"],
    status: TraceSummaryRow["status"],
  ): void {
    traceRows = traceRows.map((row) =>
      row.id === id ? { ...row, status } : row,
    );
  }

  function addMessage(role: ChatMessage["role"], text: string): void {
    messages = [...messages, { id: crypto.randomUUID(), role, text }];
  }

  function resetTraceTotals(): void {
    traceTotals = { latency: "--", cost: "--", eval: "--" };
  }

  function resetConversation(): void {
    runState = "idle";
    messages = [];
    agentNodes = createInitialAgentNodes();
    syncFlow();
    traceRows = createInitialTraceRows();
    resetTraceTotals();
    finalOutput = null;
    activeRunId = null;
    editPlanOpen = false;
    editPlanText = "";
    runToken += 1;
    responseAppliedToken = runToken;
  }

  function resetRunVisuals(): void {
    agentNodes = createInitialAgentNodes();
    syncFlow();
    traceRows = createInitialTraceRows();
    resetTraceTotals();
    finalOutput = null;
    activeRunId = null;
    editPlanOpen = false;
    editPlanText = "";
  }

  function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function isCancelled(token: number): boolean {
    return responseAppliedToken === token || token !== runToken;
  }

  function startRunNarrative(token: number): void {
    playRunNarrative(token).catch((error: unknown) => {
      if (isCancelled(token)) {
        return;
      }
      const message =
        error instanceof Error ? error.message : "Pipeline animation failed.";
      addMessage("system", message);
    });
  }

  async function playRunNarrative(token: number): Promise<void> {
    updateAgent("qualifier", { state: "running" });
    setTraceStatus("qualifier", "running");
    await wait(900);
    if (isCancelled(token)) {
      return;
    }
    updateAgent("qualifier", { state: "done" });
    setTraceStatus("qualifier", "done");

    updateAgent("architect", { state: "running" });
    setTraceStatus("architect", "running");
    await wait(1500);
    if (isCancelled(token)) {
      return;
    }
    updateAgent("architect", { state: "done" });
    setTraceStatus("architect", "done");

    updateAgent("riskChecker", { state: "running" });
    setTraceStatus("riskChecker", "running");
    await wait(1300);
    if (isCancelled(token)) {
      return;
    }
    updateAgent("riskChecker", { state: "done" });
    setTraceStatus("riskChecker", "done");
    updateAgent("hitl", { state: "running" });
  }

  function applyTraceRows(pipeline: PipelineView): void {
    traceRows = traceRows.map((row) => {
      const trace = pipeline.traces.find((item) => item.agent === row.id);
      if (!trace) {
        return row;
      }
      return {
        ...row,
        status:
          trace.evalScore !== undefined && trace.evalScore < 3
            ? "warning"
            : "done",
        latency: `${(trace.latencyMs / 1000).toFixed(1)}s`,
        cost:
          trace.costUsd !== undefined ? `$${trace.costUsd.toFixed(4)}` : "--",
        eval: trace.evalScore !== undefined ? trace.evalScore.toFixed(1) : "ok",
      };
    });
    const traces = pipeline.traces;
    const totalMs = traces.reduce((sum, trace) => sum + trace.latencyMs, 0);
    const totalCost = traces.reduce(
      (sum, trace) => sum + (trace.costUsd ?? 0),
      0,
    );
    const scored = traces.filter((trace) => trace.evalScore !== undefined);
    const avgEval =
      scored.length > 0
        ? scored.reduce((sum, trace) => sum + (trace.evalScore ?? 0), 0) /
          scored.length
        : null;
    traceTotals = {
      latency: `${(totalMs / 1000).toFixed(1)}s`,
      cost: `$${totalCost.toFixed(4)}`,
      eval: avgEval !== null ? avgEval.toFixed(1) : "--",
    };
  }

  function applyPipelineData(response: PipelineResponse): void {
    responseAppliedToken = runToken;
    activeRunId = response.runId;
    applyTraceRows(response.pipeline);
    const highSeverityRisks =
      response.gate?.highSeverityRisks ??
      response.pipeline.riskChecker.risks.filter(
        (risk) => risk.severity === "high",
      );
    agentNodes = createInitialAgentNodes().map((node) => {
      if (node.id === "qualifier" || node.id === "architect") {
        return { ...node, state: "done" };
      }
      if (node.id === "riskChecker") {
        return {
          ...node,
          state: highSeverityRisks.length > 0 ? "warning" : "done",
        };
      }
      return {
        ...node,
        state: response.status === "paused" ? "paused" : "done",
        proposedPlan:
          response.gate?.proposedPlan ?? response.pipeline.architect.poc_plan,
        reviewReason: response.gate?.review_reason,
        riskSummary: highSeverityRisks,
      };
    });
    syncFlow();
    if (response.status === "paused") {
      runState = "paused";
      addMessage(
        "system",
        "Human review required. Approve or edit the POC plan in the HITL Gate node.",
      );
      editPlanText = JSON.stringify(response.gate?.proposedPlan, null, 2);
      return;
    }
    runState = "completed";
    finalOutput = response.finalOutput ?? null;
    addMessage("system", "Pipeline completed. The draft POC plan is ready.");
  }

  async function runPipeline(prompt: string, domain?: string): Promise<void> {
    if (isInteractionLocked) {
      return;
    }
    resetRunVisuals();
    runState = "running";
    addMessage("user", prompt);
    addMessage("system", `Running pipeline in ${routingMode} mode.`);
    runToken += 1;
    const token = runToken;
    responseAppliedToken = 0;
    startRunNarrative(token);
    try {
      const response = await fetch("/api/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt, routingMode, domain }),
      });
      const payload = (await response.json()) as
        | PipelineResponse
        | { error: string };
      if (!response.ok || "error" in payload) {
        throw new Error(
          "error" in payload ? payload.error : "Pipeline run failed",
        );
      }
      applyPipelineData(payload);
    } catch (error) {
      responseAppliedToken = token;
      runState = "error";
      updateAgent("qualifier", { state: "warning" });
      addMessage(
        "system",
        error instanceof Error ? error.message : "Pipeline run failed.",
      );
    }
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
        canReset={runState !== "idle" || messages.length > 0}
        disabled={isInteractionLocked}
        {messages}
        output={finalOutput}
        onReset={resetConversation}
        onSend={runPipeline}
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
            <Background gap={18} size={1.2} variant={BackgroundVariant.Dots} />
            <Controls showInteractive={false} />
          </SvelteFlow>
        </div>

        <div class="min-h-0 flex-1 overflow-hidden p-4">
          <section
            class="flex h-full min-h-0 flex-col rounded-md border border-darkgrey-300 bg-background p-3"
          >
            <div class="mb-3 flex shrink-0 items-center justify-between">
              <h2 class="font-heading text-sm font-semibold text-darkcyan-700">
                Trace Summary
              </h2>
              <span class="text-xs text-foreground-muted">{routingMode}</span>
            </div>
            <div class="min-h-0 flex-1 space-y-2 overflow-y-auto">
              {#each traceRows as row (row.id)}
                <div
                  class="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 rounded-sm bg-[color-mix(in_oklch,var(--color-background),white_42%)] px-2 py-1.5 text-xs"
                >
                  <span class="flex items-center gap-2 font-semibold">
                    {#if row.status === "done"}
                      <CheckCircle2
                        aria-hidden="true"
                        class="h-3.5 w-3.5 text-darkcyan-600"
                      />
                    {:else if row.status === "warning"}
                      <AlertTriangle
                        aria-hidden="true"
                        class="h-3.5 w-3.5 text-sienna-600"
                      />
                    {:else}
                      <span
                        class={`h-2.5 w-2.5 rounded-full ${
                          row.status === "running"
                            ? "animate-pulse bg-rebeccapurple-500"
                            : "bg-darkgrey-400"
                        }`}
                      ></span>
                    {/if}
                    {row.label}
                  </span>
                  <span>{row.latency}</span>
                  <span>{row.cost}</span>
                  <span>{row.eval}</span>
                </div>
              {/each}
            </div>
            <footer
              class="mt-3 grid shrink-0 grid-cols-[1fr_auto_auto_auto] items-center gap-2 border-t-2 border-darkgrey-300 pt-2 text-xs font-semibold text-foreground-muted"
            >
              <span>Total</span>
              <span>{traceTotals.latency}</span>
              <span>{traceTotals.cost}</span>
              <span>eval {traceTotals.eval}</span>
            </footer>
          </section>
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
