function Disclosure({ children }: { children: ReactNode }) {
	const [open, setOpen] = useState(false);

	return (
		<>
			<button onClick={() => setOpen(!open)}>details</button>
			{open && children}
		</>
	);
}
