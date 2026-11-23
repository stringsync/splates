import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { CopyIcon, PlayIcon, SquarePenIcon } from "lucide-react";
import { act, cleanup, fireEvent, render, resize, waitFor } from "./testing";
import { type BarAction, TopBar, TopBarFrame } from "./top-bar";

/** Three icons, each as wide as a button beside a sidebar. */
const ACTIONS: BarAction[] = [
	{ label: "Start", icon: <PlayIcon />, run: () => {} },
	{ label: "Copy", icon: <CopyIcon />, run: () => {} },
	{ label: "New conversation", icon: <SquarePenIcon />, run: () => {} },
];

/** How wide the bar lays its room out, in pixels, which happy-dom never does. */
let room = 0;

describe("TopBar", () => {
	const widths = {
		clientWidth: Object.getOwnPropertyDescriptor(
			HTMLElement.prototype,
			"clientWidth",
		),
		offsetWidth: Object.getOwnPropertyDescriptor(
			HTMLElement.prototype,
			"offsetWidth",
		),
		scrollWidth: Object.getOwnPropertyDescriptor(
			HTMLElement.prototype,
			"scrollWidth",
		),
	};

	beforeEach(() => {
		resize(1280, 800);
		room = 0;
		// Every button 32 wide, the title 100, and the room what each test says.
		Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
			configurable: true,
			get() {
				return this.tagName === "SPAN" ? 32 : 0;
			},
		});
		Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
			configurable: true,
			get() {
				return this.tagName === "H2" ? 100 : 0;
			},
		});
		Object.defineProperty(HTMLElement.prototype, "clientWidth", {
			configurable: true,
			get() {
				return room;
			},
		});
	});

	afterEach(() => {
		cleanup();
		resize(1280, 800);
		for (const [name, descriptor] of Object.entries(widths)) {
			if (descriptor !== undefined) {
				Object.defineProperty(HTMLElement.prototype, name, descriptor);
			}
		}
	});

	it("shows every action while they fit beside the title, with no kebab", () => {
		room = 400;
		const bar = render(<TopBar title="Stats" actions={ACTIONS} />);

		expect(
			bar
				.getAllByRole("button")
				.map((button) => button.getAttribute("aria-label")),
		).toEqual(["Start", "Copy", "New conversation"]);
	});

	it("folds the last actions into a kebab on the left of the rest once they do not fit", async () => {
		// 100 for the title leaves 100: the kebab and one action, 36 each.
		room = 200;
		const bar = render(<TopBar title="Stats" actions={ACTIONS} />);

		expect(bar.getByRole("button", { name: "Start" })).toBeTruthy();
		expect(bar.queryByRole("button", { name: "Copy" })).toBeNull();
		const kebab = bar.getByRole("button", { name: "More" });
		expect(
			kebab.compareDocumentPosition(
				bar.getByRole("button", { name: "Start" }),
			) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();

		await act(async () => fireEvent.click(kebab));
		const items = await waitFor(() => bar.getAllByRole("menuitem"));
		expect(items.map((item) => item.textContent)).toEqual([
			"Copy",
			"New conversation",
		]);
	});

	it("shows every action before the page is laid out", () => {
		const bar = render(<TopBar title="Stats" actions={ACTIONS} />);

		expect(bar.getAllByRole("button")).toHaveLength(ACTIONS.length);
	});

	it("renders the integrated desktop area header with scope pill, description, and docked tabs", () => {
		const slot = document.createElement("header");
		document.body.appendChild(slot);
		try {
			room = 800;
			const bar = render(
				<TopBarFrame
					value={{
						slot,
						project: "mono",
						area: { page: "signals" },
					}}
				>
					<TopBar
						title="Signals"
						tabs={
							<nav aria-label="signals views">
								<a href="#signals">All signals</a>
							</nav>
						}
					/>
				</TopBarFrame>,
			);

			expect(bar.getAllByRole("heading", { name: "Signals" })).toHaveLength(1);
			expect(slot.textContent).toContain("All projects");
			expect(slot.textContent).toContain(
				"Named events and poll scripts that wake waiting agents",
			);
			expect(
				slot.querySelector("nav[aria-label='signals views']"),
			).toBeTruthy();
		} finally {
			slot.remove();
		}
	});

	it("renders the integrated phone area header inside titleSlot without repeating the title in slot", () => {
		resize(390, 844);
		const slot = document.createElement("div");
		const titleSlot = document.createElement("div");
		document.body.append(slot, titleSlot);
		try {
			render(
				<TopBarFrame
					value={{
						slot,
						titleSlot,
						untitled: true,
						project: "mono",
						area: { page: "todos" },
					}}
				>
					<TopBar title="splates" badge="2 lanes · 9 tasks" />
				</TopBarFrame>,
			);

			expect(slot.textContent).not.toContain("splates");
			expect(titleSlot.textContent).toContain("splates");
			expect(titleSlot.textContent).toContain("2 lanes · 9 tasks");
			expect(titleSlot.textContent).toContain(
				"Organize lanes, block dependencies, and queue tasks for agents.",
			);
		} finally {
			slot.remove();
			titleSlot.remove();
		}
	});
});
