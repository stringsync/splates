import "./register-dom";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { ConfigChangeField, ConfigChangesContext } from "./setup-config-field";
import { act, cleanup, fireEvent, render, waitFor } from "./testing";

const FIELD = {
	kind: "config",
	name: "config",
	label: "Evals config",
	change: "Add `evals`.",
	task: "setup-evals-results",
} as const;

describe("ConfigChangeField", () => {
	const real = globalThis.fetch;
	let diff: unknown[] | null;
	let fetched: string[];
	beforeEach(() => {
		diff = null;
		fetched = [];
		globalThis.fetch = (async (path: string) => {
			fetched.push(path);
			if (path.includes("/diff")) {
				return diff === null
					? Response.json({}, { status: 404 })
					: Response.json(diff);
			}
			return Response.json({});
		}) as typeof fetch;
	});
	afterEach(() => {
		cleanup();
		globalThis.fetch = real;
	});

	it("starts the change, shows its diff, merges on approval and offers a restart once landed", async () => {
		const said: string[] = [];
		const view = render(
			<ConfigChangesContext
				value={{
					start: async () => "chat-1",
					merge: async (id) => void said.push(id),
					open: () => {},
				}}
			>
				<ConfigChangeField field={FIELD} pollMs={20} />
			</ConfigChangesContext>,
		);
		await act(async () => {
			fireEvent.click(view.getByText("Have an agent make this change"));
		});
		diff = [
			{
				path: "splates.config.ts",
				status: "modified",
				hunks: [],
			},
		];
		await waitFor(() => view.getByText("Approve and merge"), { timeout: 5000 });
		await act(async () => {
			fireEvent.click(view.getByText("Approve and merge"));
		});
		expect(said).toEqual(["chat-1"]);
		diff = null;
		await waitFor(() => view.getByText("Restart server"), { timeout: 5000 });
		await act(async () => {
			fireEvent.click(view.getByText("Restart server"));
		});
		await waitFor(() => expect(fetched).toContain("/api/restart"));
	});
});
