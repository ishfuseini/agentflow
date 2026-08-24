import { json } from "@sveltejs/kit";
import type { z } from "zod";

type ParsedJsonRequest<T> =
	| {
			success: true;
			data: T;
	  }
	| {
			success: false;
			response: Response;
	  };

export async function parseJsonRequest<T>(
	request: Request,
	schema: z.ZodType<T>,
	expectedBodyMessage: string,
): Promise<ParsedJsonRequest<T>> {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return {
			success: false,
			response: json(
				{ error: "Request body must be valid JSON" },
				{ status: 400 },
			),
		};
	}

	const parsed = schema.safeParse(body);
	if (!parsed.success) {
		return {
			success: false,
			response: json({ error: expectedBodyMessage }, { status: 400 }),
		};
	}

	return {
		success: true,
		data: parsed.data,
	};
}
