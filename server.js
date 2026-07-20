require("dotenv").config();
const express = require("express");
const http = require("node:http");
const { Server } = require("socket.io");
const { createClient } = require("@supabase/supabase-js");
const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");
const path = require("node:path");

// ═══ SUPABASE ═══
const supabase = createClient(
	process.env.SUPABASE_URL,
	process.env.SUPABASE_SERVICE_ROLE_KEY,
	{ auth: { autoRefreshToken: false, persistSession: false } },
);

// ═══ TELEGRAM + JWT ═══
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const JWT_SECRET =
	process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex");

function signJWT(payload) {
	return jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" });
}

function verifyJWT(token) {
	try {
		return jwt.verify(token, JWT_SECRET);
	} catch {
		return null;
	}
}

function _verifyTelegramHash(data) {
	if (!TELEGRAM_BOT_TOKEN) return false;
	const { hash, ...rest } = data;
	const secret = crypto
		.createHash("sha256")
		.update(TELEGRAM_BOT_TOKEN)
		.digest();
	const checkString = Object.keys(rest)
		.sort()
		.map((k) => `${k}=${rest[k]}`)
		.join("\n");
	const hmac = crypto
		.createHmac("sha256", secret)
		.update(checkString)
		.digest("hex");
	return hmac === hash;
}

// ═══ AUTH CODES (in-memory, 5min TTL) ═══
const authCodes = new Map();
function generateAuthCode() {
	const code = crypto.randomBytes(16).toString("hex");
	authCodes.set(code, { createdAt: Date.now() });
	// Cleanup expired codes
	for (const [k, v] of authCodes) {
		if (Date.now() - v.createdAt > 5 * 60 * 1000) authCodes.delete(k);
	}
	return code;
}
function resolveAuthCode(code, telegramId) {
	if (!authCodes.has(code)) return false;
	authCodes.set(code, { telegramId, createdAt: Date.now() });
	return true;
}
function getAuthCodeTelegramId(code) {
	const entry = authCodes.get(code);
	if (!entry?.telegramId) return null;
	authCodes.delete(code);
	return entry.telegramId;
}

// ═══ CONSTANTS ═══
const CARDS_PER_SIDE = 3;
const _SHOP_SIZE = 12;
const MAX_MANA = 10;
const BASE_REWARD = 50;
const FIRST_TURN_MANA = 2;

const ALL_CARDS = [
	{
		id: "mage_01",
		name: "Библиарий Кассиан",
		atk: 6,
		hp: 11,
		price: 650,
		type: "mage",
		variance: 0.1,
		passive: "Эрудит",
		passiveDesc: "Фаербол стоит 2 маны. Раскол: 5% шанс 1-3 урона соседним",
		lore: "Хранитель запретных знаний из библиотек Некрона.",
	},
	{
		id: "mage_02",
		name: "Малекит Проклятый",
		atk: 7,
		hp: 9,
		price: 450,
		type: "mage",
		variance: 0.25,
		passive: "Проклятие",
		passiveDesc:
			"Фаербол снижает ATK врага на 1. Раскол: 5% шанс 1-3 урона соседним",
		lore: "Когда-то был светлым магом, но проклятие Хаоса извратило его дар.",
	},
	{
		id: "mage_03",
		name: "Азатот Посвящённый",
		atk: 5,
		hp: 14,
		price: 500,
		type: "mage",
		variance: 0.15,
		passive: "Жертва",
		passiveDesc:
			"Фаербол лечит мага на 2 HP. Раскол: 5% шанс 1-3 урона соседним",
		lore: "Служитель культа Азатота.",
	},
	{
		id: "mage_04",
		name: "Гнилоуст Проповедник",
		atk: 7,
		hp: 10,
		price: 500,
		type: "mage",
		variance: 0.2,
		passive: "Чума",
		passiveDesc:
			"Фаербол = 1 урон/ход на 2 хода. Раскол: 5% шанс 1-3 урона соседним",
		lore: "Уста его источают чумные миазмы.",
	},
	{
		id: "mage_05",
		name: "Иландра Хранительница Рун",
		atk: 6,
		hp: 12,
		price: 750,
		type: "mage",
		variance: 0.1,
		passive: "Рунный щит",
		passiveDesc:
			"Получает на 1 урона меньше. Раскол: 5% шанс 1-3 урона соседним",
		lore: "Последняя из ордена Рунных Стражей.",
	},
	{
		id: "mage_06",
		name: "Ксаль'Торот",
		atk: 7,
		hp: 9,
		price: 550,
		type: "mage",
		variance: 0.2,
		passive: "Искажение",
		passiveDesc:
			"30% шанс: фаербол возвращает 1 ману. Раскол: 5% шанс 1-3 урона соседним",
		lore: "Бессмертный зодчий Первородного Хаоса.",
	},
	{
		id: "mage_07",
		name: "Ксар'лот",
		atk: 6,
		hp: 12,
		price: 600,
		type: "mage",
		variance: 0.15,
		passive: "Скверна",
		passiveDesc: "Фаербол +1 урона танкам. Раскол: 5% шанс 1-3 урона соседним",
		lore: "Древний маг, искажённый скверной Бездны.",
	},
	{
		id: "mage_08",
		name: "Каэр'Тал",
		atk: 7,
		hp: 10,
		price: 600,
		type: "mage",
		variance: 0.25,
		passive: "Пожиратель",
		passiveDesc:
			"Фаербол крадёт 1 ману у врага. Раскол: 5% шанс 1-3 урона соседним",
		lore: "Пророк Варпа.",
	},
	{
		id: "mage_09",
		name: "Кадавр",
		atk: 5,
		hp: 14,
		price: 500,
		type: "mage",
		variance: 0.15,
		passive: "Сбор душ",
		passiveDesc:
			"Убийство фаерболом: +2 HP и +1 маны. Раскол: 5% шанс 1-3 урона соседним",
		lore: "Отрекшийся магистр смерти.",
	},
	{
		id: "mage_10",
		name: "Каэлис Векс",
		atk: 8,
		hp: 8,
		price: 700,
		type: "mage",
		variance: 0.2,
		passive: "Псай-шторм",
		passiveDesc:
			"Фаербол +2 урона при HP<50%. Раскол: 5% шанс 1-3 урона соседним",
		lore: "Беглый псайкер.",
	},
	{
		id: "mage_11",
		name: "Слепая Оракул",
		atk: 6,
		hp: 12,
		price: 650,
		type: "mage",
		variance: 0.1,
		passive: "Оракул",
		passiveDesc:
			"40% шанс: фаербол стоит 1 ману. Раскол: 5% шанс 1-3 урона соседним",
		lore: "Её глаза закрыты, но она видит всё.",
	},
	{
		id: "tank_01",
		name: "Железный Дредноут",
		atk: 4,
		hp: 20,
		price: 650,
		type: "tank",
		variance: 0.15,
		passive: "Броня",
		passiveDesc:
			"Провокация: -1 вх. урона. Прикрытие: 5% шанс забрать атаку с соседа без урона",
		lore: "Живая крепость, закованная в адамантий.",
	},
	{
		id: "tank_02",
		name: "Чумной Гигант",
		atk: 3,
		hp: 24,
		price: 800,
		type: "tank",
		variance: 0.2,
		passive: "Гнилая кровь",
		passiveDesc:
			"Провокация: отражает 1 урон. Прикрытие: 5% шанс забрать атаку с соседа без урона",
		lore: "Порождение гнилых садов Нургла.",
	},
	{
		id: "tank_03",
		name: "Страж Некрона",
		atk: 4,
		hp: 18,
		price: 700,
		type: "tank",
		variance: 0.1,
		passive: "Ярость мёртвых",
		passiveDesc:
			"HP<50%: +2 ATK. Прикрытие: 5% шанс забрать атаку с соседа без урона",
		lore: "Пробуждённый от вечного сна воин.",
	},
	{
		id: "tank_04",
		name: "Каменный Страж",
		atk: 3,
		hp: 22,
		price: 850,
		type: "tank",
		variance: 0.1,
		passive: "Каменная кожа",
		passiveDesc:
			"Всегда -1 вх. урона. Прикрытие: 5% шанс забрать атаку с соседа без урона",
		lore: "Голем, высеченный из горного хребта.",
	},
	{
		id: "tank_05",
		name: "Шоггот-Брут",
		atk: 4,
		hp: 21,
		price: 650,
		type: "tank",
		variance: 0.25,
		passive: "Регенерация",
		passiveDesc:
			"Провокация лечит 2 HP. Прикрытие: 5% шанс забрать атаку с соседа без урона",
		lore: "Бесформенная тварь из глубин Иннсмута.",
	},
	{
		id: "assa_01",
		name: "Ночной Клинок",
		atk: 8,
		hp: 8,
		price: 500,
		type: "assa",
		variance: 0.15,
		passive: "Теневой шаг",
		passiveDesc:
			"30% шанс: крит стоит 1 ману. Кровопускание: 5% шанс нанести половину урона соседу",
		lore: "Тень, скользящая между мирами.",
	},
	{
		id: "assa_02",
		name: "Теневой Убийца",
		atk: 9,
		hp: 6,
		price: 750,
		type: "assa",
		variance: 0.1,
		passive: "Добивание",
		passiveDesc:
			"+2 урона целям с HP<50%. Кровопускание: 5% шанс нанести половину урона соседу",
		lore: "Мастер добивания.",
	},
	{
		id: "assa_03",
		name: "Варп-Сталкер",
		atk: 7,
		hp: 10,
		price: 650,
		type: "assa",
		variance: 0.2,
		passive: "Фазовый сдвиг",
		passiveDesc:
			"Крит игнорирует провокацию. Кровопускание: 5% шанс нанести половину урона соседу",
		lore: "Ходок через Варп.",
	},
	{
		id: "assa_04",
		name: "Глубинный Хищник",
		atk: 9,
		hp: 7,
		price: 750,
		type: "assa",
		variance: 0.15,
		passive: "Хищник",
		passiveDesc:
			"Убийство даёт +2 маны. Кровопускание: 5% шанс нанести половину урона соседу",
		lore: "Вышел из Марианской впадины.",
	},
	{
		id: "assa_05",
		name: "Жнец Снов",
		atk: 9,
		hp: 7,
		price: 700,
		type: "assa",
		variance: 0.25,
		passive: "Кошмар",
		passiveDesc:
			"Крит наносит x2.5 урона. Кровопускание: 5% шанс нанести половину урона соседу",
		lore: "Посланник Кошмара.",
	},
];

