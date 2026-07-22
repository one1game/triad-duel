# Triad Duel — внедрение PvP (матчмейкинг с bot-fallback)

Единая кнопка «Начать бой»: сервер пытается подобрать реального игрока, если не выходит —
через 1.2–2.5с тихо подменяет боем с ботом. Игрок не видит разницы.

Архитектура: боевые функции (`executeAttack`, `executeCrit`, `executeFireball`, `executeTaunt`)
не переписываются. В PvP-бою `battle.playerCards`/`battle.enemyCards` — указатели на
`cardsA`/`cardsB`, которые переставляются местами при смене хода. Поэтому вся существующая
боевая логика (пассивки, прикрытия, DOT) работает без изменений.

---

## server.js

### 1. Константы

Добавить после `const FIRST_TURN_MANA = 2;`:

```js
const MATCHMAKING_TIMEOUT_MS = 8000;   // ожидание, если в очереди уже есть кандидат
const PVP_TURN_TIMEOUT_MS = 45000;     // таймаут хода в PvP
const PVP_RECONNECT_GRACE_MS = 30000;  // грейс-период на реконнект
```

### 2. Рефакторинг сборки колоды

В `seedBattle()` заменить инлайн-`.map()` для `playerCards` на:

```js
const playerCards = buildDeckCards(playerDeckIds, cardUpgrades);
```

Добавить рядом с `seedBattle`:

```js
function buildDeckCards(deckIds, cardUpgrades) {
	return deckIds.map((id) => {
		const c = createBlankCard(id);
		const up = cardUpgrades[id] || {};
		if (up.hp) { c.hp += up.hp; c.maxHp += up.hp; }
		if (up.atk) c.atk += up.atk;
		c.mana = FIRST_TURN_MANA + (up.mana || 0);
		c.mana = Math.min(c.mana, getManaCap(id, cardUpgrades));
		return c;
	});
}
```

### 3. PvP-движок

Вставить целиком после `getManaCap`, перед `// ═══ AUTH ENDPOINTS ═══`:

