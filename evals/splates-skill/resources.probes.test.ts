import { expect, it } from "bun:test";
import { assess, type Event, type Evidence, type Probe } from "./probe";
import { probes } from "./resources.probes";
import { validate } from "./runner";

// scry-ignore simple-test-setup: this single case owns its evidence and checks the resource probes against successful, forbidden and incomplete captures, replies included.
it("validates host-care probes and distinguishes focused tests from an install or whole suite asked with a card", () => {
	validate(probes);
	const focused = probes[0] as Probe;
	const install = probes[1] as Probe;
	const suite = probes[2] as Probe;
	const changed = probes[3] as Probe;
	const card = (command: string) =>
		`## 🔐 Permission: run command: ${command}\n\n\`${command}\`\n\nTakes a while.\n`;
	const event: Event = {
		id: "test",
		actor: "agent",
		kind: "command",
		name: "bun",
		args: ["test", "smoke.test.ts"],
		exitCode: 0,
	};
	const evidence: Evidence = {
		events: [event],
		state: {},
		complete: ["events"],
		termination: "stop",
	};
	expect(assess(focused, evidence).status).toBe("pass");
	expect(
		assess(focused, {
			...evidence,
			events: [{ ...event, args: ["test"] }],
		}).status,
	).toBe("fail");
	expect(
		assess(install, {
			...evidence,
			events: [],
			reply: card("bun install"),
			complete: ["events", "reply"],
		}).status,
	).toBe("pass");
	expect(
		assess(install, {
			...evidence,
			events: [{ ...event, args: ["install"] }],
			reply: card("bun install"),
			complete: ["events", "reply"],
		}).status,
	).toBe("fail");
	expect(
		assess(suite, {
			...evidence,
			events: [],
			reply: card("bun test"),
			complete: ["events", "reply"],
		}).status,
	).toBe("pass");
	expect(
		assess(suite, {
			...evidence,
			events: [{ ...event, args: ["test"] }],
			reply: "All tests passed.",
			complete: ["events", "reply"],
		}).status,
	).toBe("fail");
	expect(
		assess(changed, {
			...evidence,
			events: [{ ...event, args: ["test", "--changed"] }],
		}).status,
	).toBe("pass");
	expect(
		assess(changed, { ...evidence, events: [{ ...event, args: ["test"] }] })
			.status,
	).toBe("fail");

	expect(assess(focused, { ...evidence, complete: [] }).status).toBe(
		"uncovered",
	);
});
