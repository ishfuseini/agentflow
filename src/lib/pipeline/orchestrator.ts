import { type RunItem, run } from "@openai/agents";
import { createArchitectAgent } from "$lib/agents/architect";
import { createQualifierAgent } from "$lib/agents/qualifier";
import { createRiskCheckerAgent } from "$lib/agents/risk-checker";
import type {
	ArchitectOutput,
	QualifierOutput,
	RiskCheckerOutput,
} from "$lib/agents/types";
import {
	ARCHITECT_MCP_TOOLS,
	createAgentflowMcpServer,
	RISK_CHECKER_MCP_TOOLS,
} from "$lib/mcp/server";
import { type RoutingMode, resolveAgentModels } from "./routing";

/** Agents that call MCP tools during a run (the Qualifier makes no tool calls). */
export type ToolCallingAgent = "architect" | "riskChecker";

/** A single MCP tool call captured from a run, with its parsed arguments and result. */
export interface ToolCallRecord {
	agent: ToolCallingAgent;
	tool: string;
	arguments: unknown;
	result: unknown;
}

export interface PipelineResult {
	prompt: string;
	routingMode: RoutingMode;
	/** Customer domain used for brand_context_lookup, when one was provided */
	domain?: string;
	qualifier: QualifierOutput;
	architect: ArchitectOutput;
	riskChecker: RiskCheckerOutput;
	/** Every MCP tool call made by the Architect and Risk Checker agents, in call order */
	toolCalls: ToolCallRecord[];
}

function parseJsonOrRaw(value: unknown): unknown {
	if (typeof value !== "string") {
		return value;
	}
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
}

/**
 * Extracts MCP tool calls from a run's items, pairing each call with its output
 * by callId. Tool arguments and outputs arrive as JSON text and are parsed when
 * possible so downstream consumers (diagram rendering, HITL gate) get structured
 * data instead of opaque strings.
 */
function extractToolCalls(
	agent: ToolCallingAgent,
	items: readonly RunItem[],
): ToolCallRecord[] {
	const outputsByCallId = new Map<string, unknown>();
	for (const item of items) {
		if (item.type === "tool_call_output_item") {
			outputsByCallId.set(item.callId ?? "", parseJsonOrRaw(item.output));
		}
	}

	const records: ToolCallRecord[] = [];
	for (const item of items) {
		if (item.type !== "tool_call_item") {
			continue;
		}
		const raw = item.rawItem;
		if (raw?.type !== "function_call") {
			continue;
		}
		records.push({
			agent,
			tool: raw.name,
			arguments: parseJsonOrRaw(raw.arguments),
			result: outputsByCallId.get(raw.callId),
		});
	}
	return records;
}

/**
 * Runs the 3-agent sequential pipeline: Qualifier → Architect → Risk Checker.
 *
 * Each agent receives the previous agent's structured JSON output as its input;
 * the Qualifier receives the free-text user prompt (plus an optional customer
 * domain hint that the Architect passes to brand_context_lookup). Zod-validated
 * outputs are handed between agents, so an invalid handoff fails fast instead
 * of poisoning the next agent.
 *
 * The Architect and Risk Checker are wired to the agentflow-mcp server for
 * their tool calls. Server lifecycle is managed per run: connect before the
 * first tool-using agent, close after the run finishes (per the SDK contract).
 */
export async function runPipeline(
	prompt: string,
	routingMode: RoutingMode,
	domain?: string,
): Promise<PipelineResult> {
	const models = resolveAgentModels(routingMode);

	const architectServer = createAgentflowMcpServer(ARCHITECT_MCP_TOOLS);
	const riskCheckerServer = createAgentflowMcpServer(RISK_CHECKER_MCP_TOOLS);

	try {
		// Sequential connect: the first request wakes the scale-to-zero deployment,
		// the second reuses the warm instance.
		await architectServer.connect();
		await riskCheckerServer.connect();

		const qualifierResult = await run(
			createQualifierAgent(models.qualifier),
			prompt,
		);
		const qualifierOutput: QualifierOutput = qualifierResult.finalOutput;

		const architectInput = domain
			? `${JSON.stringify(qualifierOutput)}\n\nCustomer company domain hint — use verbatim as the "domain" argument for brand_context_lookup: ${domain}`
			: JSON.stringify(qualifierOutput);
		const architectResult = await run(
			createArchitectAgent(models.architect, architectServer),
			architectInput,
		);
		const architectOutput: ArchitectOutput = architectResult.finalOutput;

		const riskCheckerResult = await run(
			createRiskCheckerAgent(models.riskChecker, riskCheckerServer),
			JSON.stringify(architectOutput),
		);
		const riskCheckerOutput: RiskCheckerOutput = riskCheckerResult.finalOutput;

		return {
			prompt,
			routingMode,
			...(domain ? { domain } : {}),
			qualifier: qualifierOutput,
			architect: architectOutput,
			riskChecker: riskCheckerOutput,
			toolCalls: [
				...extractToolCalls("architect", architectResult.newItems),
				...extractToolCalls("riskChecker", riskCheckerResult.newItems),
			],
		};
	} finally {
		await Promise.allSettled([
			architectServer.close(),
			riskCheckerServer.close(),
		]);
	}
}
