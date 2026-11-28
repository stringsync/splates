import { afterEach, describe, expect, it } from "bun:test";
import { ShipIcon } from "lucide-react";
import { NavMenuItem } from "./nav-menu-item";
import { NavCountBadge, NavIcon } from "./nav-status";
import { Drawer } from "./phone-drawer";
import { markRecapSeen } from "./ship-recap-seen";
import { act, cleanup, render, waitFor, within } from "./testing-library";

describe("NavIcon and NavCountBadge", () => {
	afterEach(() => {
		cleanup();
	});

	it("decorates the leading icon corner for running, failed, done, and attention states", () => {
		const running = render(
			<NavIcon
				icon={ShipIcon}
				status={{ kind: "running", label: "a ship runs" }}
			/>,
		);
		const runningStatus = running.getByRole("status", { name: "a ship runs" });
		expect(runningStatus.className).toContain("ring-sidebar");
		expect(runningStatus.className).toContain("size-2.25");
		expect(runningStatus.querySelector("svg")).toBeNull();
		expect(runningStatus.firstElementChild?.className).toContain(
			"border-t-info",
		);
		cleanup();

		const runningLg = render(
			<NavMenuItem
				size="lg"
				current
				icon={
					<NavIcon
						icon={ShipIcon}
						size="lg"
						status={{ kind: "running", label: "a ship runs" }}
					/>
				}
				label="Ships"
			/>,
		);
		const lgStatus = runningLg.getByRole("status", { name: "a ship runs" });
		expect(lgStatus.className).toContain("size-2.75");
		expect(lgStatus.querySelector("svg")).toBeNull();
		expect(runningLg.container.querySelector("[data-nav-icon]")).not.toBeNull();
		expect(
			runningLg.getByRole("button", { name: /Ships/ }).className,
		).toContain("[&_[data-nav-icon]]:text-primary");
		cleanup();

		const failed = render(
			<NavIcon
				icon={ShipIcon}
				status={{ kind: "failed", label: "Ship stopped on a failure" }}
			/>,
		);
		expect(
			failed.getByRole("status", { name: "Ship stopped on a failure" })
				.className,
		).toContain("bg-destructive");
		expect(
			failed.container.querySelector("svg")?.getAttribute("class"),
		).toContain("text-destructive");
		cleanup();

		const done = render(
			<NavIcon
				icon={ShipIcon}
				status={{ kind: "done", label: "Ship succeeded, recap unread" }}
			/>,
		);
		expect(
			done.getByRole("status", { name: "Ship succeeded, recap unread" })
				.className,
		).toContain("bg-success");
		cleanup();

		const attention = render(
			<NavIcon
				icon={ShipIcon}
				status={{ kind: "attention", label: "creds requested" }}
			/>,
		);
		expect(
			attention.getByRole("img", { name: "creds requested" }).className,
		).toContain("bg-warning");
	});

	it("renders shadcn badges for muted and warning counts", () => {
		const view = render(
			<>
				<NavCountBadge count={2} tone="muted" label="2 possible improvements" />
				<NavCountBadge count={1} tone="warning" label="1 waiting on you" />
			</>,
		);
		const muted = view.getByRole("status", { name: "2 possible improvements" });
		expect(muted.dataset.slot).toBe("badge");
		expect(muted.textContent).toBe("2");

		const warning = view.getByRole("status", { name: "1 waiting on you" });
		expect(warning.dataset.slot).toBe("badge");
		expect(warning.textContent).toBe("1");
	});
});

describe("mobile Drawer status parity", () => {
	const realFetch = globalThis.fetch;

	afterEach(() => {
		cleanup();
		globalThis.fetch = realFetch;
		localStorage.removeItem("splates.ships.recap-seen");
	});

	const openDrawer = (waiting = 0) =>
		render(
			<Drawer
				open
				onOpenChange={() => {}}
				header={<div>mono</div>}
				page="boards"
				conversation={null}
				waiting={waiting}
				snapshot={null}
				onGo={() => {}}
				onSettings={() => {}}
			/>,
		);

	it("shows failed ship status on the Ships icon in the mobile drawer", async () => {
		serveShips({ status: "failed" });
		const view = openDrawer();
		const ships = view.getByRole("button", { name: /Ships/ });
		await waitFor(() =>
			expect(
				within(ships).getByRole("status", {
					name: "Ship stopped on a failure",
				}),
			).toBeTruthy(),
		);
		expect(ships.querySelector("svg")?.getAttribute("class")).toContain(
			"text-destructive",
		);
	});

	it("shows running spinner on the icon and waiting count badge on the right together", async () => {
		serveShips({ status: "running", waiting: 1 });
		const view = openDrawer(3);
		const ships = view.getByRole("button", { name: /Ships/ });
		await waitFor(() =>
			expect(
				within(ships).getByRole("status", { name: "a ship runs" }),
			).toBeTruthy(),
		);
		await waitFor(() =>
			expect(
				within(ships).getByRole("status", { name: "1 waiting on you" }).dataset
					.slot,
			).toBe("badge"),
		);

		const inbox = view.getByRole("button", { name: /Inbox/ });
		expect(inbox.querySelector('[data-slot="badge"]')?.textContent).toBe("3");
	});

	it("shows recap unread dot until marked seen", async () => {
		serveShips({ status: "done" });
		const view = openDrawer();
		const ships = view.getByRole("button", { name: /Ships/ });
		await waitFor(() =>
			expect(
				within(ships).getByRole("status", {
					name: "Ship succeeded, recap unread",
				}),
			).toBeTruthy(),
		);
		act(() => markRecapSeen("latest"));
		await waitFor(() =>
			expect(
				within(ships).queryByRole("status", {
					name: "Ship succeeded, recap unread",
				}),
			).toBeNull(),
		);
	});
});

function serveShips({
	status,
	waiting = 0,
}: {
	status: "running" | "failed" | "done" | "stopped";
	waiting?: number;
}) {
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		const url = input instanceof Request ? input.url : String(input);
		if (url.includes("waiting")) {
			return Response.json(
				Array.from({ length: waiting }, (_, index) => ({
					runId: "r1",
					id: `w${index}`,
					prompt: "Confirm?",
				})),
			);
		}
		if (url.includes("ship")) {
			return Response.json({ runs: [{ id: "latest", status }] });
		}
		return Response.json({ count: 0, key: null });
	}) as typeof fetch;
}
