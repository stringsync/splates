import type { RunEvent, RunState } from "@splates/server/ship";
import type { JSX } from "react";
import type { ShipRunServer } from "./ship-run";
import { ShipRunScreen } from "./ship-run-view";

/** The address that opens the preview in place of the app. */
export const SHIP_RUN_PREVIEW = "#ship-run-preview";

const step = (id: string, dependencies: string[] = []) => ({
	id,
	does: `Do ${id}`,
	dependencies,
	status: "pending" as const,
	output: [],
	prompts: [],
});

const RUN: RunState = {
	id: "preview",
	started: Date.now() - 60_000,
	status: "running",
	notes: [],
	targets: [
		{
			name: "@stringsync/mdom",
			command: "bin/mdom ship",
			dependencies: [],
			steps: [step("build"), step("publish", ["build"])],
		},
		{
			name: "@stringsync/vexml",
			command: "bin/vex ship",
			dependencies: ["@stringsync/mdom"],
			steps: [step("publish")],
		},
	],
};

const target = "@stringsync/mdom";
const now = Date.now();
const EVENTS: RunEvent[] = [
	{ type: "checking", at: now - 50_000, target, step: "build" },
	{ type: "running", at: now - 50_000, target, step: "build", pid: 7 },
	{ type: "update", target, step: "build", line: "Bundling" },
];

/** A fake server holding one running run, so the page's Stop can be pressed. */
const SERVER: ShipRunServer = {
	answer: async () => RUN,
	events: (id) => `/preview/${id}`,
	get: async () => RUN,
	retry: async () => RUN,
	stop: async () => ({ ...RUN, status: "stopped" }),
	send: async () => ({ state: RUN, task: 0 }),
	connect: (_, handlers) => {
		const timer = setTimeout(() => {
			handlers.named?.state?.({
				data: JSON.stringify(RUN),
			} as MessageEvent<string>);
			for (const event of EVENTS) {
				handlers.named?.run?.({
					data: JSON.stringify(event),
				} as MessageEvent<string>);
			}
		}, 0);
		return { dispose: () => clearTimeout(timer) };
	},
};

/** The run page on a fake running ship, for seeing Stop and its confirm dialog. */
export function ShipRunPreview(): JSX.Element {
	return (
		<div className="mx-auto min-h-dvh max-w-3xl bg-background p-4 text-foreground">
			<ShipRunScreen id="preview" server={SERVER} />
		</div>
	);
}
