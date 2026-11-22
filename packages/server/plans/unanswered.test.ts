import { expect, test } from "bun:test";
import type { Message } from "../conversations";
import { openCards } from "./unanswered";

function message(role: Message["role"], text: string): Message {
	return {
		role,
		parts: [{ type: "text", text }],
		plan: null,
		at: null,
		until: null,
	};
}
test("a bare approval settles no question card, old proposal or not", () => {
	const old = message(
		"agent",
		"## 💡 Proposed a fix\n\n1. Keep it?\n   - (a) Yes (chosen)",
	);
	expect(openCards([old, message("user", "[SPLATES APPROVE]")])).toHaveLength(
		1,
	);
	expect(openCards([old, message("user", "approve")])).toHaveLength(1);
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
