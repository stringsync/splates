import { afterEach, describe, expect, it } from "bun:test";
import { Running, Waiting } from "./queue-running";
import { act, cleanup, fireEvent, render, Testing, waitFor } from "./testing";

describe("Queue rows from another project", () => {
	let testing: Testing;
	const known = {
		of: () => undefined,
		project: () => ({ slug: "other", name: "Other project" }),
		here: () => false,
		open: () => {},
	};
	afterEach(() => {
		cleanup();
		testing.dispose();
		history.replaceState(null, "", location.pathname);
	});

	it.each([
		["Stop", "cancel", "POST"],
		["Restart", "restart", "POST"],
		["Archive", "archived", "PUT"],
	])(
		"routes running row's %s to its project",
		async (action, endpoint, method) => {
			testing = new Testing();
			history.replaceState(null, "", "?project=focused");
			const view = render(
				<Running
					held={[
						{
							id: "remote",
							project: "/other",
							task: "remote task",
							automatic: true,
							since: "2026-10-23T12:00:00.000Z",
						},
					]}
					known={known}
				/>,
			);
			await act(async () =>
				fireEvent.click(view.getByRole("button", { name: "More actions" })),
			);
			await act(async () =>
				fireEvent.click(
					await waitFor(() => view.getByRole("menuitem", { name: action })),
				),
			);
			expect(testing.posts.at(-1)).toMatchObject({
				path: `/api/conversations/remote/${endpoint}?project=other`,
				method,
			});
		},
	);

	it("cancels a waiting row through its own project", async () => {
		testing = new Testing();
		const view = render(
			<Waiting
				queue={[
					{
						id: "remote",
						project: "/other",
						task: "remote task",
						position: 1,
						since: "2026-10-23T12:00:00.000Z",
						reason: "paused",
					},
				]}
				known={known}
			/>,
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "More actions" })),
		);
		await act(async () =>
			fireEvent.click(
				await waitFor(() => view.getByRole("menuitem", { name: "Cancel" })),
			),
		);
		expect(testing.posts.at(-1)).toMatchObject({
			path: "/api/conversations/remote/archived?project=other",
			method: "PUT",
			body: JSON.stringify({ archived: true }),
		});
	});
});
