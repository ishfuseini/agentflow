<script lang="ts">
  import { AlertTriangle, CheckCircle2, Circle, Zap } from "@lucide/svelte";
  import { Handle, type NodeProps, Position } from "@xyflow/svelte";
  import type { AgentNodeData } from "./types";

  let { data }: NodeProps = $props();

  const nodeData = $derived(data as AgentNodeData);
  const cardWidth = $derived("w-[180px]");
  const cardMinHeight = $derived("min-h-[80px]");

  function stateClass(state: AgentNodeData["state"]): string {
    // Every state gets a 4px border (transparent when idle/done) so the box
    // model — and therefore the top-right status icon position — stays
    // identical across states. Without this, the running/paused/warning
    // border would shift the header content inward and the glowing dot would
    // jump relative to the idle/done icons.
    if (state === "running") {
      return "flex items-center justify-center border-4 border-dodgerblue-600 rounded-md transition-all duration-300 ease-linear";
    }
    if (state === "paused" || state === "warning") {
      return "flex items-center justify-center border-4 border-sienna-600 rounded-md transition-all duration-300 ease-linear";
    }
    return "border-4 border-transparent rounded-md transition-all duration-300 ease-linear";
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
  position={Position.Top}
  type="target"
/>

<article
  aria-describedby={nodeData.subtitle ? `node-tooltip-${nodeData.id}` : undefined}
  class={`group relative nodrag rounded-md p-3 text-white transition-all duration-300 ${cardWidth} ${cardMinHeight} ${stateClass(nodeData.state)}`}
  style="background-color: oklch(0.8078 0 0);"
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
  <header class="flex flex-col gap-1">
    <div class="flex items-center justify-between">
      <p class="truncate font-heading text-sm font-semibold leading-tight">
        {nodeData.label}
      </p>
      <div class="shrink-0">
        {#if nodeData.state === "running"}
          <span
            aria-label="running"
            class="relative flex h-4 w-4"
            role="status"
          >
            <span
              class="absolute inline-flex h-full w-full animate-ping rounded-full bg-rebeccapurple-500 opacity-70"
            ></span>
            <span
              class="relative inline-flex h-4 w-4 rounded-full bg-rebeccapurple-500"
            ></span>
          </span>
        {:else if nodeData.state === "done"}
          <CheckCircle2 aria-label="done" class="h-4 w-4 text-green-600" />
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
    </div>

    {#if nodeData.steps && nodeData.steps.length > 0 && nodeData.state !== "idle"}
      <div class="flex w-full flex-col gap-0.5">
        {#each nodeData.steps as step (step.id)}
          <div class="flex items-center gap-1 text-[9px] leading-tight">
            <Zap
              aria-hidden="true"
              class={`h-2.5 w-2.5 shrink-0 ${
                step.status === "done"
                  ? "text-darkcyan-600"
                  : step.status === "running"
                    ? "animate-pulse text-rebeccapurple-500"
                    : "text-darkgrey-400"
              }`}
            />
            <span class="truncate text-foreground-muted/80"
              >{step.label}()</span
            >
          </div>
        {/each}
      </div>
    {/if}
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
        <p
          class="mt-1 max-h-16 overflow-y-auto text-[10px] leading-snug text-sienna-800"
        >
          {nodeData.reviewReason}
        </p>
      {/if}
      {#if nodeData.riskSummary && nodeData.riskSummary.length > 0}
        <ul
          class="mt-1.5 max-h-20 space-y-1 overflow-y-auto text-[10px] text-sienna-900"
        >
          {#each nodeData.riskSummary as risk (risk.issue)}
            <li class="flex gap-1">
              <span
                class="mt-1 h-1 w-1 shrink-0 rounded-full bg-sienna-600"
              ></span>
              <span class="truncate">{risk.issue}</span>
            </li>
          {/each}
        </ul>
      {/if}
      {#if nodeData.proposedPlan}
        <div class="mt-2 rounded-sm bg-background/80 p-1.5 text-[10px]">
          <p class="font-medium text-foreground">Proposed POC</p>
          <p
            class="mt-0.5 max-h-12 overflow-y-auto leading-snug text-foreground-muted"
          >
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
  position={Position.Bottom}
  type="source"
/>
