import { expect, test } from "bun:test";
import type { Message } from "../conversations";
import { openCards, unanswered } from "./unanswered";

function message(role: Message["role"], text: string): Message {
	return {
		role,
		parts: [{ type: "text", text }],
		plan: null,
		at: null,
		until: null,
	};
}
const proposal = message(
	"agent",
	"## 💡 Proposed a fix\n\n1. Keep it?\n   - (a) Yes (chosen)\n   - (b) No\n2. Which name?\n",
);

test.each([
	["[SPLATES APPROVE]", ["2"]],
	["approve", ["2"]],
	["[SPLATES APPROVE]\n\n2. New name", []],
])("approval %s settles chosen answers", (reply, expected) => {
	const messages = [proposal, message("user", reply)];
	expect(openCards(messages).map((question) => question.number)).toEqual(
		expected,
	);
	expect(
		unanswered(openCards([proposal]), messages).map(
			(question) => question.number,
		),
	).toEqual(expected);
});

test("approval does not settle an ordinary question card", () => {
	expect(
		openCards([
			message("agent", "1. Keep it?\n   - (a) Yes (chosen)"),
			message("user", "approve"),
		]),
	).toHaveLength(1);
});

test("a newer proposal replaces only the previous proposal questions", () => {
	const separate = message("agent", "1. Separate question?");
	const newer = message(
		"agent",
		"## 💡 Proposed another fix\n\n1. Use the other option?",
	);
	expect(
		openCards([separate, proposal, newer]).map((question) => question.text),
	).toEqual(["Separate question?", "Use the other option?"]);
});

test("an approval of the old proposal does not answer a repeated question in its replacement", () => {
	expect(
		openCards([proposal, message("user", "approve"), proposal]).map(
			(question) => question.number,
		),
	).toEqual(["1", "2"]);
});

test("quoted answers with Windows line endings settle every matching card", () => {
	const question = message("agent", "1. Keep it?");
	expect(
		openCards([
			question,
			question,
			message("user", "> **Keep it?**\r\n\r\nYes"),
		]),
	).toEqual([]);
});

const keep = message(
	"agent",
	"1. Keep demos?\n   - (a) Yes (chosen)\n   - (b) No",
);
const words = message("user", "Demos should stay out of the plan.");
const revised = message(
	"agent",
	"1. Approve the revision?\n   - (a) Yes (chosen)",
);
const texts = (messages: Message[]) =>
	openCards(messages).map((question) => question.text);

test("a reply in own words leaves its card open until no newer card replaces it", () => {
	expect(texts([keep, words])).toEqual(["Keep demos?"]);
});

test("the next card replaces one replied to in own words", () => {
	expect(texts([keep, words, revised])).toEqual(["Approve the revision?"]);
});

test("an agent's message with no card replaces nothing", () => {
	expect(texts([keep, words, message("agent", "Done, merging.")])).toEqual([
		"Keep demos?",
	]);
});

test("a newer card does not replace a card nobody replied to", () => {
	expect(texts([keep, revised])).toEqual([
		"Keep demos?",
		"Approve the revision?",
	]);
});

test("a newer card does not replace an older card the reply did not follow", () => {
	expect(texts([keep, revised, words, message("agent", "1. Third?")])).toEqual([
		"Keep demos?",
		"Third?",
	]);
});

test("a newer card does not replace questions a partial answer left open", () => {
	const two = message("agent", "1. First?\n2. Second?");
	const partial = message("user", "> **First?**\n\nYes");
	expect(texts([two, partial, revised])).toEqual([
		"Second?",
		"Approve the revision?",
	]);
});

test.each([
	["splates", { ...message("user", "Early warning"), told: "splates" }],
	["a directive", message("user", "[SPLATES RESUME]")],
])("a message from %s is no reply a newer card can replace", (_, said) => {
	expect(texts([keep, said, revised])).toEqual([
		"Keep demos?",
		"Approve the revision?",
	]);
});

// The exchange that kept demos-still-needed from merging.
test("a chain of replies in own words ends settled by the last card's answer", () => {
	const last = message(
		"agent",
		"1. Approve this documentation-only change?\n   - (a) Yes, merge it (chosen)",
	);
	const asked = [
		message(
			"agent",
			"## 💡 Proposed keep demos\n\n1. Keep demos?\n   - (a) Yes (chosen)",
		),
		words,
		revised,
		message("user", "Can't you solve this by removing a mention of it?"),
		last,
	];
	expect(texts(asked)).toEqual(["Approve this documentation-only change?"]);
	expect(
		texts([
			...asked,
			message(
				"user",
				"> **Approve this documentation-only change?**\r\n\r\n- (a) Yes, merge it",
			),
		]),
	).toEqual([]);
});

// Replays the caption conversation that still refused after 5cdc2b492.
// Images, local paths and unrelated agent updates are omitted.
test("revised proposals settle after natural-language replies and quoted choices", async () => {
	const { default: exchange } = await import(
		"./replaced-proposals.fixture.json"
	);
	const messages = exchange.map(([role, text]) =>
		message(role as Message["role"], text as string),
	);
	const approval = messages.findLastIndex(
		(each) =>
			each.role === "user" &&
			each.parts[0]?.type === "text" &&
			each.parts[0].text === "[SPLATES APPROVE]",
	);
	// The final proposal repeats a question asked by earlier proposals.
	expect(
		openCards(messages.slice(0, approval)).map((each) => each.text),
	).toEqual(["Should the task dialog get the same layout and switch?"]);
	expect(openCards(messages)).toEqual([]);
	// Superseding proposals must not silently clear a separate question.
	expect(
		openCards([message("agent", "1. Separate question?"), ...messages]).map(
			(each) => each.text,
		),
	).toEqual(["Separate question?"]);
});
