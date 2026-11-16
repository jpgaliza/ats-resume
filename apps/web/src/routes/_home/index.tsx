import { createFileRoute, redirect } from "@tanstack/react-router";
import { Homepage } from "@/features/homepage/page";
import { getHomepageMeta } from "@/libs/seo";

// Local-first single-user edition jumps straight to the resume dashboard without a login wall.
export const Route = createFileRoute("/_home/")({
	beforeLoad: () => {
		throw redirect({ to: "/dashboard/resumes", replace: true });
	},
	component: Homepage,
	head: () => {
		const { title, description } = getHomepageMeta();
		return { meta: [{ title }, { name: "description", content: description }] };
	},
});
