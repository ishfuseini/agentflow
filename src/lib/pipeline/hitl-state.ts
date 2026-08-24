import type { PocPlan } from "$lib/agents/types";
import {
	buildFinalPocOutput,
	buildHitlGateData,
	diffPocPlans,
	type FinalPocOutput,
	type HitlDecisionType,
	type HitlGateData,
	type JsonDiffEntry,
} from "./hitl";
import { logHitlDecision } from "./langfuse";
import type { PipelineResult } from "./orchestrator";

export interface PendingHitlRun {
	runId: string;
	pipeline: PipelineResult;
	gate: HitlGateData;
	createdAt: string;
	gateDisplayedAt: string;
}

export interface CompletedHitlRun {
	runId: string;
	status: "completed";
	decision: HitlDecisionType;
	humanLatencyMs: number;
	diff: JsonDiffEntry[];
	finalOutput: FinalPocOutput;
	pipeline: PipelineResult;
}

const pendingRuns = new Map<string, PendingHitlRun>();

export function createPendingHitlRun(pipeline: PipelineResult): PendingHitlRun {
	const now = new Date().toISOString();
	const run: PendingHitlRun = {
		runId: crypto.randomUUID(),
		pipeline,
		gate: buildHitlGateData(pipeline),
		createdAt: now,
		gateDisplayedAt: now,
	};
	pendingRuns.set(run.runId, run);
	return run;
}

export function getPendingHitlRun(runId: string): PendingHitlRun | undefined {
	return pendingRuns.get(runId);
}

export async function completePendingHitlRun(
	runId: string,
	decision: HitlDecisionType,
	finalPlan: PocPlan,
): Promise<CompletedHitlRun | undefined> {
	const pending = getPendingHitlRun(runId);
	if (!pending) {
		return undefined;
	}

	const humanLatencyMs =
		Date.now() - new Date(pending.gateDisplayedAt).getTime();
	const diff =
		decision === "edited"
			? diffPocPlans(pending.pipeline.architect.poc_plan, finalPlan)
			: [];

	await logHitlDecision({
		runId,
		decision,
		humanLatencyMs,
		originalPlan: pending.pipeline.architect.poc_plan,
		finalPlan,
		diff,
	});

	pendingRuns.delete(runId);

	return {
		runId,
		status: "completed",
		decision,
		humanLatencyMs,
		diff,
		finalOutput: buildFinalPocOutput(pending.pipeline, finalPlan),
		pipeline: pending.pipeline,
	};
}
