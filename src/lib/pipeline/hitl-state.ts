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
	expiresAt: string;
}

export interface CompletedHitlRun {
	runId: string;
	status: "completed";
	decision: HitlDecisionType;
	humanLatencyMs: number;
	diff: JsonDiffEntry[];
	telemetryLogged: boolean;
	finalOutput: FinalPocOutput;
	pipeline: PipelineResult;
}

const pendingRuns = new Map<string, PendingHitlRun>();
const PENDING_RUN_TTL_MS = 30 * 60 * 1000;

function cleanupExpiredPendingRuns(now = Date.now()): void {
	for (const [runId, run] of pendingRuns) {
		if (new Date(run.expiresAt).getTime() <= now) {
			pendingRuns.delete(runId);
		}
	}
}

export function createPendingHitlRun(
	pipeline: PipelineResult,
	runId = crypto.randomUUID(),
): PendingHitlRun {
	cleanupExpiredPendingRuns();

	const nowMs = Date.now();
	const now = new Date(nowMs).toISOString();
	const run: PendingHitlRun = {
		runId,
		pipeline,
		gate: buildHitlGateData(pipeline),
		createdAt: now,
		gateDisplayedAt: now,
		expiresAt: new Date(nowMs + PENDING_RUN_TTL_MS).toISOString(),
	};
	pendingRuns.set(run.runId, run);
	return run;
}

export function getPendingHitlRun(runId: string): PendingHitlRun | undefined {
	cleanupExpiredPendingRuns();
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

	const telemetryLogged = await logHitlDecision({
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
		telemetryLogged,
		finalOutput: buildFinalPocOutput(pending.pipeline, finalPlan),
		pipeline: pending.pipeline,
	};
}
