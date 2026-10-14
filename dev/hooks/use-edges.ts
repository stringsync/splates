import { type RefObject, useCallback, useEffect, useState } from "react";

/**
 * `board`'s edges, read again as it resizes or its columns change, and by
 * `read`, which its scrolling calls.
 */
export function useEdges(board: RefObject<HTMLElement | null>): {
	edges: Edges;
	read: () => void;
} {
	const [edges, setEdges] = useState<Edges>({ left: false, right: false });
	const read = useCallback(() => {
		const next = edgesOf(board.current);
		setEdges((was) =>
			was.left === next.left && was.right === next.right ? was : next,
		);
	}, [board]);
	useEffect(() => {
		const element = board.current;
		if (element === null) {
			return;
		}
		const observer = new ResizeObserver(read);
		observer.observe(element);
		for (const column of element.children) {
			observer.observe(column);
		}
		read();
		return () => observer.disconnect();
	});
	return { edges, read };
}

/** Whether there is more of `board` to scroll to on its left and its right. */
interface Edges {
	left: boolean;
	right: boolean;
}

function edgesOf(board: HTMLElement | null): Edges {
	if (board === null) {
		return { left: false, right: false };
	}
	return {
		left: board.scrollLeft > 1,
		right: board.scrollLeft + board.clientWidth < board.scrollWidth - 1,
	};
}

/** A mask fading out each edge with more beyond it. */
export function fadeOf({ left, right }: Edges): string | undefined {
	if (!left && !right) {
		return undefined;
	}
	return `linear-gradient(to right, ${left ? "transparent, black 2.5rem" : "black"}, ${right ? "black calc(100% - 2.5rem), transparent" : "black"})`;
}
