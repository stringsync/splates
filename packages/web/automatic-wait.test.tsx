import { afterEach, expect, it } from "bun:test";
import { Mark } from "./mark";
import { automaticWait } from "./row-status";
import { cleanup, conversation, message, render } from "./testing";

afterEach(cleanup);

it("keeps task waits active when idle or idle-stopped until the server replies", () => {
	const waiting = conversation({
		messages: [
			message(
				"agent",
				"Waiting for the dependency.\n[SPLATES WAIT task dependency]",
			),
		],
	});
	expect(automaticWait(waiting)).toBe("Waiting for dependency");
	expect(automaticWait({ ...waiting, status: "stopped" })).toBe(
		"Waiting for dependency",
	);
	expect(automaticWait({ ...waiting, status: "failed" })).toBeNull();
	expect(
		automaticWait({ ...waiting, status: "stopped", checkpoint: "done" }),
	).toBeNull();
	expect(
		automaticWait({
			...waiting,
			messages: [
				...waiting.messages,
				message("user", "[SPLATES WAIT COMPLETE]"),
			],
		}),
	).toBeNull();
});

it("gives questions priority over an automatic wait and completion", () => {
	const view = render(
		<Mark
			signal
			reported="done"
			need={{
				kind: "waiting",
				why: "questions",
				subject: "Choose a target",
				questions: [],
				since: null,
			}}
		/>,
	);
	expect(view.getByRole("status", { name: "waiting on you" })).toBeTruthy();
	expect(view.container.querySelector(".animate-spin")).toBeNull();
});

it("shows gray dots for an automatic wait even when unread or disconnected", () => {
	const view = render(
		<Mark signal unread disconnected need={{ kind: "idle" }} />,
	);
	const mark = view.getByRole("status", { name: "waiting" });
	expect(mark.querySelector(".mark-ellipsis")).not.toBeNull();
	expect(mark.querySelector(".lucide-unplug")).toBeNull();
	expect(view.container.querySelector(".animate-spin")).toBeNull();
});

it("leaves a background-only idle conversation static", () => {
	const view = render(<Mark background need={{ kind: "idle" }} />);
	expect(
		view.getByRole("status", { name: "waiting on background commands" }),
	).toBeTruthy();
	expect(view.container.querySelector(".animate-spin")).toBeNull();
});

it("marks an idle conversation with only leftover commands disconnected, and a done one checked", () => {
	const leftover = render(<Mark leftover need={{ kind: "idle" }} />);
	expect(leftover.getByRole("status", { name: "disconnected" })).toBeTruthy();
	leftover.unmount();

	const done = render(
		<Mark leftover reported="done" need={{ kind: "idle" }} />,
	);
	expect(done.getByRole("img", { name: "done" })).toBeTruthy();
	expect(done.queryByRole("status", { name: "disconnected" })).toBeNull();
});
