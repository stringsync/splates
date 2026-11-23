import type { ModelProvider } from "@splates/server/stats/browser";
import type { JSX } from "react";
import { AgentIcon, AgentMark } from "./agent-icons";

const MARKS = {
	anthropic: { agent: "claude", name: "Anthropic" },
	google: { agent: "gemini", name: "Google" },
	moonshot: { agent: "kimi", name: "Moonshot AI" },
} as const;

/** Uses the model maker's mark, even when another agent ran the model. */
export function ModelProviderMark({
	provider,
	className,
}: {
	provider: ModelProvider | null | undefined;
	className?: string;
}): JSX.Element | null {
	if (provider == null) {
		return null;
	}
	if (provider === "openai") {
		return <AgentIcon agent="codex" name="OpenAI" className={className} />;
	}
	return <AgentMark {...MARKS[provider]} className={className} />;
}
