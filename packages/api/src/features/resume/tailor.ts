import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { ORPCError } from "@orpc/client";
import { generateText } from "ai";
import { jsonrepair } from "jsonrepair";
import z from "zod";
import { env } from "@reactive-resume/env/server";
import { parseResumeData } from "@reactive-resume/schema/resume/data";
import { generateId } from "@reactive-resume/utils/string";
import { loadMasterDossier } from "./dossier";
import { parseStoredResumeData } from "./resume-data-validation";
import { resumeService } from "./service";

export const tailorLanguageSchema = z.enum(["pt-BR", "en-US"]);
export type TailorLanguage = z.infer<typeof tailorLanguageSchema>;

export const tailorPreviewInputSchema = z.object({
	jobDescription: z.string().trim().min(10, "Job description must be at least 10 characters.").max(30_000),
	company: z.string().trim().max(120).optional().default(""),
	role: z.string().trim().max(120).optional().default(""),
	language: tailorLanguageSchema.default("pt-BR"),
	useMasterDossier: z.boolean().default(true),
});

export type TailorPreviewInput = z.infer<typeof tailorPreviewInputSchema>;

export const tailorDiffSchema = z.object({
	headline: z.object({ original: z.string(), tailored: z.string() }),
	summary: z.object({ original: z.string(), tailored: z.string() }),
	educationDescription: z.object({ original: z.string(), tailored: z.string() }),
	experiences: z.array(
		z.object({
			id: z.string(),
			company: z.string(),
			originalPosition: z.string(),
			tailoredPosition: z.string(),
			period: z.string(),
			hidden: z.boolean(),
			originalBullets: z.array(z.string()),
			tailoredBullets: z.array(z.string()),
		}),
	),
	projects: z.array(
		z.object({
			id: z.string(),
			name: z.string(),
			hidden: z.boolean(),
			originalDescription: z.string(),
			tailoredDescription: z.string(),
		}),
	),
	skills: z.array(z.object({ name: z.string(), proficiency: z.string() })),
	injectedSkills: z.array(z.string()),
	hiddenSections: z.array(z.string()),
});

export type TailorDiff = z.infer<typeof tailorDiffSchema>;

export type TailorPreviewResult = {
	baseResumeId: string;
	baseResumeName: string;
	suggestedName: string;
	language: TailorLanguage;
	usedMasterDossier: boolean;
	originalData: ResumeData;
	tailoredData: ResumeData;
	diff: TailorDiff;
};

export const forkWithDataInputSchema = z.object({
	name: z.string().trim().min(1).max(120).optional(),
	company: z.string().trim().max(120).optional().default(""),
	role: z.string().trim().max(120).optional().default(""),
	tags: z.array(z.string().trim().min(1)).optional(),
	data: z.record(z.string(), z.unknown()),
});

export const forkWithDataOutputSchema = z.object({
	id: z.string(),
	name: z.string(),
	slug: z.string(),
	redirectUrl: z.string(),
});

const nullableStringSchema = z
	.union([z.string(), z.number().transform(String)])
	.nullish()
	.transform((value) => (typeof value === "string" ? value : ""))
	.catch("");

const nullableOptionalIdSchema = z
	.union([z.string(), z.number().transform(String)])
	.nullish()
	.transform((value) => (value && value.trim().length > 0 ? value.trim() : undefined))
	.catch(undefined);

const nullableBooleanSchema = z
	.union([z.boolean(), z.string().transform((v) => v.trim().toLowerCase() === "true")])
	.nullish()
	.transform((value) => Boolean(value))
	.catch(false);

const stringOrJoinedArraySchema = z
	.union([
		z.string(),
		z.array(z.unknown()).transform((items) =>
			items
				.map((item) => (typeof item === "string" ? item.trim() : ""))
				.filter(Boolean)
				.join(", "),
		),
	])
	.nullish()
	.transform((value) => (typeof value === "string" ? value : ""))
	.catch("");

const stringListSchema = z
	.union([
		z.array(z.unknown()).transform((items) =>
			items
				.map((item) => {
					if (typeof item === "string") return item.trim();
					if (item && typeof item === "object") {
						const record = item as Record<string, unknown>;
						const candidate = record.name ?? record.skill ?? record.text ?? record.label ?? "";
						return typeof candidate === "string" ? candidate.trim() : "";
					}
					return "";
				})
				.filter(Boolean),
		),
		z.string().transform((value) =>
			value
				.split(/[,;\n]+/)
				.map((v) => v.trim())
				.filter(Boolean),
		),
	])
	.nullish()
	.transform((value) => value ?? [])
	.catch([]);

const llmBulletSchema = z
	.union([
		z.string(),
		z.object({ text: z.string() }).transform((obj) => obj.text),
		z.object({ bullet: z.string() }).transform((obj) => obj.bullet),
		z.object({ description: z.string() }).transform((obj) => obj.description),
		z.object({ content: z.string() }).transform((obj) => obj.content),
	])
	.catch("");

