<script lang="ts">
  import { AlertTriangle, CheckCircle2, Circle } from "@lucide/svelte";
  import { Handle, type NodeProps, Position } from "@xyflow/svelte";
  import type { AgentNodeData } from "./types";

  let { data }: NodeProps = $props();

  const nodeData = $derived(data as AgentNodeData);
  /** The HITL gate hosts the interactive review panel, so it stays a bit wider. */
  const cardWidth = $derived(
    nodeData.id === "hitl" ? "w-[220px]" : "w-[180px]",
  );

  function stateClass(state: AgentNodeData["state"]): string {
    if (state === "running") {
      return "border-rebeccapurple-500 shadow-[0_0_0_4px_oklch(0.39_0.15_299_/_0.12),0_14px_40px_oklch(0.39_0.15_299_/_0.22)]";
    }
    if (state === "paused") {
      return "border-sienna-500 shadow-[0_0_0_4px_oklch(0.58_0.17_44_/_0.14),0_14px_40px_oklch(0.58_0.17_44_/_0.2)]";
    }
    if (state === "warning") {
      return "border-sienna-500";
    }
    return "border-darkcyan-500";
  }

  function dispatchNodeAction(
    action: string,
    detail: Record<string, string>,
  ): void {
    window.dispatchEvent(new CustomEvent(`agentflow:${action}`, { detail }));
  }
</script>

<Handle
  class="!h-2 !w-2 !border-0 !bg-transparent"
  position={Position.Left}
  type="target"
/>

<article
  aria-describedby={nodeData.subtitle ? `node-tooltip-${nodeData.id}` : undefined}
  class={`group relative nodrag rounded-md border-2 bg-background/95 p-3 text-foreground transition-all duration-300 ${cardWidth} ${stateClass(nodeData.state)}`}
>
  {#if nodeData.subtitle}
    <span
      class="pointer-events-none absolute -top-1 left-1/2 z-50 w-max max-w-[220px] -translate-x-1/2 -translate-y-full rounded-sm border border-darkgrey-300 bg-darkgrey-100 px-2 py-1 text-[10px] font-medium leading-snug text-foreground-muted opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100"
      id={`node-tooltip-${nodeData.id}`}
      role="tooltip"
    >
      {nodeData.subtitle}
    </span>
  {/if}
  <header class="flex items-center justify-between gap-2">
    <p class="truncate font-heading text-sm font-semibold leading-tight">
      {nodeData.label}
    </p>
    <div class="shrink-0">
      {#if nodeData.state === "running"}
        <span aria-label="running" class="relative flex h-4 w-4" role="status">
          <span
            class="absolute inline-flex h-full w-full animate-ping rounded-full bg-rebeccapurple-500 opacity-70"
          ></span>
          <span
            class="relative inline-flex h-4 w-4 rounded-full bg-rebeccapurple-500"
          ></span>
        </span>
      {:else if nodeData.state === "done"}
        <CheckCircle2 aria-label="done" class="h-4 w-4 text-darkcyan-600" />
      {:else if nodeData.state === "warning" || nodeData.state === "paused"}
        <AlertTriangle
          aria-label={nodeData.state}
          class="h-4 w-4 text-sienna-600"
        />
      {:else}
        <Circle
          aria-label="idle"
          class="h-4 w-4 fill-darkgrey-300 text-darkgrey-400"
        />
      {/if}
    </div>
  </header>

  {#if nodeData.state === "paused"}
    <section
      aria-label="Human review gate"
      class="mt-2 rounded-sm border border-sienna-300 bg-sienna-50/75 p-2"
    >
      <p class="text-[10px] font-semibold leading-snug text-sienna-800">
        PAUSED &mdash; awaiting review
      </p>
      {#if nodeData.reviewReason}
        <p class="mt-1 text-[10px] leading-snug text-sienna-800">
          {nodeData.reviewReason}
        </p>
      {/if}
      {#if nodeData.riskSummary && nodeData.riskSummary.length > 0}
        <ul class="mt-1.5 space-y-1 text-[10px] text-sienna-900">
          {#each nodeData.riskSummary as risk (risk.issue)}
            <li class="flex gap-1">
              <span
                class="mt-1 h-1 w-1 shrink-0 rounded-full bg-sienna-600"
              ></span>
              <span>{risk.issue}</span>
            </li>
          {/each}
        </ul>
      {/if}
      {#if nodeData.proposedPlan}
        <div class="mt-2 rounded-sm bg-background/80 p-1.5 text-[10px]">
          <p class="font-medium text-foreground">Proposed POC</p>
          <p class="mt-0.5 leading-snug text-foreground-muted">
            {nodeData.proposedPlan.scope}
          </p>
        </div>
      {/if}
      <div class="mt-2 flex gap-1.5">
        <button
          class="rounded-sm bg-rebeccapurple-500 px-2 py-1 text-[10px] font-semibold text-white transition hover:bg-rebeccapurple-600 disabled:opacity-60"
          onclick={() => dispatchNodeAction("approve", { nodeId: nodeData.id })}
          type="button"
        >
          Approve
        </button>
        <button
          class="rounded-sm border border-sienna-400 px-2 py-1 text-[10px] font-semibold text-sienna-800 transition hover:bg-sienna-100 disabled:opacity-60"
          onclick={() => dispatchNodeAction("edit", { nodeId: nodeData.id })}
          type="button"
        >
          Edit
        </button>
      </div>
    </section>
  {/if}
</article>

<Handle
  class="!h-2 !w-2 !border-0 !bg-transparent"
  position={Position.Right}
  type="source"
/>
