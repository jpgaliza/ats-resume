import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { authSearchSchema } from "@/features/auth/redirect";
import { createNoindexFollowMeta } from "@/libs/seo";

function RedirectToResumes() {
	const navigate = useNavigate();
	useEffect(() => {
		void navigate({ to: "/dashboard/resumes", replace: true });
	}, [navigate]);
	return null;
}

export const Route = createFileRoute("/auth")({
	beforeLoad: () => {
		throw redirect({ to: "/dashboard/resumes", replace: true });
	},
	component: RedirectToResumes,
	validateSearch: authSearchSchema,
	head: () => ({
		meta: [createNoindexFollowMeta()],
	}),
});