const llmTailoredPayloadSchema = z.object({
	headline: nullableStringSchema,
	summary: nullableStringSchema,
	skillsCategories: z
		.array(
			z.object({
				category: nullableStringSchema.transform((v) => v || "Skills"),
				technologies: stringOrJoinedArraySchema,
			}),
		)
		.nullish()
		.transform((v) => v ?? [])
		.catch([]),
	experiences: z
		.array(
			z.object({
				id: nullableOptionalIdSchema,
				company: nullableStringSchema,
				position: nullableStringSchema,
				hidden: nullableBooleanSchema,
				bullets: z
					.array(llmBulletSchema)
					.nullish()
					.transform((v) => (v ?? []).filter(Boolean))
					.catch([]),
			}),
		)
		.nullish()
		.transform((v) => v ?? [])
		.catch([]),
	educationDescription: nullableStringSchema,
	selectedProjects: z
		.array(
			z.object({
				id: nullableOptionalIdSchema,
				name: nullableStringSchema,
				technologies: stringOrJoinedArraySchema,
				hidden: nullableBooleanSchema,
				description: nullableStringSchema,
			}),
		)
		.nullish()
		.transform((v) => v ?? [])
		.catch([]),
	injectedSkills: stringListSchema,
	hiddenSections: stringListSchema,
});

type LlmTailoredPayload = z.infer<typeof llmTailoredPayloadSchema>;

function normalizeLocalBaseUrl(rawUrl: string): string {
	const trimmed = rawUrl.trim().replace(/\/+$/, "");
	try {
		const parsed = new URL(trimmed);
		if (parsed.pathname === "" || parsed.pathname === "/") {
			parsed.pathname = "/v1";
			return parsed.toString().replace(/\/+$/, "");
		}
		return trimmed;
	} catch {
		return trimmed;
	}
}

export function resolveLocalLlmConfig() {
	const baseURL = normalizeLocalBaseUrl(env.AI_BASE_URL ?? "http://127.0.0.1:11434/v1");
	const model = env.AI_MODEL_NAME ?? env.AI_MODEL ?? "qwen2.5:7b-instruct";
	const apiKey = env.AI_API_KEY ?? "local";
	return { baseURL, model, apiKey };
}

function stripHtml(value: string): string {
	return value
		.replace(/<li[^>]*>/gi, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/\s+/g, " ")
		.trim();
}

function extractBulletsFromHtml(html: string): string[] {
	const liMatches = [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
		.map((match) => stripHtml(match[1] ?? ""))
		.filter(Boolean);
	if (liMatches.length > 0) return liMatches;

	const pMatches = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
		.map((match) => stripHtml(match[1] ?? ""))
		.filter(Boolean);
	if (pMatches.length > 0) return pMatches;

	const plain = stripHtml(html);
	return plain ? [plain] : [];
}

function enforcePortugueseRules(text: string): string {
	return text
		.replace(/\(a\)/gi, "")
		.replace(/\/a\b/gi, "")
		.replace(/\(o\/a\)/gi, "")
		.replace(/\(a\/o\)/gi, "")
		.replace(/\bOptimizou\b/g, "Otimizou")
		.replace(/\boptimizou\b/g, "otimizou")
		.replace(/\bOptimizei\b/g, "Otimizei")
		.replace(/\boptimizei\b/g, "otimizei")
		.replace(/\bOptimização\b/g, "Otimização")
		.replace(/\boptimização\b/g, "otimização")
		.replace(/\bteses e dissertações\b/gi, "Trabalhos de Conclusão de Curso (TCC)")
		.replace(/\s+/g, " ")
		.trim();
}

function sanitizeBulletText(text: string, language: TailorLanguage): string {
	const withoutBrackets = text.replace(/\[([^\]]+)\]/g, "$1");
	const plain = stripHtml(withoutBrackets)
		.replace(/^[-•*]\s+/, "")
		.trim();
	return language === "pt-BR" ? enforcePortugueseRules(plain) : plain;
}

function sanitizeRichText(text: string, language: TailorLanguage): string {
	const trimmed = text.trim();
	if (!trimmed) return "";
	const normalized = language === "pt-BR" ? enforcePortugueseRules(trimmed) : trimmed;
	if (normalized.startsWith("<p>") || normalized.startsWith("<ul>") || normalized.startsWith("<ol>")) {
		return normalized;
	}
	return `<p>${normalized}</p>`;
}

