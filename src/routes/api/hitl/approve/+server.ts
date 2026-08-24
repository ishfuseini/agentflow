import { json } from "@sveltejs/kit";
import { z } from "zod";
import {
	completePendingHitlRun,
	getPendingHitlRun,
} from "$lib/pipeline/hitl-state";
import type { RequestHandler } from "./$types";

const ApproveRequestSchema = z.object({
	runId: z.string().min(1),
});

export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: "Request body must be valid JSON" }, { status: 400 });
	}

	const parsed = ApproveRequestSchema.safeParse(body);
	if (!parsed.success) {
		return json(
			{ error: 'Expected body { "runId": string }' },
			{ status: 400 },
		);
	}

	const pending = getPendingHitlRun(parsed.data.runId);
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
