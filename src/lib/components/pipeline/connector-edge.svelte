<script lang="ts">
  import { BaseEdge, type EdgeProps, getStraightPath } from "@xyflow/svelte";

  let { id, sourceX, sourceY, targetX, targetY, data }: EdgeProps = $props();

  const edgePath = $derived(
    getStraightPath({
      sourceX,
      sourceY,
      targetX,
      targetY,
    })[0],
  );
  const active = $derived(
    typeof data === "object" &&
      data !== null &&
      "active" in data &&
      data.active === true,
  );
</script>

<BaseEdge
  {id}
  path={edgePath}
  style={`stroke: ${active ? "oklch(0.51 0.069 179.5)" : "oklch(0.66 0.008 260)"}; stroke-width: 2; stroke-dasharray: ${active ? "0" : "6 6"}; transition: stroke 180ms ease;`}
/>

{#if active}
  <path
    class="connector-flow"
    d={edgePath}
    fill="none"
    stroke="oklch(0.39 0.15 299)"
    stroke-linecap="round"
    stroke-width="4"
  />
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
