import "./testing-dom";
import { afterEach, describe, expect, it } from "bun:test";
import type { RunView } from "@splates/server/rigs/browser";
import { RigRunPage } from "./rig-run-page";
import { cleanup, render } from "./testing";

afterEach(cleanup);

describe("RigRunPage", () => {
	it("shows local and animal-slot public links side by side with the slot emoji", () => {
		const view = render(
			<RigRunPage
				run={makeRun()}
				onStop={() => {}}
				onAgain={() => {}}
				api={logApi}
			/>,
		);

		expect(view.queryByRole("link", { name: /^Open/ })).toBeNull();
		expect(view.container.textContent).toContain("😸");

		const local = view.getByRole("link", { name: "127.0.0.1:54321" });
		expect(local.getAttribute("href")).toBe("http://127.0.0.1:54321");

		const pub = view.getByRole("link", { name: "cat.ports.example" });
		expect(pub.getAttribute("href")).toBe("https://cat.ports.example");
	});

	it("omits the public link for a local-only rig", () => {
		const view = render(
			<RigRunPage
				run={makeRun({
					exposure: "none",
					slot: null,
					ports: [
						{
							name: "web",
							port: 54321,
							local: "http://127.0.0.1:54321",
							remote: null,
						},
					],
				})}
				onStop={() => {}}
				onAgain={() => {}}
				api={logApi}
			/>,
		);

		expect(view.queryByText("Public")).toBeNull();
	});

	it("shows waiting state before a self-exposed rig prints its URL, then shows the reported URL", () => {
		const waiting = render(
			<RigRunPage
				run={makeRun({
					exposure: "self",
					slot: null,
					ports: [
						{
							name: "web",
							port: 54321,
							local: "http://127.0.0.1:54321",
							remote: null,
						},
					],
				})}
				onStop={() => {}}
				onAgain={() => {}}
				api={logApi}
			/>,
		);

		expect(waiting.getByText("Waiting for URL…")).toBeTruthy();
		cleanup();

		const ready = render(
			<RigRunPage
				run={makeRun({
					exposure: "self",
					slot: null,
					ports: [
						{
							name: "web",
							port: 54321,
							local: "http://127.0.0.1:54321",
							remote: "https://my-rig.example.dev",
						},
					],
				})}
				onStop={() => {}}
				onAgain={() => {}}
				api={logApi}
			/>,
		);

		expect(
			ready.getByRole("link", { name: "127.0.0.1:54321" }).getAttribute("href"),
		).toBe("http://127.0.0.1:54321");
		expect(
			ready
				.getByRole("link", { name: "my-rig.example.dev" })
				.getAttribute("href"),
		).toBe("https://my-rig.example.dev");
	});
});

describe("RigRunPage stop", () => {
	it("pins one solid Stop at the bottom while running, with the rig's links as plain links", () => {
		let stopped = 0;
		const view = render(
			<RigRunPage
				run={makeRun()}
				onStop={() => {
					stopped += 1;
				}}
				onAgain={() => {}}
				api={logApi}
			/>,
		);

		expect(view.queryAllByRole("button")).toHaveLength(1);
		const stop = view.getByRole("button", { name: "Stop" });
		stop.click();
		expect(stopped).toBe(1);
		expect(stop.parentElement?.className).toContain("sticky");
	});
});

const logApi = {
	runLog: async () => ({ lines: [], last: 0 }),
};

function makeRun(overrides: Partial<RunView> = {}): RunView {
	return {
		id: "vexml/dev@main",
		group: "vexml",
		rig: "dev",
		label: "Playground",
		tree: "main",
		exposure: "tunnel",
		slot: { word: "cat", emoji: "😸" },
		values: {},
		preset: null,
		state: "healthy",
		health: "GET / → 200",
		exitCode: null,
		startedAt: 0,
		endedAt: null,
		ports: [
			{
				name: "web",
				port: 54321,
				local: "http://127.0.0.1:54321",
				remote: "https://cat.ports.example",
			},
		],
		lastLine: null,
		...overrides,
	};
}
