import { json } from "@sveltejs/kit";
import { z } from "zod";
import {
	completePendingHitlRun,
	getPendingHitlRun,
} from "$lib/pipeline/hitl-state";
import { parseJsonRequest } from "$lib/server/request";
import type { RequestHandler } from "./$types";

const ApproveRequestSchema = z.object({
	runId: z.string().min(1),
});

export const POST: RequestHandler = async ({ request }) => {
	const parsed = await parseJsonRequest(
		request,
		ApproveRequestSchema,
		'Expected body { "runId": string }',
	);
	if (!parsed.success) {
		return parsed.response;
	}

	const pending = await getPendingHitlRun(parsed.data.runId);
	if (!pending) {
		return json(
			{ error: "No pending HITL run found for runId" },
			{ status: 404 },
		);
	}

	try {
		const completed = await completePendingHitlRun(
			parsed.data.runId,
			"approved",
			pending.pipeline.architect.poc_plan,
		);
		return json(completed);
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Failed to approve HITL run";
		return json({ error: message }, { status: 500 });
	}
};
