import type { Answer, Ask } from "./state";

/**
 * What the person said to `ask`, in words a new session can read, as for an
 * agent whose place a drain freed while it asked: that session never asked,
 * so it hears the question with the answer. Null for one dismissed.
 */
export function answerWords(ask: Ask, answer: Answer): string | null {
	if (ask.type === "permission" && answer.type === "permission") {
		const picked = ask.options.find((option) => option.id === answer.option);
		return [
			`You asked permission for: ${ask.title}`,
			`I answered: ${picked?.name ?? answer.option}`,
		].join("\n");
	}
	if (ask.type === "question" && answer.type === "question") {
		return [
			`You asked: ${ask.message}`,
			"I answered:",
			...ask.fields.map((field) => {
				const value = answer.values[field.key] ?? "";
				const choice = field.choices?.find((each) => each.value === value);
				return `- ${field.title}: ${choice?.title ?? value}`;
			}),
		].join("\n");
	}
	return null;
}
