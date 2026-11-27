import type { Question } from "../plans";
import type { DecisionKind } from "./types";

/** Markdown image syntax: `![alt](path)`. */
const IMAGE = /!\[[^\]]*\]\([^)]+\)/;

const VISUAL_WORDS =
	/\b(ui|ux|layout|style|color|colour|theme|icon|font|spacing|padding|margin|button|modal|drawer|sheet|dialog|card|badge|avatar|sidebar|header|footer|mockup|mock|screenshot|visual|width|height|mobile|phone|desktop|responsive|align|border|shadow|animation|hover|popover|tooltip|tab|tabs|table|chart|graph)\b/i;

const SCOPE_WORDS =
	/\b(scope|split|lane|queue|task|tasks|follow[- ]?up|separate|defer|order|first|phase|step|steps|milestone|ship|release|bundle|include|exclude|drop|keep|remove|retire|migrate|migration)\b/i;

const DEFAULTS_WORDS =
	/\b(default|defaults|timeout|retry|retries|limit|limits|cap|threshold|interval|delay|ttl|port|size|count|max|min|window|TTL|polling|rate|backoff|concurrency|batch|cache|retention|capacity)\b/i;

/** Whether `question` or any of its choices embeds an image. */
export function hasImage(
	question: Pick<Question, "body" | "choices">,
): boolean {
	if (IMAGE.test(question.body)) {
		return true;
	}
	return question.choices.some((choice) => IMAGE.test(choice.body));
}

/**
 * Classifies a question into one of the five decision kinds.
 * An image on the question or any choice always means `visual`;
 * a plan approval question always means `approval`.
 */
export function classifyQuestion(
	question: Pick<Question, "text" | "body" | "choices">,
	{ approval = false }: { approval?: boolean } = {},
): DecisionKind {
	if (approval) {
		return "approval";
	}
	if (hasImage(question)) {
		return "visual";
	}
	const haystack = [
		question.text,
		question.body,
		...question.choices.map((choice) => choice.text),
	].join(" ");
	if (VISUAL_WORDS.test(haystack)) {
		return "visual";
	}
	if (DEFAULTS_WORDS.test(haystack)) {
		return "defaults";
	}
	if (SCOPE_WORDS.test(haystack)) {
		return "scope";
	}
	return "design";
}
