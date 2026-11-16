import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/auth/login")({
	beforeLoad: () => {
		throw redirect({ to: "/dashboard/resumes", replace: true });
	},
	component: () => null,
});
