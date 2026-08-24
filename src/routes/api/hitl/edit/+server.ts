import { json } from "@sveltejs/kit";
import { z } from "zod";
import { PocPlanSchema } from "$lib/agents/types";
import { completePendingHitlRun } from "$lib/pipeline/hitl-state";
import { parseJsonRequest } from "$lib/server/request";
import type { RequestHandler } from "./$types";

const EditRequestSchema = z.object({
	runId: z.string().min(1),
	pocPlan: PocPlanSchema,
});

export const POST: RequestHandler = async ({ request }) => {
	const parsed = await parseJsonRequest(
		request,
		EditRequestSchema,
		'Expected body { "runId": string, "pocPlan": { "scope": string, "timeline": string, "data_zones": string[], "integrations": string[], "resource_estimate": string } }',
	);
	if (!parsed.success) {
		return parsed.response;
	}

	try {
		const completed = await completePendingHitlRun(
			parsed.data.runId,
			"edited",
			parsed.data.pocPlan,
		);
		if (!completed) {
			return json(
				{ error: "No pending HITL run found for runId" },
				{ status: 404 },
			);
		}
		return json(completed);
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Failed to edit HITL run";
		return json({ error: message }, { status: 500 });
	}
};
