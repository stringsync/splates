import { afterEach, expect, it } from "bun:test";
import {
	AssistantRuntimeProvider,
	MessagePrimitive,
	type TextMessagePartComponent,
	type ThreadMessageLike,
	useAuiState,
	useExternalStoreRuntime,
} from "@assistant-ui/react";
import { MarkdownText } from "./components/assistant-ui/elements/markdown-text";
import { Thread } from "./components/assistant-ui/elements/thread.aui";
import { cleanup, render, waitFor } from "./testing-library";

afterEach(cleanup);

it("leaves settled messages and their markdown alone while a reply streams", async () => {
	const renders: string[] = [];
	const parsed: string[] = [];
	const typed = (text: string) => {
		parsed.push(text);
		return text;
	};
	const Text: TextMessagePartComponent = (props) => (
		<MarkdownText {...props} typed={typed} />
	);
	const parts = { Text };
	const components = {
		AssistantMessage: () => {
			const id = useAuiState((state) => state.message.id);
			renders.push(id);
			return <MessagePrimitive.Parts components={parts} />;
		},
	};
	function View({ messages }: { messages: ThreadMessageLike[] }) {
		const runtime = useExternalStoreRuntime({
			messages,
			isRunning: true,
			convertMessage: (message: ThreadMessageLike) => message,
			onNew: async () => {},
		});
		return (
			<AssistantRuntimeProvider runtime={runtime}>
				<Thread components={components} autoFocus={false} />
			</AssistantRuntimeProvider>
		);
	}
	const settled: ThreadMessageLike = {
		id: "settled",
		role: "assistant",
		content: [{ type: "text", text: "Settled **reply**" }],
	};
	const streaming = (text: string): ThreadMessageLike => ({
		id: "streaming",
		role: "assistant",
		content: [{ type: "text", text }],
	});
	const view = render(<View messages={[settled, streaming("First")]} />);
	await waitFor(() => expect(view.getByText("First")).toBeTruthy());
	renders.length = 0;
	parsed.length = 0;
	view.rerender(<View messages={[settled, streaming("Next words")]} />);
	await waitFor(() => expect(view.getByText("Next words")).toBeTruthy());
	expect(renders).not.toContain("settled");
	expect(parsed).not.toContain("Settled **reply**");

	// Stable membership must still allow a correction to an older message.
	view.rerender(
		<View
			messages={[
				{ ...settled, content: [{ type: "text", text: "Corrected reply" }] },
				streaming("Next words"),
			]}
		/>,
	);
	await waitFor(() => expect(view.getByText("Corrected reply")).toBeTruthy());

	view.rerender(
		<View
			messages={[
				{ id: "earlier", role: "user", content: "Earlier turn" },
				settled,
				{ id: "next", role: "user", content: "Next turn" },
				streaming("Next words"),
			]}
		/>,
	);
	await waitFor(() => expect(view.getByText("Earlier turn")).toBeTruthy());
	expect(view.getByText("Next turn")).toBeTruthy();
	const turns = view.container.querySelectorAll('[data-slot="aui_turn"]');
	expect(turns).toHaveLength(2);
	expect(turns[0]?.textContent).toContain("Settled reply");
	expect(turns[1]?.textContent).toContain("Next words");
});
