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
const WEBHOOK_SECRET =
	process.env.TELEGRAM_WEBHOOK_SECRET || crypto.randomBytes(24).toString("hex");
if (!process.env.TELEGRAM_WEBHOOK_SECRET) {
	console.warn(
		"[security] TELEGRAM_WEBHOOK_SECRET не задан в env — сгенерирован временный секрет. " +
		"На проде ОБЯЗАТЕЛЬНО зафиксируйте его в переменных окружения, иначе он будет меняться при каждом рестарте.",
	);
}
if (!process.env.JWT_SECRET) {
	console.warn(
		"[security] JWT_SECRET не задан в env — сгенерирован временный секрет. " +
		"Это разлогинит всех игроков при каждом рестарте сервера. Зафиксируйте JWT_SECRET на проде.",
	);
}
const JWT_SECRET =
	process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex");

// ═══ PREMIUM (Telegram Stars) ═══
const PREMIUM_PRICE_STARS = 149; // цена в Telegram Stars (XTR)
const PREMIUM_DURATION_DAYS = 7;
const PREMIUM_TEST_MODE = false; // true = бесплатный премиум без оплаты (для тестов)

function tgApiRequest(method, payload) {
	return new Promise((resolve, reject) => {
		if (!TELEGRAM_BOT_TOKEN) return reject(new Error("no bot token"));
		const https = require("node:https");
		const body = JSON.stringify(payload);
		const req = https.request(
			{
				hostname: "api.telegram.org",
				path: `/bot${TELEGRAM_BOT_TOKEN}/${method}`,
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Content-Length": Buffer.byteLength(body),
				},
			},
			(res) => {
				let raw = "";
				res.on("data", (c) => (raw += c));
				res.on("end", () => {
					try {
						resolve(JSON.parse(raw));
					} catch (e) {
						reject(e);
					}
				});
			},
		);
		req.on("error", reject);
		req.write(body);
		req.end();
	});
}

function isPremiumActive(s) {
	return !!(
		s &&
		s.premiumUntil &&
		new Date(s.premiumUntil).getTime() > Date.now()
	);
}

// ═══ MMR (уровень игрока для матчмейкинга) ═══
function calcMMR(s) {
	if (!s) return 0;
	const upgradesTotal = Object.values(s.cardUpgrades || {}).reduce(
		(sum, up) => sum + (up.hp || 0) + (up.atk || 0) + (up.mana || 0),
		0,
	);
	const collectionCount = (s.playerCollection || []).length;
	const combatPower =
		(s.wins || 0) * 100 +
		(s.losses || 0) * 20 +
		Math.max(0, collectionCount - 3) * 25 +
		upgradesTotal * 40;
	const premiumMult = isPremiumActive(s) ? 1.5 : 1.0;
	const score = combatPower * premiumMult;
	return Math.floor(Math.sqrt(score / 100));
}

function getMMRRange(mmr) {
	if (mmr <= 3) return 1;
	if (mmr <= 9) return 2;
	if (mmr <= 19) return 4;
	return 6;
}

// Начисляет премиум игроку по его Telegram ID (совпадает с kart_players.telegram_id).
// Если премиум уже активен — продлевает от текущей даты окончания, иначе от "сейчас".
async function grantPremium(telegramId) {
	const { data } = await supabase
		.from("kart_players")
		.select("id, premium_until")
		.eq("telegram_id", telegramId)
		.single();
	if (!data) return null;
	const now = Date.now();
	const currentUntil = data.premium_until
		? new Date(data.premium_until).getTime()
		: 0;
	const base = currentUntil > now ? currentUntil : now;
	const newUntil = new Date(
		base + PREMIUM_DURATION_DAYS * 24 * 60 * 60 * 1000,
	).toISOString();
	await supabase
		.from("kart_players")
		.update({ premium_until: newUntil })
		.eq("id", data.id);
	// Обновляем все активные сессии этого игрока и уведомляем клиент(ы)
	for (const key of Object.keys(sessions)) {
		if (Number(sessions[key].tgUser?.id) !== Number(telegramId)) continue;
		sessions[key].premiumUntil = newUntil;
		const sock = IO.sockets.sockets.get(key);
		if (sock && sock.connected) {
			sock.emit("premiumStatus", { premiumUntil: newUntil, active: true });
		}
	}
	return newUntil;
}

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

