const D = require("better-sqlite3");
const db = new D(".code-review-graph/graph.db", { readonly: true });

const cmd = process.argv[2];
const arg = process.argv[3];

function printNodes(rows) {
	for (const r of rows) {
		console.log(
			`  [${r.kind}] ${r.qualified_name} @ ${r.file_path}:${r.line_start || "?"}`,
		);
	}
}

switch (cmd) {
	case "callers": {
		const callers = db
			.prepare(`
      SELECT n.kind, n.qualified_name, n.file_path, n.line_start, e.kind as edge_kind
      FROM edges e JOIN nodes n ON n.qualified_name = e.source_qualified
      WHERE e.target_qualified LIKE ? OR e.target_qualified = ?
      ORDER BY n.qualified_name
    `)
			.all(`%${arg}%`, arg);
		console.log(`Callers of "${arg}" (${callers.length}):`);
		printNodes(callers);
		break;
	}

	case "callees": {
		const callees = db
			.prepare(`
      SELECT n.kind, n.qualified_name, n.file_path, n.line_start, e.kind as edge_kind
      FROM edges e JOIN nodes n ON n.qualified_name = e.target_qualified
      WHERE e.source_qualified LIKE ? OR e.source_qualified = ?
      ORDER BY n.qualified_name
    `)
			.all(`%${arg}%`, arg);
		console.log(`Callees of "${arg}" (${callees.length}):`);
		printNodes(callees);
		break;
	}

	case "flow": {
		const flow = db
			.prepare(`
      SELECT f.name, f.criticality, f.node_count
      FROM flows f WHERE f.name LIKE ? OR f.name = ?
    `)
			.get(`%${arg}%`, arg);
		if (flow) {
			console.log(
				`Flow "${flow.name}": criticality=${flow.criticality.toFixed(2)}, nodes=${flow.node_count}`,
			);
			const members = db
				.prepare(`
        SELECT n.qualified_name, n.kind, fm.position
        FROM flow_memberships fm JOIN nodes n ON n.id = fm.node_id
        WHERE fm.flow_id = (SELECT id FROM flows WHERE name = ?)
        ORDER BY fm.position
      `)
				.all(flow.name);
			for (const m of members) {
				console.log(`  ${m.position}. [${m.kind}] ${m.qualified_name}`);
			}
		} else {
			console.log(`No flow found for "${arg}"`);
		}
		break;
	}

	case "risks": {
		const risks = db
			.prepare(`
      SELECT qualified_name, risk_score, test_coverage, caller_count
      FROM risk_index ORDER BY risk_score DESC LIMIT ${parseInt(arg, 10) || 10}
    `)
			.all();
		console.log("Top risks:");
		for (const r of risks) {
			console.log(
				`  ${r.qualified_name} score=${r.risk_score} tests=${r.test_coverage} callers=${r.caller_count}`,
			);
		}
		break;
	}

	case "impact": {
		console.log(`Impact analysis for changing "${arg}":`);
		console.log("\nDirect callers:");
		const dir = db
			.prepare(`
      SELECT DISTINCT n.qualified_name, n.kind, n.file_path
      FROM edges e JOIN nodes n ON n.qualified_name = e.source_qualified
      WHERE e.target_qualified = ? AND e.kind = 'CALLS'
    `)
			.all(arg);
		printNodes(dir);

		// Recursive callers (depth 2)
		const targets = new Set([arg]);
		for (const d of dir) {
			targets.add(d.qualified_name);
		}

		console.log("\nIndirect callers (depth 2):");
		const indirect = db
			.prepare(`
      SELECT DISTINCT n.qualified_name, n.kind, n.file_path
      FROM edges e JOIN nodes n ON n.qualified_name = e.source_qualified
      WHERE e.target_qualified IN (${[...targets].map(() => "?").join(",")})
        AND e.kind = 'CALLS'
        AND n.qualified_name NOT IN (${[...targets].map(() => "?").join(",")})
    `)
			.all(...[...targets], ...[...targets]);
		printNodes(indirect);

		console.log(`\nTotal affected nodes: ${dir.length + indirect.length}`);
		break;
	}

	case "search": {
		const results = db
			.prepare(`
      SELECT n.qualified_name, n.kind, n.file_path, n.line_start, n.signature
      FROM nodes_fts JOIN nodes n ON n.rowid = nodes_fts.rowid
      WHERE nodes_fts MATCH ?
      LIMIT 15
    `)
			.all(arg);
		console.log(`Search "${arg}" (${results.length}):`);
		for (const r of results) {
			console.log(
				`  [${r.kind}] ${r.qualified_name} (${r.file_path}:${r.line_start}) ${r.signature || ""}`,
			);
		}
		break;
	}

	default: {
		console.log(`code-review-graph v1.0
Usage: node _crg.js <command> <arg>

Commands:
  callers <name>   — who calls this function
  callees <name>   — what this function calls
  flow <name>      — show critical flow path
  risks [N]        — top N risky nodes (default 10)
  impact <name>    — impact analysis of changing a function
  search <term>    — full-text search across codebase
`);
		const stats = db.prepare("SELECT key, value FROM metadata").all();
		for (const s of stats) {
			console.log(`  ${s.key}: ${s.value}`);
		}
	}
}

db.close();
