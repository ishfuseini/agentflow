import { json } from "@sveltejs/kit";
import { z } from "zod";
import {
	type BrandContext,
	parseDiagramData,
	renderDiagramHtml,
} from "$lib/diagram/render";
import { createAgentflowMcpServer, MCP_TOOL_NAMES } from "$lib/mcp/server";
import type { RequestHandler } from "./$types";

/**
 * On-demand architecture diagram fetch (mcp-tool-integration spec).
 *
 * `arch_diagram` is never called by an agent: the client requests a diagram
 * after a run completes, which structurally guarantees risk evaluation
 * (risk_policy_lookup) finished first. For non-curated patterns the tool
 * returns available=false with an explanatory message and no diagram renders.
 */

const DiagramRequestSchema = z.object({
	patternId: z.string().min(1),
	brand: z
		.object({
			companyName: z.string().optional(),
			logoUrl: z.string().optional(),
		})
		.nullish(),
	fallbackTitle: z.string().min(1),
	subtitle: z.string().optional(),
});

/** MCP tools return their JSON payload as a text content block. */
function parseToolResult(result: unknown): Record<string, unknown> {
	const blocks = Array.isArray(result)
		? result
		: ((result as { content?: unknown[] } | null | undefined)?.content ?? []);
	const text = (blocks as Array<{ type?: string; text?: string }>).find(
		(block) => block.type === "text",
	)?.text;
	if (!text) {
		throw new Error("arch_diagram returned no text content block");
	}
	return JSON.parse(text) as Record<string, unknown>;
}

export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: "Request body must be valid JSON" }, { status: 400 });
	}
	const parsed = DiagramRequestSchema.safeParse(body);
	if (!parsed.success) {
		return json(
			{
				error:
					'Expected body { "patternId": string, "brand"?: { "companyName"?: string, "logoUrl"?: string }, "fallbackTitle": string, "subtitle"?: string }',
			},
			{ status: 400 },
		);
	}

	const { patternId, brand, fallbackTitle, subtitle } = parsed.data;
	const server = createAgentflowMcpServer([MCP_TOOL_NAMES.archDiagram]);
	try {
		await server.connect();
		const result = parseToolResult(
			await server.callTool(MCP_TOOL_NAMES.archDiagram, {
				pattern_id: patternId,
			}),
		);

		const diagram = parseDiagramData(result.diagram_data);
		if (result.available !== true || !diagram) {
			return json({
				status: "unavailable",
				message:
					typeof result.message === "string"
						? result.message
						: "No diagram available for this pattern.",
			});
		}

		const brandContext: BrandContext | null =
			brand && (brand.companyName ?? brand.logoUrl) ? brand : null;
		return json({
			status: "ok",
			html: renderDiagramHtml({
				diagram,
				brand: brandContext,
				fallbackTitle,
				...(subtitle ? { subtitle } : {}),
			}),
		});
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Diagram fetch failed";
		return json({ error: message }, { status: 500 });
	} finally {
		await server.close().catch(() => undefined);
	}
};
