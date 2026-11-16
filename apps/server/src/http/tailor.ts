import { ORPCError } from "@orpc/client";
import { ZodError, flattenError } from "zod";
import { resolveUserFromRequestHeaders } from "@reactive-resume/api/context";
import {
	forkResumeWithData,
	forkWithDataInputSchema,
	tailorPreviewInputSchema,
	tailorResumePreview,
} from "@reactive-resume/api/features/resume/tailor";

function jsonError(error: unknown) {
	if (error instanceof ZodError) {
		return Response.json(
			{ code: "BAD_REQUEST", message: "Invalid request payload.", issues: flattenError(error) },
			{ status: 400 },
		);
	}
	if (error instanceof ORPCError) {
		const statusMap: Record<string, number> = {
			UNAUTHORIZED: 401,
			FORBIDDEN: 403,
			NOT_FOUND: 404,
			CONFLICT: 409,
			BAD_REQUEST: 400,
			BAD_GATEWAY: 502,
		};
		const status = error.status || statusMap[error.code] || 500;
		return Response.json({ code: error.code, message: error.message }, { status });
	}
	const message = error instanceof Error ? error.message : "Internal server error";
	return Response.json({ code: "INTERNAL_SERVER_ERROR", message }, { status: 500 });
}

export async function handleTailorPreview(request: Request, resumeId: string): Promise<Response> {
	try {
		const user = await resolveUserFromRequestHeaders(request.headers);
		if (!user) return Response.json({ code: "UNAUTHORIZED", message: "Authentication required." }, { status: 401 });

		const body = (await request.json()) as unknown;
		const input = tailorPreviewInputSchema.parse(body);
		const result = await tailorResumePreview({
			userId: user.id,
			resumeId,
			input,
			signal: request.signal,
		});
		return Response.json(result, { status: 200, headers: { "Cache-Control": "private, no-store" } });
	} catch (error) {
		return jsonError(error);
	}
}

export async function handleForkWithData(request: Request, resumeId: string): Promise<Response> {
	try {
		const user = await resolveUserFromRequestHeaders(request.headers);
		if (!user) return Response.json({ code: "UNAUTHORIZED", message: "Authentication required." }, { status: 401 });

		const body = (await request.json()) as unknown;
		const input = forkWithDataInputSchema.parse(body);
		const result = await forkResumeWithData({
			userId: user.id,
			resumeId,
			input,
		});
		return Response.json(result, { status: 201, headers: { "Cache-Control": "private, no-store" } });
	} catch (error) {
		return jsonError(error);
	}
}
