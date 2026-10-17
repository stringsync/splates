function SearchBox({ results }: { results: Results }) {
	const [query, setQuery] = useState("");
	const [found, setFound] = useState<Result[]>([]);
	const [searching, setSearching] = useState(false);

	useEffect(() => {
		setSearching(true);
		results.matching(query).then((matches) => {
			setFound(matches);
			setSearching(false);
		});
	}, [query, results]);

	return (
		<>
			<input value={query} onChange={(e) => setQuery(e.target.value)} />
			{searching ? <Spinner /> : <Results results={found} />}
		</>
	);
}
