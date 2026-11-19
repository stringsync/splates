import type { RunEvent, RunState } from "@splates/server/ship";
import type { JSX } from "react";
import type { ShipRunServer } from "./ship-run";
import { ShipRunScreen } from "./ship-run-view";
import type { SpawnedWork } from "./ship-spawned-work";

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
	started: Date.now() - 14 * 60_000,
	status: "running",
	notes: [
		{
			at: Date.now() - 9 * 60_000,
			task: "vexml-slur-curves",
			target: "@stringsync/vexml",
			step: "publish",
			text: "3 tests fail in slur.test.ts: expected 2 curves, got 1. The cross-staff slur reads mdom's old curve count.",
		},
		{
			at: Date.now() - 6 * 60_000,
			task: "vexml-slur-curves",
			target: "@stringsync/vexml",
			step: "publish",
			text: "Fixed the curve count; retried the step from the worktree and it passes. Merging now.",
			link: "#2851",
		},
		{
			at: Date.now() - 2 * 60_000,
			task: "net-deploy-check",
			text: "The staging deploy reads the new image tag; nothing to change on the run.",
			link: "https://github.com/stringsync/mono/actions/runs/1842",
		},
	],
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

/** What the run spawned, in every state a row can show. */
export const SPAWNED: SpawnedWork[] = [
	{
		kind: "fix",
		todo: 2851,
		conversation: "c-vexml",
		subject: "The ship step publish of @stringsync/vexml passes",
		target: "@stringsync/vexml",
		step: "publish",
		status: "working",
		line: "Running slur.test.ts after the curve-count fix",
	},
	{
		kind: "agent",
		todo: 2853,
		conversation: "c-mdom",
		subject: "Check the vexflow 5.1 update for API breaks",
		target: "@stringsync/mdom",
		step: "build",
		status: "asking",
		line: "Should StaveTie keep the old constructor for one release?",
	},
	{
		kind: "fix",
		todo: 2848,
		conversation: "c-types",
		subject: "The ship step build of @stringsync/mdom passes",
		target: "@stringsync/mdom",
		step: "build",
		status: "merged",
	},
	{
		kind: "agent",
		todo: 2855,
		subject: "Check the sound2score image builds on the new base",
		target: "@stringsync/vexml",
		step: "publish",
		status: "queued",
	},
];
const now = Date.now();
const EVENTS: RunEvent[] = [
	{ type: "checking", at: now - 50_000, target, step: "build" },
	{ type: "running", at: now - 50_000, target, step: "build", pid: 7 },
	{ type: "update", target, step: "build", line: "Bundling" },
	{ type: "ended", at: now - 40_000, target, step: "build", outcome: "done" },
	{ type: "checking", at: now - 40_000, target, step: "publish" },
	{ type: "running", at: now - 40_000, target, step: "publish", pid: 8 },
	{ type: "update", target, step: "publish", line: "Publishing 2.4.0" },
];

/** A fake server holding one running run, so the page's Stop can be pressed. */
const SERVER: ShipRunServer = {
	answer: async () => RUN,
	events: (id) => `/preview/${id}`,
	get: async () => RUN,
	retry: async () => RUN,
	stop: async () => ({ ...RUN, status: "stopped" }),
	send: async () => ({ state: RUN, task: 0 }),
	supervise: async () => RUN,
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

/**
 * The run page on a fake running ship, for seeing Stop and its confirm
 * dialog, what the run spawned and its notes.
 */
export function ShipRunPreview(): JSX.Element {
	return (
		<div className="mx-auto min-h-dvh max-w-3xl bg-background p-4 text-foreground">
			<ShipRunScreen id="preview" server={SERVER} spawned={() => SPAWNED} />
		</div>
	);
}
