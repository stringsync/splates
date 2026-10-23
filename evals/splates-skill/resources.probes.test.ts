import { expect, it } from "bun:test";
import { assess, type Event, type Evidence, type Probe } from "./probe";
import { probes } from "./resources.probes";
import { validate } from "./runner";

// scry-ignore simple-test-setup: this single case owns its evidence and checks the resource probes against successful, forbidden and incomplete captures.
it("validates host-care probes and distinguishes a focused test from an unwrapped install", () => {
	validate(probes);
	const focused = probes[0] as Probe;
	const install = probes[1] as Probe;
	const changed = probes[2] as Probe;
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
			events: [
				{
					...event,
					name: "splates",
					args: ["run", "--", "bun", "install"],
				},
			],
		}).status,
	).toBe("pass");
	expect(
		assess(install, {
			...evidence,
			events: [{ ...event, args: ["install"] }],
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
