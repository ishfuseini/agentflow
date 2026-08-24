<script lang="ts">
  import { AlertTriangle, CheckCircle2 } from "@lucide/svelte";
  import type { TraceSummaryRow, TraceTotals } from "./types";

  interface Props {
    rows: TraceSummaryRow[];
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
          <th class="pb-1.5 pr-2 font-semibold">Agent</th>
          <th class="pb-1.5 pr-2 text-right font-semibold">Latency</th>
          <th class="pb-1.5 pr-2 text-right font-semibold">Tokens</th>
          <th class="pb-1.5 pr-2 text-right font-semibold">Cost</th>
          <th class="pb-1.5 text-right font-semibold">Eval</th>
        </tr>
      </thead>
      <tbody>
        {#each rows as row (row.id)}
          <tr class="border-b border-darkgrey-300/60">
            <td class="py-1.5 pr-2">
              <span class="flex items-center gap-2 font-semibold">
                {#if row.status === "done"}
                  <CheckCircle2
                    aria-hidden="true"
                    class="h-3.5 w-3.5 shrink-0 text-darkcyan-600"
                  />
                {:else if row.status === "warning"}
                  <AlertTriangle
                    aria-hidden="true"
                    class="h-3.5 w-3.5 shrink-0 text-sienna-600"
                  />
                {:else}
                  <span
                    class={`h-2.5 w-2.5 shrink-0 rounded-full ${
                      row.status === "running"
                        ? "animate-pulse bg-rebeccapurple-500"
                        : "bg-darkgrey-400"
                    }`}
                  ></span>
                {/if}
                {row.label}
              </span>
            </td>
            <td class="py-1.5 pr-2 text-right tabular-nums">{row.latency}</td>
            <td class="py-1.5 pr-2 text-right tabular-nums">{row.tokens}</td>
            <td class="py-1.5 pr-2 text-right tabular-nums">{row.cost}</td>
            <td class="py-1.5 text-right tabular-nums">{row.eval}</td>
          </tr>
        {/each}
      </tbody>
      <tfoot>
        <tr class="font-semibold text-foreground-muted">
          <td class="pt-2 pr-2">Total</td>
          <td class="pt-2 pr-2 text-right tabular-nums">{totals.latency}</td>
          <td class="pt-2 pr-2 text-right tabular-nums">{totals.tokens}</td>
          <td class="pt-2 pr-2 text-right tabular-nums">{totals.cost}</td>
          <td class="pt-2 text-right tabular-nums">eval {totals.eval}</td>
        </tr>
      </tfoot>
    </table>
  </div>
</section>
