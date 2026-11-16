import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, isAbsolute, resolve } from "node:path";
import { sanitizeAndParseResumeJson } from "@reactive-resume/ai/resume/sanitize";
import { env } from "@reactive-resume/env/server";
import { parseResumeData } from "@reactive-resume/schema/resume/data";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { findWorkspaceRoot } from "@reactive-resume/utils/monorepo.node";

export type DossierProjectEntry = {
	id: string;
	name: string;
	period: string;
	stack: string;
	description: string;
	url: string;
};

export type DossierGuardrails = {
	allowedCompanies: string[];
	allowedPositions: string[];
	allowedPeriods: string[];
	allowedSchools: string[];
	allowedProjects: string[];
	allowedSkills: string[];
	projectCatalog: DossierProjectEntry[];
};

export type MasterDossier = {
	markdownPath: string | null;
	jsonPath: string | null;
	markdownText: string;
	resumeJson: ResumeData | null;
	guardrails: DossierGuardrails;
};

function resolveAssetsDirectory(): string {
	const root = findWorkspaceRoot() ?? process.cwd();
	const candidates = [
		resolve(root, "apps/server/src/assets"),
		resolve(process.cwd(), "apps/server/src/assets"),
		resolve(process.cwd(), "src/assets"),
	];
	return (
		candidates.find((candidate) => existsSync(candidate)) ?? candidates[0] ?? resolve(root, "apps/server/src/assets")
	);
}

function resolveOverridePaths(): { markdownOverride?: string; jsonOverride?: string } {
	const custom = env.MASTER_PROFILE_PATH?.trim();
	if (!custom) return {};

	const root = findWorkspaceRoot() ?? process.cwd();
	const resolved = isAbsolute(custom) ? custom : resolve(root, custom);
	if (!existsSync(resolved)) return {};

	try {
		if (statSync(resolved).isDirectory()) {
			const md = resolve(resolved, "profile.md");
			const json = resolve(resolved, "master-profile.json");
			return {
				...(existsSync(md) ? { markdownOverride: md } : {}),
				...(existsSync(json) ? { jsonOverride: json } : {}),
			};
		}
	} catch {
		return {};
	}

	const extension = extname(resolved).toLowerCase();
	if (extension === ".json") return { jsonOverride: resolved };
	return { markdownOverride: resolved };
}

function pickExistingFile(candidates: (string | undefined)[]): string | null {
	for (const candidate of candidates) {
		if (candidate && existsSync(candidate)) return candidate;
	}
	return null;
}

