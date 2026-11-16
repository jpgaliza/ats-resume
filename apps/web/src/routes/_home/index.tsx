import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { getHomepageMeta } from "@/libs/seo";

function RedirectToResumes() {
	const navigate = useNavigate();
	useEffect(() => {
		void navigate({ to: "/dashboard/resumes", replace: true });
	}, [navigate]);
	return null;
}

// Local-first single-user edition jumps straight to the resume dashboard without a landing page or login wall.
export const Route = createFileRoute("/_home/")({
	beforeLoad: () => {
		throw redirect({ to: "/dashboard/resumes", replace: true });
	},
	component: RedirectToResumes,
	head: () => {
		const { title, description } = getHomepageMeta();
		return { meta: [{ title }, { name: "description", content: description }] };
	},
});
