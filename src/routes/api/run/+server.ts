import { json } from "@sveltejs/kit";
import { z } from "zod";
import {
	ArchitectOutputSchema,
	QualifierOutputSchema,
} from "$lib/agents/types";
import { buildFinalPocOutput, shouldPauseForHitl } from "$lib/pipeline/hitl";
import { createPendingHitlRun } from "$lib/pipeline/hitl-state";
import {
	type PipelineResult,
	runPipeline,
	runSingleAgent,
	type ToolCallRecord,
} from "$lib/pipeline/orchestrator";
import { ROUTING_MODES } from "$lib/pipeline/routing";
import type { RequestHandler } from "./$types";

const ToolCallRecordSchema = z.object({
	agent: z.enum(["architect", "riskChecker"]),
	tool: z.string(),
	arguments: z.unknown(),
	result: z.unknown(),
});

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
	/**
	 * Qualifier output from the first incremental step. Required on the
	 * riskChecker step, where the server assembles the three agent outputs into
	 * a full PipelineResult so the HITL gate can open.
	 */
	qualifierOutput: z.unknown().optional(),
	/**
	 * MCP tool calls captured by earlier incremental steps. The risk policy
	 * lookup that decides the HITL gate lives alongside the Architect's calls,
	 * so the gate needs both agents' calls in one list.
	 */
	priorToolCalls: z.array(ToolCallRecordSchema).default([]),
});

type RunRequest = z.infer<typeof RunRequestSchema>;

/**
 * The accumulated state the final incremental step needs. Validated with the
 * real agent schemas rather than cast, so a malformed client payload fails
 * with a 400 instead of producing a half-built gate.
 */
const IncrementalHandoffSchema = z.object({
	qualifierOutput: QualifierOutputSchema,
	previousOutput: ArchitectOutputSchema,
});

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
			const step = {
				runId,
				agentId: singleResult.agentId,
				output: singleResult.output,
				toolCalls: singleResult.toolCalls,
			};

			if (runRequest.agentId !== "riskChecker") {
				return json({ status: "agent-complete", ...step });
			}

			// Final step: reassemble the run so the HITL gate can be opened and
			// stored for /api/hitl/approve and /api/hitl/edit to pick up.
			const handoff = IncrementalHandoffSchema.safeParse(runRequest);
			if (!handoff.success) {
				return json(
					{
						error:
							"The riskChecker step needs qualifierOutput and previousOutput (the Architect output) from the earlier steps",
					},
					{ status: 400 },
				);
			}
			const pipeline: PipelineResult = {
				runId,
				prompt: runRequest.prompt,
				routingMode: runRequest.routingMode,
				...(runRequest.domain ? { domain: runRequest.domain } : {}),
				qualifier: handoff.data.qualifierOutput,
				architect: handoff.data.previousOutput,
				riskChecker: singleResult.output as PipelineResult["riskChecker"],
				toolCalls: [
					...(runRequest.priorToolCalls as ToolCallRecord[]),
					...singleResult.toolCalls,
				],
				traces: [singleResult.trace],
			};

			if (shouldPauseForHitl(pipeline)) {
				const pending = await createPendingHitlRun(pipeline, runId);
				return json({
					status: "paused",
					...step,
					gate: pending.gate,
					pipeline,
				});
			}
			return json({
				status: "completed",
				...step,
				finalOutput: buildFinalPocOutput(pipeline, pipeline.architect.poc_plan),
				pipeline,
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