// ═══ MINI APP AUTH ═══
function verifyMiniAppInitData(initData) {
	if (!TELEGRAM_BOT_TOKEN || !initData) return null;
	try {
		const params = new URLSearchParams(initData);
		const hash = params.get("hash");
		if (!hash) return null;
		params.delete("hash");

		// Build data-check-string (sorted alphabetically by key)
		const checkString = Array.from(params.entries())
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([k, v]) => `${k}=${v}`)
			.join("\n");

		// Secret = HMAC-SHA256("WebAppData", bot_token)
		const secret = crypto
			.createHmac("sha256", "WebAppData")
			.update(TELEGRAM_BOT_TOKEN)
			.digest();

		// Hash = HMAC-SHA256(secret, checkString)
		const calculatedHash = crypto
			.createHmac("sha256", secret)
			.update(checkString)
			.digest("hex");

		const hashBuffer = Buffer.from(hash, "hex");
		const calculatedBuffer = Buffer.from(calculatedHash, "hex");
		if (hashBuffer.length !== calculatedBuffer.length) return null;
		if (!crypto.timingSafeEqual(hashBuffer, calculatedBuffer)) return null;

		// Parse user JSON from initData
		const userStr = params.get("user");
		if (!userStr) return null;
		return {
			user: JSON.parse(userStr),
			startParam: params.get("start_param") || null,
		};
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
function resolveAuthCode(code, telegramId, tgUser) {
	if (!authCodes.has(code)) return false;
	authCodes.set(code, { telegramId, tgUser, createdAt: Date.now() });
	return true;
}
function getAuthCodeInfo(code) {
	const entry = authCodes.get(code);
	if (!entry?.telegramId) return null;
	authCodes.delete(code);
	return { telegramId: entry.telegramId, tgUser: entry.tgUser };
}

// ═══ REFERRALS ═══
const REFERRAL_REWARD_GOLD = 100; // бонус и пригласившему, и приглашённому
const REFERRAL_DAILY_CAP = 10; // макс. наград за 24ч на одного пригласившего (анти-фрод)

// ═══ CONSTANTS ═══
const CARDS_PER_SIDE = 3;
const _SHOP_SIZE = 12;
const MAX_MANA = 10;
const BASE_REWARD = 50;
const FIRST_TURN_MANA = 2;
const MATCHMAKING_TIMEOUT_WITH_PLAYERS_MS = 30000;
const MATCHMAKING_MIN_NO_PLAYERS_MS = 3000;
const MATCHMAKING_MAX_NO_PLAYERS_MS = 10000;
const PVP_TURN_TIMEOUT_MS = 45000;
const PVP_RECONNECT_GRACE_MS = 30000;

// ═══ BOT POOL ═══
const BOT_POOL = [
	{ name: "Зиновий", avatar: "img/ava-bot/zinoviy.png" },
	{ name: "ИланМакс", avatar: "img/ava-bot/ilanmaks.png" },
	{ name: "Рональдо", avatar: "img/ava-bot/ronaldo.png" },
	{ name: "ГрязныйГари", avatar: "img/ava-bot/gary.png" },
	{ name: "Маратустра", avatar: "img/ava-bot/maratustra.png" },
];

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

const ALLOWED_ORIGINS = [
	"http://localhost:3000",
	"http://127.0.0.1:3000",
	"https://triad-duel.pages.dev",
	"https://traekart1cdn.vercel.app",
];

const APP = express();
APP.set("trust proxy", 1); // Render/большинство PaaS стоят за прокси — без этого req.ip будет одинаковым для всех
const SERVER = http.createServer(APP);
const IO = new Server(SERVER, {
	cors: {
			origin: ALLOWED_ORIGINS,
			methods: ["GET", "POST"],
		},
});

APP.use(express.static(path.join(__dirname, "public")));
APP.use(express.json());
APP.use((req, res, next) => {
	const origin = req.headers.origin;
	if (origin && ALLOWED_ORIGINS.includes(origin)) {
		res.setHeader("Access-Control-Allow-Origin", origin);
	}
	res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
	res.setHeader("Access-Control-Allow-Headers", "Content-Type");
	if (req.method === "OPTIONS") return res.sendStatus(200);
	next();
});

// ═══ RATE LIMITING (без внешних зависимостей) ═══
// Скользящее окно в памяти процесса. Для одного инстанса этого достаточно;
// если сервер масштабируется на несколько инстансов — заменить на Redis.
function makeRateLimiter({ windowMs, max }) {
	const hits = new Map();
	return function isAllowed(key) {
		const now = Date.now();
		const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
		arr.push(now);
		hits.set(key, arr);
		if (hits.size > 20000) {
			for (const [k, v] of hits) {
				if (v.every((t) => now - t > windowMs)) hits.delete(k);
			}
		}
		return arr.length <= max;
	};
}

// HTTP: не больше 20 попыток поллинга авторизации в минуту с одного IP
const authPollRateLimiter = makeRateLimiter({ windowMs: 60_000, max: 20 });
// Socket.IO: не больше 15 "чувствительных" действий за 10 секунд с одного сокета
const socketActionRateLimiter = makeRateLimiter({ windowMs: 10_000, max: 15 });
const RATE_LIMITED_EVENTS = new Set([
	"buyCard",
	"upgradeCard",
	"buyPremium",
	"updateDeck",
	"startBattle",
	"findMatch",
	"playerAction",
	"pvpAction",
	"getReferralStats",
	"trackEvent",
]);

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
	if (data) return { player: data, isNew: false };
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
		premium_until: null,
	};
	const { error } = await supabase.from("kart_players").insert(defaults);
	if (error) {
		console.error("Failed to create player:", error.message);
		return { player: defaults, isNew: true };
	}
	return { player: defaults, isNew: true };
}

// Записывает связь "пригласивший → приглашённый", если приглашённый действительно новый
// и ещё никогда не был привязан ни к кому (unique constraint в БД подстрахует от гонки).
async function recordReferralIfNew(inviterTelegramId, inviteeTelegramId) {
	if (!inviterTelegramId || inviterTelegramId === inviteeTelegramId) return;
	const { data: inviter } = await supabase
		.from("kart_players")
		.select("id")
		.eq("telegram_id", inviterTelegramId)
		.single();
	if (!inviter) return; // ссылка на несуществующего/битого inviter'а — игнорируем
	const { error } = await supabase.from("kart_referrals").insert({
		inviter_telegram_id: inviterTelegramId,
		invitee_telegram_id: inviteeTelegramId,
	});
	if (error && error.code !== "23505") {
		// 23505 = unique_violation, т.е. этот invitee уже был кем-то привязан раньше — это нормально
		console.error("[referral] insert error:", error.message);
	} else if (!error) {
		console.log(`[referral] tg${inviteeTelegramId} приглашён tg${inviterTelegramId}`);
	}
}

// Начисляет золото игроку в БД и, если он сейчас онлайн, обновляет его активную сессию и шлёт событие в клиент
// ═══ ANALYTICS ═══
// Простое логирование событий в БД. Никогда не бросает исключение наружу —
// сбой аналитики не должен ломать игровой процесс.
function logEvent(telegramId, event, payload) {
	supabase
		.from("kart_events")
		.insert({ telegram_id: telegramId ? String(telegramId) : null, event, payload: payload || {} })
		.then(({ error }) => {
			if (error) console.error("[analytics] log error:", error.message);
		});
}

async function creditGold(telegramId, amount) {
	const { data } = await supabase
		.from("kart_players")
		.select("id, gold")
		.eq("telegram_id", telegramId)
		.single();
	if (!data) return;
	const newGold = (data.gold || 0) + amount;
	await supabase.from("kart_players").update({ gold: newGold }).eq("id", data.id);

	for (const key of Object.keys(sessions)) {
		if (String(sessions[key].userId) !== String(telegramId)) continue;
		sessions[key].playerGold = newGold;
		const sock = IO.sockets.sockets.get(key);
		if (sock && sock.connected) {
			sock.emit("referralReward", { amount, gold: newGold });
			sock.emit("stateUpdate", getSessionState(key));
		}
	}
}

// Проверяет, есть ли для этого игрока неоплаченная реферальная связь, и если да —
// с учётом дневного лимита начисляет награду обоим (пригласившему и приглашённому)
async function grantReferralRewardIfEligible(inviteeTelegramId) {
	const { data: ref } = await supabase
		.from("kart_referrals")
		.select("*")
		.eq("invitee_telegram_id", inviteeTelegramId)
		.eq("rewarded", false)
		.single();
	if (!ref) return null;

	const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
	const { count } = await supabase
		.from("kart_referrals")
		.select("id", { count: "exact", head: true })
		.eq("inviter_telegram_id", ref.inviter_telegram_id)
		.eq("rewarded", true)
		.gte("rewarded_at", since);
	if ((count || 0) >= REFERRAL_DAILY_CAP) {
		console.warn(`[referral] дневной лимит наград исчерпан для tg${ref.inviter_telegram_id}`);
		return null;
	}

	await supabase
		.from("kart_referrals")
		.update({ rewarded: true, rewarded_at: new Date().toISOString() })
		.eq("id", ref.id);

	await creditGold(ref.inviter_telegram_id, REFERRAL_REWARD_GOLD);
	await creditGold(inviteeTelegramId, REFERRAL_REWARD_GOLD);
	console.log(`[referral] награда выдана: tg${ref.inviter_telegram_id} <-> tg${inviteeTelegramId}`);

	return { inviterTelegramId: ref.inviter_telegram_id };
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
			premium_until: data.premiumUntil || null,
			updated_at: new Date().toISOString(),
		})
		.eq("telegram_id", userId);
	if (error) console.error("Failed to save player:", error.message);
	else console.log("[db] player saved:", userId, "gold:", data.playerGold);
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
		name: base.name,
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
	const playerCards = buildDeckCards(playerDeckIds, cardUpgrades);
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

