import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { ConversationState } from "../conversations";
import { act, cleanup, Testing, tool, turn, waitFor, within } from "./testing";

describe("App's work row commands", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	const opened = async (state: ConversationState) => {
		const view = await testing.openConversations([state]);
		return await waitFor(() =>
			view.getByRole("region", { name: state.title ?? "" }),
		);
	};
	/** Each row's line, as it reads folded. */
	const lines = (list: Element) =>
		[...list.children].map(
			(row) => (row.querySelector("summary") ?? row).textContent,
		);

	it("says what each call does while it runs, and what it did once done", async () => {
		const calls = (status: "in_progress" | "completed") => [
			tool({
				id: "r1",
				kind: "read",
				title: "Read /repo/a.ts (1 - 80)",
				paths: ["/repo/a.ts"],
				status,
			}),
			tool({ id: "g1", kind: "search", target: "fold\\(", status }),
			tool({
				id: "m1",
				kind: "other",
				title: "mcp__playwright__browser_click",
				status,
			}),
			tool({ id: "x1", kind: "execute", title: "Terminal", status }),
		];
		const thread = await opened(
			turn(calls("in_progress"), { status: "running" }),
		);
		const rows = () =>
			lines(within(thread).getByRole("list", { name: "timeline" }));

		await waitFor(() =>
			expect(rows()).toEqual([
				"Readinga.ts#L1-80",
				"Searchingfold\\(",
				"Usingbrowser_click (playwright)",
				"Running",
			]),
		);

		await testing.say(turn([...calls("completed"), "Done."]));
		await waitFor(() =>
			expect(rows()).toEqual([
				"Reada.ts#L1-80",
				"Searchedfold\\(",
				"Usedbrowser_click (playwright)",
				"Ran",
			]),
		);
	});

	const reading = () =>
		turn([
			tool({
				id: "r1",
				kind: "read",
				title: "Read /repo/src/a.ts (12 - 80)",
				paths: ["/repo/src/a.ts"],
			}),
			"Done.",
		]);

	it("opens a file chip in the editor the settings pick", async () => {
		localStorage.setItem(
			"arbor.settings",
			JSON.stringify({ "editor.opener": "vscode" }),
		);
		const thread = await opened(reading());

		const chip = await waitFor(() => within(thread).getByRole("link"));
		expect(chip.getAttribute("href")).toBe("vscode://file/repo/src/a.ts:12");
	});

	it("shows each file a call names as a chip, opening in Zed at its lines", async () => {
		const thread = await opened(
			turn([
				tool({
					id: "r1",
					kind: "read",
					title: "Read /repo/src/a.ts (12 - 80)",
					paths: ["/repo/src/a.ts"],
				}),
				tool({ id: "r2", kind: "read", paths: ["/repo/notes.xyz"] }),
				"Done.",
			]),
		);

		const timeline = await waitFor(() =>
			within(thread).getByRole("list", { name: "timeline" }),
		);
		const [code, other] = within(timeline).getAllByRole("link");
		expect([code?.textContent, code?.getAttribute("href")]).toEqual([
			"a.ts#L12-80",
			"zed://file/repo/src/a.ts:12",
		]);
		// TypeScript's icon, not the plain page of a file it cannot tell.
		const icon = (chip: Element | undefined) =>
			chip?.querySelector("img")?.getAttribute("src");
		expect(icon(code)).toStartWith("data:image/svg+xml,");
		expect(icon(code)).not.toBe(icon(other));
		expect(other?.textContent).toBe("notes.xyz");
	});

	it("gives a caret only to a row that opens to more", async () => {
		const thread = await opened(
			turn([
				tool({ id: "r1", kind: "read", paths: ["/repo/a.ts"], output: "x" }),
				tool({ id: "x1", command: "bun test", output: "1 pass" }),
				"Done.",
			]),
		);

		const timeline = await waitFor(() =>
			within(thread).getByRole("list", { name: "timeline" }),
		);
		const [read, command] = within(timeline).getAllByRole("listitem");
		expect(read?.querySelector("details")).toBeNull();
		expect(read?.querySelector(".lucide-chevron-right")).toBeNull();
		expect(
			command?.querySelector("summary .lucide-chevron-right"),
		).not.toBeNull();
	});

	it("warns of a command that did to git what it should not have, opening to the command", async () => {
		const thread = await opened(
			turn([
				tool({ id: "x1", command: "git status" }),
				tool({
					id: "x2",
					command: "git stash && cd /repo && touch stray.txt",
					flags: [
						{ type: "stashed", count: 1 },
						{ type: "outside", paths: ["stray.txt"] },
					],
				}),
				"Done.",
			]),
		);

		const warnings = await waitFor(() =>
			within(thread).getByRole("list", { name: "warnings" }),
		);
		expect(within(warnings).getAllByRole("listitem")[0]?.textContent).toContain(
			"Stashed changes and left them there · Changed 1 file in the main tree",
		);
		expect(warnings.textContent).toContain(
			"$ git stash && cd /repo && touch stray.txt",
		);
		expect(
			within(warnings).getByRole("list", {
				name: "files changed in the main tree",
			}).textContent,
		).toBe("stray.txt");
		expect(warnings.textContent).not.toContain("git status");
	});

	it("shows how each permission the agent asked was answered, above its call", async () => {
		const at = "2026-10-11T12:00:00.000Z";
		const thread = await opened(
			turn([
				tool({
					id: "x1",
					command: "rm -rf build",
					decision: {
						option: { name: "Allow", kind: "allow_once" },
						at,
					},
				}),
				tool({
					id: "x2",
					command: "git push",
					status: "failed",
					decision: {
						option: { name: "Reject", kind: "reject_once" },
						at,
					},
				}),
				tool({ id: "x3", command: "deploy", decision: { option: null, at } }),
				"Done.",
			]),
		);

		const timeline = await waitFor(() =>
			within(thread).getByRole("list", { name: "timeline" }),
		);
		expect(
			within(timeline)
				.getAllByRole("listitem")
				.map((each) => each.textContent),
		).toEqual([
			"Allowed for this sessionrm -rf build",
			expect.stringContaining("rm -rf build"),
			"Deniedgit push",
			expect.stringContaining("git push"),
			"Dismisseddeploy",
			expect.stringContaining("deploy"),
		]);
	});

	it("marks a command the agent never finished as stopped once its turn is over", async () => {
		const thread = await opened(
			turn([
				tool({ id: "x1", command: "bun test" }),
				tool({ id: "x2", command: "bun run demo", status: "in_progress" }),
				"Done.",
			]),
		);

		const timeline = await waitFor(() =>
			within(thread).getByRole("list", { name: "timeline" }),
		);
		expect(within(timeline).getByText("Ran")).toBeTruthy();
		expect(within(timeline).getByText("Stopped running")).toBeTruthy();
		expect(within(timeline).queryByText("Running")).toBeNull();
		expect(within(timeline).getByText("No output")).toBeTruthy();
	});

	it("counts a command run again in a row, and opens it to its output", async () => {
		const thread = await opened(
			turn([
				tool({ id: "x1", command: "bun test", status: "failed" }),
				tool({ id: "x2", command: "bun test", status: "failed" }),
				tool({
					id: "x3",
					command: "bun test",
					status: "failed",
					output: "\u001b[31m1 fail\u001b[39m",
				}),
				"Still failing.",
			]),
		);

		const row = await waitFor(() => within(thread).getByText("×3"));
		const command = row.closest("details") as HTMLDetailsElement;
		expect(within(command).getByText("Failed to run")).toBeTruthy();
		expect(within(command).getByLabelText("output").textContent).toBe("1 fail");
	});

	it("names each edited file in its row by its name alone, the whole path its tooltip, opening to the edit", async () => {
		const thread = await opened(
			turn([
				tool({
					id: "e1",
					kind: "edit",
					paths: ["/repo/src/a.ts"],
					edits: [{ path: "/repo/src/a.ts", old: "one", new: "two" }],
				}),
				tool({
					id: "e2",
					kind: "edit",
					paths: ["/repo/src/a.ts"],
					edits: [{ path: "/repo/src/a.ts", old: "two", new: "three" }],
				}),
				tool({
					id: "e3",
					kind: "edit",
					paths: ["/repo-arbor/gone/lib/b.ts"],
					edits: [{ path: "/repo-arbor/gone/lib/b.ts", old: null, new: "new" }],
				}),
				tool({
					id: "e4",
					kind: "edit",
					paths: ["/tmp/c.ts"],
					edits: [{ path: "/tmp/c.ts", old: null, new: "new" }],
				}),
				"Done.",
			]),
		);

		const timeline = await waitFor(() =>
			within(thread).getByRole("list", { name: "timeline" }),
		);
		expect(
			within(thread).queryByRole("list", { name: "edited files" }),
		).toBeNull();
		expect(
			within(timeline)
				.getAllByRole("link")
				.map((chip) => [chip.title, chip.textContent]),
		).toEqual([
			["/repo/src/a.ts", "a.ts"],
			["/repo/src/a.ts", "a.ts"],
			["/repo-arbor/gone/lib/b.ts", "b.ts"],
			["/tmp/c.ts", "c.ts"],
		]);
		const first = within(timeline).getAllByRole("listitem")[0] as HTMLElement;
		await act(async () => {
			(first.querySelector("details") as HTMLDetailsElement).open = true;
		});
		expect(
			within(first)
				.getAllByLabelText("edit to /repo/src/a.ts")
				.map((edit) => edit.textContent),
		).toEqual(["src/a.ts+1 −1−one+two"]);
	});
});
