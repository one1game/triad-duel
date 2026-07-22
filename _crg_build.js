// _crg_build.js — Строит code-review-graph из server.js и public/index.html
const D = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const SOURCES = ["server.js", "public/index.html"];

// ═══ SCHEMA ═══
function createSchema(db) {
  db.exec(`
    CREATE TABLE nodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      qualified_name TEXT NOT NULL UNIQUE,
      file_path TEXT NOT NULL,
      line_start INTEGER,
      line_end INTEGER,
      language TEXT,
      parent_name TEXT,
      params TEXT,
      return_type TEXT,
      modifiers TEXT,
      is_test INTEGER DEFAULT 0,
      signature TEXT,
      community_id INTEGER,
      updated_at REAL NOT NULL
    );
    CREATE TABLE edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      source_qualified TEXT NOT NULL,
      target_qualified TEXT NOT NULL,
      file_path TEXT NOT NULL,
      line INTEGER DEFAULT 0,
      confidence REAL DEFAULT 1.0,
      confidence_tier TEXT DEFAULT 'EXTRACTED',
      updated_at REAL NOT NULL
    );
    CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE flows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      entry_point_id INTEGER NOT NULL,
      depth INTEGER NOT NULL,
      node_count INTEGER NOT NULL,
      file_count INTEGER NOT NULL,
      criticality REAL NOT NULL DEFAULT 0.0,
      path_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE flow_memberships (
      flow_id INTEGER NOT NULL,
      node_id INTEGER NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (flow_id, node_id)
    );
    CREATE TABLE communities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 0,
      parent_id INTEGER,
      cohesion REAL NOT NULL DEFAULT 0.0,
      size INTEGER NOT NULL DEFAULT 0,
      dominant_language TEXT,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE community_summaries (
      community_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      purpose TEXT DEFAULT '',
      key_symbols TEXT DEFAULT '[]',
      risk TEXT DEFAULT 'unknown',
      size INTEGER DEFAULT 0,
      dominant_language TEXT DEFAULT '',
      FOREIGN KEY (community_id) REFERENCES communities(id)
    );
    CREATE TABLE flow_snapshots (
      flow_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      entry_point TEXT NOT NULL,
      critical_path TEXT DEFAULT '[]',
      criticality REAL DEFAULT 0.0,
      node_count INTEGER DEFAULT 0,
      file_count INTEGER DEFAULT 0,
      FOREIGN KEY (flow_id) REFERENCES flows(id)
    );
    CREATE TABLE risk_index (
      node_id INTEGER PRIMARY KEY,
      qualified_name TEXT NOT NULL,
      risk_score REAL DEFAULT 0.0,
      test_coverage TEXT DEFAULT 'unknown',
      security_relevant INTEGER DEFAULT 0,
      caller_count INTEGER DEFAULT 0,
      last_computed TEXT DEFAULT '',
      FOREIGN KEY (node_id) REFERENCES nodes(id)
    );
    CREATE VIRTUAL TABLE nodes_fts USING fts5(
      name, qualified_name, file_path, signature,
      content='nodes', content_rowid='rowid',
      tokenize='porter unicode61'
    );
  `);
}

