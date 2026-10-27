import { describe, expect, it } from "bun:test";
import { FakeFs } from "webappwiz/system/testing";
import {
	kimiTurnUsage,
	kimiUsage,
	kimiUsageIn,
	kimiUsagePath,
} from "./kimi-usage";

describe("Kimi usage", () => {
	it("finds the session's wire log as Kimi names its working directories", async () => {
		const deps = {
			home: "/home/me/.kimi-code",
			cwd: "/repo/My Project/",
			session: "s1",
		};
		const path = kimiUsagePath(deps);
		expect(path).toBe(
			"/home/me/.kimi-code/sessions/wd_my-project_7e796667526c/session_s1/agents/main/wire.jsonl",
		);
		const fs = new FakeFs();
		await fs.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
		await fs.write(path, RECORD);
		expect(await kimiUsage({ fs, ...deps })).toEqual({
			inputTokens: 10,
			cachedReadTokens: 20,
			cachedWriteTokens: 5,
			outputTokens: 7,
			totalTokens: 42,
		});
	});

	it("sums usage records once, leaving other agents, scopes, context copies and a partial non-usage line out", () => {
		expect(kimiUsageIn(`not JSON\n${WIRE}`)).toEqual({
			inputTokens: 30,
			cachedReadTokens: 50,
			cachedWriteTokens: 5,
			outputTokens: 19,
			totalTokens: 104,
		});
	});

	it("says unknown rather than partial for a malformed usage record", () => {
		expect(
			kimiUsageIn(
				'{"type":"usage.record","agentId":"main","usageScope":"turn"}\n',
			),
		).toBeNull();
		expect(kimiUsageIn('{"type":"usage.record"\n')).toBeNull();
	});

	it("takes only the turn's new tokens, never a resumed session's old ones", () => {
		const before = kimiUsageIn(RECORD);
		const after = kimiUsageIn(WIRE);
		expect(kimiTurnUsage(before, after)).toEqual({
			inputTokens: 20,
			cachedReadTokens: 30,
			cachedWriteTokens: 0,
			outputTokens: 12,
			totalTokens: 62,
		});
		expect(kimiTurnUsage(after, before)).toBeNull();
		expect(kimiTurnUsage(before, before)).toBeNull();
		expect(kimiTurnUsage(null, after)).toBeNull();
	});
});

const RECORD = `${JSON.stringify({
	type: "usage.record",
	agentId: "main",
	usageScope: "turn",
	usage: {
		inputOther: 10,
		inputCacheRead: 20,
		inputCacheCreation: 5,
		output: 7,
	},
})}\n`;

const WIRE = [
	RECORD.trim(),
	JSON.stringify({
		type: "usage.record",
		agentId: "main",
		usageScope: "turn",
		usage: {
			inputOther: 20,
			inputCacheRead: 30,
			inputCacheCreation: 0,
			output: 12,
		},
	}),
	JSON.stringify({
		type: "usage.record",
		agentId: "subagent",
		usageScope: "turn",
		usage: {
			inputOther: 100,
			inputCacheRead: 100,
			inputCacheCreation: 100,
			output: 100,
		},
	}),
	JSON.stringify({
		type: "usage.record",
		agentId: "main",
		usageScope: "session",
		usage: {
			inputOther: 100,
			inputCacheRead: 100,
			inputCacheCreation: 100,
			output: 100,
		},
	}),
	JSON.stringify({
		type: "context.append_loop_event",
		event: {
			usage: {
				inputOther: 20,
				inputCacheRead: 30,
				inputCacheCreation: 0,
				output: 12,
			},
		},
	}),
].join("\n");
