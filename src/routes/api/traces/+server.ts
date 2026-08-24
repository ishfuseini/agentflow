import { json } from "@sveltejs/kit";
import { z } from "zod";
import { fetchRunTraces } from "$lib/pipeline/langfuse";
import type { RequestHandler } from "./$types";

const TracesQuerySchema = z.object({
	runId: z.string().min(1),
});

export const GET: RequestHandler = async ({ url }) => {
	const parsed = TracesQuerySchema.safeParse({
		runId: url.searchParams.get("runId"),
	});
	if (!parsed.success) {
		return json(
			{ error: 'Expected query parameter "runId" (non-empty string)' },
			{ status: 400 },
		);
	}

	try {
		const summary = await fetchRunTraces(parsed.data.runId);
		return json(summary);
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Failed to fetch run traces";
		return json({ error: message }, { status: 500 });
	}
};
