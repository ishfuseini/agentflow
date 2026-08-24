<script lang="ts">
  import { RotateCcw, Send } from "@lucide/svelte";
  import { SCENARIOS } from "$lib/pipeline/scenarios";
  import type { ChatMessage, FinalPocOutputView } from "./types";
  import OutputPanel from "./output-panel.svelte";

  interface Props {
    messages: ChatMessage[];
    disabled: boolean;
    canReset: boolean;
    output: FinalPocOutputView | null;
    onSend: (prompt: string, domain?: string) => void;
    onReset: () => void;
  }

  let { messages, disabled, canReset, output, onSend, onReset }: Props =
    $props();
  let draft = $state("");
  let activeTab = $state<"chat" | "results">("chat");

  function submitDraft(): void {
    const prompt = draft.trim();
    if (!prompt || disabled) {
      return;
    }
    draft = "";
    activeTab = "chat";
    onSend(prompt);
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }
    event.preventDefault();
    submitDraft();
  }

  function selectScenario(prompt: string, domain?: string): void {
    if (disabled) {
      return;
    }
    activeTab = "chat";
    onSend(prompt, domain);
  }

  function tabClass(tab: "chat" | "results"): string {
    return tab === activeTab
      ? "rounded-sm bg-rebeccapurple-500 px-3 py-1 text-xs font-semibold text-white"
      : "rounded-sm px-3 py-1 text-xs font-semibold text-foreground-muted transition hover:bg-darkgrey-200";
  }
</script>

<aside class="flex h-full min-h-0 flex-col bg-background">
  <div class="shrink-0 p-4">
    <h2
      class="mb-2 font-heading text-sm font-semibold uppercase text-darkcyan-700"
    >
      Quick Scenarios
    </h2>
    <div class="grid grid-cols-2 gap-2">
      {#each SCENARIOS as scenario (scenario.id)}
        <button
          class="rounded-md border border-darkgrey-400 bg-darkgrey-50 px-3 py-2 text-left text-sm font-semibold text-foreground transition hover:border-rebeccapurple-300 hover:bg-darkgrey-200 disabled:cursor-not-allowed disabled:opacity-50"
          {disabled}
          onclick={() => selectScenario(scenario.prompt, scenario.domain)}
          type="button"
        >
          {scenario.name}
        </button>
      {/each}
    </div>
    <hr class="mt-4 border-t-2 border-darkgrey-300">
    <div class="mt-4 flex items-center justify-between gap-3">
      <div
        aria-label="Chat sections"
        class="flex items-center gap-1"
        role="tablist"
      >
        <button
          aria-selected={activeTab === "chat"}
          class={tabClass("chat")}
          onclick={() => {
            activeTab = "chat";
          }}
          role="tab"
          type="button"
        >
          Chat
        </button>
        <button
          aria-selected={activeTab === "results"}
          class={tabClass("results")}
          onclick={() => {
            activeTab = "results";
          }}
          role="tab"
          type="button"
        >
          Results
        </button>
      </div>
      {#if canReset}
        <button
          class="flex items-center gap-1 text-xs font-semibold text-darkcyan-700 transition hover:text-darkcyan-900"
          onclick={onReset}
          type="button"
        >
          <RotateCcw aria-hidden="true" class="h-3.5 w-3.5" />
          <span>&larr; New conversation</span>
        </button>
      {/if}
    </div>
  </div>

  {#if activeTab === "chat"}
    <div
      class="flex min-h-0 flex-1 flex-col justify-end overflow-y-auto px-4 pb-4"
    >
      <div class="space-y-3">
        {#each messages as message (message.id)}
          <div
            class={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <p
              class={`max-w-[86%] whitespace-pre-wrap rounded-md border px-3 py-2 text-sm leading-snug ${
								message.role === "user"
									? "rounded-br-sm border-darkgrey-300 bg-white text-foreground"
									: "rounded-bl-sm border-darkgrey-300 bg-[color-mix(in_oklch,var(--color-background),white_42%)] text-foreground"
							}`}
            >
              {message.text}
            </p>
          </div>
        {:else}
          <p
            class="rounded-md border border-darkgrey-300 bg-white p-3 text-sm text-foreground-muted"
          >
            Select a scenario or enter a custom presales ask.
          </p>
        {/each}
      </div>
    </div>

    <form
      class="flex shrink-0 items-end gap-2 border-t-2 border-darkgrey-300 p-4"
      onsubmit={(event) => {
				event.preventDefault();
				submitDraft();
			}}
    >
      <label class="sr-only" for="agent-prompt">Message</label>
      <textarea
        class="min-h-9 flex-1 resize-none rounded-md border-2 border-darkgrey-300 bg-darkgrey-50 px-3 py-2 text-sm leading-tight outline-none transition focus:border-rebeccapurple-400 disabled:opacity-50"
        {disabled}
        id="agent-prompt"
        onkeydown={handleKeydown}
        placeholder="Describe the customer ask..."
        rows="2"
        bind:value={draft}
      ></textarea>
      <button
        aria-label="Send message"
        class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-rebeccapurple-500 text-white transition hover:bg-rebeccapurple-600 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled || draft.trim().length === 0}
        type="submit"
      >
        <Send aria-hidden="true" class="h-4 w-4" />
      </button>
    </form>
  {:else}
    <div class="min-h-0 flex-1 overflow-y-auto">
      <OutputPanel {output} />
    </div>
  {/if}
</aside>
