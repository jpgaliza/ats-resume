import type { TailorLanguage, TailorPreviewInput } from "./types";
import { useId, useState } from "react";
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
import { Switch } from "@reactive-resume/ui/components/switch";
import { Textarea } from "@reactive-resume/ui/components/textarea";

type TailorInputModalProps = {
	open: boolean;
	isLoading: boolean;
	initialValue: TailorPreviewInput;
	errorMessage: string | null;
	onOpenChange: (open: boolean) => void;
	onSubmit: (value: TailorPreviewInput) => void;
};

export function TailorInputModal({
	open,
	isLoading,
	initialValue,
	errorMessage,
	onOpenChange,
	onSubmit,
}: TailorInputModalProps) {
	const id = useId();
	const [company, setCompany] = useState(initialValue.company);
	const [role, setRole] = useState(initialValue.role);
	const [language, setLanguage] = useState<TailorLanguage>(initialValue.language);
	const [useMasterDossier, setUseMasterDossier] = useState(initialValue.useMasterDossier);
	const [jobDescription, setJobDescription] = useState(initialValue.jobDescription);
	const [validationError, setValidationError] = useState<string | null>(null);

	const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const trimmedJob = jobDescription.trim();
		if (trimmedJob.length < 10) {
			setValidationError("Paste at least 10 characters of the target job description.");
			return;
		}
		setValidationError(null);
		onSubmit({
			company: company.trim(),
			role: role.trim(),
			language,
			useMasterDossier,
			jobDescription: trimmedJob,
		});
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(nextOpen) => {
				if (!isLoading) onOpenChange(nextOpen);
			}}
		>
			<DialogContent className="sm:max-w-2xl" closeLabel="Close" showCloseButton={!isLoading}>
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Icon name="magic-wand" className="text-accent-text" />
						Tailor Resume with AI (ATS Studio)
					</DialogTitle>
					<DialogDescription>
						Tailor your resume against a target job description using your local LLM and the Google XYZ formula. A new
						branch is created only after you review the side-by-side diff.
					</DialogDescription>
				</DialogHeader>

				<form className="space-y-4" onSubmit={handleSubmit}>
					<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
						<div className="space-y-1.5">
							<Label htmlFor={`${id}-company`}>Company</Label>
							<Input
								id={`${id}-company`}
								data-testid="tailor-company-input"
								placeholder="e.g. Nubank, Stripe, Local Tech"
								value={company}
								disabled={isLoading}
								onChange={(event) => setCompany(event.target.value)}
							/>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor={`${id}-role`}>Target Role</Label>
							<Input
								id={`${id}-role`}
								data-testid="tailor-role-input"
								placeholder="e.g. Full Stack Developer Intern"
								value={role}
								disabled={isLoading}
								onChange={(event) => setRole(event.target.value)}
							/>
						</div>
					</div>

					<div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-line bg-sunken/50 p-3">
						<div className="space-y-1">
							<Label className="text-sm font-medium">Generated Resume Language</Label>
							<div className="flex items-center gap-2">
								<Button
									type="button"
									size="sm"
									variant={language === "pt-BR" ? "primary" : "secondary"}
									data-testid="tailor-lang-pt"
									disabled={isLoading}
									onClick={() => setLanguage("pt-BR")}
								>
									Português (pt-BR)
								</Button>
								<Button
									type="button"
									size="sm"
									variant={language === "en-US" ? "primary" : "secondary"}
									data-testid="tailor-lang-en"
									disabled={isLoading}
									onClick={() => setLanguage("en-US")}
								>
									English (en-US)
								</Button>
							</div>
						</div>

						<div className="flex items-center gap-3">
							<div className="text-end">
								<Label htmlFor={`${id}-dossier`} className="block text-sm font-medium">
									Use Master Dossier
								</Label>
								<span className="block text-xs text-ink-3">Load profile.md &amp; master-profile.json</span>
							</div>
							<Switch
								id={`${id}-dossier`}
								data-testid="tailor-dossier-toggle"
								checked={useMasterDossier}
								disabled={isLoading}
								onCheckedChange={setUseMasterDossier}
							/>
						</div>
					</div>

					<div className="space-y-1.5">
						<Label htmlFor={`${id}-jd`}>Job Description</Label>
						<Textarea
							id={`${id}-jd`}
							data-testid="tailor-jd-input"
							rows={8}
							className="max-h-72 resize-y"
							placeholder="Paste the full job posting, requirements, responsibilities, and desired stack here..."
							value={jobDescription}
							disabled={isLoading}
							onChange={(event) => {
								setJobDescription(event.target.value);
								if (validationError) setValidationError(null);
							}}
						/>
						{(validationError || errorMessage) && (
							<p role="alert" className="text-xs font-medium text-danger-text">
								{validationError ?? errorMessage}
							</p>
						)}
					</div>

					<DialogFooter>
						<Button type="button" variant="ghost" disabled={isLoading} onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<Button type="submit" loading={isLoading} data-testid="tailor-submit-button">
							{!isLoading && <Icon name="sparkle" />}
							{isLoading ? "Tailoring with Local LLM…" : "Tailor Resume"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