// ═══ PARSER ═══
function parseFile(filePath) {
  const absPath = path.resolve(ROOT, filePath);
  if (!fs.existsSync(absPath)) {
    console.log(`  SKIP: ${filePath} (not found)`);
    return { nodes: [], edges: [], calls: new Map() };
  }

  const code = fs.readFileSync(absPath, "utf-8");
  const lines = code.split("\n");
  const nodes = [];
  const edges = [];
  const calls = new Map(); // functionName -> [{from, line}]
  const varReads = new Map(); // varName -> [{from, line}]
  const varWrites = new Map();

  // Файл как узел
  nodes.push({
    kind: "File",
    name: path.basename(filePath),
    qualified_name: absPath,
    file_path: absPath,
    line_start: 1,
    line_end: lines.length,
    language: filePath.endsWith(".html") ? "HTML/JS" : "JavaScript",
    is_test: 0,
    signature: absPath,
    params: null,
  });

  // Поиск function declarations: function name() / async function name()
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lnum = i + 1;

    // function name(args)
    let m = line.match(/(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/);
    if (m) {
      const name = m[1];
      const params = m[2].trim();
      const qname = `${absPath}::${name}`;
      nodes.push({
        kind: "Function", name, qualified_name: qname,
        file_path: absPath, line_start: lnum, line_end: lnum,
        language: "JavaScript", is_test: name.startsWith("test") || name.includes("_test") ? 1 : 0,
        signature: `function ${name}(${params})`,
        params, modifiers: m[0].startsWith("async") ? "async" : null,
      });
      continue;
    }

    // const name = (...) => {...}
    m = line.match(/(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/);
    if (m) {
      const name = m[1];
      const params = m[2].trim();
      const qname = `${absPath}::${name}`;
      nodes.push({
        kind: "Function", name, qualified_name: qname,
        file_path: absPath, line_start: lnum, line_end: lnum,
        language: "JavaScript", is_test: name.startsWith("test") || name.includes("_test") ? 1 : 0,
        signature: `const ${name} = (${params}) =>`,
        params, modifiers: line.includes("async") ? "async" : null,
      });
      continue;
    }

    // const name = function(...)
    m = line.match(/(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?function\s*\(([^)]*)\)/);
    if (m) {
      const name = m[1];
      const params = m[2].trim();
      const qname = `${absPath}::${name}`;
      nodes.push({
        kind: "Function", name, qualified_name: qname,
        file_path: absPath, line_start: lnum, line_end: lnum,
        language: "JavaScript", is_test: name.startsWith("test") ? 1 : 0,
        signature: `const ${name} = function(${params})`,
        params, modifiers: line.includes("async") ? "async" : null,
      });
      continue;
    }
  }

  // Строим маппинг: qualified_name -> node
  const nodeMap = new Map(nodes.filter(n => n.kind === "Function").map(n => [n.qualified_name, n]));
  // И маппинг: короткое имя -> [qnames] (для разрешения вызовов)
  const shortNameMap = new Map();
  for (const n of nodes) {
    if (n.kind !== "Function") continue;
    if (!shortNameMap.has(n.name)) shortNameMap.set(n.name, []);
    shortNameMap.get(n.name).push(n.qualified_name);
  }

  // Поиск вызовов внутри функций
  // Для каждой функции ищем диапазон строк (от объявления до следующего объявления на том же уровне)
  const funcRanges = [];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.kind !== "Function") continue;
    const start = n.line_start;
    // Находим конец: следующая функция или конец файла
    let end = lines.length;
    for (let j = i + 1; j < nodes.length; j++) {
      if (nodes[j].kind === "Function" && nodes[j].line_start > start) {
        end = nodes[j].line_start - 1;
        break;
      }
    }
    funcRanges.push({ qname: n.qualified_name, start, end });
  }

  // Собираем вызовы
  const callRe = /(\w+)\s*\(/g;
  for (const fr of funcRanges) {
    const body = lines.slice(fr.start - 1, fr.end).join("\n");
    let cm;
    while ((cm = callRe.exec(body)) !== null) {
      const calledName = cm[1];
      if (calledName === "if" || calledName === "for" || calledName === "while" ||
          calledName === "switch" || calledName === "catch" || calledName === "return" ||
          calledName === "throw" || calledName === "typeof" || calledName === "new" ||
          calledName === "else" || calledName === "case" || calledName === "break" ||
          calledName === "continue" || calledName === "void" || calledName === "delete") continue;
      if (!shortNameMap.has(calledName)) continue;

      const lineInBody = body.substring(0, cm.index).split("\n").length;
      const absLine = fr.start + lineInBody - 1;

      for (const targetQname of shortNameMap.get(calledName)) {
        // Пропускаем self-calls
        if (targetQname === fr.qname) continue;
        edges.push({
          kind: "CALLS",
          source_qualified: fr.qname,
          target_qualified: targetQname,
          file_path: absPath,
          line: absLine,
          confidence: 1.0,
          confidence_tier: "EXTRACTED",
        });
      }

      if (!calls.has(calledName)) calls.set(calledName, []);
      calls.get(calledName).push({ from: fr.qname, line: absLine });
    }
  }

  // Также ищем вызовы на уровне модуля (вне функций)
  const funcLines = new Set();
  for (const fr of funcRanges) {
    for (let l = fr.start; l <= fr.end; l++) funcLines.add(l);
  }
  for (let i = 1; i <= lines.length; i++) {
    if (funcLines.has(i)) continue;
    const line = lines[i - 1];
    let cm;
    callRe.lastIndex = 0;
    while ((cm = callRe.exec(line)) !== null) {
      const calledName = cm[1];
      if (!shortNameMap.has(calledName)) continue;
      for (const targetQname of shortNameMap.get(calledName)) {
        edges.push({
          kind: "CALLS",
          source_qualified: absPath, // file-level call
          target_qualified: targetQname,
          file_path: absPath,
          line: i,
          confidence: 0.8,
          confidence_tier: "EXTRACTED",
        });
      }
    }
  }

  // Переменные: поиск чтения/записи глобальных переменных
  const globalVars = new Set([
    "sessions", "IO", "supabase", "MATCHMAKING_TIMEOUT", "MATCHMAKING_MIN",
    "BOT_POOL", "ALL_CARDS", "CARDS_PER_SIDE", "SHOP_SIZE", "MAX_MANA",
    "BASE_REWARD", "FIRST_TURN_MANA", "PVP_TURN_TIMEOUT", "PVP_RECONNECT_GRACE",
    "TELEGRAM_BOT_TOKEN", "WEBHOOK_SECRET", "JWT_SECRET", "PREMIUM_PRICE_STARS",
    "PREMIUM_DURATION_DAYS", "PREMIUM_TEST_MODE", "authCodes", "REFERRAL_REWARD_GOLD",
    "REFERRAL_DAILY_CAP", "RATE_LIMITED_EVENTS", "ALLOWED_CLIENT_EVENTS",
    "APP", "server", "premiumPollTimer", "matchmakingInterval", "turnTimerId",
    "reconnectTimerId", "battleLog", "currentBattle", "turnIndicator",
    "playerCardsData", "enemyCardsData", "playerMana", "enemyMana",
    "selectedDeck", "gold", "user", "premiumUntil", "collection",
    "cardUpgrades", "soundEnabled", "musicEnabled",
  ]);

  return { nodes, edges, calls, varReads, varWrites, shortNameMap, nodeMap };
}

