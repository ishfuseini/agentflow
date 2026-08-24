import { json } from "@sveltejs/kit";
import { z } from "zod";
import { buildFinalPocOutput, shouldPauseForHitl } from "$lib/pipeline/hitl";
import { createPendingHitlRun } from "$lib/pipeline/hitl-state";
import { runPipeline, runSingleAgent } from "$lib/pipeline/orchestrator";
import { ROUTING_MODES } from "$lib/pipeline/routing";
import type { RequestHandler } from "./$types";

const RunRequestSchema = z.object({
	prompt: z.string().min(1),
	routingMode: z.enum(ROUTING_MODES).default("cost"),
	/** Optional customer domain, passed through to the Architect's brand_context_lookup call */
	domain: z.string().min(1).optional(),
	/**
	 * Optional run id chosen by the client so it can poll trace data while the
	 * pipeline is still running. The server generates one when omitted.
	 */
	runId: z.string().min(1).optional(),
	/**
	 * Optional agent id to run a single agent incrementally.
	 * When provided, runs only that agent using stored intermediate state.
	 */
	agentId: z.enum(["qualifier", "architect", "riskChecker"]).optional(),
	/**
	 * Previous agent output to pass as input when running incrementally.
	 */
	previousOutput: z.unknown().optional(),
});

type RunRequest = z.infer<typeof RunRequestSchema>;

function parseRunRequest(body: unknown): RunRequest | undefined {
	const parsed = RunRequestSchema.safeParse(body);
	return parsed.success ? parsed.data : undefined;
}

export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: "Request body must be valid JSON" }, { status: 400 });
	}

	const runRequest = parseRunRequest(body);
	if (!runRequest) {
		return json(
			{
				error:
					'Expected body { "prompt": string (non-empty), "routingMode": "cost" | "intelligence", "domain"?: string, "runId"?: string }',
			},
			{ status: 400 },
		);
	}

	try {
		const runId = runRequest.runId ?? crypto.randomUUID();

		// Incremental single-agent execution
		if (runRequest.agentId) {
			const singleResult = await runSingleAgent(
				runRequest.agentId,
				runRequest.prompt,
				runRequest.routingMode,
				runRequest.previousOutput,
				runRequest.domain,
				runId,
			);
			return json({
				status: "agent-complete",
				runId,
				agentId: singleResult.agentId,
				output: singleResult.output,
				toolCalls: singleResult.toolCalls,
			});
		}

		// Full pipeline execution (legacy)
		const result = await runPipeline(
			runRequest.prompt,
			runRequest.routingMode,
			runRequest.domain,
			runId,
		);
		if (shouldPauseForHitl(result)) {
			const pending = await createPendingHitlRun(result, runId);
			return json({
				status: "paused",
				runId: pending.runId,
				gate: pending.gate,
				pipeline: result,
			});
		}

		return json({
			status: "completed",
			runId,
			finalOutput: buildFinalPocOutput(result, result.architect.poc_plan),
			pipeline: result,
		});
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Pipeline execution failed";
		return json({ error: message }, { status: 500 });
	}
};
