import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { AgentSettings, matchesAgentSettings } from "./agent-settings";
import { Settings } from "./settings";
import { SettingsDialog } from "./settings-dialog";
import { cleanup, fireEvent, render, waitFor } from "./testing";

function fakeSettingsServer() {
	const saved: unknown[] = [];
	let current = { level: "never", perConversationCap: 5 };
	const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		if (url.includes("/api/agent-settings") && init?.method === "PUT") {
			const patch = JSON.parse(String(init.body)) as Partial<typeof current>;
			saved.push(patch);
			current = { ...current, ...patch };
			return Response.json(current);
		}
		return Response.json(current);
	}) as unknown as typeof fetch;
	return { saved, fakeFetch };
}

describe("AgentSettings", () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		localStorage.clear();
	});

	afterEach(() => {
		cleanup();
		globalThis.fetch = originalFetch;
	});

	it("loads per-project agent settings and saves level and cap changes", async () => {
		const { saved, fakeFetch } = fakeSettingsServer();
		globalThis.fetch = fakeFetch;

		const view = render(<AgentSettings project="mono" />);

		await waitFor(() => {
			expect(
				(view.getByDisplayValue("never") as HTMLInputElement).checked,
			).toBe(true);
		});
		expect(view.getByText("mono")).toBeTruthy();

		fireEvent.click(view.getByText("Safe tasks only"));
		await waitFor(() => {
			expect(saved).toContainEqual({ level: "safe" });
		});

		fireEvent.click(view.getByText("10"));
		await waitFor(() => {
			expect(saved).toContainEqual({ perConversationCap: 10 });
		});

		fireEvent.click(view.getByText("Custom"));
		const customInput = view.getByLabelText("Custom per-conversation cap");
		fireEvent.change(customInput, { target: { value: "7" } });
		await waitFor(() => {
			expect(saved).toContainEqual({ perConversationCap: 7 });
		});
	});

	it("shows Agents in SettingsDialog and matches settings search", () => {
		globalThis.fetch = fakeSettingsServer().fakeFetch;

		expect(matchesAgentSettings("Agents", "")).toBe(true);
		expect(matchesAgentSettings("Agents", "queue")).toBe(true);
		expect(matchesAgentSettings("Agents", "conversation")).toBe(true);
		expect(matchesAgentSettings("Appearance", "agents")).toBe(false);

		const settings = new Settings(localStorage);
		const view = render(
			<SettingsDialog
				settings={settings}
				open={true}
				onOpenChange={() => {}}
				onWelcome={() => {}}
				project="mono"
			/>,
		);
		fireEvent.click(view.getByRole("button", { name: "Agents" }));
		expect(view.getByText("Agents may queue tasks themselves")).toBeTruthy();
	});
});
