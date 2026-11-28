import { afterEach, describe, expect, it } from "bun:test";
import { BanIcon, CheckIcon, GitMergeIcon, TerminalIcon } from "lucide-react";
import { CardFooter } from "./card-footer";
import { CardShell } from "./card-shell";
import { InSheetContext, PhoneSheets } from "./phone-sheets";
import {
	act,
	cleanup,
	fireEvent,
	render,
	waitFor,
	within,
} from "./testing-library";

afterEach(cleanup);

describe("CardFooter", () => {
	it("renders compact right-aligned sm buttons on a tinted footer outside sheets", () => {
		const clicked: string[] = [];
		const { container, getByRole, getByText } = render(
			<CardFooter
				note="Reason: busy"
				actions={[
					{
						label: "Deny",
						Icon: BanIcon,
						onClick: () => clicked.push("deny"),
					},
					{
						label: "Allow",
						Icon: CheckIcon,
						primary: true,
						onClick: () => clicked.push("allow"),
					},
				]}
			/>,
		);
		const footer = container.querySelector("footer");
		expect(footer?.hasAttribute("data-pinned")).toBe(false);
		expect(footer?.className).toContain("border-t");
		expect(footer?.className).not.toContain("bg-muted");
		expect(footer?.className).toContain("px-4");
		expect(getByText("Reason: busy")).toBeTruthy();

		const deny = getByRole("button", { name: "Deny" });
		const allow = getByRole("button", { name: "Allow" });
		expect(deny.className).toContain("h-7");
		expect(deny.className).not.toContain("h-11");
		expect(deny.className).toContain("border-border");
		expect(allow.className).toContain("h-7");
		expect(allow.className).not.toContain("h-11");
		expect(allow.className).toContain("bg-primary");

		fireEvent.click(deny);
		fireEvent.click(allow);
		expect(clicked).toEqual(["deny", "allow"]);
	});

	it("keeps confirmation footers neutral and renders refusal text", () => {
		const { container, getByRole, getByText } = render(
			<CardFooter
				note="Step 2 isn't checked off."
				refusal="Could not finish"
				actions={[
					{ label: "Keep going", onClick: () => {} },
					{ label: "I'm done", primary: true, onClick: () => {} },
				]}
			/>,
		);
		const footer = container.querySelector("footer");
		expect(footer?.className).toContain("border-t");
		expect(footer?.className).not.toContain("bg-warning");
		expect(footer?.className).not.toContain("bg-muted");
		expect(getByText("Step 2 isn't checked off.")).toBeTruthy();
		expect(getByRole("alert").textContent).toBe("Could not finish");
	});

	it("renders one full-width h-11 green-and-white Merge CTA in a mobile sheet", () => {
		const clicked: string[] = [];
		const { container, getByRole, queryByText } = render(
			<InSheetContext value={true}>
				<CardFooter
					note="Tab to merge"
					actions={[
						{
							label: "Merge",
							Icon: GitMergeIcon,
							tone: "success",
							primary: true,
							onClick: () => clicked.push("merge"),
						},
					]}
				/>
			</InSheetContext>,
		);
		const footer = container.querySelector("footer");
		expect(footer?.hasAttribute("data-pinned")).toBe(true);
		expect(footer?.className).toContain("bg-background");
		expect(queryByText("Tab to merge")).toBeNull();

		const merge = getByRole("button", { name: "Merge" });
		expect(merge.className).toContain("h-11");
		expect(merge.className).toContain("flex-1");
		expect(merge.className).toContain("bg-success");
		expect(merge.className).toContain("text-white");

		fireEvent.click(merge);
		expect(clicked).toEqual(["merge"]);
	});

	it("renders bordered outline secondary left and flex-1 primary right for 2 actions in a mobile sheet", () => {
		const clicked: string[] = [];
		const { getByRole } = render(
			<InSheetContext value={true}>
				<CardFooter
					actions={[
						{
							label: "Deny",
							Icon: BanIcon,
							onClick: () => clicked.push("deny"),
						},
						{
							label: "Allow",
							Icon: CheckIcon,
							primary: true,
							onClick: () => clicked.push("allow"),
						},
					]}
				/>
			</InSheetContext>,
		);
		const deny = getByRole("button", { name: "Deny" });
		const allow = getByRole("button", { name: "Allow" });
		expect(deny.className).toContain("h-11");
		expect(deny.className).toContain("shrink-0");
		expect(deny.className).not.toContain("flex-1");
		expect(deny.className).toContain("border-border");
		expect(allow.className).toContain("h-11");
		expect(allow.className).toContain("flex-1");
		expect(allow.className).toContain("bg-primary");

		fireEvent.click(deny);
		fireEvent.click(allow);
		expect(clicked).toEqual(["deny", "allow"]);
	});

	it("renders a 44x44 bordered overflow menu left and flex-1 primary right for 3+ actions in a mobile sheet", async () => {
		const clicked: string[] = [];
		const { getByRole, queryByRole } = render(
			<InSheetContext value={true}>
				<CardFooter
					actions={[
						{
							label: "Deny",
							tone: "destructive",
							onClick: () => clicked.push("deny"),
						},
						{
							label: "This session",
							onClick: () => clicked.push("session"),
						},
						{
							label: "Always",
							Icon: CheckIcon,
							primary: true,
							onClick: () => clicked.push("always"),
						},
					]}
				/>
			</InSheetContext>,
		);
		const more = getByRole("button", { name: "More actions" });
		const always = getByRole("button", { name: "Always" });
		expect(more.className).toContain("size-11");
		expect(more.className).toContain("border-border");
		expect(always.className).toContain("h-11");
		expect(always.className).toContain("flex-1");
		expect(queryByRole("button", { name: "Deny" })).toBeNull();

		await act(async () => {
			fireEvent.click(more);
		});
		const denyItem = await waitFor(() =>
			getByRole("menuitem", { name: "Deny" }),
		);
		expect(denyItem.getAttribute("data-variant")).toBe("destructive");
		expect(getByRole("menuitem", { name: "This session" })).toBeTruthy();

		fireEvent.click(denyItem);
		expect(clicked).toEqual(["deny"]);
	});

	it("shows sheetNote on a neutral footer inside mobile sheets", () => {
		const { container, getByText } = render(
			<InSheetContext value={true}>
				<CardFooter
					sheetNote="Step 2 isn't checked off."
					actions={[
						{ label: "Keep going", onClick: () => {} },
						{ label: "I'm done", primary: true, onClick: () => {} },
					]}
				/>
			</InSheetContext>,
		);
		expect(container.querySelector("footer")?.className).toContain(
			"bg-background",
		);
		expect(getByText("Step 2 isn't checked off.")).toBeTruthy();
	});
});