```js
// ═══ PVP ═══
const pvpRooms = {};   // roomId -> { battle, sideA, sideB, turnTimer, disconnectTimer }
const matchQueue = []; // [{ sessionId, userId, socket, deckIds, cardUpgrades }]

function seedPvpBattle(deckA, upgA, deckB, upgB) {
	return {
		cardsA: buildDeckCards(deckA, upgA),
		cardsB: buildDeckCards(deckB, upgB),
		playerCards: null,
		enemyCards: null,
		turnOwner: Math.random() < 0.5 ? "A" : "B",
		activeIdx: -1,
		gameOver: false,
		turnLocked: false,
		critActivated: false,
		fireballActive: false,
		waitingForCritTarget: null,
		firstTurn: true,
		turnCount: 0,
		abilitiesUsedThisTurn: [],
		battleLog: [],
		deckIdsA: deckA,
		deckIdsB: deckB,
		playerAction: null,
		aiAction: null,
		gameEnd: null,
	};
}

function syncPvpSide(battle) {
	if (battle.turnOwner === "A") {
		battle.playerCards = battle.cardsA;
		battle.enemyCards = battle.cardsB;
	} else {
		battle.playerCards = battle.cardsB;
		battle.enemyCards = battle.cardsA;
	}
}

function getSessionShellState(sessionId) {
	const s = sessions[sessionId];
	if (!s) return {};
	return {
		playerGold: s.playerGold,
		playerCollection: s.playerCollection,
		cardUpgrades: s.cardUpgrades,
		selectedDeck: s.selectedDeck,
		shopCards: s.shopCards.map((c) => ({ id: c.id, price: c.price })),
	};
}

function emitPvpState(roomId) {
	const room = pvpRooms[roomId];
	if (!room) return;
	const b = room.battle;
	const shared = {
		activeIdx: b.activeIdx,
		gameOver: b.gameOver,
		turnLocked: b.turnLocked,
		critActivated: b.critActivated,
		fireballActive: b.fireballActive,
		waitingForCritTarget: b.waitingForCritTarget,
		firstTurn: b.firstTurn,
		abilitiesUsedThisTurn: b.abilitiesUsedThisTurn,
		log: [...b.battleLog],
		playerAction: b.playerAction,
		aiAction: null,
		gameEnd: b.gameEnd,
		isPvp: true,
	};
	if (room.sideA.socket.connected) {
		room.sideA.socket.emit("stateUpdate", {
			...getSessionShellState(room.sideA.sessionId),
			battle: { ...shared, playerCards: b.cardsA, enemyCards: b.cardsB, isPlayerTurn: b.turnOwner === "A" },
		});
	}
	if (room.sideB.socket.connected) {
		room.sideB.socket.emit("stateUpdate", {
			...getSessionShellState(room.sideB.sessionId),
			battle: { ...shared, playerCards: b.cardsB, enemyCards: b.cardsA, isPlayerTurn: b.turnOwner === "B" },
		});
	}
}

function armTurnTimer(roomId) {
	const room = pvpRooms[roomId];
	if (!room) return;
	clearTimeout(room.turnTimer);
	room.turnTimer = setTimeout(() => {
		if (!pvpRooms[roomId] || room.battle.gameOver) return;
		room.battle.battleLog.push('<span class="log-ability">⏱ Ход пропущен по таймауту.</span>');
		endPvpTurn(roomId);
	}, PVP_TURN_TIMEOUT_MS);
}

function endPvpTurn(roomId) {
	const room = pvpRooms[roomId];
	if (!room) return;
	const battle = room.battle;
	if (battle.gameOver) return;

	battle.turnLocked = true;
	battle.critActivated = false;
	battle.fireballActive = false;
	battle.waitingForCritTarget = null;
	battle.turnCount++;

	battle.enemyCards.forEach((c) => {
		if (c.dotTurns > 0) {
			c.hp = Math.max(0, c.hp - 1);
			c.dotTurns--;
			battle.battleLog.push(`<span class="log-enemy">${c.name}</span> получает <span class="log-dmg">1</span> урона от чумы`);
		}
	});

	if (battle.enemyCards.every((c) => c.hp <= 0)) {
		endPvpGame(roomId, battle.turnOwner, "victory");
		return;
	}
	if (battle.playerCards.every((c) => c.hp <= 0)) {
		endPvpGame(roomId, battle.turnOwner === "A" ? "B" : "A", "victory");
		return;
	}

	battle.turnOwner = battle.turnOwner === "A" ? "B" : "A";
	syncPvpSide(battle);
	battle.turnLocked = false;
	battle.abilitiesUsedThisTurn = [];
	battle.firstTurn = false;
	battle.activeIdx = -1;
	battle.playerAction = null;
	battle.aiAction = null;

	battle.cardsA.forEach((c) => (c.tauntActive = false));
	battle.cardsB.forEach((c) => (c.tauntActive = false));
	battle.playerCards.forEach((c) => { if (c.type === "assa" && c.mana >= 2) c.critReady = true; });

	battle.battleLog.push('<span class="log-ability">— Новый ход —</span>');
	emitPvpState(roomId);
	armTurnTimer(roomId);
}

function endPvpGame(roomId, winnerSide, reason) {
	const room = pvpRooms[roomId];
	if (!room) return;
	const battle = room.battle;
	if (battle.gameOver) return;
	battle.gameOver = true;
	clearTimeout(room.turnTimer);
	clearTimeout(room.disconnectTimer);

	const reward = BASE_REWARD + Math.floor(Math.random() * 30) + battle.turnCount * 2;
	const sides = { A: room.sideA, B: room.sideB };

	for (const side of ["A", "B"]) {
		const p = sides[side];
		const sess = sessions[p.sessionId];
		const won = side === winnerSide;
		if (sess) {
			sess.pvpRoomId = null;
			if (won) { sess.playerGold += reward; sess.wins = (sess.wins || 0) + 1; }
			else sess.losses = (sess.losses || 0) + 1;
		}
		if (p.userId) {
			saveBattleResult(
				p.userId, won ? "win" : "loss", won ? reward : 0,
				side === "A" ? battle.deckIdsA : battle.deckIdsB,
				side === "A" ? battle.deckIdsB : battle.deckIdsA,
				battle.turnCount, battle.battleLog,
			).catch((e) => console.error("PvP save error:", e.message));
			if (sess) savePlayerData(p.userId, sess).catch((e) => console.error("Player save error:", e.message));
		}
	}

	battle.battleLog.push(
		reason === "opponent_disconnected"
			? '<span class="log-victory">Соперник отключился — техпобеда!</span>'
			: '<span class="log-victory">Бой окончен!</span>',
	);

	const shared = {
		activeIdx: battle.activeIdx, gameOver: true, turnLocked: true,
		critActivated: false, fireballActive: false, waitingForCritTarget: null,
		firstTurn: battle.firstTurn, abilitiesUsedThisTurn: battle.abilitiesUsedThisTurn,
		log: [...battle.battleLog], playerAction: null, aiAction: null, isPlayerTurn: false, isPvp: true,
	};
	if (room.sideA.socket.connected) {
		room.sideA.socket.emit("stateUpdate", {
			...getSessionShellState(room.sideA.sessionId),
			battle: { ...shared, playerCards: battle.cardsA, enemyCards: battle.cardsB,
				gameEnd: { victory: winnerSide === "A", reward: winnerSide === "A" ? reward : 0, reason } },
		});
	}
	if (room.sideB.socket.connected) {
		room.sideB.socket.emit("stateUpdate", {
			...getSessionShellState(room.sideB.sessionId),
			battle: { ...shared, playerCards: battle.cardsB, enemyCards: battle.cardsA,
				gameEnd: { victory: winnerSide === "B", reward: winnerSide === "B" ? reward : 0, reason } },
		});
	}

	for (const p of [room.sideA, room.sideB]) {
		const sess = sessions[p.sessionId];
		if (sess) { sess.battle = null; sess.selectedDeck = []; sess.shopCards = eraDef(); }
	}
	delete pvpRooms[roomId];
}

function createPvpRoom(p1, p2) {
	const roomId = crypto.randomBytes(8).toString("hex");
	const battle = seedPvpBattle(p1.deckIds, p1.cardUpgrades, p2.deckIds, p2.cardUpgrades);
	syncPvpSide(battle);
	pvpRooms[roomId] = { battle, sideA: p1, sideB: p2, turnTimer: null, disconnectTimer: null };
	if (sessions[p1.sessionId]) sessions[p1.sessionId].pvpRoomId = roomId;
	if (sessions[p2.sessionId]) sessions[p2.sessionId].pvpRoomId = roomId;
	battle.battleLog.push('<span class="log-ability">⚔ Битва начинается!</span>');
	emitPvpState(roomId);
	armTurnTimer(roomId);
}

function tryMatch() {
	while (matchQueue.length >= 2) {
		const p1 = matchQueue.shift();
		const p2 = matchQueue.shift();
		if (sessions[p1.sessionId]) clearTimeout(sessions[p1.sessionId].matchmakingTimer);
		if (sessions[p2.sessionId]) clearTimeout(sessions[p2.sessionId].matchmakingTimer);
		createPvpRoom(p1, p2);
	}
}

function fallbackToBot(s, socket, sessionId) {
	const idx = matchQueue.findIndex((q) => q.sessionId === sessionId);
	if (idx === -1) return; // за это время всё же заматчились с игроком
	matchQueue.splice(idx, 1);
	beginPveBattle(s, socket, sessionId);
}

function handlePvpAction(roomId, sessionId, action) {
	const room = pvpRooms[roomId];
	if (!room) return;
	const battle = room.battle;
	if (battle.gameOver) return;
	const side = room.sideA.sessionId === sessionId ? "A" : room.sideB.sessionId === sessionId ? "B" : null;
	if (!side || battle.turnOwner !== side) return;

	clearTimeout(room.turnTimer);
	battle.aiAction = null;
	const { type, attackerIdx, defenderIdx } = action;

	if (type === "endTurn") { endPvpTurn(roomId); return; }

	const attacker = battle.playerCards[attackerIdx];
	if (!attacker || attacker.hp <= 0) { armTurnTimer(roomId); return; }

	let actionResult = null;
	const cardUpgrades = (side === "A" ? room.sideA : room.sideB).cardUpgrades;

	if (type === "attack") {
		actionResult = executeAttack(battle, attackerIdx, defenderIdx, true);
	} else if (type === "crit") {
		if (attacker.type !== "assa" || attacker.mana < 2) { armTurnTimer(roomId); return; }
		if (battle.firstTurn) { armTurnTimer(roomId); return; }
		if (battle.abilitiesUsedThisTurn.includes(attackerIdx)) { armTurnTimer(roomId); return; }
		if (defenderIdx !== undefined) {
			const ignoreTaunt = attacker.baseId === "assa_03";
			if (!ignoreTaunt) {
				const taunter = battle.enemyCards.find((e) => e.tauntActive && e.hp > 0);
				if (taunter && defenderIdx !== battle.enemyCards.indexOf(taunter)) { armTurnTimer(roomId); return; }
			}
		}
		actionResult = executeCrit(battle, attackerIdx, defenderIdx);
	} else if (type === "fireball") {
		if (attacker.type !== "mage") { armTurnTimer(roomId); return; }
		if (battle.firstTurn) { armTurnTimer(roomId); return; }
		if (battle.abilitiesUsedThisTurn.includes(attackerIdx)) { armTurnTimer(roomId); return; }
		if (defenderIdx !== undefined) {
			const taunter = battle.enemyCards.find((e) => e.tauntActive && e.hp > 0);
			if (taunter && defenderIdx !== battle.enemyCards.indexOf(taunter)) { armTurnTimer(roomId); return; }
		}
		const cost = attacker.baseId === "mage_01" ? 2 : 3;
		if (attacker.mana < cost) { armTurnTimer(roomId); return; }
		actionResult = executeFireball(battle, attackerIdx, defenderIdx, cardUpgrades);
	} else if (type === "taunt") {
		if (attacker.type !== "tank" || attacker.mana < 2) { armTurnTimer(roomId); return; }
		if (battle.firstTurn) { armTurnTimer(roomId); return; }
		if (battle.abilitiesUsedThisTurn.includes(attackerIdx)) { armTurnTimer(roomId); return; }
		executeTaunt(battle, attackerIdx, cardUpgrades);
		battle.abilitiesUsedThisTurn.push(attackerIdx);
		battle.playerAction = { type: "taunt", attackerIdx, attackerName: attacker.name, hpHealed: attacker.baseId === "tank_05" ? 2 : 0 };
		endPvpTurn(roomId);
		return;
	}

	if (actionResult) battle.playerAction = actionResult;

	if (actionResult && (actionResult.type === "crit_ready" || actionResult.type === "fireball_ready")) {
		emitPvpState(roomId);
		armTurnTimer(roomId);
		return;
	}

	endPvpTurn(roomId);
}
```

