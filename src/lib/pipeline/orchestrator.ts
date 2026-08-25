import { type Agent, type RunItem, type RunResult, run } from "@openai/agents";
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
import { configureAgentsTracing } from "./agents-tracing";
import {
	type AgentTraceRecord,
	traceAgentRun,
	tracePipelineRun,
} from "./langfuse";
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
	runId: string;
	prompt: string;
	routingMode: RoutingMode;
	/** Customer domain used for brand_context_lookup, when one was provided */
	domain?: string;
	qualifier: QualifierOutput;
	architect: ArchitectOutput;
	riskChecker: RiskCheckerOutput;
	/** Every MCP tool call made by the Architect and Risk Checker agents, in call order */
	toolCalls: ToolCallRecord[];
	/** Per-agent Langfuse trace records, keyed to the same runId/sessionId */
	traces: AgentTraceRecord[];
}

function parseJsonText(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

type ContentBlock = { type?: unknown; text?: unknown };
type ContentEnvelope = { type?: unknown; text?: unknown; content?: unknown };

const isContentBlock = (value: unknown): value is ContentBlock =>
	typeof value === "object" && value !== null;

const isContentEnvelope = (value: unknown): value is ContentEnvelope =>
	typeof value === "object" && value !== null;

const extractTextFromBlock = (block: ContentBlock): string | null =>
	block.type === "text" && typeof block.text === "string" ? block.text : null;

const extractTextFromBlocks = (blocks: unknown[]): string | null => {
	for (const block of blocks) {
		if (isContentBlock(block)) {
			const text = extractTextFromBlock(block);
			if (text !== null) return text;
		}
	}
	return null;
};

/**
 * MCP tool outputs arrive as content blocks — a single `{ type: "text", text }`
 * object, a content-block array, or a `{ content: [...] }` envelope — with the
 * JSON payload inside the text block. Unwraps that envelope so downstream
 * consumers (diagram rendering, HITL gate) get structured data instead of
 * opaque strings.
 */
function parseJsonOrRaw(value: unknown): unknown {
	if (typeof value === "string") {
		return parseJsonText(value);
	}
	if (Array.isArray(value)) {
		const text = extractTextFromBlocks(value);
		return text !== null ? parseJsonText(text) : value;
	}
	if (isContentEnvelope(value)) {
		const inlineText = extractTextFromBlock(value);
		if (inlineText !== null) return parseJsonText(inlineText);
		if (Array.isArray(value.content)) return parseJsonOrRaw(value.content);
	}
	return value;
}

function requireFinalOutput<T>(output: T | undefined, agentName: string): T {
	if (output === undefined) {
		throw new Error(`${agentName} completed without final structured output.`);
	}
	return output;
}

/**
 * The 20B cost model intermittently emits off-schema final output after
 * several tool calls; the SDK then throws "Invalid output type". One retry
 * with a fresh run keeps cost mode viable without masking real failures.
 */
async function runAgentWithOutputRetry<TAgent extends Agent<any, any>>(
	agent: TAgent,
	input: string,
): Promise<RunResult<undefined, TAgent>> {
	try {
		return await run(agent, input);
	} catch (error) {
		if (
			error instanceof Error &&
			error.message.includes("Invalid output type")
		) {
			return await run(agent, input);
		}
		throw error;
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
	runId: string = crypto.randomUUID(),
): Promise<PipelineResult> {
	configureAgentsTracing();
	const models = resolveAgentModels(routingMode);

	const architectServer = createAgentflowMcpServer(ARCHITECT_MCP_TOOLS);
	const riskCheckerServer = createAgentflowMcpServer(RISK_CHECKER_MCP_TOOLS);

	try {
		// Sequential connect: the first request wakes the scale-to-zero deployment,
		// the second reuses the warm instance.
		await architectServer.connect();
		await riskCheckerServer.connect();

		const { result } = await tracePipelineRun({
			runId,
			prompt,
			routingMode,
			execute: async () => {
				let currentAgent = "Requirements Agent";
				try {
				const { result: qualifierResult, trace: qualifierTrace } =
					await traceAgentRun({
						runId,
						agentKey: "qualifier",
						agentName: "Requirements Agent",
						routingMode,
						model: models.qualifier,
						input: prompt,
						execute: () =>
							runAgentWithOutputRetry(createQualifierAgent(models.qualifier.model), prompt),
					});
				const qualifierOutput: QualifierOutput = requireFinalOutput(
					qualifierResult.finalOutput,
					"Requirements Agent",
				);

				currentAgent = "Architect Agent";
				const architectInput = domain
					? `${JSON.stringify(qualifierOutput)}\n\nCustomer company domain hint — use verbatim as the "domain" argument for brand_context_lookup: ${domain}`
					: JSON.stringify(qualifierOutput);
				const { result: architectResult, trace: architectTrace } =
					await traceAgentRun({
						runId,
						agentKey: "architect",
						agentName: "Architect Agent",
						routingMode,
						model: models.architect,
						input: architectInput,
						execute: () =>
							runAgentWithOutputRetry(
								createArchitectAgent(models.architect.model, architectServer),
								architectInput,
							),
					});
				const architectOutput: ArchitectOutput = requireFinalOutput(
					architectResult.finalOutput,
					"Architect Agent",
				);

				currentAgent = "Risk Agent";
				const riskCheckerInput = JSON.stringify(architectOutput);
				const { result: riskCheckerResult, trace: riskCheckerTrace } =
					await traceAgentRun({
						runId,
						agentKey: "riskChecker",
						agentName: "Risk Agent",
						routingMode,
						model: models.riskChecker,
						input: riskCheckerInput,
						execute: () =>
							runAgentWithOutputRetry(
								createRiskCheckerAgent(
									models.riskChecker.model,
									riskCheckerServer,
								),
								riskCheckerInput,
							),
						getEvalScore: (riskResult) => riskResult.finalOutput?.overall_score,
					});
				const riskCheckerOutput: RiskCheckerOutput = requireFinalOutput(
					riskCheckerResult.finalOutput,
					"Risk Agent",
				);

				return {
					qualifier: qualifierOutput,
					architect: architectOutput,
					riskChecker: riskCheckerOutput,
					toolCalls: [
						...extractToolCalls("architect", architectResult.newItems),
						...extractToolCalls("riskChecker", riskCheckerResult.newItems),
					],
					traces: [qualifierTrace, architectTrace, riskCheckerTrace],
				};
				} catch (error) {
					throw new Error(
						`${currentAgent} failed: ${error instanceof Error ? error.message : error}`,
					);
				}
			},
		});

		return {
			runId,
			prompt,
			routingMode,
			...(domain ? { domain } : {}),
			...result,
		};
	} finally {
		await Promise.allSettled([
			architectServer.close(),
			riskCheckerServer.close(),
		]);
	}
}

export interface SingleAgentResult {
	agentId: "qualifier" | "architect" | "riskChecker";
	output: QualifierOutput | ArchitectOutput | RiskCheckerOutput;
	trace: AgentTraceRecord;
	toolCalls: ToolCallRecord[];
}

/**
 * Runs a single agent incrementally, using previous agent output as input.
 * Used for per-step confirmation flow where user approves each agent before running.
 */
export async function runSingleAgent(
	agentId: "qualifier" | "architect" | "riskChecker",
	prompt: string,
	routingMode: RoutingMode,
	previousOutput?: unknown,
	domain?: string,
	runId: string = crypto.randomUUID(),
): Promise<SingleAgentResult> {
	configureAgentsTracing();
	const models = resolveAgentModels(routingMode);

	if (agentId === "qualifier") {
		const { result, trace } = await traceAgentRun({
			runId,
			agentKey: "qualifier",
			agentName: "Requirements Agent",
			routingMode,
			model: models.qualifier,
			input: prompt,
			execute: () => runAgentWithOutputRetry(createQualifierAgent(models.qualifier.model), prompt),
		});
		const output: QualifierOutput = requireFinalOutput(
			result.finalOutput,
			"Requirements Agent",
		);
		return {
			agentId: "qualifier",
			output,
			trace,
			toolCalls: [],
		};
	}

	if (agentId === "architect") {
		const architectServer = createAgentflowMcpServer(ARCHITECT_MCP_TOOLS);
		try {
			await architectServer.connect();
			const architectInput = domain
				? `${JSON.stringify(previousOutput)}\n\nCustomer company domain hint — use verbatim as the "domain" argument for brand_context_lookup: ${domain}`
				: JSON.stringify(previousOutput);
			const { result, trace } = await traceAgentRun({
				runId,
				agentKey: "architect",
				agentName: "Architect Agent",
				routingMode,
				model: models.architect,
				input: architectInput,
				execute: () =>
					runAgentWithOutputRetry(
						createArchitectAgent(models.architect.model, architectServer),
						architectInput,
					),
			});
			const output: ArchitectOutput = requireFinalOutput(
				result.finalOutput,
				"Architect Agent",
			);
			return {
				agentId: "architect",
				output,
				trace,
				toolCalls: extractToolCalls("architect", result.newItems),
			};
		} finally {
			await architectServer.close();
		}
	}

	// riskChecker
	const riskCheckerServer = createAgentflowMcpServer(RISK_CHECKER_MCP_TOOLS);
	try {
		await riskCheckerServer.connect();
		const riskCheckerInput = JSON.stringify(previousOutput);
		const { result, trace } = await traceAgentRun({
			runId,
			agentKey: "riskChecker",
			agentName: "Risk Agent",
			routingMode,
			model: models.riskChecker,
			input: riskCheckerInput,
			execute: () =>
				runAgentWithOutputRetry(
					createRiskCheckerAgent(models.riskChecker.model, riskCheckerServer),
					riskCheckerInput,
				),
			getEvalScore: (riskResult) => riskResult.finalOutput?.overall_score,
		});
		const output: RiskCheckerOutput = requireFinalOutput(
			result.finalOutput,
			"Risk Agent",
		);
		return {
			agentId: "riskChecker",
			output,
			trace,
			toolCalls: extractToolCalls("riskChecker", result.newItems),
		};
	} finally {
		await riskCheckerServer.close();
	}
}