const APP = express();
const SERVER = http.createServer(APP);
const IO = new Server(SERVER, {
	cors: { origin: "*", methods: ["GET", "POST"] },
});

APP.use(express.static(path.join(__dirname, "public")));
APP.use(express.json());
APP.use((req, res, next) => {
	res.setHeader("Access-Control-Allow-Origin", "*");
	res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
	res.setHeader("Access-Control-Allow-Headers", "Content-Type");
	if (req.method === "OPTIONS") return res.sendStatus(200);
	next();
});

// ═══ HELPERS ═══
function rand(min, max) {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}
function shuffle(arr) {
	return arr.slice().sort(() => Math.random() - 0.5);
}
function byId(id) {
	return ALL_CARDS.find((c) => c.id === id);
}
function eraDef() {
	const pool = ALL_CARDS.filter(
		(c) => !["mage_01", "tank_01", "assa_01"].includes(c.id),
	);
	return shuffle(pool).map((c) => ({ id: c.id, price: c.price }));
}

// ═══ PLAYER DATA (Supabase) ═══
async function getOrCreatePlayer(telegramId, userData) {
	const { data } = await supabase
		.from("kart_players")
		.select("*")
		.eq("telegram_id", telegramId)
		.single();
	if (data) return data;
	// Create new player
	const defaults = {
		id: crypto.randomUUID(),
		telegram_id: telegramId,
		username: userData.first_name || userData.username || "Игрок",
		gold: 100,
		collection: ["mage_01", "tank_01", "assa_01"],
		card_upgrades: {},
		selected_deck: [],
		wins: 0,
		losses: 0,
	};
	const { error } = await supabase.from("kart_players").insert(defaults);
	if (error) {
		console.error("Failed to create player:", error.message);
		return defaults;
	}
	return defaults;
}

async function savePlayerData(userId, data) {
	const { error } = await supabase
		.from("kart_players")
		.update({
			gold: data.playerGold,
			collection: data.playerCollection,
			card_upgrades: data.cardUpgrades || {},
			selected_deck: data.selectedDeck || [],
			wins: data.wins || 0,
			losses: data.losses || 0,
			updated_at: new Date().toISOString(),
		})
		.eq("id", userId);
	if (error) console.error("Failed to save player:", error.message);
}

async function saveBattleResult(
	userId,
	result,
	goldEarned,
	playerDeck,
	enemyDeck,
	turns,
	log,
) {
	const { error } = await supabase.from("kart_battles").insert({
		player_id: userId,
		result,
		gold_earned: goldEarned,
		player_deck: playerDeck,
		enemy_deck: enemyDeck,
		turns,
		log,
	});
	if (error) console.error("Failed to save battle:", error.message);
}

// ═══ BATTLE SESSIONS (in-memory) ═══
const sessions = {};

function createBlankCard(cardId) {
	const base = byId(cardId);
	return {
		id: base.id,
		type: base.type,
		atk: base.atk,
		hp: base.hp,
		maxHp: base.hp,
		mana: 0,
		alive: true,
		tauntActive: false,
		baseId: base.id,
		dotTurns: 0,
		atkDebuff: 0,
		critReady: false,
	};
}
function _copyCard(c) {
	return { ...c };
}
function seedBattle(playerDeckIds, enemyDeckIds, cardUpgrades) {
	const playerCards = playerDeckIds.map((id) => {
		const _base = byId(id);
		const c = createBlankCard(id);
		const up = cardUpgrades[id] || {};
		if (up.hp) {
			c.hp += up.hp;
			c.maxHp += up.hp;
		}
		if (up.atk) c.atk += up.atk;
		c.mana = FIRST_TURN_MANA + (up.mana || 0);
		c.mana = Math.min(c.mana, getManaCap(id, cardUpgrades));
		return c;
	});
	// AI scaling: player's total upgrade points = AI gets same amount, randomly distributed
	const playerUpgradeTotal = Object.values(cardUpgrades).reduce(
		(sum, up) => sum + (up.atk || 0) + (up.hp || 0) + (up.mana || 0),
		0,
	);
	const enemyCards = enemyDeckIds.map((id) => createBlankCard(id));
	for (let i = 0; i < playerUpgradeTotal; i++) {
		const card = enemyCards[Math.floor(Math.random() * enemyCards.length)];
		if (Math.random() < 0.5) {
			card.atk += 1;
		} else {
			card.hp += 1;
		}
	}
	enemyCards.forEach((c) => {
		c.maxHp = c.hp;
		c.mana = FIRST_TURN_MANA;
	});
	return {
		playerCards,
		enemyCards,
		activeIdx: -1,
		isPlayerTurn: Math.random() < 0.5,
		gameOver: false,
		turnLocked: false,
		critActivated: false,
		fireballActive: false,
		waitingForCritTarget: null,
		firstTurn: true,
		turnCount: 0,
		abilitiesUsedThisTurn: [],
		battleLog: [],
		playerDeckIds,
		enemyDeckIds,
		playerAction: null,
		aiAction: null,
	};
}

function getManaCap(cardId, cardUpgrades) {
	const up = cardUpgrades[cardId] || {};
	return Math.min(MAX_MANA + (up.mana || 0), 10);
}

// ═══ AUTH ENDPOINTS ═══
// Step 1: request auth from site → get code + bot link
APP.get("/auth/bot/start", (_req, res) => {
	const code = generateAuthCode();
	const botUrl = `https://t.me/triad_duel_bot?start=${code}`;
	res.json({ code, bot_url: botUrl });
});

// Step 2: poll for auth result
APP.get("/auth/bot/poll", async (req, res) => {
	const { code } = req.query;
	if (!code) return res.status(400).json({ error: "code required" });
	const telegramId = getAuthCodeTelegramId(code);
	if (!telegramId) return res.json({ ready: false });
	const player = await getOrCreatePlayer(telegramId, {
		username: `tg${telegramId}`,
	});
	const token = signJWT({
		sub: player.id,
		telegram_id: telegramId,
		username: player.username,
	});
	res.json({
		ready: true,
		token,
		user: { id: player.id, username: player.username },
	});
});

// Step 3: bot webhook — receives Telegram messages
APP.post("/bot/webhook", express.json(), async (req, res) => {
	try {
		const msg = req.body?.message || req.body?.edited_message;
		if (!msg?.text || !msg?.from?.id) return res.sendStatus(200);
		const text = msg.text.trim();
		const telegramId = msg.from.id;
		if (text.startsWith("/start ")) {
			const code = text.replace("/start ", "").trim();
			if (resolveAuthCode(code, telegramId)) {
				console.log(
					`[bot] auth code ${code.substring(0, 8)}... → tg${telegramId}`,
				);
			}
		}
		res.sendStatus(200);
	} catch (e) {
		console.error("[webhook error]", e.message);
		res.sendStatus(200);
	}
});

