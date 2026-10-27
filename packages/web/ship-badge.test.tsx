import { afterEach, describe, expect, it } from "bun:test";
import type { Ship } from "@stringsync/splates-server/ship";
import { snapshot } from "./fixtures";
import { ShipBadge } from "./ship-badge";
import { act, cleanup, fireEvent, render } from "./testing-library";

afterEach(cleanup);

/** Puts the page at `url`, which `history` cannot do from `about:blank`. */
function visit(url: string): void {
	(
		window as unknown as { happyDOM: { setURL(url: string): void } }
	).happyDOM.setURL(url);
}

describe("ShipBadge", () => {
	it("shows nothing for a project that never shipped, or shipped over an hour ago", () => {
		expect(badge(null).container.textContent).toBe("");
		cleanup();
		const old = badge(ship({ status: "done", to: "1.4.3", ended: ago(61) }));
		expect(old.container.textContent).toBe("");
	});

	it("says a ship runs, and that it shipped once it is done", () => {
		const running = badge(ship({}));
		expect(running.getByTitle("Shipping mdom from 1.4.2").textContent).toBe(
			"Shipping",
		);
		cleanup();
		const done = badge(ship({ status: "done", to: "1.4.3", ended: ago(1) }));
		expect(done.getByTitle("Shipped mdom 1.4.3").textContent).toBe(
			"Shipped 1.4.3",
		);
	});

	it("asks the person to sign in to npm while npm waits on them, opening npm's page", async () => {
		const view = badge(
			ship({
				step: "login",
				waiting: {
					kind: "login",
					url: "https://www.npmjs.com/login?next=/login/cli/abc",
					since: ago(0),
				},
			}),
		);
		expect(view.getByRole("button").textContent).toBe("Sign in to npm");

		await act(async () => {
			fireEvent.click(view.getByText("Sign in to npm"));
		});

		expect(view.getByText("npm waits for you to sign in.")).toBeTruthy();
		expect(view.getByRole("link", { name: "Open" }).getAttribute("href")).toBe(
			"https://www.npmjs.com/login?next=/login/cli/abc",
		);
	});

	it("opens on the npm page a ship's push asks for, then leaves the address without it", () => {
		visit("http://localhost/?project=mdom&ship=open#board");
		try {
			const view = badge(
				ship({
					step: "ship",
					waiting: {
						kind: "2fa",
						url: "https://www.npmjs.com/auth/cli/abc",
						since: ago(0),
					},
				}),
			);

			expect(
				view.getByText("npm waits for your second factor to publish."),
			).toBeTruthy();
			expect(location.search).toBe("?project=mdom");
			expect(location.hash).toBe("#board");
		} finally {
			visit("about:blank");
		}
	});

	it("says a ship failed", () => {
		const view = badge(
			ship({ status: "failed", ended: ago(1), error: "npm error 403" }),
		);
		expect(view.getByRole("button").textContent).toBe("Ship failed");
	});
});

const ago = (mins: number) =>
	new Date(Date.now() - mins * 60_000).toISOString();

/** A ship of mdom from 1.4.2, two minutes in, as `change` alters it. */
function ship(change: Partial<Ship>): Ship {
	return {
		project: "mdom",
		command: "wiz dev ship",
		status: "running",
		step: "ship",
		from: "1.4.2",
		to: null,
		started: ago(2),
		ended: null,
		waiting: null,
		error: null,
		resumed: 0,
		...change,
	};
}

/** The badge over a snapshot of mdom with `shipped` as its ship. */
function badge(shipped: Ship | null) {
	return render(
		<ShipBadge
			snapshot={{ ...snapshot({ project: "mdom" }), ship: shipped }}
		/>,
	);
}
