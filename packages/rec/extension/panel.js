const params = new URLSearchParams(location.search);
document.getElementById("control").src =
	`http://localhost:${params.get("port")}/#${[params.has("staged") ? "staged" : "", params.has("nomic") ? "nomic" : ""].filter(Boolean).join(",")}`;
