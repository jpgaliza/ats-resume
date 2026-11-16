// SPA session lookup. This stays in apps/web because @reactive-resume/auth is server-only.

import type { AuthSession } from "@reactive-resume/auth/types";
import { authClient } from "./client";

const LOCAL_FALLBACK_SESSION: AuthSession = {
	user: {
		id: "local-user-jpgaliza",
		name: "João Pedro",
		email: "jpfgaliza@gmail.com",
		emailVerified: true,
		image: null,
		createdAt: new Date(0),
		updatedAt: new Date(0),
		username: "jpgaliza",
		displayUsername: "jpgaliza",
		twoFactorEnabled: false,
		timezone: "America/Fortaleza",
		locale: "en-US",
		role: "user",
		banned: false,
		banReason: null,
		banExpires: null,
		isAnonymous: false,
	},
	session: {
		id: "local-session-jpgaliza",
		userId: "local-user-jpgaliza",
		token: "local-session-token",
		createdAt: new Date(0),
		updatedAt: new Date(0),
		expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
		ipAddress: "127.0.0.1",
		userAgent: "local",
		impersonatedBy: null,
	},
};

export const getSession = async (): Promise<AuthSession | null> => {
	try {
		const { data, error } = await authClient.getSession();
		if (!error && data) return data as AuthSession;
	} catch {
		// Fall back to the local single-user session.
	}
	return LOCAL_FALLBACK_SESSION;
};