### 4. Внутри `IO.on("connection", (socket) => { ... })`

**a) Обернуть тело `startBattle` в переиспользуемую функцию** — заменить существующий
`socket.on("startBattle", () => { ... })` целиком на:

```js
function beginPveBattle(s, socket, sessionId) {
	if (s.selectedDeck.length !== CARDS_PER_SIDE) {
		socket.emit("error", "Выберите ровно 3 карты");
		return;
	}
	const npcPool = ALL_CARDS.filter((c) => !s.selectedDeck.includes(c.id));
	const enemyDeck = shuffle(npcPool).slice(0, CARDS_PER_SIDE).map((c) => c.id);
	s.battle = seedBattle(s.selectedDeck, enemyDeck, s.cardUpgrades);
	s.battle.battleLog.push('<span class="log-ability">⚔ Битва начинается!</span>');
	socket.emit("stateUpdate", getSessionState(sessionId));

	if (!s.battle.isPlayerTurn) {
		const aiThinkMs = 3000 + Math.floor(Math.random() * 5000);
		setTimeout(() => {
			const battle = s.battle;
			if (!battle || battle.gameOver) return;
			try { executeAiTurn(battle, s.cardUpgrades); }
			catch (e) { console.error("[ai] first turn crashed:", e.message); battle.aiAction = null; }
			if (battle.enemyCards.every((c) => c.hp <= 0) || battle.playerCards.every((c) => c.hp <= 0)) {
				endGame(battle, battle.enemyCards.every((c) => c.hp <= 0), s, socket, sessionId, s.userId);
				return;
			}
			battle.isPlayerTurn = true;
			battle.turnLocked = false;
			battle.abilitiesUsedThisTurn = [];
			battle.firstTurn = false;
			battle.activeIdx = -1;
			for (const c of battle.playerCards) c.tauntActive = false;
			for (const c of battle.enemyCards) c.tauntActive = false;
			battle.battleLog.push('<span class="log-ability">— Новый ход —</span>');
			battle.aiAction = null;
			socket.emit("stateUpdate", getSessionState(sessionId));
		}, aiThinkMs);
	}
}

socket.on("startBattle", () => {
	const s = sessions[sessionId];
	if (!s) return;
	beginPveBattle(s, socket, sessionId);
});
```

