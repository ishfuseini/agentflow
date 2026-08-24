<script lang="ts">
  import { CheckCircle2 } from "@lucide/svelte";
  import type { AgentStreamView } from "./types";

  interface Props {
    stream: AgentStreamView;
  }

  let { stream }: Props = $props();
</script>

<article
  class="min-h-[112px] rounded-md border border-darkgrey-300 bg-background"
>
  <header
    class="flex items-center justify-between gap-3 rounded-t-md border-b border-darkgrey-300 bg-darkgrey-200/50 px-3 py-2"
  >
    <p class="font-heading text-sm font-semibold">{stream.label}</p>
    {#if stream.status === "done"}
      <CheckCircle2 aria-label="done" class="h-4 w-4 text-darkcyan-600" />
    {/if}
  </header>
  <p
    class="min-h-16 whitespace-pre-wrap px-3 py-2 text-xs leading-snug text-foreground-muted"
  >
    {stream.text}
    {#if stream.status === "streaming"}
      <span
        class="ml-0.5 inline-block h-4 w-1 animate-pulse bg-rebeccapurple-500 align-text-bottom"
      ></span>
    {/if}
  </p>
</article>