function getFireballCost(attacker) {
	return 2;
}

function buildDeckCards(deckIds, cardUpgrades) {
	return deckIds.map((id) => {
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
}

// ═══ PVE BATTLE ═══
function beginPveBattle(s, socket, sessionId) {
	if (s.selectedDeck.length !== CARDS_PER_SIDE) {
		socket.emit("error", "Выберите ровно 3 карты");
		return;
	}
	const npcPool = ALL_CARDS.filter((c) => !s.selectedDeck.includes(c.id));
	const enemyDeck = shuffle(npcPool)
		.slice(0, CARDS_PER_SIDE)
		.map((c) => c.id);
	const bot = BOT_POOL[Math.floor(Math.random() * BOT_POOL.length)];
	s.battle = seedBattle(s.selectedDeck, enemyDeck, s.cardUpgrades);
	s.battle.enemyName = bot.name;
	s.battle.enemyAvatar = bot.avatar;
	socket.emit("stateUpdate", getSessionState(sessionId));

	if (!s.battle.isPlayerTurn) {
		const aiThinkMs = 3000 + Math.floor(Math.random() * 5000);
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
			battle.aiAction = null;
			socket.emit("stateUpdate", getSessionState(sessionId));
		}, aiThinkMs);
	}
}

// ═══ PVP ═══
const pvpRooms = {};
const matchQueue = [];

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
		tgUser: s.tgUser || null,
		premiumUntil: s.premiumUntil || null,
		mmr: calcMMR(s),
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
			battle: {
				...shared,
				playerCards: b.cardsA,
				enemyCards: b.cardsB,
				isPlayerTurn: b.turnOwner === "A",
			},
		});
	}
	if (room.sideB.socket.connected) {
		room.sideB.socket.emit("stateUpdate", {
			...getSessionShellState(room.sideB.sessionId),
			battle: {
				...shared,
				playerCards: b.cardsB,
				enemyCards: b.cardsA,
				isPlayerTurn: b.turnOwner === "B",
			},
		});
	}
}