**b) Матчмейкинг** — добавить сразу после блока выше:

```js
// ═══ MATCHMAKING ═══
socket.on("findMatch", () => {
	const s = sessions[sessionId];
	if (!s || s.selectedDeck.length !== CARDS_PER_SIDE) {
		socket.emit("error", "Выберите ровно 3 карты");
		return;
	}
	if (s.pvpRoomId || matchQueue.find((q) => q.sessionId === sessionId)) return;

	const hadCandidates = matchQueue.length > 0;
	matchQueue.push({ sessionId, userId, socket, deckIds: [...s.selectedDeck], cardUpgrades: s.cardUpgrades });
	socket.emit("matchmakingStatus", { status: "searching" });
	tryMatch();

	if (s.pvpRoomId) return; // заматчились сразу

	if (hadCandidates) {
		s.matchmakingTimer = setTimeout(() => fallbackToBot(s, socket, sessionId), MATCHMAKING_TIMEOUT_MS);
	} else {
		const quickMs = 1200 + Math.floor(Math.random() * 1300); // 1.2–2.5с, чтобы не спалить бота
		s.matchmakingTimer = setTimeout(() => fallbackToBot(s, socket, sessionId), quickMs);
	}
});

socket.on("cancelMatch", () => {
	const idx = matchQueue.findIndex((q) => q.sessionId === sessionId);
	if (idx >= 0) matchQueue.splice(idx, 1);
	const s = sessions[sessionId];
	if (s) clearTimeout(s.matchmakingTimer);
	socket.emit("matchmakingStatus", { status: "cancelled" });
});

socket.on("pvpAction", (action) => {
	const s = sessions[sessionId];
	if (!s || !s.pvpRoomId) return;
	handlePvpAction(s.pvpRoomId, sessionId, action);
});
```