function extractJsonObject(rawText: string): unknown {
	const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(rawText);
	const candidate = (fenced?.[1] ?? rawText).trim();
	const start = candidate.indexOf("{");
	const end = candidate.lastIndexOf("}");
	const slice = start !== -1 && end > start ? candidate.slice(start, end + 1) : candidate;
	const repaired = jsonrepair(slice);
	return JSON.parse(repaired) as unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function unwrapTailoredRoot(raw: unknown): Record<string, unknown> {
	let obj = asRecord(raw) ?? {};
	for (let depth = 0; depth < 2; depth += 1) {
		if ("headline" in obj || "experiences" in obj || "summary" in obj) break;
		const nested =
			asRecord(obj.tailoredResume) ??
			asRecord(obj.tailored_resume) ??
			asRecord(obj.tailoredData) ??
			asRecord(obj.resume) ??
			asRecord(obj.data) ??
			asRecord(obj.result) ??
			asRecord(obj.output);
		if (!nested) break;
		obj = nested;
	}
	return obj;
}

function extractBulletsCandidate(item: Record<string, unknown>): unknown[] {
	const list =
		item.bullets ??
		item.highlights ??
		item.achievements ??
		item.xyzBullets ??
		item.xyz_bullets ??
		item.responsibilities;
	if (Array.isArray(list)) return list;
	if (typeof list === "string" && list.trim()) return extractBulletsFromHtml(list);
	if (Array.isArray(item.description)) return item.description;
	if (typeof item.description === "string" && item.description.trim()) {
		return extractBulletsFromHtml(item.description);
	}
	return [];
}

function normalizeRawTailoredPayload(raw: unknown): Record<string, unknown> {
	const root = unwrapTailoredRoot(raw);
	const basics = asRecord(root.basics);
	const sections = asRecord(root.sections);

	const rawSummary = asRecord(root.summary)?.content ?? root.summary ?? root.resumo;
	const rawSkills = root.skillsCategories ?? root.skills_categories ?? root.skills ?? asRecord(sections?.skills)?.items;
	const rawExperiences = root.experiences ?? root.experience ?? asRecord(sections?.experience)?.items;
	const rawProjects =
		root.selectedProjects ?? root.selected_projects ?? root.projects ?? asRecord(sections?.projects)?.items;
	const rawEducation = asRecord(sections?.education)?.items ?? root.education;
	const firstEducation = Array.isArray(rawEducation) ? asRecord(rawEducation[0]) : asRecord(rawEducation);

	const skillsCategories = Array.isArray(rawSkills)
		? rawSkills.map((entry) => {
				const item = asRecord(entry) ?? {};
				return {
					category: item.category ?? item.name ?? item.group ?? "Skills",
					technologies: item.technologies ?? item.proficiency ?? item.skills ?? item.keywords ?? item.items ?? "",
				};
			})
		: asRecord(rawSkills)
			? Object.entries(rawSkills as Record<string, unknown>).map(([category, technologies]) => ({
					category,
					technologies,
				}))
			: [];

	const expList = Array.isArray(rawExperiences) ? rawExperiences : asRecord(rawExperiences) ? [rawExperiences] : [];

	const experiences = expList.map((entry) => {
		const item = asRecord(entry) ?? {};
		return {
			id: item.id,
			company: item.company ?? item.organization ?? "",
			position: item.position ?? item.role ?? item.title ?? "",
			hidden: item.hidden,
			bullets: extractBulletsCandidate(item),
		};
	});

	const projList = Array.isArray(rawProjects) ? rawProjects : asRecord(rawProjects) ? [rawProjects] : [];

	const selectedProjects = projList.map((entry) => {
		const item = asRecord(entry) ?? {};
		return {
			id: item.id,
			name: item.name ?? item.title ?? "",
			technologies: item.technologies ?? item.stack ?? item.keywords ?? "",
			hidden: item.hidden,
			description: item.description ?? item.summary ?? "",
		};
	});

	return {
		headline: root.headline ?? basics?.headline ?? root.title ?? "",
		summary: rawSummary ?? "",
		skillsCategories,
		experiences,
		educationDescription:
			root.educationDescription ??
			root.education_description ??
			(typeof root.education === "string"
				? root.education
				: (firstEducation?.description ?? firstEducation?.area ?? "")),
		selectedProjects,
		injectedSkills: root.injectedSkills ?? root.injected_skills ?? root.addedSkills ?? root.added_skills ?? [],
		hiddenSections: root.hiddenSections ?? root.hidden_sections ?? [],
	};
}

function tokenizeKeywords(text: string): string[] {
	return text
		.split(/[,;|/\n]+/)
		.map((token) => stripHtml(token).trim())
		.filter((token) => token.length >= 2);
}

function findMatchingCanonicalProject(
	llmProjectName: string,
	catalog: { id: string; name: string; period: string; stack: string; description: string; url: string }[],
) {
	const target = llmProjectName
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
	if (!target) return null;

	return (
		catalog.find((entry) => {
			const canonicalBase = (entry.name.split("|")[0] ?? entry.name)
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, " ")
				.trim();
			return canonicalBase === target || target.includes(canonicalBase) || canonicalBase.includes(target);
		}) ?? null
	);
}

