import type { ResumeData } from "@reactive-resume/schema/resume/data";

export type TailorLanguage = "pt-BR" | "en-US";

export type TailorPreviewInput = {
	jobDescription: string;
	company: string;
	role: string;
	language: TailorLanguage;
	useMasterDossier: boolean;
};

export type TailorDiff = {
	headline: { original: string; tailored: string };
	summary: { original: string; tailored: string };
	educationDescription: { original: string; tailored: string };
	experiences: Array<{
		id: string;
		company: string;
		originalPosition: string;
		tailoredPosition: string;
		period: string;
		hidden: boolean;
		originalBullets: string[];
		tailoredBullets: string[];
	}>;
	projects: Array<{
		id: string;
		name: string;
		hidden: boolean;
		originalDescription: string;
		tailoredDescription: string;
	}>;
	skills: Array<{ name: string; proficiency: string }>;
	injectedSkills: string[];
	hiddenSections: string[];
};

export type TailorPreviewResponse = {
	baseResumeId: string;
	baseResumeName: string;
	suggestedName: string;
	language: TailorLanguage;
	usedMasterDossier: boolean;
	originalData: ResumeData;
	tailoredData: ResumeData;
	diff: TailorDiff;
};

export type ForkResumeWithDataInput = {
	name?: string | undefined;
	company?: string | undefined;
	role?: string | undefined;
	data: ResumeData;
};

export type ForkResumeWithDataResponse = {
	id: string;
	name: string;
	slug: string;
	redirectUrl: string;
};

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
	try {
		const body = (await response.json()) as { message?: string };
		if (body?.message) return body.message;
	} catch {
		// Fall back to generic message when body isn't JSON.
	}
	return fallback;
}

export async function requestTailorPreview(
	resumeId: string,
	input: TailorPreviewInput,
): Promise<TailorPreviewResponse> {
	const response = await fetch(`/api/resume/${encodeURIComponent(resumeId)}/tailor-preview`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		credentials: "include",
		body: JSON.stringify(input),
	});
	if (!response.ok) {
		throw new Error(await readErrorMessage(response, "Failed to generate AI tailored resume preview."));
	}
	return (await response.json()) as TailorPreviewResponse;
}

export async function requestForkWithData(
	resumeId: string,
	input: ForkResumeWithDataInput,
): Promise<ForkResumeWithDataResponse> {
	const response = await fetch(`/api/resume/${encodeURIComponent(resumeId)}/fork-with-data`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		credentials: "include",
		body: JSON.stringify(input),
	});
	if (!response.ok) {
		throw new Error(await readErrorMessage(response, "Failed to fork tailored resume."));
	}
	return (await response.json()) as ForkResumeWithDataResponse;
}