function stripMarkdownFormatting(value: string): string {
	return value
		.replace(/\*\*([^*]+)\*\*/g, "$1")
		.replace(/`([^`]+)`/g, "$1")
		.trim();
}

function parseMarkdownProjects(markdown: string): DossierProjectEntry[] {
	const sectionMatch = /##\s+Portf[óo]lio de Projetos[^\n]*\n([\s\S]*?)(?:\n---|\n##\s+|$)/i.exec(markdown);
	if (!sectionMatch?.[1]) return [];

	const block = sectionMatch[1];
	const headingRegex = /^###\s+(?:\d+\.\s+)?(.+)$/gm;
	const matches = [...block.matchAll(headingRegex)];
	const projects: DossierProjectEntry[] = [];

	for (let index = 0; index < matches.length; index++) {
		const current = matches[index];
		if (!current || current.index === undefined) continue;
		const title = stripMarkdownFormatting(current[1] ?? "");
		if (!title) continue;

		const start = current.index + current[0].length;
		const end = matches[index + 1]?.index ?? block.length;
		const body = block.slice(start, end);

		const descMatch = /-\s*\*\*Descri[çc][ãa]o:\*\*\s*(.+)/i.exec(body);
		const stackMatch = /-\s*\*\*Stack:\*\*\s*(.+)/i.exec(body);
		const impactMatch = /-\s*\*\*Impacto[^:]*:\*\*\s*(.+)/i.exec(body);
		const urlMatch = /-\s*\*\*(?:Deploy|Reposit[óo]rio)[^:]*:\*\*\s*(https?:\/\/\S+)/i.exec(body);

		const descriptionParts = [descMatch?.[1], impactMatch?.[1]].filter((part): part is string => Boolean(part?.trim()));
		projects.push({
			id: `dossier-proj-${index + 1}`,
			name: title,
			period: "",
			stack: stripMarkdownFormatting(stackMatch?.[1] ?? ""),
			description: stripMarkdownFormatting(descriptionParts.join(" ")),
			url: urlMatch?.[1]?.trim() ?? "",
		});
	}

	return projects;
}

function parseMarkdownExperienceCompanies(markdown: string): { companies: string[]; positions: string[] } {
	const sectionMatch = /##\s+Experi[êe]ncia Profissional[^\n]*\n([\s\S]*?)(?:\n---|\n##\s+|$)/i.exec(markdown);
	if (!sectionMatch?.[1]) return { companies: [], positions: [] };

	const block = sectionMatch[1];
	const companies = [...block.matchAll(/^###\s+(.+)$/gm)]
		.map((match) => stripMarkdownFormatting(match[1] ?? ""))
		.filter(Boolean);
	const positions = [...block.matchAll(/-\s*\*\*Cargo:\*\*\s*(.+)/gi)]
		.map((match) => stripMarkdownFormatting(match[1] ?? ""))
		.filter(Boolean);

	return { companies, positions };
}

function normalizeJsonDossier(rawJson: string): ResumeData | null {
	try {
		const { data } = sanitizeAndParseResumeJson(rawJson);
		return parseResumeData(data);
	} catch {
		try {
			const parsed = JSON.parse(rawJson) as Partial<ResumeData>;
			return parseResumeData({
				...structuredClone(defaultResumeData),
				...parsed,
				basics: { ...structuredClone(defaultResumeData.basics), ...parsed.basics },
				summary: { ...structuredClone(defaultResumeData.summary), ...parsed.summary },
				sections: { ...structuredClone(defaultResumeData.sections), ...parsed.sections },
				metadata: {
					...structuredClone(defaultResumeData.metadata),
					...parsed.metadata,
					layout: { ...structuredClone(defaultResumeData.metadata.layout), ...parsed.metadata?.layout },
					page: { ...structuredClone(defaultResumeData.metadata.page), ...parsed.metadata?.page },
					design: { ...structuredClone(defaultResumeData.metadata.design), ...parsed.metadata?.design },
					typography: {
						...structuredClone(defaultResumeData.metadata.typography),
						...parsed.metadata?.typography,
					},
				},
			});
		} catch {
			return null;
		}
	}
}

export function loadMasterDossier(): MasterDossier {
	const assetsDir = resolveAssetsDirectory();
	const { markdownOverride, jsonOverride } = resolveOverridePaths();

	const markdownPath = pickExistingFile([
		markdownOverride,
		resolve(assetsDir, "profile.md"),
		resolve(assetsDir, "profile.example.md"),
	]);
	const jsonPath = pickExistingFile([
		jsonOverride,
		resolve(assetsDir, "master-profile.json"),
		resolve(assetsDir, "master-profile.example.json"),
	]);

	const markdownText = markdownPath ? readFileSync(markdownPath, "utf8") : "";
	const rawJson = jsonPath ? readFileSync(jsonPath, "utf8") : "";
	const resumeJson = rawJson ? normalizeJsonDossier(rawJson) : null;

	const mdProjects = parseMarkdownProjects(markdownText);
	const mdExp = parseMarkdownExperienceCompanies(markdownText);

	const jsonProjects: DossierProjectEntry[] = (resumeJson?.sections.projects.items ?? []).map((item) => ({
		id: item.id,
		name: item.name,
		period: item.period,
		stack: "",
		description: item.description
			.replace(/<[^>]+>/g, " ")
			.replace(/\s+/g, " ")
			.trim(),
		url: item.website.url,
	}));

	const projectCatalog: DossierProjectEntry[] = [...jsonProjects];
	for (const mdProject of mdProjects) {
		const baseTitle = mdProject.name.toLowerCase();
		const exists = projectCatalog.some((entry) => entry.name.toLowerCase().includes(baseTitle));
		if (!exists) projectCatalog.push(mdProject);
	}

	const unique = (items: string[]) => [...new Set(items.map((item) => item.trim()).filter(Boolean))];

	const allowedCompanies = unique([
		...(resumeJson?.sections.experience.items.map((item) => item.company) ?? []),
		...mdExp.companies,
	]);
	const allowedPositions = unique([
		...(resumeJson?.sections.experience.items.flatMap((item) => [
			item.position,
			...item.roles.map((role) => role.position),
		]) ?? []),
		...mdExp.positions,
	]);
	const allowedPeriods = unique([
		...(resumeJson?.sections.experience.items.map((item) => item.period) ?? []),
		...(resumeJson?.sections.education.items.map((item) => item.period) ?? []),
	]);
	const allowedSchools = unique(
		resumeJson?.sections.education.items.flatMap((item) => [item.school, item.degree]) ?? [],
	);
	const allowedProjects = unique(projectCatalog.map((item) => item.name));
	const allowedSkills = unique(
		resumeJson?.sections.skills.items.flatMap((item) => [
			item.name,
			...item.proficiency.split(/[,;|]/),
			...item.keywords,
		]) ?? [],
	);

	return {
		markdownPath,
		jsonPath,
		markdownText,
		resumeJson,
		guardrails: {
			allowedCompanies,
			allowedPositions,
			allowedPeriods,
			allowedSchools,
			allowedProjects,
			allowedSkills,
			projectCatalog,
		},
	};
}