function buildTailoringSystemPrompt(language: TailorLanguage): string {
	const languageRules =
		language === "pt-BR"
			? [
					"OUTPUT LANGUAGE: Brazilian Portuguese (pt-BR) ONLY.",
					"- Use natural, professional Brazilian Portuguese (e.g., 'Otimizou', never European 'Optimizou').",
					"- Use strictly masculine grammatical concordance for the candidate (e.g., 'Estagiário', 'Desenvolvedor', 'Graduando'); NEVER use '(a)', '/a', or '(o/a)'.",
					"- Google XYZ Formula in pt-BR: Every experience bullet and project description MUST follow '[Strong past-tense action verb + impact/outcome (X)], [as measured/evidenced by contextual scale or metric (Y)], [by doing/using specific technology or practice (Z)]'.",
				].join("\n")
			: [
					"OUTPUT LANGUAGE: American English (en-US) ONLY.",
					"- Translate all resume headline, summary, experience positions/bullets, education emphasis, project descriptions, and skill group titles into natural, concise American English.",
					"- Google XYZ Formula in en-US: Every experience bullet and project description MUST strictly follow 'Accomplished [X] as measured by [Y], by doing [Z]'.",
				].join("\n");

	return `You are a senior technical recruiter and ATS optimization specialist.
Your task is to tailor the candidate's resume for maximum ATS score and human readability against the provided target job posting.

${languageRules}

MANDATORY FACTUAL GUARDRAILS (ZERO HALLUCINATION):
1. NEVER invent employers, companies, job titles held at non-existent companies, degrees, schools, or employment/education dates.
2. Only output experience entries corresponding to the candidate's real employers from the Base Resume / Master Dossier.
3. Only select projects from the candidate's real project catalog in the Base Resume / Master Dossier.
4. NEVER put literal square brackets like [Accomplished] or [Implementou] in the text.
5. You ARE encouraged to rewrite descriptions for maximum job fit using the Google XYZ formula, inject relevant technical skills/keywords truthfully supported by the candidate's dossier, reorder/group skills by job relevance, and mark irrelevant projects or optional sections (e.g. interests, awards, volunteer, references, profiles, certifications) as hidden.
6. Headline MUST be concise (<= 65 characters), plain text without HTML, formatted with pipe tokens like: "Target Role | Core Specialty | Top Tech 1 | Top Tech 2".
7. Summary MUST be an HTML paragraph (<p>...</p>) written from the CANDIDATE'S perspective highlighting factual experience and matching skills with <strong> tags (NEVER write "The internship aims to..." or copy job-ad phrasing as if describing the job opening).

RETURN ONLY A SINGLE VALID JSON OBJECT matching this exact structure (no markdown commentary outside JSON):
{
  "headline": "string",
  "summary": "<p>...</p>",
  "skillsCategories": [{ "category": "string", "technologies": "comma, separated, skills" }],
  "experiences": [{ "id": "optional-id", "company": "canonical company name", "position": "tailored factual title", "hidden": false, "bullets": ["XYZ bullet 1", "XYZ bullet 2", "XYZ bullet 3"] }],
  "educationDescription": "<p>...</p>",
  "selectedProjects": [{ "name": "exact project name from dossier", "technologies": "relevant stack", "hidden": false, "description": "<p>XYZ project description</p>" }],
  "injectedSkills": ["keyword1", "keyword2"],
  "hiddenSections": ["interests", "awards", "volunteer", "references"]
}`;
}

function buildTailoringUserPrompt(params: {
	jobDescription: string;
	company: string;
	role: string;
	language: TailorLanguage;
	baseData: ResumeData;
	dossierMarkdown: string;
	allowedCompanies: string[];
	allowedProjects: string[];
}): string {
	const hasDossier = Boolean(params.dossierMarkdown.trim());
	const compactBase = {
		basics: {
			name: params.baseData.basics.name,
			headline: params.baseData.basics.headline,
		},
		summary: stripHtml(params.baseData.summary.content).slice(0, 500),
		experience: params.baseData.sections.experience.items.map((item) => ({
			id: item.id,
			company: item.company,
			position: item.position,
			period: item.period,
			description: stripHtml(item.description).slice(0, hasDossier ? 350 : 1200),
		})),
		education: params.baseData.sections.education.items.map((item) => ({
			id: item.id,
			school: item.school,
			degree: item.degree,
			area: item.area,
			period: item.period,
			...(hasDossier ? {} : { description: stripHtml(item.description) }),
		})),
		...(hasDossier
			? {}
			: {
					projects: params.baseData.sections.projects.items.map((item) => ({
						id: item.id,
						name: item.name,
						period: item.period,
						description: stripHtml(item.description),
					})),
					skills: params.baseData.sections.skills.items.map((item) => ({
						name: item.name,
						proficiency: item.proficiency,
						keywords: item.keywords,
					})),
				}),
	};

	const outputLangDirective =
		params.language === "en-US"
			? "- LANGUAGE REQUIREMENT: Translate and write EVERY output field (headline, summary, positions, experience bullets, educationDescription, project descriptions, skillsCategories categories/names) strictly in fluent American English (en-US). Follow Google XYZ: 'Accomplished [X] as measured by [Y], by doing [Z]'."
			: "- LANGUAGE REQUIREMENT: Write EVERY output field strictly in natural Brazilian Portuguese (pt-BR), using third-person/action-verb phrasing ('Desenvolveu', 'Implementou', 'Otimizou'). Follow XYZ format: '[Ação/Resultado X], [como medido por Y], [por meio de Z]'.";

	return `TARGET APPLICATION:
- Target Company: ${params.company || "Not specified"}
- Target Role: ${params.role || "Infer from job description"}
- Output Language: ${params.language}

TARGET JOB DESCRIPTION:
${params.jobDescription.slice(0, 14_000)}

ALLOWED CANONICAL EMPLOYERS (IMMUTABLE): ${JSON.stringify(params.allowedCompanies)}
ALLOWED CANONICAL PROJECTS (CHOOSE FROM THIS LIST ONLY): ${JSON.stringify(params.allowedProjects)}

CURRENT BASE RESUME JSON:
${JSON.stringify(compactBase, null, 2)}

${params.dossierMarkdown ? `MASTER CANDIDATE DOSSIER (SINGLE SOURCE OF TRUTH):\n${params.dossierMarkdown.slice(0, 12_000)}` : ""}

OUTPUT REQUIREMENTS (CRITICAL):
${outputLangDirective}
- Return ONE JSON object matching the schema.
- Write "experiences": include ONLY the canonical employers (${JSON.stringify(params.allowedCompanies)}). Put personal portfolio projects (${JSON.stringify(params.allowedProjects)}) ONLY inside "selectedProjects", NEVER inside "experiences". Each experience MUST have 3 to 5 detailed Google XYZ bullets describing work at that employer.
- Populate "skillsCategories" with 3 to 5 prioritized categories (comma-separated "technologies") and "injectedSkills" with 4 to 8 matching keywords from the dossier.`;
}

