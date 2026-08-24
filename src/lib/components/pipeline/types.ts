import type {
	ArchitectOutput,
	PocPlan,
	QualifierOutput,
	RiskCheckerOutput,
	RiskItem,
} from "$lib/agents/types";
import type { RoutingMode } from "$lib/pipeline/routing";

export type AgentId = "qualifier" | "architect" | "riskChecker" | "hitl";
export type AgentNodeState = "idle" | "running" | "done" | "warning" | "paused";
export type ChatRole = "user" | "system";

export interface ChatMessage {
	id: string;
	role: ChatRole;
	text: string;
}

/** Streaming token view for an agent (kept for the LLMStreamBlock component). */
export interface AgentStreamView {
	agentId: Exclude<AgentId, "hitl">;
	label: string;
	text: string;
	status: "idle" | "streaming" | "done";
}

/** Compact node card data — no per-step or tool-call content inside the graph nodes. */
export interface AgentNodeData {
	id: AgentId;
	label: string;
	subtitle: string;
	state: AgentNodeState;
	riskSummary?: RiskItem[];
	reviewReason?: string;
	proposedPlan?: PocPlan;
}

export interface TraceSummaryRow {
	id: string;
	label: string;
	status: "pending" | "running" | "done" | "warning";
	latency: string;
	cost: string;
	eval: string;
}

export interface TraceTotals {
	latency: string;
	cost: string;
	eval: string;
}

export interface PipelineResponse {
	status: "paused" | "completed";
	runId: string;
	gate?: {
		proposedPlan: PocPlan;
		highSeverityRisks: RiskItem[];
		review_reason?: string;
	};
	finalOutput?: FinalPocOutputView;
	pipeline: PipelineView;
}

export interface HitlCompletionResponse {
	runId: string;
	status: "completed";
	decision: "approved" | "edited";
	humanLatencyMs: number;
	finalOutput: FinalPocOutputView;
	pipeline: PipelineView;
}

export interface PipelineView {
	runId: string;
	prompt: string;
	routingMode: RoutingMode;
	domain?: string;
	qualifier: QualifierOutput;
	architect: ArchitectOutput;
	riskChecker: RiskCheckerOutput;
	toolCalls: Array<{
		agent: "architect" | "riskChecker";
		tool: string;
		arguments: unknown;
		result: unknown;
	}>;
	traces: Array<{
		agent: "qualifier" | "architect" | "riskChecker";
		latencyMs: number;
		costUsd: number;
		evalScore?: number;
		tokenCount: number;
	}>;
}

export interface FinalPocOutputView {
	pocPlan: PocPlan;
	architectureSummary: string;
	deploymentNotes: string;
	namedUseCases: string[];
	successCriteria: string[];
	exitCriteria: string[];
	risks: RiskItem[];
	overallScore: number;
	recommendation: string;
}
