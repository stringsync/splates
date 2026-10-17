type SearchEvents = { changed: undefined };

class Search implements Eventful<SearchEvents> {
	private readonly dispatcher = new Dispatcher<SearchEvents>();
	readonly events = this.dispatcher.events;

	query = "";
	results: Result[] = [];
	searching = false;

	constructor(private readonly results_: Results) {}

	async search(query: string): Promise<void> {
		this.query = query;
		this.searching = true;
		this.dispatcher.dispatch("changed");
		this.results = await this.results_.matching(query);
		this.searching = false;
		this.dispatcher.dispatch("changed");
	}
}

function SearchBox({ search }: { search: Search }) {
	const { query, results, searching } = useReactive(
		search,
		(search) => ({
			query: search.query,
			results: search.results,
			searching: search.searching,
		}),
		["changed"],
	);

	return (
		<>
			<input value={query} onChange={(e) => search.search(e.target.value)} />
			{searching ? <Spinner /> : <Results results={results} />}
		</>
	);
}