function applyLocalizedSectionTitles(data: ResumeData, language: TailorLanguage): void {
	if (language === "en-US") {
		data.summary.title = "SUMMARY";
		data.sections.experience.title = "EXPERIENCE";
		data.sections.education.title = "EDUCATION";
		data.sections.projects.title = "PROJECTS";
		data.sections.skills.title = "SKILLS";
		data.sections.publications.title = "COURSES & CERTIFICATIONS";
		data.sections.languages.title = "LANGUAGES";
		data.sections.certifications.title = "CERTIFICATIONS";
		data.metadata.page.locale = "en-US";
	} else {
		data.summary.title = "RESUMO";
		data.sections.experience.title = "EXPERIÊNCIA";
		data.sections.education.title = "FORMAÇÃO";
		data.sections.projects.title = "PROJETOS";
		data.sections.skills.title = "HABILIDADES";
		data.sections.publications.title = "CURSOS E CERTIFICAÇÕES";
		data.sections.languages.title = "IDIOMAS";
		data.sections.certifications.title = "CERTIFICAÇÕES";
		data.metadata.page.locale = "pt-BR";
	}
}

const HIDEABLE_SECTIONS = new Set([
	"profiles",
	"interests",
	"awards",
	"certifications",
	"publications",
	"volunteer",
	"references",
	"languages",
	"projects",
]);

