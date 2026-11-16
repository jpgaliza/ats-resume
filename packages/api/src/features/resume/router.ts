import z from "zod";
import { resumeDataSchema } from "@reactive-resume/schema/resume/data";
import { writableResumeDataSchema } from "@reactive-resume/schema/resume/write";
import { protectedProcedure, publicProcedure } from "../../context";
import { crudRouter } from "./crud";
import { updatesRouter } from "./event-router";
import { getRootResume } from "./root";
import { ownerViewer, sharingRouter } from "./sharing";
import { resumeStatisticsRouter } from "./statistics";
import { tagsRouter } from "./tags";
import {
	forkResumeWithData,
	forkWithDataInputSchema,
	forkWithDataOutputSchema,
	tailorDiffSchema,
	tailorLanguageSchema,
	tailorPreviewInputSchema,
	tailorResumePreview,
} from "./tailor";
import { versionsRouter } from "./versions";

const tailorPreviewOutputSchema = z.object({
	baseResumeId: z.string(),
	baseResumeName: z.string(),
	suggestedName: z.string(),
	language: tailorLanguageSchema,
	usedMasterDossier: z.boolean(),
	originalData: resumeDataSchema,
	tailoredData: resumeDataSchema,
	diff: tailorDiffSchema,
});

export const resumeRouter = {
	getRoot: publicProcedure
		.route({ tags: ["Internal"] })
		.handler(({ context }) => getRootResume({ requestHeaders: context.reqHeaders, ...ownerViewer(context) })),
	tags: tagsRouter,
	statistics: resumeStatisticsRouter,
	updates: updatesRouter,

	list: crudRouter.list,
	getById: crudRouter.getById,
	getBySlug: sharingRouter.getBySlug,
	previewUrl: sharingRouter.previewUrl,
	checkSlug: sharingRouter.checkSlug,
	create: crudRouter.create,
	import: crudRouter.import,
	update: crudRouter.update,
	patch: crudRouter.patch,
	setLocked: crudRouter.setLocked,
	setPassword: sharingRouter.setPassword,
	verifyPassword: sharingRouter.verifyPassword,
	removePassword: sharingRouter.removePassword,
	duplicate: crudRouter.duplicate,
	delete: crudRouter.delete,
	tailorPreview: protectedProcedure
		.route({
			method: "POST",
			path: "/resumes/{id}/tailor-preview",
			tags: ["Resumes"],
			operationId: "tailorResumePreview",
			summary: "Generate an AI-tailored preview of a resume",
			description:
				"Generates an ATS-tailored preview using the local LLM and Master Dossier without modifying the base resume.",
		})
		.input(tailorPreviewInputSchema.extend({ id: z.string().min(1) }))
		.output(tailorPreviewOutputSchema)
		.handler(({ context, input, signal }) =>
			tailorResumePreview({
				userId: context.user.id,
				resumeId: input.id,
				input,
				signal,
			}),
		),
	forkWithData: protectedProcedure
		.route({
			method: "POST",
			path: "/resumes/{id}/fork-with-data",
			tags: ["Resumes"],
			operationId: "forkResumeWithData",
			summary: "Fork a resume with tailored resume data",
			description: "Creates a new resume branch seeded with tailored ResumeData and returns its builder URL.",
		})
		.input(
			forkWithDataInputSchema.omit({ data: true }).extend({
				id: z.string().min(1),
				data: writableResumeDataSchema,
			}),
		)
		.output(forkWithDataOutputSchema)
		.handler(({ context, input }) =>
			forkResumeWithData({
				userId: context.user.id,
				resumeId: input.id,
				input: { ...input, data: input.data as Record<string, unknown> },
			}),
		),
	listVersions: versionsRouter.listVersions,
	getVersion: versionsRouter.getVersion,
	createVersion: versionsRouter.createVersion,
	renameVersion: versionsRouter.renameVersion,
	deleteVersion: versionsRouter.deleteVersion,
	restoreVersion: versionsRouter.restoreVersion,
};
