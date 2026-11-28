import { afterEach, describe, expect, it } from "bun:test";
import type { Event } from "@splates/server/records";
import type { SignalProbe } from "@splates/server/signals";
import { ListPlusIcon, TriangleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ActionCard } from "./action-card";
import { AskPanel } from "./ask-panel";
import { BlockersCard } from "./blockers-card";
import { Board, NO_BOARD } from "./board";
import { ReplyContext } from "./card-reply";
import { Drafts } from "./drafts";
import { conversation, details, todo } from "./fixtures";
import { LANDED } from "./landed-outcomes";
import { EndedMergeCard, LiveMergeCard } from "./merge-card";
import { PhoneSheets } from "./phone-sheets";
import { ProbeCard } from "./probe-card";
import { ReportCard } from "./report-cards";
import { RunCommandCard } from "./run-command-card";
import {
	act,
	cleanup,
	fireEvent,
	render,
	waitFor,
	within,
} from "./testing-library";

afterEach(() => {
	cleanup();
	LANDED.clear();
});

function renderOnPhone(children: ReactNode) {
	return render(
		<PhoneSheets conversation="c1" on={true} whole={true}>
			{children}
		</PhoneSheets>,
	);
}

describe("compact conversation cards on mobile", () => {
	it("keeps LiveMergeCard and EndedMergeCard inline without collapsing to a ThreadBar", () => {
		const now = new Date().toISOString();
		const task = details({
			task: "alpha",
			base: "main",
			gate: "running",
			mergeSince: now,
			mergeSteps: {
				steps: [{ step: "rebase", at: now }],
				phases: [],
			},
		});
		const live = renderOnPhone(<LiveMergeCard conversation="c1" task={task} />);
		expect(live.container.querySelector("[data-thread-bar]")).toBeNull();
		expect(live.getByRole("region", { name: "Merge" })).toBeTruthy();
		expect(live.getByRole("list", { name: "Merge steps" })).toBeTruthy();
		cleanup();

		const refused: Extract<Event, { action: "merge" }> = {
			id: "m1",
			at: now,
			action: "merge",
			task: "alpha",
			reason: "tests_failed",
			conversation: "c1",
			base: "main",
			commit: "abc1234",
			files: [],
			attemptsLeft: 2,
			failedTests: [],
			stepsMs: { rebase: 2000, test: 5000 },
		};
		const ended = renderOnPhone(<EndedMergeCard end={refused} ms={7000} />);
		expect(ended.container.querySelector("[data-thread-bar]")).toBeNull();
		expect(ended.getByRole("button", { name: "Why" })).toBeTruthy();
	});

	it("keeps Done, Removed, and Escalated reports inline, while Merged reports still open in a sheet", async () => {
		const done = renderOnPhone(
			<ReportCard
				report={{
					ending: "done",
					task: "",
					base: null,
					reason: "all checks passed",
					body: "Everything looks clean.",
					source: "## ✅ Done: all checks passed\n\nEverything looks clean.",
				}}
			/>,
		);
		expect(done.container.querySelector("[data-thread-bar]")).toBeNull();
		expect(done.getByText("Everything looks clean.")).toBeTruthy();
		cleanup();

		const escalated = renderOnPhone(
			<ReportCard
				report={{
					ending: "escalated",
					task: "alpha",
					base: null,
					reason: "needs a call",
					body: "Two APIs conflict.",
					source: "## ⚠️ Escalated alpha: needs a call\n\nTwo APIs conflict.",
				}}
			/>,
		);
		expect(escalated.container.querySelector("[data-thread-bar]")).toBeNull();
		expect(escalated.getByText("Two APIs conflict.")).toBeTruthy();
		cleanup();

		await LANDED.load("alpha", "removed");
		const removed = renderOnPhone(
			<ReportCard
				report={{
					ending: "removed",
					task: "alpha",
					base: null,
					reason: "superseded",
					body: "Fixed elsewhere.",
					source: "## 🧹 Removed alpha: superseded\n\nFixed elsewhere.",
				}}
			/>,
		);
		await waitFor(() =>
			expect(removed.getByText("Fixed elsewhere.")).toBeTruthy(),
		);
		expect(removed.container.querySelector("[data-thread-bar]")).toBeNull();
		cleanup();

		await LANDED.load("alpha", "merged");
		const merged = renderOnPhone(
			<ReportCard
				report={{
					ending: "merged",
					task: "alpha",
					base: "main",
					reason: null,
					body: "Landed the fix.",
					source: "## ✅ Merged alpha onto main\n\nLanded the fix.",
				}}
			/>,
		);
		const bar = await waitFor(() =>
			merged.getByRole("button", { name: /Done · alpha.*Open/ }),
		);
		expect(bar.hasAttribute("data-thread-bar")).toBe(true);
		await act(async () => {
			fireEvent.click(bar);
		});
		const dialog = await waitFor(() => merged.getByRole("dialog"));
		expect(within(dialog).getByText("Done · alpha")).toBeTruthy();
	});

	it("keeps BlockersCard and ProbeCard inline on mobile", () => {
		const blocker = todo({ id: 2, subject: "Prep helper", stage: "available" });
		const blocked = todo({
			id: 1,
			subject: "Main fix",
			stage: "queued",
			blockedBy: [2],
		});
		const blockers = renderOnPhone(
			<Board
				value={{
					...NO_BOARD,
					todos: [blocked, blocker],
				}}
			>
				<BlockersCard task={blocked} label="Blocked" />
			</Board>,
		);
		expect(blockers.container.querySelector("[data-thread-bar]")).toBeNull();
		expect(blockers.getByText("Prep helper")).toBeTruthy();
		expect(
			blockers.getByRole("button", { name: "Queue 1 blocker" }),
		).toBeTruthy();
		cleanup();

		const probe: SignalProbe = {
			name: "deploy.ready",
			description: "Wait for rollout",
			script: "true",
			everyMs: 30_000,
			cwd: "/repo",
			conversation: "c1",
			state: "running",
			startedAt: new Date().toISOString(),
			deadline: new Date(Date.now() + 600_000).toISOString(),
			passed: false,
			subscribed: true,
			count: 1,
			runs: [{ at: new Date().toISOString(), exit: 1, output: "pending" }],
		};
		const probed = renderOnPhone(<ProbeCard probe={probe} />);
		expect(probed.container.querySelector("[data-thread-bar]")).toBeNull();
		expect(probed.getByText("Wait for rollout")).toBeTruthy();
		expect(probed.getByRole("button", { name: "Stop polling" })).toBeTruthy();
	});

	it("keeps tool permission, ActionCard, and RunCommandCard inline on mobile", () => {
		const drafts = new Drafts();
		const askView = renderOnPhone(
			<AskPanel
				drafts={drafts}
				conversation={conversation({ id: "c1", task: "alpha" })}
				agent="Claude"
				ask={{
					id: "a1",
					at: new Date().toISOString(),
					type: "permission",
					title: "Run bun test",
					options: [
						{ id: "r1", kind: "reject_once", name: "Deny" },
						{ id: "o1", kind: "allow_once", name: "Allow once" },
						{ id: "a1", kind: "allow_always", name: "Always" },
					],
				}}
			/>,
		);
		expect(askView.container.querySelector("[data-thread-bar]")).toBeNull();
		expect(askView.getByRole("button", { name: "Deny" })).toBeTruthy();
		expect(askView.getByRole("button", { name: "This session" })).toBeTruthy();
		expect(askView.getByRole("button", { name: "Always" })).toBeTruthy();
		cleanup();

		const actionView = renderOnPhone(
			<ActionCard
				label="queue tasks"
				Icon={TriangleAlertIcon}
				title="Add 2 tasks to the queue"
				body="Ready to run next."
				done={false}
				gone={null}
				action={{
					verb: "Queue 2 tasks",
					VerbIcon: ListPlusIcon,
					done: "Queued",
					run: async () => {},
					failed: "Not queued",
				}}
			/>,
		);
		expect(actionView.container.querySelector("[data-thread-bar]")).toBeNull();
		expect(actionView.getByText("Ready to run next.")).toBeTruthy();
		expect(
			actionView.getByRole("button", { name: "Queue 2 tasks" }),
		).toBeTruthy();
		cleanup();

		const runView = renderOnPhone(
			<ReplyContext value={{ send: async () => {}, drafts }}>
				<RunCommandCard
					proposal={{
						action: "run-command",
						lane: null,
						tasks: [],
						title: "Run the test suite",
						command: "bun test",
						body: "Machine is busy.",
					}}
				/>
			</ReplyContext>,
		);
		expect(runView.container.querySelector("[data-thread-bar]")).toBeNull();
		expect(runView.getByText("bun test")).toBeTruthy();
		expect(runView.getByRole("button", { name: "Allow" })).toBeTruthy();
		expect(runView.getByRole("button", { name: "Deny" })).toBeTruthy();
	});
});
