import type { PocPlan } from "$lib/agents/types";
import type { PipelineResult, ToolCallRecord } from "./orchestrator";

export type PipelineStatus = "completed" | "paused";
export type HitlDecisionType = "approved" | "edited";

export interface RiskPolicyResult {
	required_controls?: unknown;
	risk_flags?: unknown;
	hitl_required?: boolean;
	review_reason?: string;
}

export interface HitlGateData {
	proposedPlan: PocPlan;
	highSeverityRisks: PipelineResult["riskChecker"]["risks"];
	review_reason?: string;
	riskPolicy: RiskPolicyResult | null;
}

export interface FinalPocOutput {
	pocPlan: PocPlan;
	architectureSummary: string;
	deploymentNotes: string;
	namedUseCases: string[];
	successCriteria: string[];
	exitCriteria: string[];
	risks: PipelineResult["riskChecker"]["risks"];
	evalScores: PipelineResult["riskChecker"]["eval_scores"];
	overallScore: number;
	recommendation: string;
}

export interface JsonDiffEntry {
	path: string;
	before: unknown;
	after: unknown;
}

const RISK_POLICY_TOOL = "risk_policy_lookup";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonString(value: string): unknown {
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
}

function getTextBlockValue(block: unknown): string | undefined {
	if (
		isRecord(block) &&
		block.type === "text" &&
		typeof block.text === "string"
	) {
		return block.text;
	}
	return undefined;
}

function extractJsonFromBlocks(
	blocks: readonly unknown[],
): unknown | undefined {
	const text = blocks.map(getTextBlockValue).find(Boolean);
	return text ? parseJsonString(text) : undefined;
}

function normalizeToolResult(value: unknown): unknown {
	if (typeof value === "string") {
		return parseJsonString(value);
	}

	if (Array.isArray(value)) {
		return extractJsonFromBlocks(value) ?? value;
	}

	const text = getTextBlockValue(value);
	if (text) {
		return parseJsonString(text);
	}

	if (isRecord(value) && Array.isArray(value.content)) {
		return extractJsonFromBlocks(value.content) ?? value;
	}

	return value;
}

function getRiskPolicyToolCall(
	toolCalls: readonly ToolCallRecord[],
): ToolCallRecord | undefined {
	return toolCalls.find(
		(call) => call.agent === "riskChecker" && call.tool === RISK_POLICY_TOOL,
	);
}

export function extractRiskPolicyResult(
	toolCalls: readonly ToolCallRecord[],
): RiskPolicyResult | null {
	const result = normalizeToolResult(getRiskPolicyToolCall(toolCalls)?.result);
	return isRecord(result) ? (result as RiskPolicyResult) : null;
}

export function buildHitlGateData(result: PipelineResult): HitlGateData {
	const riskPolicy = extractRiskPolicyResult(result.toolCalls);
	const highSeverityRisks = result.riskChecker.risks.filter(
		(risk) => risk.severity === "high",
	);

	return {
		proposedPlan: result.architect.poc_plan,
		highSeverityRisks,
		...(riskPolicy?.review_reason
			? { review_reason: riskPolicy.review_reason }
			: {}),
		riskPolicy,
	};
}

export function shouldPauseForHitl(result: PipelineResult): boolean {
	const riskPolicy = extractRiskPolicyResult(result.toolCalls);
	const hasHighSeverityRisk = result.riskChecker.risks.some(
		(risk) => risk.severity === "high",
	);
	return riskPolicy?.hitl_required === true || hasHighSeverityRisk;
}

export function buildFinalPocOutput(
	result: PipelineResult,
	pocPlan: PocPlan,
): FinalPocOutput {
	return {
		pocPlan,
		architectureSummary: result.architect.architecture_summary,
		deploymentNotes: result.architect.deployment_notes,
		namedUseCases: result.qualifier.named_use_cases,
		successCriteria: result.qualifier.success_criteria,
		exitCriteria: result.qualifier.exit_criteria,
		risks: result.riskChecker.risks,
		evalScores: result.riskChecker.eval_scores,
		overallScore: result.riskChecker.overall_score,
		recommendation: result.riskChecker.recommendation,
	};
}

function isComparableObject(value: unknown): value is Record<string, unknown> {
	return isRecord(value);
}

function diffValues(
	before: unknown,
	after: unknown,
	path: string,
): JsonDiffEntry[] {
	if (Object.is(before, after)) {
		return [];
	}

	if (Array.isArray(before) && Array.isArray(after)) {
		const maxLength = Math.max(before.length, after.length);
		const entries: JsonDiffEntry[] = [];
		for (let index = 0; index < maxLength; index += 1) {
			entries.push(
				...diffValues(before[index], after[index], `${path}[${index}]`),
			);
		}
		return entries;
	}

	if (isComparableObject(before) && isComparableObject(after)) {
		const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
		const entries: JsonDiffEntry[] = [];
		for (const key of keys) {
			const childPath = path ? `${path}.${key}` : key;
			entries.push(...diffValues(before[key], after[key], childPath));
		}
		return entries;
	}

	return [{ path, before, after }];
}

export function diffPocPlans(before: PocPlan, after: PocPlan): JsonDiffEntry[] {
	return diffValues(before, after, "");
}