// ═══ BUILD ═══
function build() {
  const dbPath = path.join(ROOT, ".code-review-graph", "graph.db");

  // Delete old DB
  try { fs.unlinkSync(dbPath); } catch {}
  try { fs.unlinkSync(dbPath + "-shm"); } catch {}
  try { fs.unlinkSync(dbPath + "-wal"); } catch {}

  const db = new D(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  createSchema(db);

  const now = Date.now() / 1000;
  const insertNode = db.prepare(`INSERT INTO nodes (kind, name, qualified_name, file_path, line_start, line_end, language, is_test, signature, params, modifiers, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insertEdge = db.prepare(`INSERT INTO edges (kind, source_qualified, target_qualified, file_path, line, confidence, confidence_tier, updated_at) VALUES (?,?,?,?,?,?,?,?)`);

  let allNodes = [];
  let allEdges = [];

  const insertNodes = db.transaction(() => {
    for (const src of SOURCES) {
      console.log(`  Parsing: ${src}`);
      const result = parseFile(src);
      allNodes.push(...result.nodes);
      allEdges.push(...result.edges);
    }

    // Deduplicate edges
    const edgeSet = new Set();
    const dedupedEdges = [];
    for (const e of allEdges) {
      const key = `${e.source_qualified}|${e.target_qualified}|${e.kind}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        dedupedEdges.push(e);
      }
    }
    allEdges = dedupedEdges;

    // Insert nodes
    for (const n of allNodes) {
      insertNode.run(
        n.kind, n.name, n.qualified_name, n.file_path,
        n.line_start, n.line_end, n.language || "JavaScript",
        n.is_test || 0, n.signature || null, n.params || null,
        n.modifiers || null, now,
      );
    }

    // Get node IDs back
    const nodeIdMap = new Map();
    for (const n of allNodes) {
      const row = db.prepare("SELECT id FROM nodes WHERE qualified_name = ?").get(n.qualified_name);
      if (row) nodeIdMap.set(n.qualified_name, row.id);
    }

    // Insert edges
    for (const e of allEdges) {
      insertEdge.run(
        e.kind, e.source_qualified, e.target_qualified,
        e.file_path, e.line || 0, e.confidence || 1.0,
        e.confidence_tier || "EXTRACTED", now,
      );
    }

    return nodeIdMap;
  });

  const nodeIdMap = insertNodes();

  // Build risk_index
  console.log(`  Nodes: ${allNodes.length}, Edges: ${allEdges.length}`);

  const insertRisk = db.prepare(`INSERT OR REPLACE INTO risk_index (node_id, qualified_name, risk_score, test_coverage, security_relevant, caller_count, last_computed) VALUES (?,?,?,?,?,?,?)`);
  for (const n of allNodes) {
    if (n.kind !== "Function") continue;
    const nid = nodeIdMap.get(n.qualified_name);
    if (!nid) continue;

    const callerCount = allEdges.filter(e => e.target_qualified === n.qualified_name && e.kind === "CALLS").length;
    const calleeCount = allEdges.filter(e => e.source_qualified === n.qualified_name && e.kind === "CALLS").length;

    // Risk = callers * 2 + callees, higher = more impact when changed
    const riskScore = callerCount * 2 + calleeCount;
    const testCoverage = n.is_test ? "test" : (calleeCount > 0 ? "covered_by_callees" : "unknown");
    const securityRelevant = n.name.toLowerCase().includes("auth") || n.name.toLowerCase().includes("token") ||
      n.name.toLowerCase().includes("jwt") || n.name.toLowerCase().includes("verify") ||
      n.name.toLowerCase().includes("secret") || n.name.toLowerCase().includes("hash") ? 1 : 0;

    insertRisk.run(nid, n.qualified_name, riskScore, testCoverage, securityRelevant, callerCount, new Date().toISOString());
  }

  // Build flows (critical execution paths)
  const criticalFlows = [
    {
      name: "battle_end",
      entry: "server.js::endGame",
      path: ["server.js::executePlayerEndTurn", "server.js::endGame", "server.js::logEvent", "server.js::savePlayerData", "server.js::recordReferralIfNew", "server.js::creditGold", "server.js::grantReferralRewardIfEligible"],
    },
    {
      name: "session_start",
      entry: "server.js::getOrCreatePlayer",
      path: ["server.js::getOrCreatePlayer", "server.js::signJWT", "server.js::logEvent"],
    },
    {
      name: "battle_turn",
      entry: "server.js::handlePvpAction",
      path: ["server.js::handlePvpAction", "server.js::executeAttack", "server.js::executeCrit", "server.js::executeFireball", "server.js::executeAiTurn", "server.js::executePlayerEndTurn"],
    },
    {
      name: "battle_init",
      entry: "server.js::beginPveBattle",
      path: ["server.js::beginPveBattle", "server.js::seedBattle", "server.js::logEvent"],
    },
    {
      name: "pvp_match",
      entry: "server.js::tryMatch",
      path: ["server.js::tryMatch", "server.js::createPvpRoom", "server.js::handlePvpAction", "server.js::endPvpTurn", "server.js::endPvpGame"],
    },
    {
      name: "premium_purchase",
      entry: "server.js::grantPremium",
      path: ["server.js::grantPremium", "server.js::isPremiumActive", "server.js::logEvent"],
    },
  ];

  const insertFlow = db.prepare(`INSERT INTO flows (name, entry_point_id, depth, node_count, file_count, criticality, path_json) VALUES (?,?,?,?,?,?,?)`);
  const insertFlowMember = db.prepare(`INSERT INTO flow_memberships (flow_id, node_id, position) VALUES (?,?,?)`);

  for (const flow of criticalFlows) {
    // Resolve node IDs from qualified names
    const resolvedIds = [];
    for (const qname of flow.path) {
      // Try exact match first, then fuzzy match
      let nid = nodeIdMap.get(qname);
      if (!nid) {
        // Try finding by name suffix
        const suffix = qname.split("::").pop();
        for (const [qn, id] of nodeIdMap) {
          if (qn.endsWith(`::${suffix}`)) { nid = id; break; }
        }
      }
      if (nid) resolvedIds.push(nid);
    }

    if (resolvedIds.length < 2) {
      console.log(`  Flow "${flow.name}": not enough resolved nodes (${resolvedIds.length}/${flow.path.length}), skipping`);
      continue;
    }

    const entryId = resolvedIds[0];
    const depth = resolvedIds.length;
    const filePaths = new Set();
    for (const qname of flow.path) {
      const n = allNodes.find(n => n.qualified_name === qname);
      if (n) filePaths.add(n.file_path);
    }
    const criticality = resolvedIds.length / 10;

    const result = insertFlow.run(
      flow.name, entryId, depth, resolvedIds.length,
      filePaths.size, criticality, JSON.stringify(resolvedIds),
    );

    const flowId = result.lastInsertRowid;
    for (let i = 0; i < resolvedIds.length; i++) {
      insertFlowMember.run(flowId, resolvedIds[i], i + 1);
    }

    console.log(`  Flow "${flow.name}": ${resolvedIds.length} nodes, crit=${criticality.toFixed(2)}`);
  }

  // Build communities
  const communities = [
    { name: "Battle System", symbols: ["executeAttack", "executeCrit", "executeFireball", "applyBattleState", "startBattle", "finishBattle"] },
    { name: "Auth & Security", symbols: ["signJWT", "verifyJWT", "verifyMiniAppInitData", "generateAuthCode", "resolveAuthCode"] },
    { name: "Card Management", symbols: ["upgradeCard", "getUpgradeCost", "getManaCost", "getCardById"] },
    { name: "Economy", symbols: ["creditGold", "grantPremium", "isPremiumActive", "REFERRAL_REWARD_GOLD"] },
    { name: "AI", symbols: ["executeAiTurn", "chooseBotDeck", "pickAiAction", "findLowestHp", "findHighestAtk"] },
    { name: "Networking", symbols: ["broadcastBattleState", "setupSocketHandlers", "startMatchmaking", "processPlayerAction"] },
  ];

  const insertCommunity = db.prepare(`INSERT INTO communities (name, level, cohesion, size, dominant_language, description) VALUES (?,?,?,?,?,?)`);
  const insertCommSummary = db.prepare(`INSERT INTO community_summaries (community_id, name, purpose, key_symbols, risk, size, dominant_language) VALUES (?,?,?,?,?,?,?)`);

  for (const comm of communities) {
    // Find node IDs for symbols
    const memberIds = [];
    for (const sym of comm.symbols) {
      for (const [qn, id] of nodeIdMap) {
        if (qn.endsWith(`::${sym}`)) { memberIds.push(id); break; }
      }
    }

    if (memberIds.length === 0) continue;

    const result = insertCommunity.run(
      comm.name, 0, 0.5, memberIds.length,
      "JavaScript", `${comm.name} community`,
    );

    const commId = result.lastInsertRowid;
    insertCommSummary.run(
      commId, comm.name, `${comm.name} related functions`,
      JSON.stringify(comm.symbols), "medium", memberIds.length, "JavaScript",
    );

    // Update nodes with community_id
    for (const nid of memberIds) {
      db.prepare("UPDATE nodes SET community_id = ? WHERE id = ?").run(commId, nid);
    }
  }

  // Rebuild FTS
  db.exec(`INSERT INTO nodes_fts(rowid, name, qualified_name, file_path, signature) SELECT rowid, name, qualified_name, file_path, signature FROM nodes`);

  // Metadata
  const meta = db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES (?,?)");
  const gitSha = (() => { try { return require("child_process").execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim(); } catch { return "unknown"; } })();
  const gitBranch = (() => { try { return require("child_process").execSync("git rev-parse --abbrev-ref HEAD", { cwd: ROOT }).toString().trim(); } catch { return "unknown"; } })();

  meta.run("schema_version", "9");
  meta.run("last_updated", new Date().toISOString());
  meta.run("last_build_type", "full");
  meta.run("git_branch", gitBranch);
  meta.run("git_head_sha", gitSha);
  meta.run("last_postprocessed_at", new Date().toISOString());
  meta.run("postprocess_level", "full");

  // Stats
  const nodeCount = db.prepare("SELECT count(*) c FROM nodes").get().c;
  const edgeCount = db.prepare("SELECT count(*) c FROM edges").get().c;
  const flowCount = db.prepare("SELECT count(*) c FROM flows").get().c;

  console.log(`\nDone: ${nodeCount} nodes, ${edgeCount} edges, ${flowCount} flows`);

  db.close();
}

build();
