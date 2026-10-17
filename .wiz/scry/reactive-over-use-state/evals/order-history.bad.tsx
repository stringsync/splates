import { useEffect, useState } from "react";

export function OrderHistory({ orders }: { orders: Orders }) {
	const [page, setPage] = useState(1);
	const [rows, setRows] = useState<Order[]>([]);
	const [loading, setLoading] = useState(false);
	const [hasMore, setHasMore] = useState(true);

	useEffect(() => {
		setLoading(true);
		orders.page(page).then((result) => {
			setRows((previous) => [...previous, ...result.items]);
			setHasMore(result.hasMore);
			setLoading(false);
		});
	}, [page, orders]);

	return (
		<section>
			<OrderTable orders={rows} />
			{hasMore && (
				<button disabled={loading} onClick={() => setPage(page + 1)}>
					{loading ? "Loading" : "Load more"}
				</button>
			)}
		</section>
	);
}