describe("CardShell mobile sheet integration", () => {
	it("collapses to a ThreadBar and opens a sheet with the card icon and pinned CardFooter", async () => {
		const clicked: string[] = [];
		const { getByRole } = render(
			<PhoneSheets conversation="c1" on={true} whole={true}>
				<CardShell
					label="Run command"
					Icon={TerminalIcon}
					title="Run the full web test suite"
					tone="warning"
					sheet={{ title: "Run command", action: "Review" }}
				>
					<CardFooter
						actions={[
							{ label: "Deny", onClick: () => clicked.push("deny") },
							{
								label: "Allow",
								primary: true,
								onClick: () => clicked.push("allow"),
							},
						]}
					/>
				</CardShell>
			</PhoneSheets>,
		);

		const bar = getByRole("button", { name: /Run command.*Review/ });
		expect(bar.hasAttribute("data-thread-bar")).toBe(true);
		await act(async () => {
			fireEvent.click(bar);
		});

		const dialog = await waitFor(() => getByRole("dialog"));
		const header = dialog.querySelector("header");
		expect(header?.className).toContain("bg-warning/[0.08]");
		expect(header?.className).toContain("h-(--top-bar-height)");
		expect(header?.querySelector("svg.text-warning")).not.toBeNull();
		const heading = within(dialog).getByRole("heading", {
			name: "Run command",
		});
		expect(heading.className).toContain("font-medium");
		expect(heading.className).toContain("text-sm");
		// Close button sits at the end (upper-right) with no Conversation button.
		expect(header?.lastElementChild?.getAttribute("aria-label")).toBe("Close");
		expect(
			within(dialog).queryByRole("button", { name: "Conversation" }),
		).toBeNull();
		// No second card header stutter inside the mobile sheet.
		expect(dialog.querySelector("[data-card] > header")).toBeNull();

		const allow = within(dialog).getByRole("button", { name: "Allow" });
		expect(allow.closest("[data-pinned]")).not.toBeNull();
		expect(allow.className).toContain("h-11");
		expect(allow.className).toContain("flex-1");
		fireEvent.click(allow);
		expect(clicked).toEqual(["allow"]);
	});

	it("places aside as a single-line subtitle inside the sheet header and omits task/base chips", async () => {
		const { getByRole } = render(
			<PhoneSheets conversation="c1" on={true} whole={true}>
				<CardShell
					label="Ready to merge"
					Icon={GitMergeIcon}
					title="Ready to merge"
					tone="success"
					task="mobile-nav-scroll"
					base="main"
					aside={<span>Changes asked</span>}
					sheet={{ title: "Ready to merge", action: "Open" }}
				>
					<p className="px-4 py-3 text-sm">Body text</p>
				</CardShell>
			</PhoneSheets>,
		);

		await act(async () => {
			fireEvent.click(getByRole("button", { name: /Ready to merge.*Open/ }));
		});

		const dialog = await waitFor(() => getByRole("dialog"));
		const header = dialog.querySelector("header");
		expect(header?.textContent).toContain("Ready to merge");
		expect(header?.textContent).toContain("Changes asked");
		const subtitleRow = header?.querySelector(".whitespace-nowrap");
		expect(subtitleRow?.textContent).toBe("Changes asked");
		expect(subtitleRow?.className).toContain("text-[11px]");
		expect(subtitleRow?.className).toContain("leading-4");
		expect(dialog.textContent).not.toContain("mobile-nav-scroll");
		expect(dialog.textContent).not.toContain("onto");
		const card = dialog.querySelector("[data-card]");
		expect(card?.textContent).toBe("Body text");
	});
});