**c) Защита `playerAction` от PvP-сессий** — в существующем
`socket.on("playerAction", (action) => { ... })`, сразу после
`const s = sessions[sessionId]; if (!s) return;` добавить:

```js
if (s.pvpRoomId) return; // PvP использует событие pvpAction
```

**d) `surrender`** — в начале существующего `socket.on("surrender", () => { ... })`:

```js
socket.on("surrender", () => {
	const s = sessions[sessionId];
	if (!s) return;
	if (s.pvpRoomId) {
		const room = pvpRooms[s.pvpRoomId];
		if (room && !room.battle.gameOver) {
			const side = room.sideA.sessionId === sessionId ? "A" : "B";
			endPvpGame(s.pvpRoomId, side === "A" ? "B" : "A", "surrender");
		}
		return;
	}
	// ...дальше существующий код PvE-сдачи без изменений
```

**e) `disconnect`** — в начале существующего `socket.on("disconnect", async () => { ... })`:

```js
socket.on("disconnect", async () => {
	console.log(`[disconnect] ${sessionId}`);
	const s = sessions[sessionId];
	if (s?.pvpRoomId) {
		const room = pvpRooms[s.pvpRoomId];
		if (room && !room.battle.gameOver) {
			const side = room.sideA.sessionId === sessionId ? "A" : "B";
			room.disconnectTimer = setTimeout(() => {
				if (pvpRooms[s.pvpRoomId] && !room.battle.gameOver) {
					endPvpGame(s.pvpRoomId, side === "A" ? "B" : "A", "opponent_disconnected");
				}
			}, PVP_RECONNECT_GRACE_MS);
		}
	}
	// ...дальше существующий код disconnect без изменений
```