function mergeTailoredResumeData(params: {
	originalData: ResumeData;
	dossierResumeJson: ResumeData | null;
	projectCatalog: { id: string; name: string; period: string; stack: string; description: string; url: string }[];
	payload: LlmTailoredPayload;
	language: TailorLanguage;
}): { tailoredData: ResumeData; diff: TailorDiff } {
	const original = structuredClone(params.originalData);
	const tailored = structuredClone(params.originalData);
	applyLocalizedSectionTitles(tailored, params.language);

	// 1. Headline
	const cleanedHeadline = stripHtml(params.payload.headline);
	if (cleanedHeadline) {
		tailored.basics.headline = params.language === "pt-BR" ? enforcePortugueseRules(cleanedHeadline) : cleanedHeadline;
	}

	// 2. Summary
	const cleanedSummary = sanitizeRichText(params.payload.summary, params.language);
	if (cleanedSummary) {
		tailored.summary.content = cleanedSummary;
		tailored.summary.hidden = false;
	}

	// 3. Skills
	const originalSkillText = [
		...original.sections.skills.items.map((item) => `${item.name} ${item.proficiency} ${item.keywords.join(" ")}`),
		stripHtml(original.summary.content),
	]
		.join(" ")
		.toLowerCase();

	if (params.payload.skillsCategories.length > 0) {
		tailored.sections.skills.items = params.payload.skillsCategories.slice(0, 6).map((cat, index) => ({
			id: original.sections.skills.items[index]?.id ?? `skill-${index + 1}-${generateId().slice(0, 8)}`,
			hidden: false,
			icon: "",
			iconColor: "",
			name: `${stripHtml(cat.category).replace(/:+$/, "")}:`,
			proficiency: stripHtml(cat.technologies),
			level: 0,
			keywords: [],
		}));
		tailored.sections.skills.hidden = false;
	}

	const tailoredSkillTokens = tailored.sections.skills.items.flatMap((item) => tokenizeKeywords(item.proficiency));
	const detectedInjected = tailoredSkillTokens.filter((token) => !originalSkillText.includes(token.toLowerCase()));
	const mergedInjected = [
		...new Set([...params.payload.injectedSkills.map((skill) => skill.trim()).filter(Boolean), ...detectedInjected]),
	];
	const injectedSkills = (mergedInjected.length > 0 ? mergedInjected : [...new Set(tailoredSkillTokens)]).slice(0, 16);

	// 4. Canonical Experiences (factual lock on company, period, dates, location)
	const canonicalExperiences =
		tailored.sections.experience.items.length > 0
			? tailored.sections.experience.items
			: structuredClone(params.dossierResumeJson?.sections.experience.items ?? []);

	const expDiffs: TailorDiff["experiences"] = [];
	const updatedExperiences = canonicalExperiences.map((canonical, index) => {
		const matched =
			params.payload.experiences.find((item) => item.id && item.id === canonical.id) ??
			params.payload.experiences.find(
				(item) =>
					item.company &&
					(canonical.company.toLowerCase().includes(item.company.toLowerCase()) ||
						item.company.toLowerCase().includes(canonical.company.toLowerCase())),
			) ??
			params.payload.experiences[index];

		const originalBullets = extractBulletsFromHtml(canonical.description);
		const rawBullets = matched?.bullets.length ? matched.bullets : originalBullets;
		const tailoredBullets = rawBullets
			.map((bullet) => sanitizeBulletText(bullet, params.language))
			.filter(Boolean)
			.slice(0, 5);

		const tailoredPosition = matched?.position
			? stripHtml(params.language === "pt-BR" ? enforcePortugueseRules(matched.position) : matched.position) ||
				canonical.position
			: canonical.position;

		const descriptionHtml =
			tailoredBullets.length > 0
				? `<ul>${tailoredBullets.map((bullet) => `<li>${bullet}</li>`).join("")}</ul>`
				: canonical.description;

		const hidden = Boolean(matched?.hidden);
		expDiffs.push({
			id: canonical.id,
			company: canonical.company,
			originalPosition: canonical.position,
			tailoredPosition,
			period: canonical.period,
			hidden,
			originalBullets,
			tailoredBullets,
		});

		return {
			...canonical,
			position: tailoredPosition,
			description: descriptionHtml,
			hidden,
		};
	});
	tailored.sections.experience.items = updatedExperiences;
	tailored.sections.experience.hidden = updatedExperiences.length === 0;

	// 5. Education description (factual lock on school, degree, period, dates)
	if (tailored.sections.education.items.length === 0 && params.dossierResumeJson?.sections.education.items.length) {
		tailored.sections.education.items = structuredClone(params.dossierResumeJson.sections.education.items);
	}
	const originalEduDesc = stripHtml(
		original.sections.education.items[0]?.description || original.sections.education.items[0]?.area || "",
	);
	const tailoredEduDescHtml = params.payload.educationDescription
		? sanitizeRichText(params.payload.educationDescription, params.language)
		: "";
	if (tailored.sections.education.items[0] && tailoredEduDescHtml) {
		tailored.sections.education.items[0] = {
			...tailored.sections.education.items[0],
			description: tailoredEduDescHtml,
			area: "",
		};
	}

	// 6. Projects (strictly matched against canonical dossier/base catalog)
	const projectCatalog = params.projectCatalog.length
		? params.projectCatalog
		: original.sections.projects.items.map((item) => ({
				id: item.id,
				name: item.name,
				period: item.period,
				stack: "",
				description: stripHtml(item.description),
				url: item.website.url,
			}));

	const projectDiffs: TailorDiff["projects"] = [];
	const selectedProjects: ResumeData["sections"]["projects"]["items"] = [];
	const seenProjectNames = new Set<string>();

	for (const llmProject of params.payload.selectedProjects) {
		const canonical = findMatchingCanonicalProject(llmProject.name, projectCatalog);
		if (!canonical) continue;
		const key = canonical.name.toLowerCase();
		if (seenProjectNames.has(key)) continue;
		seenProjectNames.add(key);

		const originalItem = original.sections.projects.items.find(
			(item) => item.id === canonical.id || item.name.toLowerCase() === key,
		);
		const baseTitle = (canonical.name.split("|")[0] ?? canonical.name).trim();
		const techSuffix = stripHtml(llmProject.technologies || canonical.stack);
		const displayName =
			techSuffix && !baseTitle.toLowerCase().includes(techSuffix.toLowerCase())
				? `${baseTitle} | ${techSuffix}`
				: canonical.name;

		const descriptionHtml =
			sanitizeRichText(llmProject.description, params.language) ||
			originalItem?.description ||
			`<p>${canonical.description}</p>`;

		selectedProjects.push({
			id: originalItem?.id ?? canonical.id ?? `proj-${generateId().slice(0, 8)}`,
			hidden: Boolean(llmProject.hidden),
			name: displayName,
			period: canonical.period || originalItem?.period || "2026",
			website: originalItem?.website ?? {
				url: canonical.url,
				label: canonical.url ? "Demo" : "",
				inlineLink: Boolean(canonical.url),
			},
			description: descriptionHtml,
		});

		projectDiffs.push({
			id: originalItem?.id ?? canonical.id,
			name: displayName,
			hidden: Boolean(llmProject.hidden),
			originalDescription: stripHtml(originalItem?.description ?? canonical.description),
			tailoredDescription: stripHtml(descriptionHtml),
		});
	}

	if (selectedProjects.length > 0) {
		tailored.sections.projects.items = selectedProjects;
		tailored.sections.projects.hidden = selectedProjects.every((item) => item.hidden);
	}

	// 7. Hidden Sections
	const requestedHidden = new Set(
		params.payload.hiddenSections
			.map((name) => name.trim().toLowerCase())
			.filter((name) => HIDEABLE_SECTIONS.has(name)),
	);
	const sectionEntries = Object.entries(tailored.sections) as [
		keyof ResumeData["sections"],
		ResumeData["sections"][keyof ResumeData["sections"]],
	][];
	const hiddenSections: string[] = [];

	for (const [key, section] of sectionEntries) {
		if (key === "experience" || key === "skills" || key === "education") continue;
		if (requestedHidden.has(key) || section.items.length === 0) {
			section.hidden = true;
		}
		if (section.hidden) hiddenSections.push(key);
	}

	const validatedTailored = parseResumeData(tailored);

	return {
		tailoredData: validatedTailored,
		diff: {
			headline: { original: original.basics.headline, tailored: validatedTailored.basics.headline },
			summary: {
				original: stripHtml(original.summary.content),
				tailored: stripHtml(validatedTailored.summary.content),
			},
			educationDescription: {
				original: originalEduDesc,
				tailored: stripHtml(validatedTailored.sections.education.items[0]?.description ?? originalEduDesc),
			},
			experiences: expDiffs,
			projects: projectDiffs,
			skills: validatedTailored.sections.skills.items.map((item) => ({
				name: item.name,
				proficiency: item.proficiency,
			})),
			injectedSkills,
			hiddenSections,
		},
	};
}

