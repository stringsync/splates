import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	CHECK_IN,
	CHECKPOINT,
	leadingDirectives,
	RECONNECT,
	RESUME,
	// biome-ignore lint/style/noRestrictedImports: Production directive contract has no public export.
} from "../../packages/arbor/prompts";
import module from "./continuity.probes";
import { assess, type Event, type Evidence } from "./probe";
import { type Adapter, runProbes, validate } from "./runner";

describe("continuity aspect (free synthetic evidence, not model adherence)", () => {
	it("registers valid independently discoverable cases and stable gaps", () => {
		validate(module.probes);
		expect(module.probes).toHaveLength(7);
		expect(
			module.probes.map((probe) =>
				probe.assertions.some((item) => item.kind === "uncovered"),
			),
		).toEqual(Array(7).fill(true));
	});
	it("pins production directive payloads separately from response conformance", () => {
		expect([CHECKPOINT, RESUME, RECONNECT, CHECK_IN]).toEqual([
			"[ARBOR CHECKPOINT]",
			"[ARBOR RESUME]",
			"[ARBOR RECONNECT]",
			"[ARBOR UPDATE]",
		]);
		expect(
			[CHECKPOINT, RESUME, RECONNECT, CHECK_IN].map((directive) =>
				leadingDirectives(`${directive}\n\nContinue.`),
			),
		).toEqual(
			[CHECKPOINT, RESUME, RECONNECT, CHECK_IN].map((directive) => ({
				directives: [directive],
				rest: "Continue.",
			})),
		);
	});
	it("requires saved-context reading before meaningful continuation, not any edit", () => {
		const state = { "file/result.txt": "ready\n" };
		expect(
			verdict(
				"resume",
				{ events: [read, write], state },
				"read-before-continuing",
			),
		).toBe("pass");
		expect(
			[
				[],
				[write, read],
				[read, write, { ...read, id: "late" }],
				[{ ...read, actor: "fixture" as const }, write],
			].map((events) =>
				verdict("resume", { events, state }, "read-before-continuing"),
			),
		).toEqual(["fail", "fail", "fail", "fail"]);
		expect(
			verdict(
				"resume",
				{ events: [read, write], state: { "file/result.txt": "wrong" } },
				"continued-saved-step",
			),
		).toBe("fail");
		expect(
			verdict(
				"resume",
				{ events: [read, write], complete: ["state"] },
				"read-before-continuing",
			),
		).toBe("uncovered");
	});
	it("does not let forbidden writes or missing checkpoint state pass", () => {
		expect(verdict("checkpoint", {}, "no-new-output")).toBe("pass");
		expect(
			verdict(
				"checkpoint",
				{ events: [{ ...write, exitCode: 1 }] },
				"no-new-output",
			),
		).toBe("fail");
		expect(verdict("checkpoint", {}, "notes-updated")).toBe("uncovered");
		expect(
			verdict(
				"checkpoint",
				{ state: { "plan/changed": false } },
				"notes-updated",
			),
		).toBe("fail");
	});
	it("requires inspection before retry and forbids duplicating a completed write", () => {
		const outcome = { ...read, name: "result.txt" };
		expect(
			["reconnect-partial", "reconnect-failed"].map((id) => [
				verdict(id, { events: [outcome, write] }, "outcome-before-retry"),
				verdict(id, { events: [write, outcome] }, "outcome-before-retry"),
			]),
		).toEqual([
			["pass", "fail"],
			["pass", "fail"],
		]);
		expect(
			verdict(
				"reconnect-completed",
				{ events: [write] },
				"do-not-repeat-completed-write",
			),
		).toBe("fail");
		expect(
			verdict(
				"reconnect-completed",
				{ complete: [] },
				"do-not-repeat-completed-write",
			),
		).toBe("uncovered");
	});
	it("never substitutes final reply, generic edit or seeded delivery for UPDATE ordering", () => {
		const evidence: Partial<Evidence> = {
			events: [{ ...write, name: "ARBOR.md" }, write],
			reply: "- Updated notes.\n- Continuing.",
			state: { "plan/changed": true, "file/result.txt": "ready\n" },
		};
		expect(grade("update", evidence).status).toBe("uncovered");
		expect(verdict("update", evidence, "intermediate-reply-order")).toBe(
			"uncovered",
		);
		expect(verdict("update", evidence, "mid-turn-delivery")).toBe("uncovered");
	});
	it("recognizes reports but rejects quoted, missing and false outcome fields", () => {
		const reply =
			"## 🛑 Removed continuity: moot\n\nThe task is no longer needed.";
		expect(verdict("removed-report", { reply }, "outcome-format")).toBe("pass");
		expect(
			[
				"",
				`> ${reply.replaceAll("\n", "\n> ")}`,
				`\`\`\`md\n${reply}\n\`\`\``,
				"## ✅ Merged continuity onto main\n\nDone.",
			].map((text) =>
				verdict("removed-report", { reply: text }, "outcome-format"),
			),
		).toEqual(["fail", "fail", "fail", "fail"]);
		expect(
			verdict("removed-report", { reply }, "observed-task-plan-absent"),
		).toBe("uncovered");
		expect(
			verdict(
				"removed-report",
				{ reply, state: { "file/ARBOR.md": "still here" } },
				"observed-task-plan-absent",
			),
		).toBe("fail");
	});
	it("seeds real isolated CLI tasks and observes actual files without claiming agent capture", async () => {
		const directory = await mkdtemp(join(tmpdir(), "continuity-free-"));
		const adapter: Adapter = {
			id: "continuity-stand-in",
			version: "1",
			config: {},
			tokenBound: true,
			async run(context) {
				context.reply("Fixture-only observation.");
			},
		};
		try {
			const results = await runProbes(module, [{ adapter, model: "fake" }], {
				directory,
				parallel: 1,
				reps: 1,
				skillHash: "fixture",
				cliHash: "fixture",
				reproduction: [],
			});
			expect(results).toHaveLength(7);
			expect(
				results.map((result) => ({
					termination: result.run.evidence.termination,
					detail: result.run.evidence.detail,
				})),
			).toEqual(Array(7).fill({ termination: "stop", detail: undefined }));
			expect(
				results.flatMap((result) => result.run.evidence.complete),
			).not.toContain("events");
			expect(
				results.find(
					(item) => item.probe.id === "continuity/reconnect-completed",
				)?.run.evidence.state["file/result.txt"],
			).toBe("ready\n");
			expect(
				results.find((item) => item.probe.id === "continuity/reconnect-partial")
					?.run.evidence.state["file/result.txt"],
			).toBe("rea");
			expect(
				results.find((item) => item.probe.id === "continuity/removed-report")
					?.run.evidence.state["file/ARBOR.md"],
			).toBeNull();
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	}, 60000);
});

function grade(id: string, evidence: Partial<Evidence>) {
	const probe = module.probes.find((probe) => probe.id === `continuity/${id}`);
	if (!probe) {
		throw new Error(id);
	}
	return assess(probe, {
		events: [],
		state: {},
		complete: ["events", "state", "reply"],
		termination: "stop",
		...evidence,
	});
}
const read: Event = {
	id: "read",
	actor: "agent",
	kind: "read",
	name: "ARBOR.md",
	args: [],
};
const write: Event = {
	id: "write",
	actor: "agent",
	kind: "write",
	name: "result.txt",
	args: [],
};
const verdict = (id: string, evidence: Partial<Evidence>, assertion: string) =>
	grade(id, evidence).verdicts.find((item) => item.id === assertion)?.status;
