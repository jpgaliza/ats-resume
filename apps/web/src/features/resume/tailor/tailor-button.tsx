import type { TailorPreviewInput, TailorPreviewResponse } from "./types";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { toast } from "@reactive-resume/ui/components/toast";
import { TailorDiffModal } from "./tailor-diff-modal";
import { TailorInputModal } from "./tailor-input-modal";
import { requestForkWithData, requestTailorPreview } from "./types";
import { orpc } from "@/libs/orpc/client";

type TailorWithAiButtonProps = {
	resumeId?: string | undefined;
	disabled?: boolean;
	compact?: boolean;
};

const DEFAULT_INPUT: TailorPreviewInput = {
	company: "",
	role: "",
	language: "pt-BR",
	useMasterDossier: true,
	jobDescription: "",
};

export function TailorWithAiButton({ resumeId, disabled = false, compact = false }: TailorWithAiButtonProps) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	const [step, setStep] = useState<"closed" | "input" | "diff">("closed");
	const [inputState, setInputState] = useState<TailorPreviewInput>(DEFAULT_INPUT);
	const [preview, setPreview] = useState<TailorPreviewResponse | null>(null);
	const [isGenerating, setIsGenerating] = useState(false);
	const [isForking, setIsForking] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	const runPreview = async (input: TailorPreviewInput) => {
		if (!resumeId) return;
		setInputState(input);
		setErrorMessage(null);
		setIsGenerating(true);

		try {
			const result = await requestTailorPreview(resumeId, input);
			setPreview(result);
			setStep("diff");
		} catch (error) {
			const message = error instanceof Error ? error.message : "Failed to tailor resume.";
			setErrorMessage(message);
			toast.add({ type: "error", description: message });
		} finally {
			setIsGenerating(false);
		}
	};

	const handleConfirmFork = async (forkName: string) => {
		if (!resumeId || !preview) return;
		setErrorMessage(null);
		setIsForking(true);

		try {
			const forked = await requestForkWithData(resumeId, {
				name: forkName,
				company: inputState.company,
				role: inputState.role,
				data: preview.tailoredData,
			});

			void queryClient.invalidateQueries({ queryKey: orpc.documents.key() });
			void queryClient.invalidateQueries({ queryKey: orpc.resume.key() });
			toast.add({ type: "success", description: `Forked "${forked.name}". Opening builder…` });
			setStep("closed");
			setPreview(null);
			void navigate({ to: "/builder/$resumeId", params: { resumeId: forked.id } });
		} catch (error) {
			const message = error instanceof Error ? error.message : "Failed to fork tailored resume.";
			setErrorMessage(message);
			toast.add({ type: "error", description: message });
		} finally {
			setIsForking(false);
		}
	};

	return (
		<>
			{compact ? (
				<IconButton
					icon="magic-wand"
					label="Tailor with AI"
					variant="soft"
					disabled={disabled || !resumeId}
					data-testid="tailor-with-ai-button"
					onClick={() => {
						setErrorMessage(null);
						setStep("input");
					}}
				/>
			) : (
				<Button
					variant="soft"
					disabled={disabled || !resumeId}
					data-testid="tailor-with-ai-button"
					onClick={() => {
						setErrorMessage(null);
						setStep("input");
					}}
				>
					<Icon name="magic-wand" />
					<span>Tailor with AI</span>
				</Button>
			)}

			<TailorInputModal
				open={step === "input"}
				isLoading={isGenerating}
				initialValue={inputState}
				errorMessage={errorMessage}
				onOpenChange={(open) => {
					if (!open) setStep("closed");
				}}
				onSubmit={(value) => {
					void runPreview(value);
				}}
			/>

			<TailorDiffModal
				open={step === "diff"}
				preview={preview}
				isRegenerating={isGenerating}
				isForking={isForking}
				errorMessage={errorMessage}
				onOpenChange={(open) => {
					if (!open) setStep("closed");
				}}
				onBack={() => {
					setErrorMessage(null);
					setStep("input");
				}}
				onRegenerate={() => {
					void runPreview(inputState);
				}}
				onConfirmFork={(forkName) => {
					void handleConfirmFork(forkName);
				}}
			/>
		</>
	);
}
