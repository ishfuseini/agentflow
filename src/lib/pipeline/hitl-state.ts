import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
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

const PENDING_RUN_TTL_MS = 30 * 60 * 1000;
const DEFAULT_PENDING_STORE_PATH = ".data/hitl-pending-runs.json";

interface PendingHitlRunStore {
	save: (run: PendingHitlRun) => Promise<void>;
	get: (runId: string) => Promise<PendingHitlRun | undefined>;
	delete: (runId: string) => Promise<void>;
	cleanupExpired: (now?: number) => Promise<void>;
}

type PendingHitlRunFile = Record<string, PendingHitlRun>;

class FilePendingHitlRunStore implements PendingHitlRunStore {
	private readonly filePath: string;
	private writeQueue: Promise<void> = Promise.resolve();

	constructor(filePath: string) {
		this.filePath = resolve(filePath);
	}

	async save(run: PendingHitlRun): Promise<void> {
		await this.withWriteLock(async () => {
			const runs = await this.readRuns();
			runs[run.runId] = run;
			await this.writeRuns(runs);
		});
	}

	async get(runId: string): Promise<PendingHitlRun | undefined> {
		await this.cleanupExpired();
		const runs = await this.readRuns();
		return runs[runId];
	}

	async delete(runId: string): Promise<void> {
		await this.withWriteLock(async () => {
			const runs = await this.readRuns();
			if (runs[runId]) {
				delete runs[runId];
				await this.writeRuns(runs);
			}
		});
	}

	async cleanupExpired(now = Date.now()): Promise<void> {
		await this.withWriteLock(async () => {
			const runs = await this.readRuns();
			let changed = false;
			for (const [runId, run] of Object.entries(runs)) {
				if (new Date(run.expiresAt).getTime() <= now) {
					delete runs[runId];
					changed = true;
				}
			}
			if (changed) {
				await this.writeRuns(runs);
			}
		});
	}

	private async readRuns(): Promise<PendingHitlRunFile> {
		try {
			const content = await readFile(this.filePath, "utf8");
			const parsed: unknown = JSON.parse(content);
			return isPendingRunFile(parsed) ? parsed : {};
		} catch (error) {
			if (isNodeError(error) && error.code === "ENOENT") {
				return {};
			}
			throw error;
		}
	}

	private async writeRuns(runs: PendingHitlRunFile): Promise<void> {
		await mkdir(dirname(this.filePath), { recursive: true });
		const temporaryPath = `${this.filePath}.tmp`;
		await writeFile(temporaryPath, JSON.stringify(runs, null, 2), "utf8");
		await rename(temporaryPath, this.filePath);
	}

	private withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
		const nextOperation = this.writeQueue.then(operation, operation);
		this.writeQueue = nextOperation.then(
			() => undefined,
			() => undefined,
		);
		return nextOperation;
	}
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}

function isPendingRunFile(value: unknown): value is PendingHitlRunFile {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		Object.values(value).every(isPendingHitlRun)
	);
}

function isPendingHitlRun(value: unknown): value is PendingHitlRun {
	return (
		typeof value === "object" &&
		value !== null &&
		"runId" in value &&
		typeof value.runId === "string" &&
		"expiresAt" in value &&
		typeof value.expiresAt === "string"
	);
}

const pendingHitlRunStore = new FilePendingHitlRunStore(
	process.env.HITL_PENDING_STORE_PATH ?? DEFAULT_PENDING_STORE_PATH,
);

export async function createPendingHitlRun(
	pipeline: PipelineResult,
	runId: string = crypto.randomUUID(),
): Promise<PendingHitlRun> {
	await pendingHitlRunStore.cleanupExpired();

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
	await pendingHitlRunStore.save(run);
	return run;
}

export function getPendingHitlRun(
	runId: string,
): Promise<PendingHitlRun | undefined> {
	return pendingHitlRunStore.get(runId);
}

export async function completePendingHitlRun(
	runId: string,
	decision: HitlDecisionType,
	finalPlan: PocPlan,
): Promise<CompletedHitlRun | undefined> {
	const pending = await getPendingHitlRun(runId);
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

	await pendingHitlRunStore.delete(runId);

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