function armTurnTimer(roomId) {
	const room = pvpRooms[roomId];
	if (!room) return;
	clearTimeout(room.turnTimer);
	room.turnTimer = setTimeout(() => {
		if (!pvpRooms[roomId] || room.battle.gameOver) return;
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

	for (const c of battle.enemyCards) {
		if (c.dotTurns > 0) {
			c.hp = Math.max(0, c.hp - 1);
			c.dotTurns--;
			battle.battleLog.push(
				`<span class="log-enemy">${c.name}</span> получает <span class="log-dmg">1</span> урона от чумы`,
			);
		}
	}

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

	// Clear taunt from the side whose turn is about to start (their taunt already lasted a full round)
	for (const c of battle.playerCards) c.tauntActive = false;
	for (const c of battle.playerCards) {
		if (c.type === "assa" && c.mana >= 2) c.critReady = true;
	}

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

	const baseReward =
		BASE_REWARD + Math.floor(Math.random() * 30) + battle.turnCount * 2;
	const sides = { A: room.sideA, B: room.sideB };
	const rewards = { A: 0, B: 0 };

	for (const side of ["A", "B"]) {
		const p = sides[side];
		const sess = sessions[p.sessionId];
		const won = side === winnerSide;
		const reward =
			won && isPremiumActive(sess) ? baseReward * 2 : won ? baseReward : 0;
		rewards[side] = reward;
		if (sess) {
			sess.pvpRoomId = null;
			if (won) {
				sess.playerGold += reward;
				sess.wins = (sess.wins || 0) + 1;
			} else {
				sess.losses = (sess.losses || 0) + 1;
			}
		}
		if (p.userId) {
			saveBattleResult(
				p.userId,
				won ? "win" : "loss",
				won ? reward : 0,
				side === "A" ? battle.deckIdsA : battle.deckIdsB,
				side === "A" ? battle.deckIdsB : battle.deckIdsA,
				battle.turnCount,
				battle.battleLog,
			).catch((e) => console.error("PvP save error:", e.message));
			if (sess)
				savePlayerData(p.userId, sess).catch((e) =>
					console.error("Player save error:", e.message),
				);
		}
	}

	battle.battleLog.push(
		reason === "opponent_disconnected"
			? '<span class="log-victory">Соперник отключился — техпобеда!</span>'
			: '<span class="log-victory">Бой окончен!</span>',
	);

	const shared = {
		activeIdx: battle.activeIdx,
		gameOver: true,
		turnLocked: true,
		critActivated: false,
		fireballActive: false,
		waitingForCritTarget: null,
		firstTurn: battle.firstTurn,
		abilitiesUsedThisTurn: battle.abilitiesUsedThisTurn,
		log: [...battle.battleLog],
		playerAction: null,
		aiAction: null,
		isPlayerTurn: false,
		isPvp: true,
	};
	if (room.sideA.socket.connected) {
		room.sideA.socket.emit("stateUpdate", {
			...getSessionShellState(room.sideA.sessionId),
			battle: {
				...shared,
				playerCards: battle.cardsA,
				enemyCards: battle.cardsB,
				gameEnd: {
					victory: winnerSide === "A",
					reward: rewards.A,
					reason,
				},
			},
		});
	}
	if (room.sideB.socket.connected) {
		room.sideB.socket.emit("stateUpdate", {
			...getSessionShellState(room.sideB.sessionId),
			battle: {
				...shared,
				playerCards: battle.cardsB,
				enemyCards: battle.cardsA,
				gameEnd: {
					victory: winnerSide === "B",
					reward: rewards.B,
					reason,
				},
			},
		});
	}

	for (const p of [room.sideA, room.sideB]) {
		const sess = sessions[p.sessionId];
		if (sess) {
			sess.battle = null;
			sess.selectedDeck = [];
			sess.shopCards = eraDef();
		}
	}
	delete pvpRooms[roomId];
}

function createPvpRoom(p1, p2) {
	const roomId = crypto.randomBytes(8).toString("hex");
	const battle = seedPvpBattle(
		p1.deckIds,
		p1.cardUpgrades,
		p2.deckIds,
		p2.cardUpgrades,
	);
	syncPvpSide(battle);
	pvpRooms[roomId] = {
		battle,
		sideA: p1,
		sideB: p2,
		turnTimer: null,
		disconnectTimer: null,
	};
	if (sessions[p1.sessionId]) sessions[p1.sessionId].pvpRoomId = roomId;
	if (sessions[p2.sessionId]) sessions[p2.sessionId].pvpRoomId = roomId;
	emitPvpState(roomId);
	armTurnTimer(roomId);
}

function countOnlinePlayers(excludeUserId) {
	const ids = new Set();
	for (const key of Object.keys(sessions)) {
		const sess = sessions[key];
		if (!sess.userId || sess.userId === excludeUserId) continue;
		const sock = IO.sockets.sockets.get(key);
		if (sock && sock.connected) ids.add(sess.userId);
	}
	return ids.size;
}

function tryMatch() {
	console.log(`[match] tryMatch queue=${matchQueue.length}`);
	while (matchQueue.length >= 2) {
		// Пропускаем мёртвые записи (сокет отключился до матча)
		while (matchQueue.length && !matchQueue[0].socket.connected)
			matchQueue.shift();
		if (matchQueue.length < 2) break;

		const p1 = matchQueue[0];
		const range = getMMRRange(p1.mmr);
		// Ищем первого совместимого по MMR
		let p2Idx = -1;
		for (let i = 1; i < matchQueue.length; i++) {
			const p = matchQueue[i];
			if (!p.socket.connected) { matchQueue.splice(i, 1); i--; continue; }
			if (Math.abs(p1.mmr - p.mmr) <= range) { p2Idx = i; break; }
		}
		if (p2Idx < 0) break; // нет совместимых — ждём расширения или таймаута
		
		const p2 = matchQueue.splice(p2Idx, 1)[0];
		matchQueue.shift(); // убираем p1
		
		console.log(`[match] matched ${p1.sessionId}(mmr=${p1.mmr}) vs ${p2.sessionId}(mmr=${p2.mmr})`);
		if (sessions[p1.sessionId])
			clearTimeout(sessions[p1.sessionId].matchmakingTimer);
		if (sessions[p2.sessionId])
			clearTimeout(sessions[p2.sessionId].matchmakingTimer);
		createPvpRoom(p1, p2);
		console.log(`[match] PvP room created`);
	}
}

function fallbackToBot(s, socket, sessionId) {
	const idx = matchQueue.findIndex((q) => q.sessionId === sessionId);
	if (idx === -1) return;
	matchQueue.splice(idx, 1);
	tryMatch(); // перезапускаем подбор для оставшихся в очереди
	beginPveBattle(s, socket, sessionId);
}

function handlePvpAction(roomId, sessionId, action) {
	const room = pvpRooms[roomId];
	if (!room) return;
	const battle = room.battle;
	if (battle.gameOver) return;
	const side =
		room.sideA.sessionId === sessionId
			? "A"
			: room.sideB.sessionId === sessionId
				? "B"
				: null;
	if (!side || battle.turnOwner !== side) return;

	clearTimeout(room.turnTimer);
	battle.aiAction = null;
	const { type, attackerIdx, defenderIdx } = action;

	if (type === "endTurn") {
		endPvpTurn(roomId);
		return;
	}

	const attacker = battle.playerCards[attackerIdx];
	if (!attacker || attacker.hp <= 0) {
		armTurnTimer(roomId);
		return;
	}

	let actionResult = null;
	const cardUpgrades = (side === "A" ? room.sideA : room.sideB).cardUpgrades;

	if (type === "attack") {
		actionResult = executeAttack(battle, attackerIdx, defenderIdx, true);
	} else if (type === "crit") {
		if (attacker.type !== "assa" || attacker.mana < 2) {
			armTurnTimer(roomId);
			return;
		}
		if (battle.firstTurn) {
			armTurnTimer(roomId);
			return;
		}
		if (battle.abilitiesUsedThisTurn.includes(attackerIdx)) {
			armTurnTimer(roomId);
			return;
		}
		if (defenderIdx !== undefined) {
			const ignoreTaunt = attacker.baseId === "assa_03";
			if (!ignoreTaunt) {
				const taunter = battle.enemyCards.find(
					(e) => e.tauntActive && e.hp > 0,
				);
				if (taunter && defenderIdx !== battle.enemyCards.indexOf(taunter)) {
					armTurnTimer(roomId);
					return;
				}
			}
		}
		actionResult = executeCrit(battle, attackerIdx, defenderIdx);
	} else if (type === "fireball") {
		if (attacker.type !== "mage") {
			armTurnTimer(roomId);
			return;
		}
		if (battle.firstTurn) {
			armTurnTimer(roomId);
			return;
		}
		if (battle.abilitiesUsedThisTurn.includes(attackerIdx)) {
			armTurnTimer(roomId);
			return;
		}
		if (defenderIdx !== undefined) {
			const taunter = battle.enemyCards.find((e) => e.tauntActive && e.hp > 0);
			if (taunter && defenderIdx !== battle.enemyCards.indexOf(taunter)) {
				armTurnTimer(roomId);
				return;
			}
		}
		const cost = 2;
		if (attacker.mana < cost) {
			armTurnTimer(roomId);
			return;
		}
		actionResult = executeFireball(
			battle,
			attackerIdx,
			defenderIdx,
			cardUpgrades,
		);
	} else if (type === "taunt") {
		if (attacker.type !== "tank" || attacker.mana < 2) {
			armTurnTimer(roomId);
			return;
		}
		if (battle.firstTurn) {
			armTurnTimer(roomId);
			return;
		}
		if (battle.abilitiesUsedThisTurn.includes(attackerIdx)) {
			armTurnTimer(roomId);
			return;
		}
		executeTaunt(battle, attackerIdx, cardUpgrades);
		battle.abilitiesUsedThisTurn.push(attackerIdx);
		battle.playerAction = {
			type: "taunt",
			attackerIdx,
			attackerName: attacker.name,
			hpHealed: attacker.baseId === "tank_05" ? 2 : 0,
		};
		endPvpTurn(roomId);
		return;
	}

	if (actionResult) battle.playerAction = actionResult;

	if (
		actionResult &&
		(actionResult.type === "crit_ready" ||
			actionResult.type === "fireball_ready")
	) {
		emitPvpState(roomId);
		armTurnTimer(roomId);
		return;
	}

	endPvpTurn(roomId);
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
	if (!authPollRateLimiter(req.ip)) {
		return res.status(429).json({ error: "too many requests" });
	}
	const { code } = req.query;
	if (!code) return res.status(400).json({ error: "code required" });
	const info = getAuthCodeInfo(code);
	if (!info) return res.json({ ready: false });
	const telegramId = info.telegramId;
	const tgUser = info.tgUser || { firstName: `tg${telegramId}` };
	const { player } = await getOrCreatePlayer(telegramId, {
		username: tgUser.firstName || tgUser.username || `tg${telegramId}`,
	});
	const token = signJWT({
		sub: player.id,
		telegram_id: telegramId,
		username: player.username,
		tgUser: {
			id: telegramId,
			firstName: tgUser.firstName,
			lastName: tgUser.lastName || null,
			username: tgUser.username || null,
		},
	});
	res.json({
		ready: true,
		token,
		user: { id: player.id, username: player.username },
		tgUser: {
			id: telegramId,
			firstName: tgUser.firstName,
			lastName: tgUser.lastName || null,
			username: tgUser.username || null,
		},
	});
});

// Step 3: bot webhook — receives Telegram messages
APP.post("/bot/webhook", express.json(), async (req, res) => {
	// Telegram присылает этот заголовок только если он был передан в setWebhook.
	// Без проверки кто угодно может POST-нуть сюда поддельный successful_payment
	// с произвольным from.id и получить премиум бесплатно.
	const incomingSecret = req.get("X-Telegram-Bot-Api-Secret-Token");
	if (incomingSecret !== WEBHOOK_SECRET) {
		console.warn("[webhook] отклонён запрос с неверным secret token");
		return res.sendStatus(401);
	}
	try {
		// Telegram Stars: подтверждение перед оплатой (обязателен ответ в течение 10 сек)
		const preCheckout = req.body?.pre_checkout_query;
		if (preCheckout) {
			await tgApiRequest("answerPreCheckoutQuery", {
				pre_checkout_query_id: preCheckout.id,
				ok: true,
			});
			return res.sendStatus(200);
		}

		const msg = req.body?.message || req.body?.edited_message;

		// Telegram Stars: платёж прошёл успешно — начисляем премиум
		if (msg?.successful_payment && msg?.from?.id) {
			await grantPremium(msg.from.id.toString());
			logEvent(msg.from.id.toString(), "premium_purchase", {
				stars: msg.successful_payment.total_amount,
			});
			console.log(`[premium] granted to tg${msg.from.id}`);
			return res.sendStatus(200);
		}

		if (!msg?.text || !msg?.from?.id) return res.sendStatus(200);
		const text = msg.text.trim();
		const telegramId = msg.from.id;
		if (text.startsWith("/start ")) {
			const code = text.replace("/start ", "").trim();
			const tgUser = {
				firstName: msg.from.first_name || null,
				lastName: msg.from.last_name || null,
				username: msg.from.username || null,
			};
			if (resolveAuthCode(code, telegramId, tgUser)) {
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

// ═══ CRASH SAFETY ═══
// Необработанные ошибки не должны ронять весь процесс (это оборвёт все активные
// игры разом). Логируем и продолжаем работу; сама операция, где случилась ошибка,
// прервётся, но остальные игроки не пострадают.
process.on("uncaughtException", (err) => {
	console.error("[uncaughtException]", err);
});
process.on("unhandledRejection", (reason) => {
	console.error("[unhandledRejection]", reason);
});

// ═══ SOCKET.IO ═══
IO.on("connection", (socket) => {
	let userId = null;
	let _playerData = null;
	const sessionId = socket.id;
	console.log(`[connect] ${sessionId}`);

	// Оборачиваем каждый socket.on этого соединения в try/catch + rate limit,
	// не трогая тела самих обработчиков. Если внутри произойдёт исключение —
	// упадёт только текущее событие, а не весь процесс/все соединения.
	const _originalOn = socket.on.bind(socket);
	socket.on = (event, handler) => {
		return _originalOn(event, async (...args) => {
			try {
				if (RATE_LIMITED_EVENTS.has(event) && !socketActionRateLimiter(socket.id)) {
					socket.emit("error", "Слишком много действий, подождите немного");
					return;
				}
				await handler(...args);
			} catch (e) {
				console.error(`[socket:${event}] error:`, e?.message || e);
				try {
					socket.emit("error", "Внутренняя ошибка сервера");
				} catch {}
			}
		});
	};

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
		premiumUntil: null,
	};

	// ═══ AUTH ═══
	socket.on("auth", async ({ access_token }) => {
		try {
			const decoded = verifyJWT(access_token);
			if (!decoded) {
				socket.emit("error", "Токен недействителен");
				return;
			}
			userId = decoded.telegram_id;

			// Если у этого userId уже есть активная сессия — шарим объект между вкладками
			const existingKey = Object.keys(sessions).find(
				(k) => sessions[k].userId === userId && k !== sessionId,
			);
			const isReconnect = !!existingKey;
			if (isReconnect) {
				sessions[sessionId] = sessions[existingKey];
				// Не удаляем старый ключ — обе вкладки ссылаются на один объект
			}

			const { player: dbPlayer } = await getOrCreatePlayer(decoded.telegram_id, {
				username: decoded.username,
			});
			_playerData = dbPlayer;
			sessions[sessionId]._dbPlayerId = dbPlayer.id;
			sessions[sessionId].userId = userId;
			sessions[sessionId].playerGold = dbPlayer.gold;
			sessions[sessionId].playerCollection = dbPlayer.collection || [];
			sessions[sessionId].cardUpgrades = dbPlayer.card_upgrades || {};
			sessions[sessionId].selectedDeck = dbPlayer.selected_deck || [];
			sessions[sessionId].wins = dbPlayer.wins || 0;
			sessions[sessionId].losses = dbPlayer.losses || 0;
			sessions[sessionId].premiumUntil = dbPlayer.premium_until || null;
			sessions[sessionId].tgUser = decoded.tgUser || {
				id: decoded.telegram_id,
				firstName: decoded.username,
			};
			// shopCards не перезаписываем при реконнекте — сохраняем текущий магазин
			if (!isReconnect) {
				sessions[sessionId].shopCards = eraDef();
			}

			// Реконнект в разгар PvP-боя — перепривязываем сокет к комнате
			if (sessions[sessionId].pvpRoomId) {
				const room = pvpRooms[sessions[sessionId].pvpRoomId];
				if (room) {
					clearTimeout(room.disconnectTimer);
					if (room.sideA.userId === userId) {
						room.sideA.sessionId = sessionId;
						room.sideA.socket = socket;
					} else if (room.sideB.userId === userId) {
						room.sideB.sessionId = sessionId;
						room.sideB.socket = socket;
					}
					emitPvpState(sessions[sessionId].pvpRoomId);
				} else {
					sessions[sessionId].pvpRoomId = null;
				}
			}

			console.log(`[auth] tg${decoded.telegram_id} -> ${sessionId}`);
			socket.emit("init", getSessionState(sessionId));
		} catch (e) {
			console.error("[auth error]", e.message);
			socket.emit("error", "Ошибка авторизации");
		}
	});

	// ═══ TELEGRAM MINI APP AUTH ═══
	socket.on("auth_miniapp", async ({ initData }) => {
		try {
			const verified = verifyMiniAppInitData(initData);
			if (!verified) {
				socket.emit("error", "Неверная подпись Telegram");
				return;
			}
			const { user: tgUser, startParam } = verified;

			const telegramId = tgUser.id.toString();
			userId = telegramId;

			const existingKey = Object.keys(sessions).find(
				(k) => sessions[k].userId === userId && k !== sessionId,
			);
			const isReconnect = !!existingKey;
			if (isReconnect) {
				sessions[sessionId] = sessions[existingKey];
			}

			const { player: dbPlayer, isNew } = await getOrCreatePlayer(telegramId, {
				first_name: tgUser.first_name,
				username: tgUser.username,
			});
			_playerData = dbPlayer;

			// Реферал привязывается только у по-настоящему новых игроков —
			// нельзя "переприкрепить" уже существующего игрока по чужой ссылке.
			if (isNew && startParam && startParam.startsWith("ref")) {
				const inviterTelegramId = startParam.slice(3);
				recordReferralIfNew(inviterTelegramId, telegramId).catch((e) =>
					console.error("[referral] record error:", e.message),
				);
			}

			sessions[sessionId]._dbPlayerId = dbPlayer.id;
			sessions[sessionId].userId = userId;
			sessions[sessionId].playerGold = dbPlayer.gold;
			sessions[sessionId].playerCollection = dbPlayer.collection || [];
			sessions[sessionId].cardUpgrades = dbPlayer.card_upgrades || {};
			sessions[sessionId].selectedDeck = dbPlayer.selected_deck || [];
			sessions[sessionId].wins = dbPlayer.wins || 0;
			sessions[sessionId].losses = dbPlayer.losses || 0;
			sessions[sessionId].premiumUntil = dbPlayer.premium_until || null;
			sessions[sessionId].tgUser = {
				id: parseInt(telegramId),
				firstName: tgUser.first_name,
				lastName: tgUser.last_name || null,
				username: tgUser.username || null,
			};

			// PvP reconnect
			if (sessions[sessionId].pvpRoomId) {
				const room = pvpRooms[sessions[sessionId].pvpRoomId];
				if (room) {
					clearTimeout(room.disconnectTimer);
					if (room.sideA.userId === userId) {
						room.sideA.sessionId = sessionId;
						room.sideA.socket = socket;
					} else if (room.sideB.userId === userId) {
						room.sideB.sessionId = sessionId;
						room.sideB.socket = socket;
					}
					emitPvpState(sessions[sessionId].pvpRoomId);
				} else {
					sessions[sessionId].pvpRoomId = null;
				}
			}

			console.log(`[auth:miniapp] tg${telegramId} -> ${sessionId}`);
			logEvent(telegramId, "session_start", { isNew, source: "miniapp" });
			socket.emit("init", getSessionState(sessionId));
		} catch (e) {
			console.error("[auth:miniapp error]", e.message);
			socket.emit("error", "Ошибка авторизации Mini App");
		}
	});

	// ═══ NEW CAMPAIGN ═══
	socket.on("newCampaign", () => {
		const s = sessions[sessionId];
		if (!s) {
			socket.emit("error", "Сессия не найдена. Перезайдите в игру.");
			return;
		}
		s.selectedDeck = [];
		s.battle = null;
		s.shopCards = eraDef();
		socket.emit("stateUpdate", getSessionState(sessionId));
		if (userId) savePlayerData(userId, s);
	});

	// ═══ PREMIUM ═══
	socket.on("buyPremium", async () => {
		const s = sessions[sessionId];
		const telegramId = s?.tgUser?.id;
		if (!s || !telegramId) {
			socket.emit("premiumError", "Войдите через Telegram, чтобы купить премиум");
			return;
		}
		// Тестовый режим: начисляем сразу без оплаты
		if (PREMIUM_TEST_MODE) {
			grantPremium(telegramId);
			return;
		}
		try {
			const invoice = await tgApiRequest("createInvoiceLink", {
				title: "Премиум-аккаунт",
				description: `x2 золота за каждую победу на ${PREMIUM_DURATION_DAYS} дней`,
				payload: `premium_${telegramId}_${Date.now()}`,
				currency: "XTR",
				prices: [{ label: "Премиум на 7 дней", amount: PREMIUM_PRICE_STARS }],
			});
			if (invoice?.ok) {
				logEvent(telegramId, "premium_invoice_created", {});
				socket.emit("invoiceLink", invoice.result);
			} else {
				console.error("[premium] createInvoiceLink failed:", invoice);
				socket.emit("premiumError", "Не удалось создать счёт на оплату");
			}
		} catch (e) {
			console.error("[premium] error:", e.message);
			socket.emit("premiumError", "Ошибка сервера при создании счёта");
		}
	});

	socket.on("getPremiumStatus", () => {
		const s = sessions[sessionId];
		if (!s) return;
		socket.emit("premiumStatus", {
			premiumUntil: s.premiumUntil || null,
			active: isPremiumActive(s),
		});
	});

	// ═══ REFERRAL STATS ═══
	socket.on("getReferralStats", async () => {
		if (!userId) return;
		try {
			const { count } = await supabase
				.from("kart_referrals")
				.select("id", { count: "exact", head: true })
				.eq("inviter_telegram_id", userId)
				.eq("rewarded", true);
			socket.emit("referralStats", {
				invited: count || 0,
				earned: (count || 0) * REFERRAL_REWARD_GOLD,
			});
		} catch (e) {
			console.error("[referral] stats error:", e.message);
		}
	});

	// ═══ CLIENT-SIDE EVENT TRACKING ═══
	// Небольшой белый список, чтобы клиент не мог засорять таблицу произвольными
	// именами событий и данными.
	const ALLOWED_CLIENT_EVENTS = new Set([
		"invite_link_shared",
		"shop_view",
		"deck_selected",
		"pvp_view",
	]);
	socket.on("trackEvent", (data) => {
		const event = data?.event;
		if (!event || !ALLOWED_CLIENT_EVENTS.has(event)) return;
		logEvent(userId, event, data?.payload || {});
	});

	// ═══ GET SHOP ═══
	socket.on("getShop", () => {
		const s = sessions[sessionId];
		if (!s) return;
		if (!s.shopCards.length) s.shopCards = eraDef();
		socket.emit("stateUpdate", getSessionState(sessionId));
		if (userId) savePlayerData(userId, s);
	});

	// ═══ RESYNC (watchdog recovery) ═══
	socket.on("resync", () => {
		const s = sessions[sessionId];
		if (!s) return;
		console.log(`[resync] ${sessionId} requested resync — re-emitting state`);
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
		if (userId) savePlayerData(userId, s);
	});

	// ═══ UPGRADE CARD ═══
	socket.on("upgradeCard", ({ cardId, stat }) => {
		const s = sessions[sessionId];
		if (!s) return;
		if (!["hp", "atk", "mana"].includes(stat)) {
			socket.emit("error", "bad stat");
			return;
		}
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
		if (userId) savePlayerData(userId, s);
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
		if (userId) savePlayerData(userId, s);
	});

	// ═══ MATCHMAKING ═══
	socket.on("startBattle", () => {
		const s = sessions[sessionId];
		if (!s) return;
		logEvent(userId, "battle_start", { mode: "pve" });
		beginPveBattle(s, socket, sessionId);
	});

	socket.on("findMatch", () => {
		const s = sessions[sessionId];
		console.log(`[match] findMatch sessionId=${sessionId} deck=${s?.selectedDeck?.length} queue=${matchQueue.length}`);
		if (!s || s.selectedDeck.length !== CARDS_PER_SIDE) {
			socket.emit("error", "Выберите ровно 3 карты");
			return;
		}
		if (s.pvpRoomId || matchQueue.find((q) => q.sessionId === sessionId))
			return;

		matchQueue.push({
			sessionId,
			userId,
			socket,
			deckIds: [...s.selectedDeck],
			cardUpgrades: s.cardUpgrades,
			mmr: calcMMR(s),
		});
		socket.emit("matchmakingStatus", { status: "searching" });
		tryMatch();

		if (s.pvpRoomId) return; // заматчились сразу

		const othersOnline = countOnlinePlayers(userId) > 0;
		const waitMs = othersOnline
			? MATCHMAKING_TIMEOUT_WITH_PLAYERS_MS
			: MATCHMAKING_MIN_NO_PLAYERS_MS +
				Math.floor(
					Math.random() *
						(MATCHMAKING_MAX_NO_PLAYERS_MS -
							MATCHMAKING_MIN_NO_PLAYERS_MS),
				);
		console.log(
			`[match] othersOnline=${othersOnline} waitMs=${waitMs}`,
		);
		s.matchmakingTimer = setTimeout(
			() => fallbackToBot(s, socket, sessionId),
			waitMs,
		);
	});

	socket.on("cancelMatch", () => {
		const idx = matchQueue.findIndex((q) => q.sessionId === sessionId);
		if (idx >= 0) { matchQueue.splice(idx, 1); tryMatch(); }
		const s = sessions[sessionId];
		if (s) clearTimeout(s.matchmakingTimer);
		socket.emit("matchmakingStatus", { status: "cancelled" });
	});

	socket.on("pvpAction", (action) => {
		const s = sessions[sessionId];
		if (!s?.pvpRoomId) return;
		handlePvpAction(s.pvpRoomId, sessionId, action);
	});

	// ═══ PLAYER ACTION ═══
	socket.on("playerAction", (action) => {
		process.env.DEBUG && console.log(
			"[action]",
			action.type,
			"attackerIdx:",
			action.attackerIdx,
			"defenderIdx:",
			action.defenderIdx,
		);
		const s = sessions[sessionId];
		if (!s) {
			process.env.DEBUG && console.log("[action] no session");
			return;
		}
		if (s.pvpRoomId) return; // PvP использует событие pvpAction
		const battle = s.battle;
		if (!battle || battle.gameOver || !battle.isPlayerTurn) {
			process.env.DEBUG && console.log(
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

		if (!Number.isInteger(attackerIdx) || attackerIdx < 0 || attackerIdx >= battle.playerCards.length) return;

		if (type === "endTurn") {
			process.env.DEBUG && console.log("[action] endTurn → executePlayerEndTurn");
			executePlayerEndTurn(s, socket, userId);
			return;
		}

		const attacker = battle.playerCards[attackerIdx];
		if (!attacker || attacker.hp <= 0) {
			process.env.DEBUG && console.log("[action] attacker dead/missing");
			return;
		}

		let actionResult = null;

		if (type === "attack") {
			if (!Number.isInteger(defenderIdx) || defenderIdx < 0 || defenderIdx >= battle.enemyCards.length) return;
			actionResult = executeAttack(battle, attackerIdx, defenderIdx, true);
		} else if (type === "crit") {
			if (attacker.type !== "assa" || attacker.mana < 2) {
				process.env.DEBUG && console.log(
					"[crit] blocked: type=",
					attacker.type,
					"mana=",
					attacker.mana,
				);
				return;
			}
			if (battle.firstTurn) {
				process.env.DEBUG && console.log("[crit] blocked: firstTurn");
				return;
			}
			if (battle.abilitiesUsedThisTurn.includes(attackerIdx)) {
				process.env.DEBUG && console.log("[crit] blocked: ability already used");
				return;
			}
			// Taunt check only when actually selecting a target (not during activation)
			if (defenderIdx !== undefined) {
				if (!Number.isInteger(defenderIdx) || defenderIdx < 0 || defenderIdx >= battle.enemyCards.length) return;
				const ignoreTaunt = attacker.baseId === "assa_03";
				if (!ignoreTaunt) {
					const taunter = battle.enemyCards.find(
						(e) => e.tauntActive && e.hp > 0,
					);
					if (taunter && defenderIdx !== battle.enemyCards.indexOf(taunter)) {
						process.env.DEBUG && console.log("[crit] blocked: taunt");
						return;
					}
				}
			}
			actionResult = executeCrit(battle, attackerIdx, defenderIdx);
			process.env.DEBUG && console.log("[crit] result:", actionResult?.type);
		} else if (type === "fireball") {
			if (attacker.type !== "mage") {
				process.env.DEBUG && console.log("[fireball] blocked: type=", attacker.type);
				return;
			}
			if (battle.firstTurn) {
				process.env.DEBUG && console.log("[fireball] blocked: firstTurn");
				return;
			}
			if (battle.abilitiesUsedThisTurn.includes(attackerIdx)) {
				process.env.DEBUG && console.log("[fireball] blocked: ability already used");
				return;
			}
			// Taunt check only when actually selecting a target (not during activation)
			if (defenderIdx !== undefined) {
				if (!Number.isInteger(defenderIdx) || defenderIdx < 0 || defenderIdx >= battle.enemyCards.length) return;
				const taunter = battle.enemyCards.find(
					(e) => e.tauntActive && e.hp > 0,
				);
				if (taunter && defenderIdx !== battle.enemyCards.indexOf(taunter)) {
					process.env.DEBUG && console.log("[fireball] blocked: taunt");
					return;
				}
			}
			const cost = getFireballCost(attacker);
			if (attacker.mana < cost) {
				process.env.DEBUG && console.log("[fireball] blocked: mana=", attacker.mana, "need=", cost);
				return;
			}
			actionResult = executeFireball(
				battle,
				attackerIdx,
				defenderIdx,
				s.cardUpgrades,
			);
			process.env.DEBUG && console.log(
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
			process.env.DEBUG && console.log(
				"[action] ability activated, NOT ending turn. type:",
				actionResult.type,
			);
			socket.emit("stateUpdate", getSessionState(sessionId));
			return;
		}

		// End of player action: auto-end turn
		process.env.DEBUG && console.log("[action] ending turn, actionResult:", actionResult?.type);
		executePlayerEndTurn(s, socket, userId);
	});

	// ═══ SURRENDER ═══
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
		// Чистим очередь матчмейкинга — иначе мёртвый сокет останется и сломает подбор
		const qIdx = matchQueue.findIndex((q) => q.sessionId === sessionId);
		if (qIdx >= 0) { matchQueue.splice(qIdx, 1); tryMatch(); }
		const s = sessions[sessionId];
		if (s) clearTimeout(s.matchmakingTimer);
		if (s?.pvpRoomId) {
			const room = pvpRooms[s.pvpRoomId];
			if (room && !room.battle.gameOver) {
				const side = room.sideA.sessionId === sessionId ? "A" : "B";
				room.disconnectTimer = setTimeout(() => {
					if (pvpRooms[s.pvpRoomId] && !room.battle.gameOver) {
						endPvpGame(
							s.pvpRoomId,
							side === "A" ? "B" : "A",
							"opponent_disconnected",
						);
					}
				}, PVP_RECONNECT_GRACE_MS);
			}
		}
		if (s && userId) {
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
		tgUser: s.tgUser || null,
		premiumUntil: s.premiumUntil || null,
		mmr: calcMMR(s),
		allCards: ALL_CARDS,
	};
}

function getBattleState(b) {
	return {
		playerCards: b.playerCards.map((c) => ({ ...c })),
		enemyCards: b.enemyCards.map((c) => ({ ...c })),
		enemyName: b.enemyName || null,
		enemyAvatar: b.enemyAvatar || null,
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
	let manaCost = getFireballCost(attacker);
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

	// Clear enemy taunt (expires when the opponent's turn is over)
	battle.enemyCards.forEach((c) => {
		c.tauntActive = false;
	});

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

		// Clear player's own taunt (expires after player's next turn begins)
		battle.playerCards.forEach((c) => {
			c.tauntActive = false;
		});
		// NOTE: Enemy taunt persists through the player's turn — cleared in executePlayerEndTurn

		// Update crit ready flags
		battle.playerCards.forEach((c) => {
			if (c.type === "assa" && c.mana >= 2) c.critReady = true;
		});

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
				const cost = 2;
				if (actor.mana >= cost) {
					const { target, score } = bestTargetFor(actor, "fireball");
					if (target)
						actions.push({ actor, actorIdx, type: "fireball", target, score });
				}
			}
		}
	}

	if (!actions.length) return;

	// ═══ LOOKAHEAD: "if I play this, what's their best answer?" ═══
	// Reuses the exact same action types/costs available to the player
	// (attack/crit/fireball/taunt) — no new abilities, just deeper calculation.
	const cloneSide = (arr) => arr.map((c) => ({ ...c }));

	// Applies the *expected* outcome of an AI action to cloned boards (no RNG,
	// no rare procs — this is only for scoring hypothetical futures, the real
	// execution below still uses the normal randomized damage/passives).
	const simulateAiAction = (aiClone, plClone, action) => {
		const actor = aiClone[action.actorIdx];
		if (!actor) return;
		if (action.type === "taunt") {
			actor.mana = Math.max(0, actor.mana - 2);
			actor.tauntActive = true;
			return;
		}
		const tIdx = plClone.findIndex((c) => c.id === action.target.id);
		if (tIdx === -1) return;
		const tgt = plClone[tIdx];
		tgt.hp = Math.max(0, tgt.hp - estimateRawDamage(actor, action.type, tgt));
		if (action.type === "crit" || action.type === "fireball")
			actor.mana = Math.max(0, actor.mana - 2);
	};

	// Mirrors bestTargetFor/scoreTargetForAction, but for the player's side
	// attacking our (hypothetical, post-action) board — gives the strongest
	// single reply the opponent could land next turn.
	const bestPlayerReplyThreat = (aiClone, plClone) => {
		const aliveAi = aiClone.filter((c) => c.hp > 0);
		const alivePl = plClone.filter((c) => c.hp > 0);
		if (!aliveAi.length || !alivePl.length) return 0;
		const ourTaunter = aiClone.find((c) => c.hp > 0 && c.tauntActive);
		let best = 0;
		for (const pActor of alivePl) {
			const candidateTargets = ourTaunter ? [ourTaunter] : aliveAi;
			const canCrit = pActor.type === "assa" && pActor.mana >= 2;
			const canFireball = pActor.type === "mage" && pActor.mana >= 2;
			for (const tgt of candidateTargets) {
				const types = ["attack"];
				if (canCrit) types.push("crit");
				if (canFireball) types.push("fireball");
				for (const type of types) {
					const dmg = estimateRawDamage(pActor, type, tgt);
					const lethal = dmg >= tgt.hp;
					const val = dmg + (lethal ? 15 + targetThreatValue(tgt) : 0);
					if (val > best) best = val;
				}
			}
		}
		return best;
	};

	// Small jitter to break ties between near-equal options without ever
	// overturning a clearly better (especially lethal) play.
	actions.forEach((a) => {
		a.score += Math.random() * 1.2;
	});
	actions.sort((a, b) => b.score - a.score);

	// Look one reply ahead for the strongest candidates (cheap: top 4 max).
	const LOOKAHEAD_N = Math.min(4, actions.length);
	for (let i = 0; i < actions.length; i++) {
		if (i >= LOOKAHEAD_N) {
			actions[i].finalScore = -Infinity;
			continue;
		}
		const a = actions[i];
		const aiClone = cloneSide(battle.enemyCards);
		const plClone = cloneSide(battle.playerCards);
		simulateAiAction(aiClone, plClone, a);
		const replyThreat = bestPlayerReplyThreat(aiClone, plClone);
		// Punish moves that hand the opponent a strong/lethal answer;
		// a guaranteed kill now still easily outweighs a future threat.
		a.finalScore = a.score - replyThreat * 0.45;
	}
	actions.sort((a, b) => b.finalScore - a.finalScore);
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
		const cost = 2;
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

	let reward = victory
		? BASE_REWARD + Math.floor(Math.random() * 30) + battle.turnCount * 2
		: 0;
	const premiumActive = isPremiumActive(s);
	if (victory && premiumActive) reward *= 2;
	if (victory) {
		s.playerGold += reward;
		s.wins = (s.wins || 0) + 1;
		battle.battleLog.push(
			`<span class="log-victory">ПОБЕДА! +${reward} Remains${premiumActive ? " (x2 Премиум)" : ""}</span>`,
		);
	} else {
		s.losses = (s.losses || 0) + 1;
		battle.battleLog.push(
			'<span class="log-defeat">ПОРАЖЕНИЕ! Все воины пали.</span>',
		);
	}

	battle.gameEnd = { victory, reward, premium: premiumActive };

	logEvent(userId, "battle_end", {
		victory,
		reward,
		turns: battle.turnCount,
		isFirstBattle: (s.wins || 0) + (s.losses || 0) === 1,
	});

	// Реферальная награда: срабатывает строго на первом бою в жизни игрока
	// (wins+losses стало равно 1 именно на этом бою), чтобы нельзя было
	// зафармить бонус, просто установив приложение и не сыграв ни разу.
	if (userId && (s.wins || 0) + (s.losses || 0) === 1) {
		grantReferralRewardIfEligible(userId).catch((e) =>
			console.error("[referral] grant error:", e.message),
		);
	}

	// Save battle result
	if (userId) {
		saveBattleResult(
			s._dbPlayerId || userId,
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
		tgApiRequest("setWebhook", {
			url: webhookUrl,
			allowed_updates: ["message", "pre_checkout_query"],
			secret_token: WEBHOOK_SECRET,
		}).then((r) => console.log("[webhook]", r.description || r.ok)).catch((e) => console.error("[webhook fail]", e.message));
		// Set menu button — shows "Играть" directly in Telegram chat list
		const appUrl = process.env.APP_URL || "https://triad-duel.pages.dev/";
		tgApiRequest("setChatMenuButton", {
			menu_button: { type: "web_app", text: "Играть", web_app: { url: appUrl } },
		}).then((r) => console.log("[menu_button]", r.description || r.ok)).catch((e) => console.error("[menu_button fail]", e.message));
	}
});