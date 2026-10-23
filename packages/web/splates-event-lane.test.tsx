import "./register-dom";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { Board, NO_BOARD } from "./board";
import { SplatesEvent, type SplatesEventView } from "./splates-event";

afterEach(cleanup);

describe("lane chips in splates events", () => {
	let opened: number[];
	beforeEach(() => {
		opened = [];
	});

	function show() {
		const board = {
			...NO_BOARD,
			linked: true,
			lanes: [{ id: 3, name: "Chips" }],
			openLane: (id: number) => opened.push(id),
		} as unknown as typeof NO_BOARD;
		const view = (id: number, name: string): SplatesEventView => ({
			words: ["Queued", { kind: "lane", id, name }],
			at: new Date().toISOString(),
		});
		return render(
			<Board value={board}>
				<SplatesEvent event={view(3, "Chips")} />
				<SplatesEvent event={view(9, "Old")} />
			</Board>,
		);
	}

	it("opens a lane it names", () => {
		fireEvent.click(show().getByTitle("Lane 3: Chips"));
		expect(opened).toEqual([3]);
	});

	it("marks a lane that is gone and opens nothing", () => {
		fireEvent.click(show().getByTitle("Lane 9: Old (no longer exists)"));
		expect(opened).toEqual([]);
	});
});