const TAILORED_RESPONSE_JSON_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		headline: { type: "string" },
		summary: { type: "string" },
		skillsCategories: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					category: { type: "string" },
					technologies: { type: "string" },
				},
				required: ["category", "technologies"],
			},
		},
		experiences: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					company: { type: "string" },
					position: { type: "string" },
					hidden: { type: "boolean" },
					bullets: { type: "array", items: { type: "string" } },
				},
				required: ["company", "position", "hidden", "bullets"],
			},
		},
		educationDescription: { type: "string" },
		selectedProjects: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					name: { type: "string" },
					technologies: { type: "string" },
					hidden: { type: "boolean" },
					description: { type: "string" },
				},
				required: ["name", "technologies", "hidden", "description"],
			},
		},
		injectedSkills: { type: "array", items: { type: "string" } },
		hiddenSections: { type: "array", items: { type: "string" } },
	},
	required: [
		"headline",
		"summary",
		"skillsCategories",
		"experiences",
		"educationDescription",
		"selectedProjects",
		"injectedSkills",
		"hiddenSections",
	],
} as const;

export async function tailorResumePreview(params: {
	userId: string;
	resumeId: string;
	input: TailorPreviewInput;
	signal?: AbortSignal | undefined;
}): Promise<TailorPreviewResult> {
	const baseResume = await resumeService.getById({ id: params.resumeId, userId: params.userId });
	const originalData = parseStoredResumeData(baseResume.data);

	const dossier = params.input.useMasterDossier ? loadMasterDossier() : null;
	const workingBase = structuredClone(originalData);
	if (dossier?.resumeJson) {
		if (workingBase.sections.experience.items.length === 0) {
			workingBase.sections.experience.items = structuredClone(dossier.resumeJson.sections.experience.items);
		}
		if (workingBase.sections.education.items.length === 0) {
			workingBase.sections.education.items = structuredClone(dossier.resumeJson.sections.education.items);
		}
		if (workingBase.sections.projects.items.length === 0) {
			workingBase.sections.projects.items = structuredClone(dossier.resumeJson.sections.projects.items);
		}
		if (workingBase.sections.skills.items.length === 0) {
			workingBase.sections.skills.items = structuredClone(dossier.resumeJson.sections.skills.items);
		}
	}

	const allowedCompanies = [
		...new Set([
			...workingBase.sections.experience.items.map((item) => item.company).filter(Boolean),
			...(dossier?.guardrails.allowedCompanies ?? []),
		]),
	];
	const projectCatalog = dossier?.guardrails.projectCatalog.length
		? dossier.guardrails.projectCatalog
		: workingBase.sections.projects.items.map((item) => ({
				id: item.id,
				name: item.name,
				period: item.period,
				stack: "",
				description: stripHtml(item.description),
				url: item.website.url,
			}));
	const allowedProjects = [...new Set(projectCatalog.map((item) => item.name))];

	const llm = resolveLocalLlmConfig();
	const makeProvider = (responseFormat?: Record<string, unknown>) =>
		createOpenAICompatible({
			name: "local-ats-llm",
			baseURL: llm.baseURL,
			apiKey: llm.apiKey,
			...(responseFormat
				? {
						transformRequestBody: (body: Record<string, unknown>) => ({
							...body,
							response_format: responseFormat,
						}),
					}
				: {}),
		});

	const providers = [
		makeProvider({
			type: "json_schema",
			json_schema: {
				name: "tailored_resume",
				strict: true,
				schema: TAILORED_RESPONSE_JSON_SCHEMA,
			},
		}),
		makeProvider({ type: "json_object" }),
		makeProvider(),
	];

	const timeoutSignal = AbortSignal.timeout(180_000);
	const abortSignal = params.signal ? AbortSignal.any([params.signal, timeoutSignal]) : timeoutSignal;
	const promptOptions = {
		temperature: 0.2,
		maxRetries: 0,
		abortSignal,
		system: buildTailoringSystemPrompt(params.input.language),
		prompt: buildTailoringUserPrompt({
			jobDescription: params.input.jobDescription,
			company: params.input.company,
			role: params.input.role,
			language: params.input.language,
			baseData: workingBase,
			dossierMarkdown: dossier?.markdownText ?? "",
			allowedCompanies,
			allowedProjects,
		}),
	};

	let rawText: string;
	const requestCompletion = async (promptText: string) => {
		let lastError: unknown;
		for (const provider of providers) {
			if (abortSignal.aborted) break;
			try {
				const response = await generateText({
					model: provider.languageModel(llm.model),
					...promptOptions,
					prompt: promptText,
				});
				return response.text;
			} catch (error) {
				lastError = error;
			}
		}
		throw lastError ?? new Error("All local LLM completion strategies failed.");
	};

	const parseNormalizedPayload = (text: string): LlmTailoredPayload => {
		const parsedJson = extractJsonObject(text);
		return llmTailoredPayloadSchema.parse(normalizeRawTailoredPayload(parsedJson));
	};

	try {
		rawText = await requestCompletion(promptOptions.prompt);
	} catch (error) {
		console.error("[tailor] Local LLM request failed:", error);
		throw new ORPCError("BAD_GATEWAY", {
			message: `Failed to reach local LLM (${llm.baseURL}, model "${llm.model}"). Verify Ollama/Bionic is running.`,
			cause: error,
		});
	}

	let payload: LlmTailoredPayload;
	try {
		payload = parseNormalizedPayload(rawText);
	} catch (error) {
		console.error("[tailor] Invalid LLM payload:", {
			error,
			rawPreview: rawText.slice(0, 1500),
		});
		throw new ORPCError("BAD_REQUEST", {
			message: "Local LLM returned invalid JSON for tailored resume.",
			cause: error,
		});
	}

	// Retry once if the model returned an empty skeleton without rewritten experience bullets.
	if (payload.experiences.length === 0 || payload.experiences.every((exp) => exp.bullets.length === 0)) {
		console.warn("[tailor] LLM returned empty experience bullets, retrying once with strict schema reminder.", {
			rawPreview: rawText.slice(0, 800),
		});
		try {
			const retryText = await requestCompletion(
				`${promptOptions.prompt}\n\nIMPORTANT RETRY INSTRUCTION: Your previous JSON omitted "experiences[].bullets". Return complete "headline", "summary", "skillsCategories", "experiences" (each with 3-5 XYZ "bullets"), "selectedProjects", and "injectedSkills".`,
			);
			const retryPayload = parseNormalizedPayload(retryText);
			if (retryPayload.experiences.some((exp) => exp.bullets.length > 0)) {
				payload = retryPayload;
			}
		} catch {
			// Keep initial normalized payload if retry fails.
		}
	}

	const { tailoredData, diff } = mergeTailoredResumeData({
		originalData: workingBase,
		dossierResumeJson: dossier?.resumeJson ?? null,
		projectCatalog,
		payload,
		language: params.input.language,
	});

	const labelParts = [params.input.company.trim(), params.input.role.trim()].filter(Boolean);
	const suggestedName = labelParts.length
		? `${baseResume.name} — ${labelParts.join(" · ")}`.slice(0, 100)
		: `${baseResume.name} — ATS (${params.input.language})`.slice(0, 100);

	return {
		baseResumeId: baseResume.id,
		baseResumeName: baseResume.name,
		suggestedName,
		language: params.input.language,
		usedMasterDossier: params.input.useMasterDossier,
		originalData: workingBase,
		tailoredData,
		diff,
	};
}

