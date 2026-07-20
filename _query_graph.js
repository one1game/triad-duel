const D = require("better-sqlite3");
const db = new D(".code-review-graph/graph.db", { readonly: true });

console.log("=== COUNTS ===");
console.log("Nodes:", db.prepare("SELECT COUNT(*) as c FROM nodes").get().c);
console.log("Edges:", db.prepare("SELECT COUNT(*) as c FROM edges").get().c);
console.log("Flows:", db.prepare("SELECT COUNT(*) as c FROM flows").get().c);
console.log("Communities:", db.prepare("SELECT COUNT(*) as c FROM communities").get().c);
console.log("Risk entries:", db.prepare("SELECT COUNT(*) as c FROM risk_index").get().c);

console.log("\n=== NODE KINDS ===");
db.prepare("SELECT kind, COUNT(*) as c FROM nodes GROUP BY kind ORDER BY c DESC").all().forEach(r => console.log(`  ${r.kind}: ${r.c}`));

console.log("\n=== TOP NODES ===");
db.prepare("SELECT qualified_name, kind, file_path FROM nodes LIMIT 20").all().forEach(r => console.log(`  [${r.kind}] ${r.qualified_name} (${r.file_path})`));

console.log("\n=== FLOWS (critical paths) ===");
db.prepare("SELECT name, criticality, node_count FROM flows ORDER BY criticality DESC LIMIT 10").all().forEach(r => console.log(`  ${r.name} (crit=${r.criticality.toFixed(2)}, nodes=${r.node_count})`));

console.log("\n=== RISK INDEX (top) ===");
db.prepare("SELECT qualified_name, risk_score, test_coverage, caller_count FROM risk_index ORDER BY risk_score DESC LIMIT 10").all().forEach(r => console.log(`  ${r.qualified_name} risk=${r.risk_score} tests=${r.test_coverage} callers=${r.caller_count}`));

console.log("\n=== METADATA ===");
db.prepare("SELECT * FROM metadata").all().forEach(r => console.log(`  ${r.key}: ${r.value}`));

db.close();
