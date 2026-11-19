import { expect, test } from "bun:test";
import type { ConversationList } from "../conversations";
import type { Message } from "../conversations/state";
import { autoAllowed, BusyRunWatch, busyCommandOf } from "./busy-run-watch";

function agent(card: string): Message {
	return {
		role: "agent",
		parts: [{ type: "text", text: card }],
		plan: null,
		at: null,
		until: null,
	};
}

const card = (reason: string, command = "bun run build") =>
	`## 🔐 Permission: run command: build\n\n\`${command}\`\n\n${reason}\n\nAsking because the machine is busy.`;

test("a card whose only reason is the busy machine is answerable", () => {
	expect(busyCommandOf(agent(card("Reason: busy")))).toBe("bun run build");
});

test.each([
	["a risk reason", card("Reason: risk", "aws deploy")],
	["a cost reason", card("Reason: cost")],
	["no reason", card("")],
	["two reasons", card("Reason: busy\nReason: risk")],
])("%s is never answered", (_, text) => {
	expect(busyCommandOf(agent(text))).toBeNull();
});

test("a person's message, or no message, is never answered", () => {
	expect(busyCommandOf(undefined)).toBeNull();
	expect(
		busyCommandOf({ ...agent(card("Reason: busy")), role: "user" }),
	).toBeNull();
});

test("a rec card is never answered, since it needs the person at the machine", () => {
	expect(
		busyCommandOf(agent(card("Reason: busy", "rec --name x --url http://a"))),
	).toBeNull();
});

test("the answer carries the directive and the reading", () => {
	const text = autoAllowed({
		kind: "Mac",
		splates: null,
		cpu: 0.12,
		memory: 0.4,
		load: 1,
		cores: 8,
		temperature: null,
	});
	expect(text.startsWith("[SPLATES RUN ALLOWED]")).toBe(true);
	expect(text).toContain("Auto-allowed by splates");
	expect(text).toContain("CPU 12%");
});

function watching(options: { enabled: boolean; cpu: number; text: string }) {
	const said: string[] = [];
	const conversation = {
		state: {
			id: "c1",
			archived: false,
			status: "idle",
			messages: [agent(options.text)],
		},
		prompt: async (text: string) => {
			said.push(text);
		},
	};
	const watch = new BusyRunWatch({
		enabled: () => options.enabled,
		conversations: {
			list: async () => [conversation],
		} as unknown as ConversationList,
		read: async () => ({
			kind: "Mac",
			splates: null,
			cpu: options.cpu,
			memory: 0.3,
			load: 1,
			cores: 8,
			temperature: null,
		}),
		log: { error: () => {} },
	});
	return { watch, said };
}

test("an idle machine allows a busy-only card once", async () => {
	const { watch, said } = watching({
		enabled: true,
		cpu: 0.1,
		text: card("Reason: busy"),
	});
	await watch.sweep();
	await watch.sweep();
	expect(said).toHaveLength(1);
	expect(said[0]).toContain("[SPLATES RUN ALLOWED]");
});

test.each([
	["a busy machine", { enabled: true, cpu: 0.95, text: card("Reason: busy") }],
	["the setting off", { enabled: false, cpu: 0.1, text: card("Reason: busy") }],
	["a risk reason", { enabled: true, cpu: 0.1, text: card("Reason: risk") }],
	["no reason", { enabled: true, cpu: 0.1, text: card("") }],
])("%s allows nothing", async (_, options) => {
	const { watch, said } = watching(options);
	await watch.sweep();
	expect(said).toEqual([]);
});
