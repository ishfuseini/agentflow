import type {
	ArchitectOutput,
	PocPlan,
	QualifierOutput,
	RiskCheckerOutput,
	RiskItem,
} from "$lib/agents/types";
import type { RoutingMode } from "$lib/pipeline/routing";

export type AgentId =
	| "qualifier"
	| "architect"
	| "riskChecker"
	| "hitl"
	| "orchestrator"
	| "mcpTools";
export type AgentNodeState = "idle" | "running" | "done" | "warning" | "paused";
export type ChatRole = "user" | "system";

export interface ChatMessage {
	id: string;
	role: ChatRole;
	text: string;
	/** Brand logo shown inside the bubble (from the confirmed brand_search candidate) */
	logoUrl?: string;
	logoAlt?: string;
}

/** Streaming token view for an agent (kept for the LLMStreamBlock component). */
export interface AgentStreamView {
	agentId: Exclude<AgentId, "hitl">;
	label: string;
	text: string;
	status: "idle" | "streaming" | "done";
}

/** Step detail for agent execution tracking */
export interface AgentStep {
	id: string;
	label: string;
	status: "pending" | "running" | "done" | "warning";
	detail?: string;
}

/** Node card data with step tracking and tool-call details */
export interface AgentNodeData {
	id: AgentId;
	label: string;
	subtitle: string;
	state: AgentNodeState;
	riskSummary?: RiskItem[];
	reviewReason?: string;
	proposedPlan?: PocPlan;
	steps?: AgentStep[];
	currentStep?: number;
}

export interface TraceObservationRow {
	id: string;
	name: string;
	type: "SPAN" | "AGENT" | "GENERATION" | "EVENT";
	latency: string;
	tokens: string;
	cost: string;
	level: "DEFAULT" | "ERROR" | "WARNING";
}

export interface TraceTotals {
	latency: string;
	tokens: string;
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
