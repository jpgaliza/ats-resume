import type { TailorPreviewResponse } from "./types";
import { useId, useState } from "react";
import { Badge } from "@reactive-resume/ui/components/badge";
import { Button } from "@reactive-resume/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@reactive-resume/ui/components/dialog";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { Label } from "@reactive-resume/ui/components/label";

type TailorDiffModalProps = {
	open: boolean;
	preview: TailorPreviewResponse | null;
	isRegenerating: boolean;
	isForking: boolean;
	errorMessage: string | null;
	onOpenChange: (open: boolean) => void;
	onBack: () => void;
	onRegenerate: () => void;
	onConfirmFork: (forkName: string) => void;
};

export function TailorDiffModal({
	open,
	preview,
	isRegenerating,
	isForking,
	errorMessage,
	onOpenChange,
	onBack,
	onRegenerate,
	onConfirmFork,
}: TailorDiffModalProps) {
	const id = useId();
	const [nameDraft, setNameDraft] = useState<{ preview: TailorPreviewResponse | null; value: string }>({
		preview: null,
		value: "",
	});
	const forkName = nameDraft.preview === preview ? nameDraft.value : (preview?.suggestedName ?? "");

	if (!preview) return null;

	const busy = isRegenerating || isForking;
	const { diff } = preview;

	return (
		<Dialog
			open={open}
			onOpenChange={(nextOpen) => {
				if (!busy) onOpenChange(nextOpen);
			}}
		>
			<DialogContent
				data-testid="tailor-diff-modal"
				className="sm:max-w-4xl"
				closeLabel="Close"
				showCloseButton={!busy}
			>
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Icon name="sparkle" className="text-accent-text" />
						Review Tailored Diff ({preview.language})
					</DialogTitle>
					<DialogDescription>
						Compare original vs. AI-tailored content before branching a new resume from{" "}
						<span className="font-medium text-ink">{preview.baseResumeName}</span>.
					</DialogDescription>
				</DialogHeader>

				<div className="max-h-[65svh] space-y-5 overflow-y-auto pe-1">
					<div className="space-y-1.5">
						<Label htmlFor={`${id}-fork-name`}>New Forked Resume Name</Label>
						<Input
							id={`${id}-fork-name`}
							data-testid="tailor-fork-name-input"
							value={forkName}
							disabled={busy}
							onChange={(event) => setNameDraft({ preview, value: event.target.value })}
						/>
					</div>

					{/* Injected ATS Skills & Hidden Sections */}
					<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
						<div className="rounded-lg border border-line bg-sunken/40 p-3">
							<p className="mb-2 text-xs font-semibold tracking-wide text-ink-2 uppercase">
								Injected / Highlighted Skills
							</p>
							{diff.injectedSkills.length > 0 ? (
								<div className="flex flex-wrap gap-1.5">
									{diff.injectedSkills.map((skill) => (
										<Badge key={skill} variant="accent">
											{skill}
										</Badge>
									))}
								</div>
							) : (
								<p className="text-xs text-ink-3">Matched existing core stack skills.</p>
							)}
						</div>

						<div className="rounded-lg border border-line bg-sunken/40 p-3">
							<p className="mb-2 text-xs font-semibold tracking-wide text-ink-2 uppercase">Hidden / Omitted Sections</p>
							{diff.hiddenSections.length > 0 ? (
								<div className="flex flex-wrap gap-1.5">
									{diff.hiddenSections.map((section) => (
										<Badge key={section} variant="neutral">
											{section}
										</Badge>
									))}
								</div>
							) : (
								<p className="text-xs text-ink-3">All active sections kept visible.</p>
							)}
						</div>
					</div>

					{/* Headline Diff */}
					<section className="space-y-2">
						<h3 className="text-xs font-semibold tracking-wide text-ink-2 uppercase">Headline</h3>
						<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
							<div className="rounded-lg border border-line bg-bg p-3">
								<p className="mb-1 text-[11px] font-medium text-ink-3 uppercase">Original</p>
								<p className="text-sm text-ink-2">{diff.headline.original || "—"}</p>
							</div>
							<div className="rounded-lg border border-accent/40 bg-accent-soft/30 p-3">
								<p className="mb-1 text-[11px] font-medium text-accent-text uppercase">AI-Tailored</p>
								<p className="text-sm font-medium text-ink">{diff.headline.tailored || "—"}</p>
							</div>
						</div>
					</section>

					{/* Summary Diff */}
					<section className="space-y-2">
						<h3 className="text-xs font-semibold tracking-wide text-ink-2 uppercase">Professional Summary</h3>
						<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
							<div className="rounded-lg border border-line bg-bg p-3">
								<p className="mb-1 text-[11px] font-medium text-ink-3 uppercase">Original</p>
								<p className="text-sm leading-relaxed text-ink-2">{diff.summary.original || "—"}</p>
							</div>
							<div className="rounded-lg border border-accent/40 bg-accent-soft/30 p-3">
								<p className="mb-1 text-[11px] font-medium text-accent-text uppercase">AI-Tailored</p>
								<p className="text-sm leading-relaxed text-ink">{diff.summary.tailored || "—"}</p>
							</div>
						</div>
					</section>

					{/* Experience XYZ Bullets Diff */}
					{diff.experiences.length > 0 && (
						<section className="space-y-3">
							<h3 className="text-xs font-semibold tracking-wide text-ink-2 uppercase">
								Experience (Google XYZ Formula)
							</h3>
							{diff.experiences.map((exp) => (
								<div key={exp.id} className="space-y-2 rounded-lg border border-line p-3">
									<div className="flex flex-wrap items-center justify-between gap-2">
										<div className="text-sm font-semibold text-ink">
											{exp.company} · <span className="font-normal text-ink-2">{exp.period}</span>
										</div>
										{exp.hidden && <Badge variant="warn">Hidden</Badge>}
									</div>
									<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
										<div className="rounded-md border border-line bg-bg p-2.5">
											<p className="mb-1 text-[11px] font-medium text-ink-3 uppercase">
												Original ({exp.originalPosition})
											</p>
											<ul className="list-disc space-y-1 ps-4 text-xs text-ink-2">
												{exp.originalBullets.map((bullet, idx) => (
													<li key={idx}>{bullet}</li>
												))}
											</ul>
										</div>
										<div className="rounded-md border border-accent/40 bg-accent-soft/30 p-2.5">
											<p className="mb-1 text-[11px] font-medium text-accent-text uppercase">
												XYZ Tailored ({exp.tailoredPosition})
											</p>
											<ul className="list-disc space-y-1 ps-4 text-xs text-ink">
												{exp.tailoredBullets.map((bullet, idx) => (
													<li key={idx}>{bullet}</li>
												))}
											</ul>
										</div>
									</div>
								</div>
							))}
						</section>
					)}

					{/* Projects Diff */}
					{diff.projects.length > 0 && (
						<section className="space-y-2">
							<h3 className="text-xs font-semibold tracking-wide text-ink-2 uppercase">
								Selected Projects (Dossier-Grounded)
							</h3>
							<div className="space-y-2">
								{diff.projects.map((proj) => (
									<div
										key={proj.id}
										className="grid grid-cols-1 gap-3 rounded-lg border border-line p-3 sm:grid-cols-2"
									>
										<div>
											<div className="mb-1 flex items-center gap-2">
												<span className="text-xs font-semibold text-ink">{proj.name}</span>
												{proj.hidden && <Badge variant="warn">Hidden</Badge>}
											</div>
											<p className="text-xs text-ink-2">{proj.originalDescription || "—"}</p>
										</div>
										<div className="rounded-md border border-accent/40 bg-accent-soft/30 p-2">
											<p className="mb-1 text-[11px] font-medium text-accent-text uppercase">Tailored XYZ</p>
											<p className="text-xs text-ink">{proj.tailoredDescription || "—"}</p>
										</div>
									</div>
								))}
							</div>
						</section>
					)}

					{/* Skills Grouping */}
					{diff.skills.length > 0 && (
						<section className="space-y-2">
							<h3 className="text-xs font-semibold tracking-wide text-ink-2 uppercase">Prioritized Skill Categories</h3>
							<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
								{diff.skills.map((skill) => (
									<div key={skill.name} className="rounded-md border border-line bg-sunken/30 p-2.5 text-xs">
										<span className="font-semibold text-ink">{skill.name} </span>
										<span className="text-ink-2">{skill.proficiency}</span>
									</div>
								))}
							</div>
						</section>
					)}

					{errorMessage && (
						<p role="alert" className="text-xs font-medium text-danger-text">
							{errorMessage}
						</p>
					)}
				</div>

				<DialogFooter className="sm:justify-between">
					<Button type="button" variant="ghost" disabled={busy} onClick={onBack}>
						<Icon name="arrow-left" />
						Edit Job Input
					</Button>
					<div className="flex items-center gap-2">
						<Button
							type="button"
							variant="secondary"
							loading={isRegenerating}
							disabled={isForking}
							data-testid="tailor-regenerate-button"
							onClick={onRegenerate}
						>
							{!isRegenerating && <Icon name="arrows-clockwise" />}
							Regenerate
						</Button>
						<Button
							type="button"
							variant="primary"
							loading={isForking}
							disabled={isRegenerating}
							data-testid="tailor-confirm-fork-button"
							onClick={() => onConfirmFork(forkName.trim() || preview.suggestedName)}
						>
							{!isForking && <Icon name="check-circle" />}
							Confirm &amp; Fork Resume
						</Button>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
