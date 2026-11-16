import type { AuthSession } from "@reactive-resume/auth/types";
import type { User } from "better-auth";
import { and, eq, isNull } from "drizzle-orm";
import { createDefaultOwnedApplicationLanes } from "@reactive-resume/db/application-lanes";
import { db } from "@reactive-resume/db/client";
import * as schema from "@reactive-resume/db/schema";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { generateId } from "@reactive-resume/utils/string";
import { loadMasterDossier } from "../resume/dossier";

export const LOCAL_USER = {
	id: "local-user-jpgaliza",
	name: "João Pedro",
	email: "jpfgaliza@gmail.com",
	username: "jpgaliza",
	displayUsername: "jpgaliza",
	emailVerified: true,
	image: null,
	twoFactorEnabled: false,
	isAnonymous: false,
	locale: "en-US",
	timezone: "America/Fortaleza",
	role: "user",
	banned: false,
	banReason: null,
	banExpires: null,
} as const;

let pendingProvision: Promise<User> | null = null;

async function provisionLocalUserAndSeed(): Promise<User> {
	let [userRow] = await db.select().from(schema.user).where(eq(schema.user.id, LOCAL_USER.id)).limit(1);

	if (!userRow) {
		await db
			.insert(schema.user)
			.values({ ...LOCAL_USER })
			.onConflictDoNothing();

		[userRow] = await db.select().from(schema.user).where(eq(schema.user.id, LOCAL_USER.id)).limit(1);

		if (!userRow) {
			[userRow] = await db.select().from(schema.user).where(eq(schema.user.email, LOCAL_USER.email)).limit(1);
		}
		if (!userRow) {
			throw new Error("Failed to provision default local user.");
		}
	}

	await db.insert(schema.applicationLane).values(createDefaultOwnedApplicationLanes(userRow.id)).onConflictDoNothing();

	const [existingResume] = await db
		.select({ id: schema.resume.id })
		.from(schema.resume)
		.where(and(eq(schema.resume.userId, userRow.id), isNull(schema.resume.trashedAt)))
		.limit(1);

	if (!existingResume) {
		const [anyResume] = await db
			.select({ id: schema.resume.id })
			.from(schema.resume)
			.where(eq(schema.resume.userId, userRow.id))
			.limit(1);

		if (!anyResume) {
			const dossier = loadMasterDossier();
			const baseData = structuredClone(dossier.resumeJson ?? defaultResumeData);
			const resumeId = "base-resume-jpgaliza";
			const slug = "curriculo-base-joao-pedro";

			await db
				.insert(schema.resume)
				.values({
					id: resumeId,
					name: "Currículo Base — João Pedro",
					slug,
					tags: ["base"],
					isPrimary: true,
					autoName: false,
					autoSlug: false,
					userId: userRow.id,
					data: baseData,
				})
				.onConflictDoNothing();

			await db
				.insert(schema.resumeVersion)
				.values({
					id: generateId(),
					resumeId,
					userId: userRow.id,
					data: baseData,
					kind: "created",
				})
				.onConflictDoNothing();
		}
	}

	return userRow;
}

/**
 * Ensures the single local default user (João Pedro / jpgaliza) and an initial base resume
 * exist in the database, returning the persisted User record.
 */
export function ensureLocalDefaultUser(): Promise<User> {
	if (!pendingProvision) {
		pendingProvision = provisionLocalUserAndSeed().finally(() => {
			pendingProvision = null;
		});
	}
	return pendingProvision;
}

export function buildLocalAuthSession(user: User): AuthSession {
	const now = new Date();
	const oneYearLater = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
	return {
		user: user as AuthSession["user"],
		session: {
			id: "local-session-jpgaliza",
			userId: user.id,
			token: "local-session-token",
			createdAt: new Date(0),
			updatedAt: now,
			expiresAt: oneYearLater,
			ipAddress: "127.0.0.1",
			userAgent: "local",
			impersonatedBy: null,
		},
	};
}
