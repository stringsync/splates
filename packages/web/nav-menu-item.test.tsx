import { afterEach, describe, expect, it } from "bun:test";
import { InboxIcon } from "lucide-react";
import { NavMenuItem, navMenuItemClass } from "./nav-menu-item";
import { Drawer } from "./phone-drawer";
import {
	cleanup,
	conversation,
	message,
	render,
	Testing,
	within,
} from "./testing";

describe("navMenuItemClass and NavMenuItem", () => {
	afterEach(() => {
		cleanup();
	});

	it("matches Settings desktop row typography, height, and inactive/active tones", () => {
		const inactive = navMenuItemClass();
		expect(inactive).toContain("h-9");
		expect(inactive).toContain("py-2");
		expect(inactive).toContain("text-sm");
		expect(inactive).toContain("text-muted-foreground");
		expect(inactive).toContain("hover:bg-muted/60");
		expect(inactive).toContain("hover:text-foreground");
		expect(inactive.split(/\s+/)).not.toContain("bg-accent");

		const active = navMenuItemClass({ current: true });
		expect(active.split(/\s+/)).toContain("bg-accent");
		expect(active).toContain("font-medium");
		expect(active).toContain("text-foreground");
	});

	it("uses muted inactive and bright active tones for lg drawer items", () => {
		const view = render(
			<>
				<NavMenuItem size="lg" icon={<InboxIcon />} label="Inactive" />
				<NavMenuItem size="lg" current icon={<InboxIcon />} label="Active" />
			</>,
		);
		const inactive = view.getByRole("button", { name: "Inactive" });
		const active = view.getByRole("button", { name: "Active" });

		expect(inactive.className).toContain("h-12");
		expect(inactive.className).toContain("text-muted-foreground");
		expect(inactive.className.split(/\s+/)).not.toContain("bg-accent");

		expect(active.className.split(/\s+/)).toContain("bg-accent");
		expect(active.className).toContain("font-medium");
		expect(active.className).toContain("text-foreground");
	});
});

describe("desktop AppNav and phone Drawer Workspace rhythm", () => {
	let testing: Testing | null = null;

	afterEach(() => {
		cleanup();
		testing?.dispose();
		testing = null;
	});

	it("renders Conversations and Workspace headers and 4px-gapped 36px Workspace rows on desktop", async () => {
		testing = new Testing();
		const view = await testing.openConversations([
			conversation({
				title: "Sample conversation",
				messages: [message("user", "hi")],
			}),
		]);

		const headerClasses = ["Conversations", "Workspace"].map(
			(label) => view.getByText(label).className,
		);
		expect(headerClasses).toEqual([
			expect.stringContaining("text-xs"),
			expect.stringContaining("text-xs"),
		]);
		expect(headerClasses).toEqual([
			expect.stringContaining("font-medium"),
			expect.stringContaining("font-medium"),
		]);
		expect(headerClasses).toEqual([
			expect.stringContaining("text-muted-foreground"),
			expect.stringContaining("text-muted-foreground"),
		]);
		expect(headerClasses).not.toEqual([
			expect.stringContaining("text-muted-foreground/75"),
			expect.anything(),
		]);
		expect(headerClasses).not.toEqual([
			expect.anything(),
			expect.stringContaining("text-muted-foreground/75"),
		]);

		const pages = view.container.querySelector("[data-sidebar-pages]");
		expect(pages?.className).toContain("gap-1");

		const signalsTab = view.getByRole("tab", { name: /Signals/ });
		expect(signalsTab.className).toContain("h-9");
		expect(signalsTab.className).toContain("text-sm");
		expect(signalsTab.className).toContain("text-muted-foreground");
		expect(signalsTab.className).toContain(
			"group-data-[variant=line]/tabs-list:hover:bg-muted/60",
		);
	});

	it("renders a Workspace section header between Inbox and Workspace pages and Settings in the phone drawer footer without Archived", () => {
		const view = render(
			<Drawer
				open
				onOpenChange={() => {}}
				header={<div>mono</div>}
				page="conversations"
				conversation={null}
				waiting={2}
				snapshot={null}
				onGo={() => {}}
				onSettings={() => {}}
			/>,
		);

		const dialog = view.getByRole("dialog", { name: "Pages" });
		const nav = dialog.querySelector("nav");
		expect(nav).not.toBeNull();
		const scoped = within(nav as HTMLElement);
		const workspaceHeader = scoped.getByText("Workspace");
		expect(workspaceHeader.className).toContain("text-xs");
		expect(workspaceHeader.className).toContain("font-medium");
		expect(workspaceHeader.className).toContain("text-muted-foreground");

		const inbox = scoped.getByRole("button", { name: /Inbox/ });
		const boards = scoped.getByRole("button", { name: "Boards" });
		expect(
			inbox.compareDocumentPosition(workspaceHeader) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(
			workspaceHeader.compareDocumentPosition(boards) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();

		expect(inbox.className.split(/\s+/)).toContain("bg-accent");
		expect(inbox.className).toContain("text-foreground");
		expect(boards.className).toContain("text-muted-foreground");

		const drawer = within(dialog);
		expect(drawer.queryByRole("button", { name: "Archived" })).toBeNull();
		const settings = drawer.getByRole("button", { name: "Settings" });
		expect(settings.className).toContain("h-12");
	});

	it("keeps the phone drawer navigation list scrollable between a pinned header and Settings footer", () => {
		const view = render(
			<Drawer
				open
				onOpenChange={() => {}}
				header={<div>mono</div>}
				page="conversations"
				conversation={null}
				waiting={0}
				snapshot={null}
				onGo={() => {}}
				onSettings={() => {}}
			/>,
		);

		const dialog = view.getByRole("dialog", { name: "Pages" });
		const nav = dialog.querySelector("nav");
		expect(nav).not.toBeNull();
		expect(nav?.className).toContain("min-h-0");
		expect(nav?.className).toContain("flex-1");
		expect(nav?.className).toContain("overflow-y-auto");
		expect(nav?.className).toContain("overscroll-contain");

		const settings = within(dialog).getByRole("button", { name: "Settings" });
		expect(settings.parentElement?.className).toContain("shrink-0");
	});
});
