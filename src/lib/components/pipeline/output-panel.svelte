<script lang="ts">
  import type { DiagramUnavailableReason } from "$lib/diagram/render";
  import type { FinalPocOutputView } from "./types";

  interface Props {
    output: FinalPocOutputView | null;
    /** Self-contained diagram HTML, or null when no diagram is available */
    diagramHtml: string | null;
    /** Why no diagram is available, when there is none */
    diagramUnavailable: DiagramUnavailableReason | null;
  }

  let { output, diagramHtml, diagramUnavailable }: Props = $props();

  const sections = $derived(
    output
      ? [
          { id: "use-cases", title: "Use cases", items: output.namedUseCases },
          {
            id: "success",
            title: "Success criteria",
            items: output.successCriteria,
          },
          { id: "exit", title: "Exit criteria", items: output.exitCriteria },
          {
            id: "risks",
            title: "Risks",
            items: output.risks.map(
              (risk) => `${risk.severity}: ${risk.issue}`,
            ),
          },
        ]
      : [],
  );
</script>

<div class="p-5">
  {#if output}
    <header class="mb-5">
      <div class="flex items-center gap-2">
        <h2 class="font-heading text-xl font-semibold text-rebeccapurple-500">
          POC Plan
        </h2>
        <span
          class="rounded-sm bg-darkcyan-600 px-2 py-0.5 text-xs font-semibold uppercase text-white"
        >
          draft
        </span>
      </div>
      <p class="mt-2 text-sm leading-snug text-foreground-muted">
        {output.architectureSummary}
      </p>
    </header>

    <section
      class="mb-5 rounded-md border-2 border-darkgrey-300 bg-darkgrey-100 p-3"
    >
      <h3 class="font-heading text-sm font-semibold text-darkcyan-700">
        Scope
      </h3>
      <p class="mt-2 text-sm leading-snug">{output.pocPlan.scope}</p>
      <dl class="mt-3 grid gap-2 text-xs text-foreground-muted">
        <div>
          <dt class="font-semibold text-foreground">Timeline</dt>
          <dd>{output.pocPlan.timeline}</dd>
        </div>
        <div>
          <dt class="font-semibold text-foreground">Resources</dt>
          <dd>{output.pocPlan.resource_estimate}</dd>
        </div>
      </dl>
    </section>

    <div class="space-y-4">
      {#each sections as section, si (section.id)}
        <section
          class="animate-section rounded-md border border-darkgrey-300 bg-darkgrey-100/70 p-3"
          style={`animation-delay: ${si * 0.12}s`}
        >
          <h3 class="font-heading text-sm font-semibold text-darkcyan-700">
            {section.title}
          </h3>
          <ul class="mt-2 space-y-2 text-sm leading-snug">
            {#each section.items as item (item)}
              <li class="flex gap-2">
                <span
                  class="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-rebeccapurple-500"
                ></span>
                <span>{item}</span>
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    </div>

    <section class="mt-5">
      <h3 class="font-heading text-sm font-semibold text-darkcyan-700">
        Architecture
      </h3>
      {#if diagramHtml}
        <iframe
          class="mt-2 h-[420px] w-full rounded-md border border-darkgrey-300 bg-[#020617]"
          srcdoc={diagramHtml}
          title="Architecture diagram"
        ></iframe>
      {:else}
        <p class="mt-2 text-sm leading-snug text-foreground-muted">
          {diagramUnavailable === "weak-match"
            ? "No architecture diagram — the pattern match was low-confidence, so no reference diagram is available."
            : "No architecture diagram available for this scenario."}
        </p>
      {/if}
    </section>
  {:else}
    <header>
      <h2 class="font-heading text-xl font-semibold text-rebeccapurple-500">
        Awaiting Results
      </h2>
      <p class="mt-2 text-sm leading-snug text-foreground-muted">
        The final POC plan appears after human review.
      </p>
    </header>
  {/if}
</div>

<style>
  .animate-section {
    animation: section-in 280ms ease both;
  }

  @keyframes section-in {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
