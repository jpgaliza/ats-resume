#!/usr/bin/env tsx
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { parseArgs } from "node:util";
import { and, desc, eq, isNull } from "drizzle-orm";
import { ensureLocalDefaultUser } from "@reactive-resume/api/features/auth/local-user";
import { createResumePdfDownload } from "@reactive-resume/api/features/resume/export";
import {
	forkResumeWithData,
	resolveLocalLlmConfig,
	tailorResumePreview,
} from "@reactive-resume/api/features/resume/tailor";
import { db } from "@reactive-resume/db/client";
import { runMigrations } from "@reactive-resume/db/migrate";
import * as schema from "@reactive-resume/db/schema";
import { findWorkspaceRoot } from "@reactive-resume/utils/monorepo.node";

function resolveNextOutputPath(outputDir: string): string {
	mkdirSync(outputDir, { recursive: true });
	let maxIndex = 0;
	for (const file of readdirSync(outputDir)) {
		const match = /^curriculo_(\d+)\.pdf$/i.exec(file);
		if (!match?.[1]) continue;
		const index = Number.parseInt(match[1], 10);
		if (index > maxIndex) maxIndex = index;
	}
	return resolve(outputDir, `curriculo_${maxIndex + 1}.pdf`);
}

function readJobInput(jobArg: string | undefined, workspaceRoot: string): string {
	const candidate = jobArg?.trim();
	if (candidate) {
		const resolved = isAbsolute(candidate) ? candidate : resolve(process.cwd(), candidate);
		if (existsSync(resolved)) {
			return readFileSync(resolved, "utf8").trim();
		}
		return candidate;
	}

	const fallbackFiles = [
		resolve(workspaceRoot, "vaga.txt"),
		resolve(workspaceRoot, "../ai-ats-resume-generator/vaga.txt"),
	];
	for (const file of fallbackFiles) {
		if (existsSync(file)) {
			console.info(`[tailor-cli] Reading job description from ${file}`);
			return readFileSync(file, "utf8").trim();
		}
	}

	throw new Error("Provide a job description via --job <path-or-text> (e.g. pnpm tailor -- --job vaga.txt).");
}

async function main() {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: {
			job: { type: "string", short: "j" },
			"resume-id": { type: "string", short: "r" },
			company: { type: "string", short: "c", default: "" },
			role: { type: "string", default: "" },
			lang: { type: "string", short: "l", default: "pt-BR" },
			output: { type: "string", short: "o" },
			"no-dossier": { type: "boolean", default: false },
			"no-fork": { type: "boolean", default: false },
		},
	});

	const language = values.lang === "en-US" ? "en-US" : "pt-BR";
	const useMasterDossier = !values["no-dossier"];
	const workspaceRoot = findWorkspaceRoot() ?? process.cwd();
	const jobDescription = readJobInput(values.job ?? positionals[0], workspaceRoot);

	if (jobDescription.length < 10) {
		throw new Error("Job description must be at least 10 characters long.");
	}

	const llm = resolveLocalLlmConfig();
	console.info(`[tailor-cli] Local LLM: ${llm.baseURL} (model: ${llm.model})`);
	console.info(`[tailor-cli] Running database migrations & provisioning local user...`);

	await runMigrations();
	const user = await ensureLocalDefaultUser();

	let baseResumeId = values["resume-id"]?.trim();
	if (!baseResumeId) {
		const [primary] = await db
			.select({ id: schema.resume.id, name: schema.resume.name })
			.from(schema.resume)
			.where(and(eq(schema.resume.userId, user.id), isNull(schema.resume.trashedAt)))
			.orderBy(desc(schema.resume.isPrimary), desc(schema.resume.updatedAt))
			.limit(1);
		if (!primary) throw new Error("No base resume found for local user.");
		baseResumeId = primary.id;
	}

	console.info(`[tailor-cli] Tailoring resume "${baseResumeId}" (${language}, masterDossier=${useMasterDossier})...`);
	const preview = await tailorResumePreview({
		userId: user.id,
		resumeId: baseResumeId,
		input: {
			jobDescription,
			company: values.company ?? "",
			role: values.role ?? "",
			language,
			useMasterDossier,
		},
	});

	console.info("\n=== ATS Tailoring Diff Summary ===");
	console.info(`Headline: ${preview.diff.headline.tailored}`);
	console.info(`Injected Skills: ${preview.diff.injectedSkills.join(", ") || "(none)"}`);
	console.info(`Hidden Sections: ${preview.diff.hiddenSections.join(", ") || "(none)"}`);
	for (const exp of preview.diff.experiences) {
		console.info(`Experience: ${exp.company} — ${exp.tailoredPosition} (${exp.tailoredBullets.length} XYZ bullets)`);
		for (const bullet of exp.tailoredBullets) {
			console.info(`  • ${bullet}`);
		}
	}

	if (values["no-fork"]) {
		console.info("\n[tailor-cli] --no-fork specified; skipping fork & PDF export.");
		return;
	}

	const forked = await forkResumeWithData({
		userId: user.id,
		resumeId: baseResumeId,
		input: {
			name: preview.suggestedName,
			company: values.company ?? "",
			role: values.role ?? "",
			data: preview.tailoredData as Record<string, unknown>,
		},
	});

	const download = await createResumePdfDownload({
		id: forked.id,
		userId: user.id,
	});
	const pdfBuffer = Buffer.from(await download.body.arrayBuffer());

	const outputPath = values.output
		? isAbsolute(values.output)
			? values.output
			: resolve(process.cwd(), values.output)
		: resolveNextOutputPath(resolve(workspaceRoot, "data/output"));
	mkdirSync(dirname(outputPath), { recursive: true });
	writeFileSync(outputPath, pdfBuffer);

	console.info(`\n[tailor-cli] Forked resume ID: ${forked.id}`);
	console.info(`[tailor-cli] Builder URL: http://localhost:3000${forked.redirectUrl}`);
	console.info(`[tailor-cli] PDF exported (${pdfBuffer.byteLength} bytes): ${outputPath}`);
}

main()
	.then(() => {
		process.exit(0);
	})
	.catch((error) => {
		console.error("[tailor-cli] Error:", error);
		process.exit(1);
	});