// ═══ SOCKET.IO ═══
IO.on("connection", (socket) => {
	let userId = null;
	let _playerData = null;
	const sessionId = socket.id;
	console.log(`[connect] ${sessionId}`);

	// Store temporary session for battles
	sessions[sessionId] = {
		playerGold: 100,
		playerCollection: ["mage_01", "tank_01", "assa_01"],
		cardUpgrades: {},
		selectedDeck: [],
		battle: null,
		shopCards: eraDef(),
		wins: 0,
		losses: 0,
	};

	// ═══ AUTH ═══
	socket.on("auth", async ({ access_token }) => {
		try {
			const decoded = verifyJWT(access_token);
			if (!decoded) {
				socket.emit("error", "Токен недействителен");
				return;
			}
			userId = decoded.sub;

			// Если у этого userId уже есть активная сессия — шарим объект между вкладками
			const existingKey = Object.keys(sessions).find(
				(k) => sessions[k].userId === userId && k !== sessionId,
			);
			const isReconnect = !!existingKey;
			if (isReconnect) {
				sessions[sessionId] = sessions[existingKey];
				// Не удаляем старый ключ — обе вкладки ссылаются на один объект
			}

			const dbPlayer = await getOrCreatePlayer(decoded.telegram_id, {
				username: decoded.username,
			});
			_playerData = dbPlayer;
			sessions[sessionId].userId = userId;
			sessions[sessionId].playerGold = dbPlayer.gold;
			sessions[sessionId].playerCollection = dbPlayer.collection || [];
			sessions[sessionId].cardUpgrades = dbPlayer.card_upgrades || {};
			sessions[sessionId].selectedDeck = dbPlayer.selected_deck || [];
			sessions[sessionId].wins = dbPlayer.wins || 0;
			sessions[sessionId].losses = dbPlayer.losses || 0;
			// shopCards не перезаписываем при реконнекте — сохраняем текущий магазин
			if (!isReconnect) {
				sessions[sessionId].shopCards = eraDef();
			}

			console.log(`[auth] tg${decoded.telegram_id} -> ${sessionId}`);
			socket.emit("init", getSessionState(sessionId));
		} catch (e) {
			console.error("[auth error]", e.message);
			socket.emit("error", "Ошибка авторизации");
		}
	});

	// ═══ NEW CAMPAIGN ═══
	socket.on("newCampaign", () => {
		const s = sessions[sessionId];
		if (!s) return;
		s.playerGold = 100;
		s.playerCollection = ["mage_01", "tank_01", "assa_01"];
		s.cardUpgrades = {};
		s.selectedDeck = [];
		s.battle = null;
		s.shopCards = eraDef();
		socket.emit("stateUpdate", getSessionState(sessionId));
	});

	// ═══ GET SHOP ═══
	socket.on("getShop", () => {
		const s = sessions[sessionId];
		if (!s) return;
		if (!s.shopCards.length) s.shopCards = eraDef();
		socket.emit("stateUpdate", getSessionState(sessionId));
	});

	// ═══ BUY CARD ═══
	socket.on("buyCard", (cardId) => {
		const s = sessions[sessionId];
		if (!s) return;
		const card = s.shopCards.find((c) => c.id === cardId);
		if (!card) {
			socket.emit("error", "Карта не найдена");
			return;
		}
		if (s.playerCollection.includes(cardId)) {
			socket.emit("error", "Карта уже в коллекции");
			return;
		}
		if (s.playerGold < card.price) {
			socket.emit("error", "Недостаточно золота");
			return;
		}
		s.playerGold -= card.price;
		s.playerCollection.push(cardId);
		socket.emit("sfx", "buy");
		socket.emit("stateUpdate", getSessionState(sessionId));
	});

	// ═══ UPGRADE CARD ═══
	socket.on("upgradeCard", ({ cardId, stat }) => {
		const s = sessions[sessionId];
		if (!s) return;
		if (!s.playerCollection.includes(cardId)) {
			socket.emit("error", "Карта не в коллекции");
			return;
		}
		if (!s.cardUpgrades[cardId])
			s.cardUpgrades[cardId] = { hp: 0, atk: 0, mana: 0 };
		const up = s.cardUpgrades[cardId];
		const cost = 150 * 2 ** up[stat];
		if (stat === "mana" && up.mana >= 4) {
			socket.emit("error", "Мана на максимуме");
			return;
		}
		if (s.playerGold < cost) {
			socket.emit("error", "Недостаточно золота");
			return;
		}
		s.playerGold -= cost;
		up[stat]++;
		socket.emit("sfx", "upgrade");
		socket.emit("stateUpdate", getSessionState(sessionId));
	});

	// ═══ UPDATE DECK ═══
	socket.on("updateDeck", ({ cardId }) => {
		const s = sessions[sessionId];
		if (!s) return;
		if (!s.playerCollection.includes(cardId)) {
			socket.emit("error", "Карта не в коллекции");
			return;
		}
		const idx = s.selectedDeck.indexOf(cardId);
		if (idx >= 0) {
			s.selectedDeck.splice(idx, 1);
		} else {
			s.selectedDeck.push(cardId);
			if (s.selectedDeck.length > CARDS_PER_SIDE) s.selectedDeck.shift();
		}
		socket.emit("stateUpdate", getSessionState(sessionId));
	});

	// ═══ START BATTLE ═══
	socket.on("startBattle", () => {
		const s = sessions[sessionId];
		if (!s) return;
		if (s.selectedDeck.length !== CARDS_PER_SIDE) {
			socket.emit("error", "Выберите ровно 3 карты");
			return;
		}
		// Generate enemy deck from NPC pool
		const npcPool = ALL_CARDS.filter((c) => !s.selectedDeck.includes(c.id));
		const enemyDeck = shuffle(npcPool)
			.slice(0, CARDS_PER_SIDE)
			.map((c) => c.id);
		s.battle = seedBattle(s.selectedDeck, enemyDeck, s.cardUpgrades);
		s.battle.battleLog.push(
			'<span class="log-ability">⚔ Битва начинается!</span>',
		);
		socket.emit("stateUpdate", getSessionState(sessionId));

		// If AI goes first, trigger its turn with thinking delay
		if (!s.battle.isPlayerTurn) {
			const aiThinkMs = 3000 + Math.floor(Math.random() * 5000);
			console.log(`[ai] first turn, thinking for ${aiThinkMs}ms...`);
			setTimeout(() => {
				const battle = s.battle;
				if (!battle || battle.gameOver) return;
				try {
					executeAiTurn(battle, s.cardUpgrades);
				} catch (e) {
					console.error("[ai] first turn crashed:", e.message);
					battle.aiAction = null;
				}
				if (
					battle.enemyCards.every((c) => c.hp <= 0) ||
					battle.playerCards.every((c) => c.hp <= 0)
				) {
					endGame(
						battle,
						battle.enemyCards.every((c) => c.hp <= 0),
						s,
						socket,
						sessionId,
						s.userId,
					);
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
	});

	// ═══ PLAYER ACTION ═══
	socket.on("playerAction", (action) => {
		console.log(
			"[action]",
			action.type,
			"attackerIdx:",
			action.attackerIdx,
			"defenderIdx:",
			action.defenderIdx,
		);
		const s = sessions[sessionId];
		if (!s) {
			console.log("[action] no session");
			return;
		}
		const battle = s.battle;
		if (!battle || battle.gameOver || !battle.isPlayerTurn) {
			console.log(
				"[action] blocked: battle=",
				!!battle,
				"gameOver=",
				battle?.gameOver,
				"isPlayerTurn=",
				battle?.isPlayerTurn,
			);
			return;
		}
		battle.aiAction = null; // Safety: never leak old AI action into player turn stateUpdates

		const { type, attackerIdx, defenderIdx } = action;

		if (type === "endTurn") {
			console.log("[action] endTurn → executePlayerEndTurn");
			executePlayerEndTurn(s, socket, userId);
			return;
		}

		const attacker = battle.playerCards[attackerIdx];
		if (!attacker || attacker.hp <= 0) {
			console.log("[action] attacker dead/missing");
			return;
		}

		let actionResult = null;

		if (type === "attack") {
			actionResult = executeAttack(battle, attackerIdx, defenderIdx, true);
		} else if (type === "crit") {
			if (attacker.type !== "assa" || attacker.mana < 2) {
				console.log(
					"[crit] blocked: type=",
					attacker.type,
					"mana=",
					attacker.mana,
				);
				return;
			}
			if (battle.firstTurn) {
				console.log("[crit] blocked: firstTurn");
				return;
			}
			if (battle.abilitiesUsedThisTurn.includes(attackerIdx)) {
				console.log("[crit] blocked: ability already used");
				return;
			}
			// Taunt check only when actually selecting a target (not during activation)
			if (defenderIdx !== undefined) {
				const ignoreTaunt = attacker.baseId === "assa_03";
				if (!ignoreTaunt) {
					const taunter = battle.enemyCards.find(
						(e) => e.tauntActive && e.hp > 0,
					);
					if (taunter && defenderIdx !== battle.enemyCards.indexOf(taunter)) {
						console.log("[crit] blocked: taunt");
						return;
					}
				}
			}
			actionResult = executeCrit(battle, attackerIdx, defenderIdx);
			console.log("[crit] result:", actionResult?.type);
		} else if (type === "fireball") {
			if (attacker.type !== "mage") {
				console.log("[fireball] blocked: type=", attacker.type);
				return;
			}
			if (battle.firstTurn) {
				console.log("[fireball] blocked: firstTurn");
				return;
			}
			if (battle.abilitiesUsedThisTurn.includes(attackerIdx)) {
				console.log("[fireball] blocked: ability already used");
				return;
			}
			// Taunt check only when actually selecting a target (not during activation)
			if (defenderIdx !== undefined) {
				const taunter = battle.enemyCards.find(
					(e) => e.tauntActive && e.hp > 0,
				);
				if (taunter && defenderIdx !== battle.enemyCards.indexOf(taunter)) {
					console.log("[fireball] blocked: taunt");
					return;
				}
			}
			const cost = attacker.baseId === "mage_01" ? 2 : 3;
			if (attacker.mana < cost) {
				console.log("[fireball] blocked: mana=", attacker.mana, "need=", cost);
				return;
			}
			actionResult = executeFireball(
				battle,
				attackerIdx,
				defenderIdx,
				s.cardUpgrades,
			);
			console.log(
				"[fireball] result:",
				actionResult?.type,
				"defIdx:",
				defenderIdx,
			);
		} else if (type === "taunt") {
			if (attacker.type !== "tank" || attacker.mana < 2) return;
			if (battle.firstTurn) return;
			if (battle.abilitiesUsedThisTurn.includes(attackerIdx)) return;
			executeTaunt(battle, attackerIdx, s.cardUpgrades);
			battle.abilitiesUsedThisTurn.push(attackerIdx);
			battle.playerAction = {
				type: "taunt",
				attackerIdx,
				attackerName: attacker.name,
				hpHealed: attacker.baseId === "tank_05" ? 2 : 0,
			};
			// Taunt ends the player's turn immediately
			executePlayerEndTurn(s, socket, userId);
			return;
		}

		if (actionResult) {
			battle.playerAction = actionResult;
		}

		// Если способность только "активирована" (ждём выбор цели) — ход НЕ завершаем
		if (
			actionResult &&
			(actionResult.type === "crit_ready" ||
				actionResult.type === "fireball_ready")
		) {
			console.log(
				"[action] ability activated, NOT ending turn. type:",
				actionResult.type,
			);
			socket.emit("stateUpdate", getSessionState(sessionId));
			return;
		}

		// End of player action: auto-end turn
		console.log("[action] ending turn, actionResult:", actionResult?.type);
		executePlayerEndTurn(s, socket, userId);
	});

	// ═══ SURRENDER ═══
	socket.on("surrender", () => {
		const s = sessions[sessionId];
		if (!s) return;
		const battle = s.battle;
		if (!battle || battle.gameOver) return;

		const penalty = 20;
		s.playerGold = Math.max(0, s.playerGold - penalty);
		s.losses = (s.losses || 0) + 1;

		battle.gameOver = true;
		battle.isPlayerTurn = false;
		battle.gameEnd = { victory: false, reward: -penalty };
		battle.battleLog.push(
			`<span class="log-defeat">СДАЛСЯ! -${penalty} Remains</span>`,
		);

		// Сохраняем в БД
		if (userId) {
			saveBattleResult(
				userId,
				"loss",
				-penalty,
				battle.playerDeckIds || s.selectedDeck,
				battle.enemyDeckIds || [],
				battle.turnCount,
				battle.battleLog,
			).catch((e) => console.error("Battle save error:", e));
			savePlayerData(userId, s).catch((e) =>
				console.error("Player save error:", e),
			);
		}

		// Эмитим ДО очистки — клиент получит battle.gameEnd и покажет результат
		socket.emit("stateUpdate", getSessionState(sessionId));

		s.battle = null;
		s.selectedDeck = [];
		s.shopCards = eraDef();
	});

	// ═══ DISCONNECT ═══
	socket.on("disconnect", async () => {
		console.log(`[disconnect] ${sessionId}`);
		if (userId && sessions[sessionId]) {
			const s = sessions[sessionId];
			await savePlayerData(userId, s);
			// Держим сессию 2 минуты на случай реконнекта (F5)
			setTimeout(() => {
				if (sessions[sessionId] && sessions[sessionId].userId === userId)
					delete sessions[sessionId];
			}, 120000);
		}
	});
});

// ═══ GAME LOGIC ═══

function getSessionState(sessionId) {
	const s = sessions[sessionId];
	if (!s) return null;
	return {
		playerGold: s.playerGold,
		playerCollection: s.playerCollection,
		cardUpgrades: s.cardUpgrades,
		selectedDeck: s.selectedDeck,
		shopCards: s.shopCards.map((c) => ({ id: c.id, price: c.price })),
		battle: s.battle ? getBattleState(s.battle) : null,
	};
}

function getBattleState(b) {
	return {
		playerCards: b.playerCards.map((c) => ({ ...c })),
		enemyCards: b.enemyCards.map((c) => ({ ...c })),
		activeIdx: b.activeIdx,
		isPlayerTurn: b.isPlayerTurn,
		gameOver: b.gameOver,
		turnLocked: b.turnLocked,
		critActivated: b.critActivated,
		fireballActive: b.fireballActive,
		waitingForCritTarget: b.waitingForCritTarget,
		firstTurn: b.firstTurn,
		abilitiesUsedThisTurn: b.abilitiesUsedThisTurn,
		log: [...b.battleLog],
		playerAction: b.playerAction,
		aiAction: b.aiAction,
		gameEnd: b.gameEnd,
	};
}

function executeAttack(battle, attIdx, defIdx, _isPlayer) {
	const attacker = battle.playerCards[attIdx];
	const defender = battle.enemyCards[defIdx];
	if (!attacker || !defender || defender.hp <= 0) return null;

	const base = byId(attacker.baseId);
	const isCrit = false;

	// Taunt check (assa_03 crit ignores taunt — handled in playerAction, not here during regular attack)
	const taunter = battle.enemyCards.find((e) => e.tauntActive && e.hp > 0);
	if (taunter && defender.id !== taunter.id) return null;

	// Apply atkDebuff on attacker
	let effectiveAtk = attacker.atk;
	if (attacker.atkDebuff)
		effectiveAtk = Math.max(1, effectiveAtk - attacker.atkDebuff);

	let dmg = effectiveAtk;

	// assa_02: +2 урона целям <50% HP (все атаки, не только крит)
	if (attacker.baseId === "assa_02" && defender.hp < defender.maxHp * 0.5)
		dmg += 2;

	// Variance
	const variance = base.variance || 0;
	dmg = Math.max(
		1,
		Math.round(dmg * (1 - variance + Math.random() * variance * 2)),
	);

	// Tank armor passive (tank_01: only during taunt, tank_04: always)
	if (defender.type === "tank") {
		if (defender.baseId === "tank_04") dmg = Math.max(1, dmg - 1);
		else if (defender.baseId === "tank_01" && defender.tauntActive)
			dmg = Math.max(1, dmg - 1);
	}

	// Mage shield passive
	if (defender.type === "mage" && defender.baseId === "mage_05")
		dmg = Math.max(1, dmg - 1);

	// Tank cover passive — 5% шанс забрать атаку с соседа без урона
	let blocked = false;
	let blockMsg = "";
	const defNeighbors = [-1, 1]
		.map((o) => defIdx + o)
		.filter((i) => i >= 0 && i < battle.enemyCards.length);
	const coveringTankIdx = defNeighbors.find(
		(i) => battle.enemyCards[i].type === "tank" && battle.enemyCards[i].hp > 0,
	);
	if (coveringTankIdx !== undefined && Math.random() < 0.05) {
		dmg = 0;
		blocked = true;
		blockMsg = ` <span class="log-ability">(${battle.enemyCards[coveringTankIdx].name} прикрыл союзника)</span>`;
	}

	defender.hp = Math.max(0, defender.hp - dmg);
	const isDead = defender.hp <= 0;
	if (isDead) defender.alive = false;

	// Tank thorns (tank_02: only during taunt)
	if (
		defender.type === "tank" &&
		defender.baseId === "tank_02" &&
		defender.tauntActive
	) {
		attacker.hp -= 1;
		if (attacker.hp < 0) attacker.hp = 0;
	}

	// Tank rage passive (tank_03: recalculate from base each time, no stacking)
	if (
		attacker.type === "tank" &&
		attacker.baseId === "tank_03" &&
		attacker.hp < attacker.maxHp * 0.5
	) {
		attacker.atk = base.atk + 2;
	}

	// assa_04: +2 mana on kill
	if (attacker.baseId === "assa_04" && isDead) {
		attacker.mana = Math.min(attacker.mana + 2, 10);
	}

	// Assa splash
	let assaSplash = null;
	if (attacker.type === "assa" && Math.random() < 0.05) {
		const neighbors = [-1, 1]
			.map((o) => defIdx + o)
			.filter(
				(i) =>
					i >= 0 && i < battle.enemyCards.length && battle.enemyCards[i].hp > 0,
			);
		if (neighbors.length > 0) {
			const nIdx = neighbors[Math.floor(Math.random() * neighbors.length)];
			const splashDmg = Math.floor(dmg / 2);
			battle.enemyCards[nIdx].hp = Math.max(
				0,
				battle.enemyCards[nIdx].hp - splashDmg,
			);
			assaSplash = { neighborIdx: nIdx, damage: splashDmg };
		}
	}

	if (blocked)
		battle.battleLog.push(
			`<span class="log-ability">Прикрытие!</span> ${defender.name} защищён${blockMsg}`,
		);
	else
		battle.battleLog.push(
			`<span class="log-player">${attacker.name}</span> атакует <span class="log-enemy">${defender.name}</span> на <span class="log-dmg">${dmg}</span> урона${isDead ? ' <span class="log-death">[УБИТ]</span>' : ""}`,
		);
	if (assaSplash)
		battle.battleLog.push(
			`<span class="log-ability">Кровопускание!</span> <span class="log-dmg">${assaSplash.damage}</span> урона соседнему врагу`,
		);

	return {
		type: "attack",
		attackerIdx: attIdx,
		defenderIdx: defIdx,
		damage: dmg,
		isCrit,
		isDead,
		assaSplash,
		attackerName: attacker.name,
		defenderName: defender.name,
	};
}

function executeCrit(battle, attIdx, defIdx) {
	const attacker = battle.playerCards[attIdx];
	if (!defIdx && defIdx !== 0) {
		// No target yet - activate crit mode
		battle.critActivated = true;
		battle.waitingForCritTarget = attIdx;
		battle.battleLog.push(
			`<span class="log-ability">${attacker.name} готовит КРИТ-УДАР! Выбери цель.</span>`,
		);
		return {
			type: "crit_ready",
			attackerIdx: attIdx,
			attackerName: attacker.name,
		};
	}

	const defender = battle.enemyCards[defIdx];
	if (!defender || defender.hp <= 0) return null;

	const base = byId(attacker.baseId);
	let dmg = attacker.atk * 2;
	if (attacker.baseId === "assa_05") dmg = Math.round(attacker.atk * 2.5);

	// Bonus vs low HP (assa_02)
	if (attacker.baseId === "assa_02" && defender.hp < defender.maxHp * 0.5)
		dmg += 2;

	// Mana cost
	let manaCost = 2;
	if (attacker.baseId === "assa_01" && Math.random() < 0.3) manaCost = 1;
	attacker.mana -= manaCost;

	// Variance
	const variance = base.variance || 0;
	dmg = Math.max(
		1,
		Math.round(dmg * (1 - variance + Math.random() * variance * 2)),
	);

	// Tank armor / mage shield (defender passives)
	if (defender.type === "tank") {
		if (defender.baseId === "tank_04") dmg = Math.max(1, dmg - 1);
		else if (defender.baseId === "tank_01") dmg = Math.max(1, dmg - 1);
	}
	if (defender.type === "mage" && defender.baseId === "mage_05")
		dmg = Math.max(1, dmg - 1);

	// Tank cover passive — 5% шанс забрать атаку с соседа без урона
	let blocked = false;
	let blockMsg = "";
	const critNeighbors = [-1, 1]
		.map((o) => defIdx + o)
		.filter((i) => i >= 0 && i < battle.enemyCards.length);
	const critCoverTankIdx = critNeighbors.find(
		(i) => battle.enemyCards[i].type === "tank" && battle.enemyCards[i].hp > 0,
	);
	if (critCoverTankIdx !== undefined && Math.random() < 0.05) {
		dmg = 0;
		blocked = true;
		blockMsg = ` <span class="log-ability">(${battle.enemyCards[critCoverTankIdx].name} прикрыл союзника)</span>`;
	}

	defender.hp = Math.max(0, defender.hp - dmg);
	const isDead = defender.hp <= 0;

	// Tank thorns (tank_02)
	if (defender.type === "tank" && defender.baseId === "tank_02") {
		attacker.hp -= 1;
		if (attacker.hp < 0) attacker.hp = 0;
	}

	// assa_04: +2 mana on kill
	if (attacker.baseId === "assa_04" && isDead) {
		attacker.mana = Math.min(attacker.mana + 2, 10);
	}

	// Assa splash
	let assaSplash = null;
	if (Math.random() < 0.05) {
		const neighbors = [-1, 1]
			.map((o) => defIdx + o)
			.filter(
				(i) =>
					i >= 0 && i < battle.enemyCards.length && battle.enemyCards[i].hp > 0,
			);
		if (neighbors.length > 0) {
			const nIdx = neighbors[Math.floor(Math.random() * neighbors.length)];
			const splashDmg = Math.floor(dmg / 2);
			battle.enemyCards[nIdx].hp = Math.max(
				0,
				battle.enemyCards[nIdx].hp - splashDmg,
			);
			assaSplash = { neighborIdx: nIdx, damage: splashDmg };
		}
	}

	battle.abilitiesUsedThisTurn.push(attIdx);
	battle.critActivated = false;
	battle.waitingForCritTarget = null;

	if (blocked)
		battle.battleLog.push(
			`<span class="log-ability">Прикрытие!</span> ${defender.name} защищён${blockMsg}`,
		);
	else
		battle.battleLog.push(
			`<span class="log-player">${attacker.name}</span> наносит <span class="log-crit">КРИТ!</span> <span class="log-enemy">${defender.name}</span> на <span class="log-dmg">${dmg}</span> урона${isDead ? ' <span class="log-death">[УБИТ]</span>' : ""}`,
		);

	return {
		type: "crit",
		attackerIdx: attIdx,
		defenderIdx: defIdx,
		damage: dmg,
		isCrit: true,
		isDead,
		assaSplash,
		attackerName: attacker.name,
		defenderName: defender.name,
	};
}

function executeFireball(battle, attIdx, defIdx, cardUpgrades) {
	const attacker = battle.playerCards[attIdx];
	if (!defIdx && defIdx !== 0) {
		// No target yet - activate fireball mode
		battle.fireballActive = true;
		battle.battleLog.push(
			`<span class="log-ability">${attacker.name} готовит ОГНЕННЫЙ ШАР! Выбери цель.</span>`,
		);
		return {
			type: "fireball_ready",
			attackerIdx: attIdx,
			attackerName: attacker.name,
		};
	}

	const defender = battle.enemyCards[defIdx];
	if (!defender || defender.hp <= 0) return null;

	const base = byId(attacker.baseId);
	let dmg = attacker.atk + 2;

	// Psi-storm
	if (attacker.baseId === "mage_10" && attacker.hp < attacker.maxHp * 0.5)
		dmg += 2;

	// Bonus vs tanks
	if (attacker.baseId === "mage_07" && defender.type === "tank") dmg += 1;

	// Mana cost
	let manaCost = 3;
	if (attacker.baseId === "mage_01") manaCost = 2;
	if (attacker.baseId === "mage_11" && Math.random() < 0.4) manaCost = 1;
	attacker.mana -= manaCost;

	// mage_06: 30% шанс вернуть 1 ману
	if (attacker.baseId === "mage_06" && Math.random() < 0.3)
		attacker.mana = Math.min(
			attacker.mana + 1,
			getManaCap(attacker.baseId, cardUpgrades),
		);

	// Variance
	const variance = base.variance || 0;
	dmg = Math.max(
		1,
		Math.round(dmg * (1 - variance + Math.random() * variance * 2)),
	);

	// Tank armor / mage shield (defender passives)
	if (defender.type === "tank") {
		if (defender.baseId === "tank_04") dmg = Math.max(1, dmg - 1);
		else if (defender.baseId === "tank_01") dmg = Math.max(1, dmg - 1);
	}
	if (defender.type === "mage" && defender.baseId === "mage_05")
		dmg = Math.max(1, dmg - 1);

	// Tank cover passive — 5% шанс забрать атаку с соседа без урона
	let blocked = false;
	let blockMsg = "";
	const fbNeighbors = [-1, 1]
		.map((o) => defIdx + o)
		.filter((i) => i >= 0 && i < battle.enemyCards.length);
	const fbCoverTankIdx = fbNeighbors.find(
		(i) => battle.enemyCards[i].type === "tank" && battle.enemyCards[i].hp > 0,
	);
	if (fbCoverTankIdx !== undefined && Math.random() < 0.05) {
		dmg = 0;
		blocked = true;
		blockMsg = ` <span class="log-ability">(${battle.enemyCards[fbCoverTankIdx].name} прикрыл союзника)</span>`;
	}

	defender.hp = Math.max(0, defender.hp - dmg);
	const isDead = defender.hp <= 0;

	// Tank thorns (tank_02)
	if (defender.type === "tank" && defender.baseId === "tank_02") {
		attacker.hp -= 1;
		if (attacker.hp < 0) attacker.hp = 0;
	}

	// Curse debuff
	if (attacker.baseId === "mage_02")
		defender.atkDebuff = (defender.atkDebuff || 0) + 1;

	// Plague DOT
	if (attacker.baseId === "mage_04") defender.dotTurns = 2;

	// Heal on fireball
	if (attacker.baseId === "mage_03")
		attacker.hp = Math.min(attacker.maxHp, attacker.hp + 2);
	if (attacker.baseId === "mage_09" && isDead) {
		attacker.hp = Math.min(attacker.maxHp, attacker.hp + 2);
		attacker.mana = Math.min(
			getManaCap(attacker.baseId, cardUpgrades),
			attacker.mana + 1,
		);
	}

	// Steal mana (Пожиратель)
	if (attacker.baseId === "mage_08") {
		if (defender.mana > 0) {
			defender.mana--;
			attacker.mana = Math.min(
				getManaCap(attacker.baseId, cardUpgrades),
				attacker.mana + 1,
			);
		}
	}

	// Mage splash (Раскол)
	const mageSplashes = [];
	if (Math.random() < 0.05) {
		[-1, 1].forEach((o) => {
			const nIdx = defIdx + o;
			if (
				nIdx >= 0 &&
				nIdx < battle.enemyCards.length &&
				battle.enemyCards[nIdx].hp > 0
			) {
				const sDmg = rand(1, 3);
				battle.enemyCards[nIdx].hp = Math.max(
					0,
					battle.enemyCards[nIdx].hp - sDmg,
				);
				mageSplashes.push({ neighborIdx: nIdx, damage: sDmg });
			}
		});
	}

	battle.abilitiesUsedThisTurn.push(attIdx);
	battle.fireballActive = false;

	if (blocked)
		battle.battleLog.push(
			`<span class="log-ability">Прикрытие!</span> ${defender.name} защищён${blockMsg}`,
		);
	else
		battle.battleLog.push(
			`<span class="log-player">${attacker.name}</span> запускает <span class="log-ability">ОГНЕННЫЙ ШАР</span> в <span class="log-enemy">${defender.name}</span> на <span class="log-dmg">${dmg}</span> урона${isDead ? ' <span class="log-death">[УБИТ]</span>' : ""}`,
		);
	if (mageSplashes.length)
		mageSplashes.forEach((s) => {
			battle.battleLog.push(
				`<span class="log-ability">Раскол!</span> <span class="log-dmg">${s.damage}</span> урона соседнему врагу`,
			);
		});

	return {
		type: "fireball",
		attackerIdx: attIdx,
		defenderIdx: defIdx,
		damage: dmg,
		isCrit: false,
		isDead,
		mageSplashes: mageSplashes.length ? mageSplashes : undefined,
		attackerName: attacker.name,
		defenderName: defender.name,
	};
}

function executeTaunt(battle, attIdx, _cardUpgrades) {
	const attacker = battle.playerCards[attIdx];
	attacker.mana -= 2;
	attacker.tauntActive = true;

	// Regen passive
	if (attacker.baseId === "tank_05") {
		attacker.hp = Math.min(attacker.maxHp, attacker.hp + 2);
	}

	battle.battleLog.push(
		`<span class="log-player">${attacker.name}</span> использует <span class="log-ability">ПРОВОКАЦИЮ!</span>${attacker.baseId === "tank_05" ? " +2 HP" : ""}`,
	);
}

function executePlayerEndTurn(s, socket, userId) {
	const battle = s.battle;
	if (!battle || battle.gameOver) return;

	const sessionId = Object.keys(sessions).find((k) => sessions[k] === s);

	battle.isPlayerTurn = false;
	battle.turnLocked = true;
	battle.critActivated = false;
	battle.fireballActive = false;
	battle.waitingForCritTarget = null;
	battle.turnCount++;

	// DOT and debuff tick (player DOTs tick on enemy cards only)
	battle.enemyCards.forEach((c) => {
		if (c.dotTurns > 0) {
			c.hp = Math.max(0, c.hp - 1);
			c.dotTurns--;
			battle.battleLog.push(
				`<span class="log-enemy">${c.name}</span> получает <span class="log-dmg">1</span> урона от чумы`,
			);
		}
	});

	// Check if all enemies dead
	if (battle.enemyCards.every((c) => c.hp <= 0)) {
		endGame(battle, true, s, socket, sessionId, userId);
		return;
	}

	// Check if all players dead
	if (battle.playerCards.every((c) => c.hp <= 0)) {
		endGame(battle, false, s, socket, sessionId, userId);
		return;
	}

	// Emit state before AI turn
	battle.playerAction = battle.playerAction || { type: "end_turn" };
	battle.aiAction = null;
	socket.emit("stateUpdate", getSessionState(sessionId));
	battle.playerAction = null;

	// AI thinking delay: 3-8 seconds before executing turn
	const aiThinkMs = 3000 + Math.floor(Math.random() * 5000);
	console.log(`[ai] thinking for ${aiThinkMs}ms...`);
	setTimeout(() => {
		try {
			executeAiTurn(battle, s.cardUpgrades);
		} catch (e) {
			console.error("[ai] executeAiTurn crashed:", e.message);
			battle.aiAction = null;
			battle.battleLog.push(
				'<span class="log-ability">⚡ Противник колеблется...</span>',
			);
		}
		battle.battleLog.push(
			'<span class="log-ability">⚡ Противник завершил ход.</span>',
		);

		// Check game end after AI
		if (battle.enemyCards.every((c) => c.hp <= 0)) {
			endGame(battle, true, s, socket, sessionId, userId);
			return;
		}
		if (battle.playerCards.every((c) => c.hp <= 0)) {
			endGame(battle, false, s, socket, sessionId, userId);
			return;
		}

		// Start next player turn
		battle.isPlayerTurn = true;
		battle.turnLocked = false;
		battle.abilitiesUsedThisTurn = [];
		battle.firstTurn = false;
		battle.activeIdx = -1;

		// Clear taunts
		battle.playerCards.forEach((c) => {
			c.tauntActive = false;
		});
		battle.enemyCards.forEach((c) => {
			c.tauntActive = false;
		});

		// Update crit ready flags
		battle.playerCards.forEach((c) => {
			if (c.type === "assa" && c.mana >= 2) c.critReady = true;
		});

		battle.battleLog.push('<span class="log-ability">— Новый ход —</span>');
		socket.emit("stateUpdate", getSessionState(sessionId));
	}, aiThinkMs);
}

function executeAiTurn(battle, _cardUpgrades) {
	const aliveEnemies = battle.enemyCards.filter((c) => c.hp > 0);
	const alivePlayers = battle.playerCards.filter((c) => c.hp > 0);
	if (!aliveEnemies.length || !alivePlayers.length) return;

	// tank_03 rage passive: +2 ATK when HP < 50% (for AI tanks)
	aliveEnemies.forEach((e) => {
		if (e.baseId === "tank_03" && e.hp < e.maxHp * 0.5) {
			const base = byId(e.baseId);
			if (base) e.atk = base.atk + 2;
		}
	});

	// Find taunter (player card forcing AI to target it)
	const taunter = alivePlayers.find((c) => c.tauntActive);
	// Do we already have an active taunt on our own side this round?
	const ourTaunterActive = aliveEnemies.find((c) => c.tauntActive);

	// Helper: tank cover — 5% шанс сосед-танк заберёт атаку без урона
	const checkCover = (targetIdx, allTargets) => {
		const neighbors = [-1, 1]
			.map((o) => targetIdx + o)
			.filter(
				(i) => i >= 0 && i < allTargets.length && allTargets[i] !== undefined,
			);
		const coveringTankIdx = neighbors.find(
			(i) => allTargets[i].type === "tank" && allTargets[i].hp > 0,
		);
		if (coveringTankIdx !== undefined && Math.random() < 0.05) {
			return allTargets[coveringTankIdx].name;
		}
		return null;
	};

	// Helper: apply defender armor/shield/thorns (mutating — used on final execution)
	const applyDefense = (attackerRef, target, rawDmg) => {
		let dmg = rawDmg;
		if (target.type === "tank") {
			if (target.baseId === "tank_04") dmg = Math.max(1, dmg - 1);
			else if (target.baseId === "tank_01" && target.tauntActive)
				dmg = Math.max(1, dmg - 1);
		}
		if (target.type === "mage" && target.baseId === "mage_05")
			dmg = Math.max(1, dmg - 1);
		if (
			target.type === "tank" &&
			target.baseId === "tank_02" &&
			target.tauntActive
		) {
			attackerRef.hp -= 1;
			if (attackerRef.hp < 0) attackerRef.hp = 0;
		}
		target.hp = Math.max(0, target.hp - dmg);
		return dmg;
	};

	// ═══ STRATEGIC BRAIN ═══
	// Pure (non-mutating) estimate of the damage a given action would deal.
	const estimateRawDamage = (actor, actionType, target) => {
		let dmg;
		if (actionType === "attack") {
			dmg = actor.atk;
		} else if (actionType === "crit") {
			dmg = Math.round(actor.atk * 2);
			if (actor.baseId === "assa_05") dmg = Math.round(actor.atk * 2.5);
			if (actor.baseId === "assa_02" && target.hp < target.maxHp * 0.5)
				dmg += 2;
		} else {
			// fireball
			dmg = actor.atk + 2;
			if (actor.baseId === "mage_10" && actor.hp < actor.maxHp * 0.5) dmg += 2;
			if (actor.baseId === "mage_07" && target.type === "tank") dmg += 1;
		}
		if (target.type === "tank") {
			if (target.baseId === "tank_04") dmg = Math.max(1, dmg - 1);
			else if (target.baseId === "tank_01" && target.tauntActive)
				dmg = Math.max(1, dmg - 1);
		}
		if (target.type === "mage" && target.baseId === "mage_05")
			dmg = Math.max(1, dmg - 1);
		return dmg;
	};

	// How dangerous/valuable a target is to remove from play.
	const targetThreatValue = (t) => {
		let v = t.atk * 1.5;
		if (t.type === "assa") v += 4; // hits hard, high burst
		if (t.type === "mage") v += 3; // ranged burst + utility
		if (t.mana >= 2) v += 2; // has an ability ready right now
		return v;
	};

	// Score a specific (actor, actionType, target) combination.
	const scoreTargetForAction = (actor, actionType, target) => {
		const dmg = estimateRawDamage(actor, actionType, target);
		const lethal = dmg >= target.hp;
		let score = dmg;
		if (lethal) {
			// Killing a card outright is the single strongest move on the board.
			score += 15 + targetThreatValue(target);
		} else {
			// Reward chipping down already-wounded targets (sets up a kill next turn).
			score += Math.max(0, target.maxHp - (target.hp - dmg)) * 0.15;
		}
		score += targetThreatValue(target) * 0.3;
		// Slight discount if a neighboring tank could intercept the hit (5% chance).
		const idx = battle.playerCards.indexOf(target);
		const hasCoverNeighbor = [-1, 1].some((o) => {
			const n = battle.playerCards[idx + o];
			return n && n.hp > 0 && n.type === "tank";
		});
		if (hasCoverNeighbor) score *= 0.97;
		return score;
	};

	// Pick the best legal target for a given actor/action (respects taunt).
	const bestTargetFor = (actor, actionType) => {
		const ignoresTaunt = actionType === "crit" && actor.baseId === "assa_03";
		const candidates = taunter && !ignoresTaunt ? [taunter] : alivePlayers;
		let best = null;
		let bestScore = -Infinity;
		for (const t of candidates) {
			const sc = scoreTargetForAction(actor, actionType, t);
			if (sc > bestScore) {
				bestScore = sc;
				best = t;
			}
		}
		return { target: best, score: bestScore };
	};

	// Value of using Taunt right now for a given tank.
	const tauntValue = (actor) => {
		let v = 4;
		if (actor.baseId === "tank_04") v += 3; // permanent -1 dmg armor
		if (actor.baseId === "tank_01") v += 2; // -1 dmg while taunting
		if (actor.baseId === "tank_02") v += 2; // reflects damage
		if (actor.baseId === "tank_05") v += 3; // heals 2 HP on activation
		if (actor.hp < actor.maxHp * 0.5) v += 6; // self-preservation
		// Protect the most fragile ally if it looks like it could die soon.
		const weakestAlly = aliveEnemies
			.filter((e) => e !== actor)
			.sort((a, b) => a.hp - b.hp)[0];
		if (weakestAlly && weakestAlly.hp <= 6) v += 5;
		return v;
	};

	// Build every viable action this turn across all living enemy cards.
	const actions = [];
	for (const actor of aliveEnemies) {
		const actorIdx = battle.enemyCards.indexOf(actor);

		// Basic attack is always available.
		{
			const { target, score } = bestTargetFor(actor, "attack");
			if (target)
				actions.push({ actor, actorIdx, type: "attack", target, score });
		}

		if (!battle.firstTurn) {
			if (actor.type === "tank" && actor.mana >= 2 && !ourTaunterActive) {
				actions.push({
					actor,
					actorIdx,
					type: "taunt",
					target: null,
					score: tauntValue(actor),
				});
			} else if (actor.type === "assa" && actor.mana >= 2) {
				const { target, score } = bestTargetFor(actor, "crit");
				if (target)
					actions.push({ actor, actorIdx, type: "crit", target, score });
			} else if (actor.type === "mage") {
				const cost = actor.baseId === "mage_01" ? 2 : 3;
				if (actor.mana >= cost) {
					const { target, score } = bestTargetFor(actor, "fireball");
					if (target)
						actions.push({ actor, actorIdx, type: "fireball", target, score });
				}
			}
		}
	}

	if (!actions.length) return;

	// Small jitter to break ties between near-equal options without ever
	// overturning a clearly better (especially lethal) play.
	actions.forEach((a) => {
		a.score += Math.random() * 1.2;
	});
	actions.sort((a, b) => b.score - a.score);
	const { actor, actorIdx, type, target } = actions[0];

	let aiAction = null;

	if (type === "taunt") {
		actor.mana -= 2;
		actor.tauntActive = true;
		if (actor.baseId === "tank_05")
			actor.hp = Math.min(actor.maxHp, actor.hp + 2);
		battle.battleLog.push(
			`<span class="log-enemy">${actor.name}</span> использует <span class="log-ability">ПРОВОКАЦИЮ!</span>`,
		);
		aiAction = { type: "taunt", actorIdx, targetIdx: null, damage: 0 };
	} else if (type === "crit") {
		const tIdx = battle.playerCards.indexOf(target);
		let dmg = Math.round(actor.atk * 2);
		if (actor.baseId === "assa_05") dmg = Math.round(actor.atk * 2.5);
		if (actor.baseId === "assa_02" && target.hp < target.maxHp * 0.5) dmg += 2;
		const coverName = checkCover(tIdx, battle.playerCards);
		if (coverName) {
			dmg = 0;
			actor.mana -= 2;
			if (actor.baseId === "assa_01" && Math.random() < 0.3)
				actor.mana = Math.min(actor.mana + 1, 10);
			battle.battleLog.push(
				`<span class="log-enemy">${actor.name}</span> <span class="log-crit">КРИТ</span> — <span class="log-ability">${coverName} прикрыл союзника!</span>`,
			);
			aiAction = {
				type: "crit",
				actorIdx,
				targetIdx: tIdx,
				damage: 0,
				isCrit: true,
				isDead: false,
				attackerName: actor.name,
				defenderName: target.name,
			};
		} else {
			dmg = applyDefense(actor, target, dmg);
			actor.mana -= 2;
			if (actor.baseId === "assa_01" && Math.random() < 0.3)
				actor.mana = Math.min(actor.mana + 1, 10);
			const isDead = target.hp <= 0;
			if (actor.baseId === "assa_04" && isDead)
				actor.mana = Math.min(actor.mana + 2, 10);
			let splashText = "";
			if (Math.random() < 0.05) {
				const others = alivePlayers.filter((c) => c !== target);
				if (others.length > 0) {
					const s = others[Math.floor(Math.random() * others.length)];
					const sDmg = Math.floor(dmg / 2);
					s.hp = Math.max(0, s.hp - sDmg);
					splashText = ` <span class="log-ability">(+ ${sDmg} splash)</span>`;
				}
			}
			battle.battleLog.push(
				`<span class="log-enemy">${actor.name}</span> <span class="log-crit">КРИТ</span> по <span class="log-player">${target.name}</span> на <span class="log-dmg">${dmg}</span>${isDead ? ' <span class="log-death">[УБИТ]</span>' : ""}${splashText}`,
			);
			aiAction = {
				type: "crit",
				actorIdx,
				targetIdx: tIdx,
				damage: dmg,
				isCrit: true,
				isDead,
				attackerName: actor.name,
				defenderName: target.name,
			};
		}
	} else if (type === "fireball") {
		const tIdx = battle.playerCards.indexOf(target);
		let dmg = actor.atk + 2;
		if (actor.baseId === "mage_10" && actor.hp < actor.maxHp * 0.5) dmg += 2;
		if (actor.baseId === "mage_07" && target.type === "tank") dmg += 1;
		const cost = actor.baseId === "mage_01" ? 2 : 3;
		const coverName = checkCover(tIdx, battle.playerCards);
		if (coverName) {
			dmg = 0;
			actor.mana -= cost;
			battle.battleLog.push(
				`<span class="log-enemy">${actor.name}</span> <span class="log-ability">ОГНЕННЫЙ ШАР</span> — <span class="log-ability">${coverName} прикрыл союзника!</span>`,
			);
			aiAction = {
				type: "fireball",
				actorIdx,
				targetIdx: tIdx,
				damage: 0,
				isCrit: false,
				isDead: false,
				attackerName: actor.name,
				defenderName: target.name,
			};
		} else {
			dmg = applyDefense(actor, target, dmg);
			actor.mana -= cost;
			const isDead = target.hp <= 0;
			if (actor.baseId === "mage_02")
				target.atkDebuff = (target.atkDebuff || 0) + 1;
			if (actor.baseId === "mage_03")
				actor.hp = Math.min(actor.maxHp, actor.hp + 2);
			if (actor.baseId === "mage_04") target.dotTurns = 2;
			if (actor.baseId === "mage_06" && Math.random() < 0.3)
				actor.mana = Math.min(actor.mana + 1, 10);
			if (actor.baseId === "mage_08") {
				target.mana = Math.max(0, target.mana - 1);
				actor.mana = Math.min(10, actor.mana + 1);
			}
			if (actor.baseId === "mage_09" && isDead) {
				actor.hp = Math.min(actor.maxHp, actor.hp + 2);
				actor.mana = Math.min(10, actor.mana + 1);
			}
			let splashText = "";
			if (Math.random() < 0.05) {
				const others = alivePlayers.filter((c) => c !== target);
				if (others.length > 0) {
					const s = others[Math.floor(Math.random() * others.length)];
					const sDmg = 1 + Math.floor(Math.random() * 3);
					s.hp = Math.max(0, s.hp - sDmg);
					splashText = ` <span class="log-ability">(+ ${sDmg} splash)</span>`;
				}
			}
			battle.battleLog.push(
				`<span class="log-enemy">${actor.name}</span> <span class="log-ability">ОГНЕННЫЙ ШАР</span> в <span class="log-player">${target.name}</span> на <span class="log-dmg">${dmg}</span>${isDead ? ' <span class="log-death">[УБИТ]</span>' : ""}${splashText}`,
			);
			aiAction = {
				type: "fireball",
				actorIdx,
				targetIdx: tIdx,
				damage: dmg,
				isCrit: false,
				isDead,
				attackerName: actor.name,
				defenderName: target.name,
			};
		}
	} else {
		// basic attack
		const tIdx = battle.playerCards.indexOf(target);
		let dmg = actor.atk;
		const coverName = checkCover(tIdx, battle.playerCards);
		if (coverName) {
			dmg = 0;
			battle.battleLog.push(
				`<span class="log-enemy">${actor.name}</span> атакует — <span class="log-ability">${coverName} прикрыл союзника!</span>`,
			);
			aiAction = {
				type: "attack",
				actorIdx,
				targetIdx: tIdx,
				damage: 0,
				isCrit: false,
				isDead: false,
				attackerName: actor.name,
				defenderName: target.name,
			};
		} else {
			dmg = applyDefense(actor, target, dmg);
			const isDead = target.hp <= 0;
			if (actor.baseId === "assa_04" && isDead)
				actor.mana = Math.min(actor.mana + 2, 10);
			let splashText = "";
			if (actor.type === "assa" && Math.random() < 0.05) {
				const others = alivePlayers.filter((c) => c !== target);
				if (others.length > 0) {
					const s = others[Math.floor(Math.random() * others.length)];
					const sDmg = Math.floor(dmg / 2);
					s.hp = Math.max(0, s.hp - sDmg);
					splashText = ` <span class="log-ability">(+ ${sDmg} splash)</span>`;
				}
			}
			battle.battleLog.push(
				`<span class="log-enemy">${actor.name}</span> атакует <span class="log-player">${target.name}</span> на <span class="log-dmg">${dmg}</span>${isDead ? ' <span class="log-death">[УБИТ]</span>' : ""}${splashText}`,
			);
			aiAction = {
				type: "attack",
				actorIdx,
				targetIdx: tIdx,
				damage: dmg,
				isCrit: false,
				isDead,
				attackerName: actor.name,
				defenderName: target.name,
			};
		}
	}

	battle.aiAction = aiAction;
}

function endGame(battle, victory, s, socket, sessionId, userId) {
	battle.gameOver = true;
	battle.isPlayerTurn = false;

	const reward = victory
		? BASE_REWARD + Math.floor(Math.random() * 30) + battle.turnCount * 2
		: 0;
	if (victory) {
		s.playerGold += reward;
		s.wins = (s.wins || 0) + 1;
		battle.battleLog.push(
			`<span class="log-victory">ПОБЕДА! +${reward} Remains</span>`,
		);
	} else {
		s.losses = (s.losses || 0) + 1;
		battle.battleLog.push(
			'<span class="log-defeat">ПОРАЖЕНИЕ! Все воины пали.</span>',
		);
	}

	battle.gameEnd = { victory, reward };

	// Save battle result
	if (userId) {
		saveBattleResult(
			userId,
			victory ? "win" : "loss",
			reward,
			battle.playerDeckIds || s.selectedDeck,
			battle.enemyDeckIds || [],
			battle.turnCount,
			battle.battleLog,
		).catch((e) => console.error("Battle save error:", e));
		// Save player data
		savePlayerData(userId, s).catch((e) =>
			console.error("Player save error:", e),
		);
	}

	// Эмитим ДО очистки — клиент получит gameEnd и покажет результат
	socket.emit("stateUpdate", getSessionState(sessionId));

	s.battle = null;
	s.selectedDeck = [];
	s.shopCards = eraDef();
}

// ═══ START ═══
const PORT = process.env.PORT || 3000;
SERVER.listen(PORT, "0.0.0.0", () => {
	console.log(`[server] Triad Duel running on 0.0.0.0:${PORT}`);
	// Set Telegram bot webhook
	const webhookUrl = `${process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`}/bot/webhook`;
	if (TELEGRAM_BOT_TOKEN) {
		const https = require("node:https");
		const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}`;
		https
			.get(url, (res) => {
				let data = "";
				res.on("data", (chunk) => (data += chunk));
				res.on("end", () => {
					try {
						console.log("[webhook]", JSON.parse(data).description || data);
					} catch {
						console.log("[webhook]", data);
					}
				});
			})
			.on("error", (e) => console.error("[webhook fail]", e.message));
	}
});
