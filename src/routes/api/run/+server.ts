import { json } from "@sveltejs/kit";
import { z } from "zod";
import { buildFinalPocOutput, shouldPauseForHitl } from "$lib/pipeline/hitl";
import { createPendingHitlRun } from "$lib/pipeline/hitl-state";
import { runPipeline } from "$lib/pipeline/orchestrator";
import { ROUTING_MODES } from "$lib/pipeline/routing";
import type { RequestHandler } from "./$types";

const RunRequestSchema = z.object({
	prompt: z.string().min(1),
	routingMode: z.enum(ROUTING_MODES).default("cost"),
	/** Optional customer domain, passed through to the Architect's brand_context_lookup call */
	domain: z.string().min(1).optional(),
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
					'Expected body { "prompt": string (non-empty), "routingMode": "cost" | "intelligence", "domain"?: string }',
			},
			{ status: 400 },
		);
	}

	try {
		const result = await runPipeline(
			runRequest.prompt,
			runRequest.routingMode,
			runRequest.domain,
		);
		const runId = crypto.randomUUID();
		if (shouldPauseForHitl(result)) {
			const pending = createPendingHitlRun(result, runId);
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