export async function forkResumeWithData(params: {
	userId: string;
	resumeId: string;
	input: z.infer<typeof forkWithDataInputSchema>;
}) {
	const baseResume = await resumeService.getById({ id: params.resumeId, userId: params.userId });
	let parsedData: ResumeData;
	try {
		parsedData = parseResumeData(params.input.data);
	} catch (error) {
		throw new ORPCError("BAD_REQUEST", {
			message: "Invalid resume data payload for forked resume.",
			cause: error,
		});
	}

	const labelParts = [params.input.company.trim(), params.input.role.trim()].filter(Boolean);
	const requestedName =
		params.input.name?.trim() ||
		(labelParts.length
			? `${baseResume.name} — ${labelParts.join(" · ")}`.slice(0, 100)
			: `${baseResume.name} — ATS Tailored`.slice(0, 100));

	const tags = [...new Set([...(params.input.tags ?? baseResume.tags), "ats-tailored"])];
	const newId = await resumeService.create({
		userId: params.userId,
		name: requestedName,
		tags,
		data: parsedData,
		origin: "created",
	});

	const created = await resumeService.getById({ id: newId, userId: params.userId });
	return {
		id: created.id,
		name: created.name,
		slug: created.slug,
		redirectUrl: `/builder/${created.id}`,
	};
}