**f) `auth`** — в существующем `socket.on("auth", ...)`, перед строкой
`console.log("[auth] tg${decoded.telegram_id} -> ${sessionId}");` добавить:

```js
// Реконнект в разгар PvP-боя — перепривязываем сокет к комнате
if (sessions[sessionId].pvpRoomId) {
	const room = pvpRooms[sessions[sessionId].pvpRoomId];
	if (room) {
		clearTimeout(room.disconnectTimer);
		if (room.sideA.userId === userId) { room.sideA.sessionId = sessionId; room.sideA.socket = socket; }
		else if (room.sideB.userId === userId) { room.sideB.sessionId = sessionId; room.sideB.socket = socket; }
		emitPvpState(sessions[sessionId].pvpRoomId);
	} else {
		sessions[sessionId].pvpRoomId = null;
	}
}
```

---

## index.html

### 1. Кнопка «Начать бой» — заменить `startBattle()` (строка ~906)

```js
function startBattle(){
  stopRoundTimer();battleGen++;el('battleLog').innerHTML='';
  saveGameState({playerGold,playerCollection,selectedDeck,cardUpgrades,shopCards,battle:{}}, 'battle');
  showMatchmakingOverlay();
  socket.emit('findMatch');
}

function cancelMatchmaking(){ socket.emit('cancelMatch'); hideMatchmakingOverlay(); }

function showMatchmakingOverlay(){
  let ov=document.getElementById('mmOverlay');
  if(!ov){
    ov=document.createElement('div');
    ov.id='mmOverlay';
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:999;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;gap:16px;font-size:18px';
    ov.innerHTML='<div id="mmText">Поиск игрока…</div><button onclick="cancelMatchmaking()" style="padding:8px 20px;cursor:pointer">Отмена</button>';
    document.body.appendChild(ov);
  }
  ov.style.display='flex';
}
function hideMatchmakingOverlay(){
  const ov=document.getElementById('mmOverlay');
  if(ov) ov.style.display='none';
}
```

### 2. Обработчик статуса матчмейкинга — добавить рядом с `socket.on('sfx', ...)` (строка ~362)

```js
socket.on('matchmakingStatus', ({status}) => {
  const t = document.getElementById('mmText');
  if (status === 'searching' && t) t.textContent = 'Поиск игрока…';
  if (status === 'cancelled') hideMatchmakingOverlay();
});
```

### 3. Скрыть оверлей при старте любого боя — в `socket.on('stateUpdate', ...)` (строка ~333), первой строкой внутри колбэка

```js
socket.on('stateUpdate',(state)=>{
  gameState=state;
  hideLoading();
  if(state.battle) hideMatchmakingOverlay();   // ← добавить
  ...
```

### 4. Отправка боевых действий — универсальная функция

Добавить рядом с остальными функциями боя:

```js
function sendBattleAction(action){
  socket.emit(gameState?.battle?.isPvp ? 'pvpAction' : 'playerAction', action);
}
```

Заменить `socket.emit('playerAction', {...})` на `sendBattleAction({...})` во всех местах,
где это вызывается (атака/крит/файербол/провокация/endTurn — строки 849, 860, 872, 882, 889, 896, 903).

---

## Проверка после внедрения

1. Один вкладка (нет других игроков в очереди) → клик «Начать бой» → короткий оверлей 1.2–2.5с → бой с ботом, как раньше.
2. Две вкладки/два аккаунта одновременно жмут «Начать бой» → должны попасть в PvP-бой друг с другом (проверить лог сервера: `⚔ Битва начинается!` создаётся один раз на комнату, не дважды).
3. В PvP закрыть одну вкладку посреди боя → через 30с у второго игрока техпобеда.
4. В PvP не делать ход 45с → ход автоматически передаётся сопернику.
5. Победа/поражение в PvP корректно сохраняются в Supabase (`saveBattleResult`, `savePlayerData`) для обеих сторон.
