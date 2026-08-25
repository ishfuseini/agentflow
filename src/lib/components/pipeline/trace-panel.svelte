<script lang="ts">
  import { AlertTriangle, CheckCircle2 } from "@lucide/svelte";
  import type { TraceObservationRow, TraceTotals } from "./types";

  interface Props {
    rows: TraceObservationRow[];
    totals: TraceTotals;
    routingMode: string;
  }

  let { rows, totals, routingMode }: Props = $props();
</script>

<section
  class="flex h-full min-h-0 flex-col rounded-md border border-darkgrey-300 bg-background p-3"
>
  <div class="mb-3 flex shrink-0 items-center justify-between">
    <h2 class="font-heading text-sm font-semibold text-darkcyan-700">
      Trace Summary
    </h2>
    <span class="text-xs text-foreground-muted">{routingMode}</span>
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto">
    <table class="w-full border-collapse text-xs">
      <thead>
        <tr
          class="border-b-2 border-darkgrey-300 text-left text-foreground-muted"
        >
          <th class="pb-1.5 pr-2 font-semibold">Name</th>
          <th class="pb-1.5 pr-2 font-semibold">Type</th>
          <th class="pb-1.5 pr-2 text-right font-semibold">Latency</th>
          <th class="pb-1.5 pr-2 text-right font-semibold">Tokens</th>
          <th class="pb-1.5 pr-2 text-right font-semibold">Cost</th>
          <th class="pb-1.5 text-right font-semibold">Level</th>
        </tr>
      </thead>
      <tbody>
        {#each rows as row (row.id)}
          <tr class="border-b border-darkgrey-300/60">
            <td class="py-1.5 pr-2 font-medium">{row.name}</td>
            <td class="py-1.5 pr-2">
              <span
                class={`rounded-sm px-1.5 py-0.5 text-[10px] font-semibold ${
                  row.type === "AGENT"
                    ? "bg-rebeccapurple-100 text-rebeccapurple-800"
                    : row.type === "GENERATION"
                      ? "bg-darkcyan-100 text-darkcyan-800"
                      : row.type === "SPAN"
                        ? "bg-darkgrey-200 text-darkgrey-700"
                        : "bg-sienna-100 text-sienna-800"
                }`}
              >
                {row.type}
              </span>
            </td>
            <td class="py-1.5 pr-2 text-right tabular-nums">{row.latency}</td>
            <td class="py-1.5 pr-2 text-right tabular-nums">{row.tokens}</td>
            <td class="py-1.5 pr-2 text-right tabular-nums">{row.cost}</td>
            <td class="py-1.5 text-right">
              {#if row.level === "ERROR"}
                <AlertTriangle
                  aria-hidden="true"
                  class="ml-auto h-3.5 w-3.5 text-sienna-600"
                />
              {:else if row.level === "WARNING"}
                <AlertTriangle
                  aria-hidden="true"
                  class="ml-auto h-3.5 w-3.5 text-amber-600"
                />
              {:else}
                <CheckCircle2
                  aria-hidden="true"
                  class="ml-auto h-3.5 w-3.5 text-darkcyan-600"
                />
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
      <tfoot>
        <tr
          class="border-t-2 border-darkgrey-300 font-semibold text-foreground-muted"
        >
          <td class="pt-2 pr-2" colspan="2">Total</td>
          <td class="pt-2 pr-2 text-right tabular-nums">{totals.latency}</td>
          <td class="pt-2 pr-2 text-right tabular-nums">{totals.tokens}</td>
          <td class="pt-2 pr-2 text-right tabular-nums">{totals.cost}</td>
          <td class="pt-2 text-right tabular-nums">eval {totals.eval}</td>
        </tr>
      </tfoot>
    </table>
  </div>
</section>
