import { beforeEach, describe, expect, it } from "bun:test";
import type { Tool } from "@stringsync/splates-server/conversations";
import { Markdown } from "./markdown";
import { NamedContext } from "./mentioned";
import { linkNotes, noteIn } from "./note-references";
import { fireEvent, render, waitFor } from "./testing-library";
import { TimelineItem } from "./work-timeline";

describe("note references", () => {
	let notes: { path: string; description: string }[];
	let named: import("./mentioned").Named;
	beforeEach(() => {
		notes = [
			{
				path: "/repo/notes/retries.md",
				description: "Retry only transient failures",
			},
		];
		named = {
			notes,
			notesRoot: "/repo",
			tree: "/tasks/fix",
			projects: [],
			paths: new Set<string>(),
			resolving: { paths: false, projects: false },
		};
	});
	it("links known paths and filenames in prose and inline code", () => {
		const linked = linkNotes(
			"Read notes/retries.md, then `retries.md` and /repo/notes/retries.md.",
			notes,
			"/repo",
		);
		expect(linked.match(/#note=/g)).toHaveLength(3);
		expect(noteIn("#note=%2Frepo%2Fnotes%2Fretries.md")).toBe(
			"/repo/notes/retries.md",
		);
	});

	it("keeps fenced code, commands, links, @ mentions, URLs, and other paths intact", () => {
		const text =
			"`cat notes/retries.md` @notes/retries.md other/retries.md retries.md.bak https://a/retries.md [retries.md](notes/retries.md)\n```md\nnotes/retries.md\n```\n~~~\nretries.md\n~~~";
		expect(linkNotes(text, notes, "/repo")).toBe(text);
	});

	it("leaves ambiguous filenames alone and supports a configured notes directory", () => {
		const custom = [
			{ path: "/repo/docs/decisions/retries.md", description: "Retries" },
			{ path: "/else/retries.md", description: "Other" },
		];
		expect(linkNotes("retries.md", custom, "/repo")).toBe("retries.md");
		expect(linkNotes("docs/decisions/retries.md", custom, "/repo")).toContain(
			"#note=",
		);
		expect(noteIn("#note=%broken")).toBeNull();
	});

	it("renders prose and tool read references as reader buttons", () => {
		const tool: Tool = {
			type: "tool",
			id: "read",
			title: "Read",
			kind: "read",
			command: null,
			target: null,
			paths: ["/tasks/fix/notes/retries.md"],
			output: "",
			status: "completed",
			edits: [],
			parent: null,
			at: null,
			until: null,
			flags: [],
			decision: null,
		};
		const page = render(
			<NamedContext value={named}>
				<Markdown text="Read `notes/retries.md`." />
				<TimelineItem item={{ type: "tool", tool }} short={(path) => path} />
			</NamedContext>,
		);
		expect(page.getAllByRole("button", { name: "retries.md" })).toHaveLength(2);
		expect(page.container.querySelector("a")).toBeNull();
	});

	it("opens the note body in a dialog and closes it without leaving the conversation", async () => {
		const previous = globalThis.fetch;
		const requests: string[] = [];
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			requests.push(String(input));
			return Response.json({
				...notes[0],
				body: "Retry **transient** failures.",
			});
		}) as typeof fetch;
		try {
			const page = render(
				<NamedContext value={named}>
					<Markdown text="See retries.md." />
				</NamedContext>,
			);
			fireEvent.click(page.getByRole("button", { name: "retries.md" }));
			const dialog = await waitFor(() => page.getByRole("dialog"));
			await waitFor(() =>
				expect(dialog.textContent).toContain("Retry transient failures."),
			);
			expect(requests).toContain(
				"/api/notes/read?path=%2Frepo%2Fnotes%2Fretries.md",
			);
			fireEvent.click(page.getByRole("button", { name: "Close" }));
			await waitFor(() => expect(page.queryByRole("dialog")).toBeNull());
		} finally {
			globalThis.fetch = previous;
		}
	});
});
