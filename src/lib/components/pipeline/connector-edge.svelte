<script lang="ts">
  import {
    BaseEdge,
    EdgeLabel,
    type EdgeProps,
    getStraightPath,
  } from "@xyflow/svelte";

  let { id, sourceX, sourceY, targetX, targetY, data }: EdgeProps = $props();

  const edgePath = $derived(
    getStraightPath({
      sourceX,
      sourceY,
      targetX,
      targetY,
    })[0],
  );
  const edgeData = $derived(
    typeof data === "object" && data !== null ? data : {},
  );
  const active = $derived(edgeData.active === true);
  const label = $derived(
    typeof edgeData.label === "string" ? edgeData.label : null,
  );
  const dashed = $derived(edgeData.dashed === true);
  const mcp = $derived(edgeData.mcp === true);

  // Calculate label position (midpoint of edge)
  const labelX = $derived((sourceX + targetX) / 2);
  const labelY = $derived((sourceY + targetY) / 2);
</script>

<BaseEdge
  class={`transition-all duration-300 ease-linear ${active ? "stroke-dodgerblue-600" : "stroke-darkgrey-400"}`}
  {id}
  markerEnd={active ? "url(#arrowhead-active)" : "url(#arrowhead)"}
  path={edgePath}
  style={`stroke-width: ${active ? 4 : 2}; stroke-dasharray: ${dashed || mcp ? "6 4" : active ? "0" : "6 6"};`}
/>

{#if active && !mcp}
  <path
    class="connector-flow"
    d={edgePath}
    fill="none"
    stroke="oklch(0.55 0.16 250)"
    stroke-linecap="round"
    stroke-width="4"
  />
{/if}

{#if label}
  <EdgeLabel x={labelX} y={labelY}>
    <div
      class="rounded-sm border border-darkgrey-300 bg-background px-1.5 py-0.5 text-center text-[10px] font-semibold text-foreground-muted"
    >
      {label}
    </div>
  </EdgeLabel>
{/if}

<style>
  .connector-flow {
    stroke-dasharray: 24 120;
    animation: draw-edge 900ms ease-in-out infinite;
  }

  @keyframes draw-edge {
    from {
      stroke-dashoffset: 120;
    }
    to {
      stroke-dashoffset: 0;
    }
  }
</style>
