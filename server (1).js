const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// ═══════════════ CONSTANTS ═══════════════
const CARDS_PER_SIDE = 3;
const SHOP_SIZE = 12;
const MAX_MANA = 10;

// ═══════════════ ALL CARDS (21 total: 11 mages, 5 tanks, 5 assassins) ═══════════════
const ALL_CARDS = [
  { id:'mage_01',name:'Библиарий Кассиан',atk:6,hp:11,price:650,type:'mage',variance:0.10,passive:'Эрудит',passiveDesc:'Фаербол стоит 2 маны. Раскол: 5% шанс 1-3 урона соседним',lore:'Хранитель запретных знаний из библиотек Некрона. Веками изучал тёмные рукописи, но рассудок его давно покинул эти стены.' },
  { id:'mage_02',name:'Малекит Проклятый',atk:7,hp:9,price:450,type:'mage',variance:0.25,passive:'Проклятие',passiveDesc:'Фаербол снижает ATK врага на 1. Раскол: 5% шанс 1-3 урона соседним',lore:'Когда-то был светлым магом, но проклятие Хаоса извратило его дар. Теперь его заклинания несут лишь страдания.' },
  { id:'mage_03',name:'Азатот Посвящённый',atk:5,hp:14,price:500,type:'mage',variance:0.15,passive:'Жертва',passiveDesc:'Фаербол лечит мага на 2 HP. Раскол: 5% шанс 1-3 урона соседним',lore:'Служитель культа Азатота. Каждая жертва приближает его к слиянию с ядерным хаосом.' },
  { id:'mage_04',name:'Гнилоуст Проповедник',atk:7,hp:10,price:500,type:'mage',variance:0.20,passive:'Чума',passiveDesc:'Фаербол = 1 урон/ход на 2 хода. Раскол: 5% шанс 1-3 урона соседним',lore:'Уста его источают чумные миазмы. Проповедует волю Дедушки Нургла среди смертных.' },
  { id:'mage_05',name:'Иландра Хранительница Рун',atk:6,hp:12,price:750,type:'mage',variance:0.10,passive:'Рунный щит',passiveDesc:'Получает на 1 урона меньше. Раскол: 5% шанс 1-3 урона соседним',lore:'Последняя из ордена Рунных Стражей. Её щиты выдержали атаки самих демонов Варпа.' },
  { id:'mage_06',name:"Ксаль'Торот",atk:7,hp:9,price:550,type:'mage',variance:0.20,passive:'Искажение',passiveDesc:'30% шанс: фаербол возвращает 1 ману. Раскол: 5% шанс 1-3 урона соседним',lore:'Бессмертный зодчий Первородного Хаоса. Управляет временем, стирая и возводя искажённые города из чужих снов и страхов.' },
  { id:'mage_07',name:"Ксар'лот",atk:6,hp:12,price:600,type:'mage',variance:0.15,passive:'Скверна',passiveDesc:'Фаербол +1 урона танкам. Раскол: 5% шанс 1-3 урона соседним',lore:'Древний маг, искажённый скверной Бездны. Его фолиант исписан запретными заклинаниями, а посох пульсирует потусторонним светом.' },
  { id:'mage_08',name:"Каэр'Тал",atk:7,hp:10,price:600,type:'mage',variance:0.25,passive:'Пожиратель',passiveDesc:'Фаербол крадёт 1 ману у врага. Раскол: 5% шанс 1-3 урона соседним',lore:'Пророк Варпа — его тело сосуд чистой энергии Хаоса. Третий глаз видит разломы реальностей и разрывает их своей волей.' },
  { id:'mage_09',name:'Кадавр',atk:5,hp:14,price:500,type:'mage',variance:0.15,passive:'Сбор душ',passiveDesc:'Убийство фаерболом: +2 HP и +1 маны. Раскол: 5% шанс 1-3 урона соседним',lore:'Отрекшийся магистр смерти. Собирает осколки душ из пустоты, сплетая их в вихрь бесконечного проклятия.' },
  { id:'mage_10',name:'Каэлис Векс',atk:8,hp:8,price:700,type:'mage',variance:0.20,passive:'Псай-шторм',passiveDesc:'Фаербол +2 урона при HP<50%. Раскол: 5% шанс 1-3 урона соседним',lore:'Беглый псайкер. Его разум искажает гравитацию, а воля обращает ментальную энергию в смертоносный шторм молний.' },
  { id:'mage_11',name:'Слепая Оракул',atk:6,hp:12,price:650,type:'mage',variance:0.10,passive:'Оракул',passiveDesc:'40% шанс: фаербол стоит 1 ману. Раскол: 5% шанс 1-3 урона соседним',lore:'Её глаза закрыты, но она видит всё. Таро с символами хаоса парят в потоке warp-энергии — она читает саму ткань реальности.' },
  { id:'tank_01',name:'Железный Дредноут',atk:4,hp:20,price:650,type:'tank',variance:0.15,passive:'Броня',passiveDesc:'Провокация: -1 вх. урона. Прикрытие: 5% шанс забрать атаку с соседа без урона',lore:'Живая крепость, закованная в адамантий. Стоял на страже врат Кадии до самого конца.' },
  { id:'tank_02',name:'Чумной Гигант',atk:3,hp:24,price:800,type:'tank',variance:0.20,passive:'Гнилая кровь',passiveDesc:'Провокация: отражает 1 урон. Прикрытие: 5% шанс забрать атаку с соседа без урона',lore:'Порождение гнилых садов Нургла. Его кровь — едкая жижа, разъедающая даже сталь.' },
  { id:'tank_03',name:'Страж Некрона',atk:4,hp:18,price:700,type:'tank',variance:0.10,passive:'Ярость мёртвых',passiveDesc:'HP<50%: +2 ATK. Прикрытие: 5% шанс забрать атаку с соседа без урона',lore:'Пробуждённый от вечного сна воин древней расы. Чем ближе к смерти — тем яростнее бой.' },
  { id:'tank_04',name:'Каменный Страж',atk:3,hp:22,price:850,type:'tank',variance:0.10,passive:'Каменная кожа',passiveDesc:'Всегда -1 вх. урона. Прикрытие: 5% шанс забрать атаку с соседа без урона',lore:'Голем, высеченный из горного хребта Мира Теней. Не чувствует ни боли, ни страха.' },
  { id:'tank_05',name:'Шоггот-Брут',atk:4,hp:21,price:650,type:'tank',variance:0.25,passive:'Регенерация',passiveDesc:'Провокация лечит 2 HP. Прикрытие: 5% шанс забрать атаку с соседа без урона',lore:'Бесформенная тварь из глубин Иннсмута. Постоянно регенерирует, пожирая всё вокруг.' },
  { id:'assa_01',name:'Ночной Клинок',atk:8,hp:8,price:500,type:'assa',variance:0.15,passive:'Теневой шаг',passiveDesc:'30% шанс: крит стоит 1 ману. Кровопускание: 5% шанс нанести половину урона соседу',lore:'Тень, скользящая между мирами. Его клинок видел кровь сотен жертв и не знает промаха.' },
  { id:'assa_02',name:'Теневой Убийца',atk:9,hp:6,price:750,type:'assa',variance:0.10,passive:'Добивание',passiveDesc:'+2 урона целям с HP<50%. Кровопускание: 5% шанс нанести половину урона соседу',lore:'Мастер добивания. Чует слабость врага как акула чует кровь за мили.' },
  { id:'assa_03',name:'Варп-Сталкер',atk:7,hp:10,price:650,type:'assa',variance:0.20,passive:'Фазовый сдвиг',passiveDesc:'Крит игнорирует провокацию. Кровопускание: 5% шанс нанести половину урона соседу',lore:'Ходок через Варп. Проходит сквозь защитные барьеры, словно их не существует.' },
  { id:'assa_04',name:'Глубинный Хищник',atk:9,hp:7,price:750,type:'assa',variance:0.15,passive:'Хищник',passiveDesc:'Убийство даёт +2 маны. Кровопускание: 5% шанс нанести половину урона соседу',lore:'Вышел из Марианской впадины, где спят Древние. Каждое убийство питает его тёмную силу.' },
  { id:'assa_05',name:'Жнец Снов',atk:9,hp:7,price:700,type:'assa',variance:0.25,passive:'Кошмар',passiveDesc:'Крит наносит x2.5 урона. Кровопускание: 5% шанс нанести половину урона соседу',lore:'Посланник Кошмара. Его серп пожинает не жизни — но сами души, обрекая жертв на вечные муки.' },
];

// ═══════════════ UTILITY FUNCTIONS ═══════════════
function byId(id) { return ALL_CARDS.find(c => c.id === id); }

function sh(array) { const r = [...array]; for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; }

function rollDamage(base, variance = 0.15) { return Math.max(1, Math.round(base * (1 - variance + Math.random() * variance * 2))); }

function getEffAtk(c) { if (!c || c.hp <= 0) return 0; let a = c.atk; if (c.atkDebuff) a = Math.max(0, a - c.atkDebuff); if (c.type === 'tank' && c.id === 'tank_03' && c.hp <= c.maxHp * 0.5) a += 2; return a; }

function getDefBonus(c) { if (!c || c.hp <= 0) return 0; let b = 0; if (c.id === 'mage_05' || c.id === 'tank_04') b = 1; if (c.id === 'tank_01' && c.tauntActive) b = 1; return b; }

function tryTankCover(defCards, targetIdx) {
  for (let i = Math.max(0, targetIdx - 1); i <= Math.min(defCards.length - 1, targetIdx + 1); i++) {
    if (i === targetIdx) continue; const nb = defCards[i];
    if (nb && nb.hp > 0 && nb.type === 'tank' && Math.random() < 0.05) return nb;
  } return null;
}

function tryMageSplash(attacker, defCards, targetIdx) {
  if (attacker.type !== 'mage' || Math.random() >= 0.05) return null;
  const results = [];
  for (let i = Math.max(0, targetIdx - 1); i <= Math.min(defCards.length - 1, targetIdx + 1); i++) {
    if (i === targetIdx) continue; const nb = defCards[i];
    if (nb && nb.hp > 0) { const dmg = 1 + Math.floor(Math.random() * 3); nb.hp = Math.max(0, nb.hp - dmg); results.push({ neighbor: nb, damage: dmg, index: i }); }
  } return results.length > 0 ? results : null;
}

function tryAssaSplash(attacker, defCards, targetIdx, mainDmg) {
  if (attacker.type !== 'assa' || Math.random() >= 0.05) return null;
  const neighbors = [];
  for (let i = Math.max(0, targetIdx - 1); i <= Math.min(defCards.length - 1, targetIdx + 1); i++) {
    if (i === targetIdx) continue; const nb = defCards[i];
    if (nb && nb.hp > 0) neighbors.push({ neighbor: nb, index: i });
  }
  if (neighbors.length === 0) return null;
  const pick = neighbors[Math.floor(Math.random() * neighbors.length)];
  const dmg = Math.max(1, Math.floor(mainDmg / 2)); pick.neighbor.hp = Math.max(0, pick.neighbor.hp - dmg);
  return { neighbor: pick.neighbor, damage: dmg, index: pick.index };
}

function applyDOT(c) { if (!c || c.hp <= 0 || !c.dotTurns || c.dotTurns <= 0) return 0; const dmg = 1; c.hp = Math.max(0, c.hp - dmg); c.dotTurns--; return dmg; }

function upgradeCost(stat, level) { return 150 * Math.pow(2, level); }

function getUp(session, cardId) { if (!session.cardUpgrades[cardId]) session.cardUpgrades[cardId] = { hp: 0, atk: 0, mana: 0 }; return session.cardUpgrades[cardId]; }

// ═══════════════ SESSION STORE ═══════════════
const sessions = {};
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function createSession() {
  return {
    playerGold: 100, playerCollection: ['mage_01', 'tank_01', 'assa_01'], selectedDeck: [], cardUpgrades: {},
    playerCards: [], enemyCards: [], activeIdx: -1, isPlayerTurn: true, gameOver: false,
    abilitiesUsedThisTurn: [], turnLocked: false, critActivated: false, fireballActive: false,
    firstTurn: false, aiLastTargetId: null, lastSeen: Date.now(), shopCards: null,
  };
}

setInterval(() => {
  const now = Date.now();
  for (const id in sessions) {
    if (now - sessions[id].lastSeen > SESSION_TTL_MS) delete sessions[id];
  }
}, 60 * 60 * 1000); // check every hour

// ═══════════════ STATE BUILDERS ═══════════════
function buildBattleState(session) {
  return {
    playerCards: session.playerCards.map(c => ({ ...c })),
    enemyCards: session.enemyCards.map(c => ({ ...c })),
    activeIdx: session.activeIdx, isPlayerTurn: session.isPlayerTurn, gameOver: session.gameOver,
    abilitiesUsedThisTurn: [...session.abilitiesUsedThisTurn], turnLocked: session.turnLocked,
    critActivated: session.critActivated, fireballActive: session.fireballActive, firstTurn: session.firstTurn,
    playerGold: session.playerGold, playerCollection: session.playerCollection,
    selectedDeck: session.selectedDeck, cardUpgrades: session.cardUpgrades,
  };
}

function buildFullState(session) {
  const hasBattle = (session.playerCards && session.playerCards.some(c => c.hp > 0))
    || (session.enemyCards && session.enemyCards.some(c => c.hp > 0));
  return {
    playerGold: session.playerGold,
    playerCollection: session.playerCollection,
    selectedDeck: session.selectedDeck,
    cardUpgrades: session.cardUpgrades,
    shopCards: session.shopCards,
    battle: hasBattle ? buildBattleState(session) : null
  };
}

// ═══════════════ AI LOGIC ═══════════════
function aiThreatScore(c) {
  if (c.hp <= 0) return 0; let s = c.atk * 4;
  if (c.type === 'mage') s += 8; if (c.type === 'assa') s += 5; if (c.type === 'tank') s += 3;
  if (c.mana >= 2) s += 5; if (c.mana >= 3) s += 8;
  if (c.hp <= c.maxHp * 0.3) s += 4; if (c.tauntActive) s += 6; return s;
}

function aiEvalPosition(enemyCards, playerCards) {
  const aE = enemyCards.filter(c => c.hp > 0), aP = playerCards.filter(c => c.hp > 0);
  if (!aP.length) return 99999; if (!aE.length) return -99999; let sc = 0;
  sc += (aE.reduce((s, c) => s + c.hp, 0) - aP.reduce((s, c) => s + c.hp, 0)) * 2.5;
  sc += (aE.length - aP.length) * 25;
  sc += (aE.reduce((s, c) => s + aiThreatScore(c), 0) - aP.reduce((s, c) => s + aiThreatScore(c), 0)) * 1.2;
  sc += (aE.reduce((s, c) => s + c.mana, 0) - aP.reduce((s, c) => s + c.mana, 0)) * 4;
  aP.forEach(p => { if (p.hp <= p.maxHp * 0.25) sc += 30; else if (p.hp <= p.maxHp * 0.5) sc += 12; });
  aE.forEach(e => { if (e.hp <= e.maxHp * 0.25) sc -= 25; else if (e.hp <= e.maxHp * 0.5) sc -= 10; }); return sc;
}

function aiPredictPlayerResponse(enemyCards, playerCards) {
  const aE = enemyCards.filter(c => c.hp > 0), aP = playerCards.filter(c => c.hp > 0);
  if (!aE.length || !aP.length) return { damage: 0, killCount: 0, threatLost: 0 };
  let totalDmg = 0, kills = 0, threatGone = 0; const eCopy = aE.map(c => ({ ...c, hp: c.hp }));
  aP.forEach(p => {
    const liveE = eCopy.filter(e => e.hp > 0); if (!liveE.length) return;
    const taunted = liveE.find(e => e.tauntActive); let target;
    if (taunted) { target = taunted; }
    else {
      const canKill = liveE.filter(e => e.hp <= Math.max(1, p.atk - getDefBonus(e)));
      if (canKill.length > 0) target = canKill.reduce((b, c) => aiThreatScore(c) > aiThreatScore(b) ? c : b, canKill[0]);
      else target = liveE.reduce((b, c) => { const sB = (1 - b.hp / b.maxHp) * 7 + aiThreatScore(b) * 0.5; const sC = (1 - c.hp / c.maxHp) * 7 + aiThreatScore(c) * 0.5; return sC > sB ? c : b; }, liveE[0]);
    }
    if (!target) return;
    const dmg = Math.max(1, rollDamage(p.atk, p.variance || 0.15) - getDefBonus(target));
    const wasAlive = target.hp > 0; target.hp = Math.max(0, target.hp - dmg);
    if (target.hp <= 0 && wasAlive) { kills++; threatGone += aiThreatScore(target); }
    totalDmg += Math.min(dmg, wasAlive ? dmg : 0);
  });
  return { damage: totalDmg, killCount: kills, threatLost: threatGone };
}

function aiPickTarget(playerCards, attackerDmg, attackerType, ignoreTaunt, session) {
  const liveP = playerCards.filter(c => c.hp > 0); if (!liveP.length) return null;
  if (!ignoreTaunt) { const taunted = liveP.find(c => c.tauntActive); if (taunted) return taunted; }
  const kills = liveP.filter(p => p.hp <= Math.max(1, attackerDmg - getDefBonus(p)));
  if (kills.length > 0) return kills.reduce((b, c) => aiThreatScore(c) > aiThreatScore(b) ? c : b, kills[0]);
  return liveP.reduce((b, c) => { const sB = (1 - b.hp / b.maxHp) * 8 + aiThreatScore(b) * 0.7 + (b.id === session.aiLastTargetId ? 15 : 0); const sC = (1 - c.hp / c.maxHp) * 8 + aiThreatScore(c) * 0.7 + (c.id === session.aiLastTargetId ? 15 : 0); return sC > sB ? c : b; }, liveP[0]);
}

function checkEnd(session) {
  const pAlive = session.playerCards.some(c => c.hp > 0), eAlive = session.enemyCards.some(c => c.hp > 0);
  if (!pAlive || !eAlive) { session.gameOver = true; session.isPlayerTurn = false; session.activeIdx = -1;
    if (!eAlive) { const r = 40 + Math.floor(Math.random() * 40); session.playerGold += r; return { victory: true, reward: r, message: `⚔ Все враги пали! +${r} золота` }; }
    else { const r = 10 + Math.floor(Math.random() * 10); session.playerGold += r; return { victory: false, reward: r, message: `☠ Ваш отряд уничтожен... +${r} золота` }; }
  } return null;
}

function doAiEndTurn(session) {
  session.playerCards.forEach(c => { applyDOT(c); if (c.tauntActive) c.tauntActive = false; c.atkDebuff = 0; });
  const er = checkEnd(session); if (er) return er;
  session.isPlayerTurn = true; session.activeIdx = -1; session.abilitiesUsedThisTurn = []; session.firstTurn = false;
  return null;
}

function executeAiAction(session) {
  if (session.gameOver) return { log: [] }; const logEntries = [];
  const aliveE = session.enemyCards.filter(c => c.hp > 0), aliveP = session.playerCards.filter(c => c.hp > 0);
  if (!aliveE.length || !aliveP.length) { const r = doAiEndTurn(session); return r ? { gameEnd: r, log: [] } : { log: [] }; }
  const maxPlayerAtk = Math.max(...aliveP.map(c => c.atk));
  const basePosScore = aiEvalPosition(session.enemyCards, session.playerCards); const actions = [];

  // BASIC ATTACKS
  aliveE.forEach(e => {
    const critMul = (e.type === 'assa' && e.critReady) ? (e.id === 'assa_05' ? 2.5 : 2) : 1;
    const liveP = session.playerCards.filter(c => c.hp > 0);
    liveP.forEach(p => {
      if (e.type !== 'assa' || e.id !== 'assa_03' || critMul === 1) { const t = aliveP.find(x => x.tauntActive && x.hp > 0); if (t && p !== t) return; }
      const avgDmg = rollDamage(e.atk * critMul, e.variance || 0.15);
      const defBonus = getDefBonus(p); const finalDmg = Math.max(1, avgDmg - defBonus);
      const kill = p.hp <= finalDmg; const oldHp = p.hp; p.hp = Math.max(0, p.hp - finalDmg);
      const posDelta = aiEvalPosition(session.enemyCards, session.playerCards) - basePosScore;
      const resp = aiPredictPlayerResponse(session.enemyCards, session.playerCards); p.hp = oldHp;
      let score = posDelta * 2.5 + finalDmg * 1.5; score -= resp.damage * 3.5 + resp.killCount * 55 + resp.threatLost * 5;
      if (kill) score += 85 + aiThreatScore(p) * 3.5; if (p.id === session.aiLastTargetId) score += 30;
      if (p.hp <= p.maxHp * 0.3) score += 22; if (p.mana >= 2 && !kill) score += 18;
      if (e.type === 'assa' && critMul > 1) score += 12; if (e.mana >= 5) score += 5;
      actions.push({ type: 'attack', actor: e, target: p, damage: finalDmg, kill, score, critMul });
    });
  });

  // ABILITIES (skip on first turn)
  if (!session.firstTurn) {
    // TAUNT
    aliveE.forEach(e => {
      if (e.type !== 'tank' || e.mana < 2 || e.tauntActive) return;
      const nonTanks = aliveE.filter(c => c.type !== 'tank' && c.hp > 0); if (!nonTanks.length) return;
      const critAlly = nonTanks.some(a => a.hp <= a.maxHp * 0.25), dangerAlly = nonTanks.some(a => a.hp <= maxPlayerAtk), lowAlly = nonTanks.some(a => a.hp <= a.maxHp * 0.35);
      if (!dangerAlly && !lowAlly && !critAlly) return;
      e.tauntActive = true; const posDelta = aiEvalPosition(session.enemyCards, session.playerCards) - basePosScore;
      const resp = aiPredictPlayerResponse(session.enemyCards, session.playerCards); e.tauntActive = false;
      let score = posDelta * 2 + 25; score -= resp.damage * 2.5 + resp.killCount * 40;
      if (critAlly) score += 50; if (dangerAlly) score += 28; if (lowAlly) score += 20;
      if (aliveE.length >= 3) score += 14; if (e.hp > maxPlayerAtk * 1.5) score += 12;
      actions.push({ type: 'taunt', actor: e, score });
    });
    // CRIT
    aliveE.forEach(e => {
      if (e.type !== 'assa' || e.mana < 2 || e.critReady) return;
      const mul = e.id === 'assa_05' ? 2.5 : 2, rawDmg = rollDamage(e.atk * mul, e.variance || 0.15), ignoreT = e.id === 'assa_03';
      const liveP = session.playerCards.filter(c => c.hp > 0);
      liveP.forEach(p => {
        if (!ignoreT) { const t = aliveP.find(x => x.tauntActive && x.hp > 0); if (t && p !== t) return; }
        const dmg = Math.max(1, rawDmg - getDefBonus(p)), kill = p.hp <= dmg, oldHp = p.hp; p.hp = Math.max(0, p.hp - dmg);
        const posDelta = aiEvalPosition(session.enemyCards, session.playerCards) - basePosScore;
        const resp = aiPredictPlayerResponse(session.enemyCards, session.playerCards); p.hp = oldHp;
        let score = posDelta * 3 + dmg * 1.8; score -= resp.damage * 3.8 + resp.killCount * 60 + resp.threatLost * 5;
        if (kill) score += 100 + aiThreatScore(p) * 4; if (p.id === session.aiLastTargetId) score += 35;
        if (p.mana >= 2 && !kill) score += 22; if (p.hp <= p.maxHp * 0.4) score += 20; if (e.mana >= 4) score += 8;
        actions.push({ type: 'crit', actor: e, target: p, damage: dmg, kill, score, rawDmg, mul });
      });
    });
    // FIREBALL
    aliveE.forEach(e => {
      if (e.type !== 'mage') return; const cost = e.id === 'mage_01' ? 2 : 3; if (e.mana < cost) return;
      let fireAtk = e.atk; if (e.id === 'mage_10' && e.hp <= e.maxHp * 0.5) fireAtk += 2;
      const rawDmg = rollDamage(fireAtk, e.variance || 0.15), liveP = session.playerCards.filter(c => c.hp > 0);
      liveP.forEach(p => {
        let dmg = Math.max(1, rawDmg - getDefBonus(p)); if (e.id === 'mage_07' && p.type === 'tank') dmg += 1;
        const kill = p.hp <= dmg, oldHp = p.hp; p.hp = Math.max(0, p.hp - dmg);
        const oldDebuff = p.atkDebuff || 0; if (e.id === 'mage_02' && !kill) p.atkDebuff = (p.atkDebuff || 0) + 1;
        const oldDot = p.dotTurns || 0; if (e.id === 'mage_04' && !kill) p.dotTurns = 2;
        const oldMana = p.mana; if (e.id === 'mage_08' && !kill && p.mana > 0) p.mana--;
        const posDelta = aiEvalPosition(session.enemyCards, session.playerCards) - basePosScore;
        const resp = aiPredictPlayerResponse(session.enemyCards, session.playerCards);
        p.hp = oldHp; p.atkDebuff = oldDebuff; p.dotTurns = oldDot; p.mana = oldMana;
        let score = posDelta * 2.8 + dmg * 1.5; score -= resp.damage * 3.5 + resp.killCount * 55 + resp.threatLost * 5;
        if (kill) score += 95 + aiThreatScore(p) * 3.8; if (p.id === session.aiLastTargetId) score += 32;
        if (p.mana >= 2 && !kill) score += 20; if (e.id === 'mage_04' && !kill) score += 14;
        if (e.id === 'mage_02' && !kill) score += 12; if (e.mana >= 5) score += 7;
        if (e.id === 'mage_08' && !kill && p.mana > 0) score += 16; if (e.id === 'mage_09' && kill) score += 22;
        if (e.id === 'mage_06') score += 5;
        actions.push({ type: 'fireball', actor: e, target: p, damage: dmg, kill, score, rawDmg, cost });
      });
    });
  }

  if (!actions.length) { const r = doAiEndTurn(session); return r ? { gameEnd: r, log: logEntries } : { log: logEntries }; }
  actions.sort((a, b) => b.score - a.score); const best = actions[0];
  session.aiLastTargetId = best.target ? best.target.id : null;

  if (best.type === 'attack') {
    const { actor, target, damage, kill, critMul } = best; const isCrit = critMul > 1; if (isCrit) actor.critReady = false;
    const tgtIdx = session.playerCards.indexOf(target);
    const actIdx = session.enemyCards.indexOf(actor);
    const coverTank = tryTankCover(session.playerCards, tgtIdx);
    if (coverTank) { logEntries.push(`🛡 ${coverTank.name} прикрыл ${target.name}!`); const r = doAiEndTurn(session); return { log: logEntries, gameEnd: r, action: { type: 'attack_blocked', actor: actor.name, actorIdx: actIdx } }; }
    const wasAlive = target.hp > 0; target.hp = Math.max(0, target.hp - damage); const isDead = target.hp <= 0 && wasAlive;
    if (actor.id === 'assa_04' && isDead) { actor.mana = Math.min(MAX_MANA, actor.mana + 2); logEntries.push(`Враг: ${actor.passive}: +2 маны!`); }
    if (actor.type === 'assa' && actor.id === 'assa_02' && target.hp <= target.maxHp * 0.5) logEntries.push(`Враг: ${actor.passive}: ДОБИВАНИЕ +2 урона!`);
    let am = `${actor.name} → ${target.name} -${damage} HP`; if (getDefBonus(target) > 0) am += ` [${target.passive} -${getDefBonus(target)}]`;
    logEntries.push(am + (isCrit ? ' [КРИТ!]' : '') + (isDead ? ' [УБИТ]' : ''));
    const ta = session.playerCards.find(e => e.tauntActive && e.hp > 0 && e.id === 'tank_02');
    if (ta && target.id === ta.id && actor.hp > 0) { actor.hp = Math.max(0, actor.hp - 1); logEntries.push(`${ta.passive}: отражает 1 урон в ${actor.name}!`); }
    const aiMageSplashes = actor.type === 'mage' ? tryMageSplash(actor, session.playerCards, tgtIdx) : null;
    if (aiMageSplashes) aiMageSplashes.forEach(s => logEntries.push(`Враг: ${actor.passive}: ${s.damage} урона по ${s.neighbor.name}!`));
    const aiAssaSplash = tryAssaSplash(actor, session.playerCards, tgtIdx, damage); if (aiAssaSplash) logEntries.push(`Враг: ${actor.passive}: ${aiAssaSplash.damage} урона по ${aiAssaSplash.neighbor.name}!`);
    const aiAction = { type: 'attack', actor: actor.name, actorIdx: actIdx, target: target.name, targetIdx: tgtIdx, damage, isCrit, isDead };
    if (aiMageSplashes) aiAction.mageSplashes = aiMageSplashes.map(s => ({ neighborIdx: s.index, damage: s.damage }));
    if (aiAssaSplash) aiAction.assaSplash = { neighborIdx: aiAssaSplash.index, damage: aiAssaSplash.damage };
    const r = doAiEndTurn(session); return { log: logEntries, gameEnd: r, action: aiAction };
  }
  if (best.type === 'taunt') {
    const { actor } = best; actor.mana -= 2; actor.tauntActive = true;
    const actIdx = session.enemyCards.indexOf(actor);
    if (actor.id === 'tank_05') { actor.hp = Math.min(actor.maxHp, actor.hp + 2); logEntries.push(`Враг: ${actor.name} — ${actor.passive}: +2 HP!`); }
    logEntries.push(`Враг: ${actor.name} применяет ПРОВОКАЦИЮ!`);
    const r = doAiEndTurn(session); return { log: logEntries, gameEnd: r, action: { type: 'taunt', actor: actor.name, actorIdx: actIdx } };
  }
  if (best.type === 'crit') {
    const { actor, target, damage, kill, mul } = best; actor.mana -= 2;
    if (actor.id === 'assa_01' && Math.random() < 0.3) { actor.mana = Math.min(MAX_MANA, actor.mana + 1); logEntries.push(`Враг: ${actor.passive}: мана возвращена!`); }
    const tgtIdx = session.playerCards.indexOf(target);
    const actIdx = session.enemyCards.indexOf(actor);
    const c = tryTankCover(session.playerCards, tgtIdx);
    if (c) { logEntries.push(`🛡 ${c.name} прикрыл ${target.name}!`); const r = doAiEndTurn(session); return { log: logEntries, gameEnd: r, action: { type: 'crit_blocked', actor: actor.name, actorIdx: actIdx } }; }
    const w = target.hp > 0; target.hp = Math.max(0, target.hp - damage); const d = target.hp <= 0 && w;
    if (actor.id === 'assa_04' && d) { actor.mana = Math.min(MAX_MANA, actor.mana + 2); logEntries.push(`Враг: ${actor.passive}: +2 маны!`); }
    logEntries.push(`Враг: ${actor.name} — КРИТ${mul === 2.5 ? ' x2.5' : ' x2'} в ${target.name}! ${damage} урона.${d ? ' [УБИТ]' : ''}`);
    const ta = session.playerCards.find(e => e.tauntActive && e.hp > 0 && e.id === 'tank_02');
    if (ta && target.id === ta.id && actor.hp > 0) { actor.hp = Math.max(0, actor.hp - 1); logEntries.push(`${ta.passive}: отражает 1 урон в ${actor.name}!`); }
    const r = doAiEndTurn(session); return { log: logEntries, gameEnd: r, action: { type: 'crit', actor: actor.name, actorIdx: actIdx, target: target.name, targetIdx: tgtIdx, damage, isCrit: true, isDead: d } };
  }
  if (best.type === 'fireball') {
    const { actor, target, damage, kill, cost } = best; actor.mana -= cost;
    if (actor.id === 'mage_11' && Math.random() < 0.4) { actor.mana = Math.min(MAX_MANA, actor.mana + 2); logEntries.push(`Враг: ${actor.passive}: фаербол стоил 1 ману!`); }
    const w = target.hp > 0; target.hp = Math.max(0, target.hp - damage); const d = target.hp <= 0 && w;
    if (actor.id === 'mage_02' && target.hp > 0) target.atkDebuff = (target.atkDebuff || 0) + 1;
    if (actor.id === 'mage_03') { actor.hp = Math.min(actor.maxHp, actor.hp + 2); logEntries.push(`Враг: ${actor.passive}: +2 HP!`); }
    if (actor.id === 'mage_04' && target.hp > 0) target.dotTurns = 2;
    if (actor.id === 'mage_06' && Math.random() < 0.3) { actor.mana = Math.min(MAX_MANA, actor.mana + 1); logEntries.push(`Враг: ${actor.passive}: мана возвращена!`); }
    if (actor.id === 'mage_08' && target.hp > 0 && target.mana > 0) { target.mana--; actor.mana = Math.min(MAX_MANA, actor.mana + 1); logEntries.push(`Враг: ${actor.passive}: мана украдена!`); }
    if (actor.id === 'mage_09' && d) { actor.hp = Math.min(actor.maxHp, actor.hp + 2); actor.mana = Math.min(MAX_MANA, actor.mana + 1); logEntries.push(`Враг: ${actor.passive}: +2 HP, +1 маны!`); }
    logEntries.push(`Враг: ${actor.name} — ОГНЕННЫЙ ШАР в ${target.name}! ${damage} урона.${d ? ' [УБИТ]' : ''}`);
    const tgtIdx = session.playerCards.indexOf(target);
    const actIdx = session.enemyCards.indexOf(actor);
    const aiFbSplash = tryMageSplash(actor, session.playerCards, tgtIdx); if (aiFbSplash) aiFbSplash.forEach(s => logEntries.push(`Враг: ${actor.passive}: ${s.damage} урона по ${s.neighbor.name}!`));
    const aiAction = { type: 'fireball', actor: actor.name, actorIdx: actIdx, target: target.name, targetIdx: tgtIdx, damage, isDead: d };
    if (aiFbSplash) aiAction.mageSplashes = aiFbSplash.map(s => ({ neighborIdx: s.index, damage: s.damage }));
    const r = doAiEndTurn(session); return { log: logEntries, gameEnd: r, action: aiAction };
  }
  const r = doAiEndTurn(session); return { log: logEntries, gameEnd: r };
}

// ═══════════════ SOCKET.IO HANDLERS ═══════════════
io.on('connection', (socket) => {
  // Create session for this socket
  sessions[socket.id] = createSession();
  sessions[socket.id].lastSeen = Date.now();
  socket.emit('init', buildFullState(sessions[socket.id]));

  // Touch session on any event
  const touch = () => { if (sessions[socket.id]) sessions[socket.id].lastSeen = Date.now(); };

  // ─── SHOP ──────────────────────────────────
  socket.on('buyCard', (cardId) => {
    touch();
    const session = sessions[socket.id];
    if (!session) return;
    const c = byId(cardId);
    if (!c) return socket.emit('stateUpdate', { ...buildFullState(session), error: 'Card not found' });
    if (session.playerGold < c.price) return socket.emit('stateUpdate', { ...buildFullState(session), error: 'Not enough gold' });
    if (session.playerCollection.includes(cardId)) return socket.emit('stateUpdate', { ...buildFullState(session), error: 'Card already owned' });
    session.playerGold -= c.price;
    session.playerCollection.push(cardId);
    if (session.shopCards) session.shopCards = session.shopCards.filter(sc => sc.id !== cardId);
    socket.emit('sfx', 'buy');
    socket.emit('stateUpdate', buildFullState(session));
  });

  socket.on('getShop', () => {
    touch();
    const session = sessions[socket.id];
    if (!session) return;
    // Явный выход из боя в магазин — иначе оставшиеся в живых карты
    // держат hasBattle=true и клиент считает, что бой всё ещё идёт.
    session.playerCards = []; session.enemyCards = []; session.gameOver = false;
    session.activeIdx = -1; session.isPlayerTurn = true; session.turnLocked = false;
    if (!session.shopCards) session.shopCards = sh(ALL_CARDS.filter(c => !session.playerCollection.includes(c.id))).slice(0, SHOP_SIZE);
    socket.emit('stateUpdate', buildFullState(session));
  });

  // ─── DECK ──────────────────────────────────
  socket.on('updateDeck', (data) => {
    touch();
    const session = sessions[socket.id];
    if (!session) return;
    const cardId = data.cardId;
    if (!session.playerCollection.includes(cardId)) return socket.emit('stateUpdate', { ...buildFullState(session), error: 'Card not in collection' });
    if (session.selectedDeck.includes(cardId)) {
      session.selectedDeck = session.selectedDeck.filter(x => x !== cardId);
    } else {
      if (session.selectedDeck.length >= CARDS_PER_SIDE) return socket.emit('stateUpdate', { ...buildFullState(session), error: 'Deck full (max 3)' });
      session.selectedDeck.push(cardId);
    }
    socket.emit('sfx', 'select');
    socket.emit('stateUpdate', buildFullState(session));
  });

  // ─── UPGRADE ───────────────────────────────
  socket.on('upgradeCard', (data) => {
    touch();
    const session = sessions[socket.id];
    if (!session) return;
    const { cardId, stat } = data;
    if (!['hp', 'atk', 'mana'].includes(stat)) return socket.emit('stateUpdate', { ...buildFullState(session), error: 'Invalid stat' });
    const c = byId(cardId);
    if (!c) return socket.emit('stateUpdate', { ...buildFullState(session), error: 'Card not found' });
    if (!session.playerCollection.includes(cardId)) return socket.emit('stateUpdate', { ...buildFullState(session), error: 'Card not in collection' });
    const up = getUp(session, cardId);
    const lvl = up[stat];
    const cost = upgradeCost(stat, lvl);
    if (stat === 'mana' && lvl >= 4) return socket.emit('stateUpdate', { ...buildFullState(session), error: 'Mana maxed out' });
    if (session.playerGold < cost) return socket.emit('stateUpdate', { ...buildFullState(session), error: 'Not enough gold', needed: cost - session.playerGold });
    session.playerGold -= cost;
    up[stat]++;
    const newStats = { atk: c.atk + up.atk, hp: c.hp + up.hp, mana: 2 + up.mana };
    socket.emit('sfx', 'upgrade');
    socket.emit('stateUpdate', { ...buildFullState(session), upgraded: { cardId, stat, level: up[stat], cost }, newStats });
  });

  // ─── BATTLE START ──────────────────────────
  socket.on('startBattle', () => {
    touch();
    const session = sessions[socket.id];
    if (!session) return;
    if (session.selectedDeck.length !== CARDS_PER_SIDE) return socket.emit('stateUpdate', { ...buildFullState(session), error: 'Deck not ready (need 3 cards)' });
    session.gameOver = false; session.isPlayerTurn = Math.random() < 0.5; session.activeIdx = -1; session.abilitiesUsedThisTurn = [];
    session.turnLocked = false; session.critActivated = false; session.fireballActive = false; session.firstTurn = true; session.aiLastTargetId = null;
    session.playerCards = session.selectedDeck.map(id => { const c = byId(id); const up = getUp(session, id); return { ...c, atk: c.atk + up.atk, hp: c.hp + up.hp, maxHp: c.hp + up.hp, mana: 2 + up.mana, critReady: false, tauntActive: false, dotTurns: 0, atkDebuff: 0 }; });
    session.enemyCards = sh(ALL_CARDS.filter(c => !session.selectedDeck.includes(c.id))).slice(0, CARDS_PER_SIDE).map(c => ({ ...c, maxHp: c.hp, mana: 2, critReady: false, tauntActive: false, dotTurns: 0, atkDebuff: 0 }));
    const firstTurn = session.isPlayerTurn;
    let aiAction = null, aiLog = [], stateBeforeAi = null;
    if (!session.isPlayerTurn) {
      stateBeforeAi = buildBattleState(session);
      const ai = executeAiAction(session);
      aiAction = ai.action || null;
      aiLog = ai.log || [];
    }
    socket.emit('sfx', 'battle_start');
    socket.emit('stateUpdate', {
      ...buildFullState(session),
      stateBeforeAi,
      log: [`Бой начался. ${firstTurn ? 'Вы' : 'Противник'} ходит первым.`, 'Первый ход: только базовые атаки, способности недоступны.', ...aiLog],
      aiAction
    });
  });

  // ─── NEW CAMPAIGN ──────────────────────────
  socket.on('newCampaign', () => {
    const s = createSession();
    sessions[socket.id] = s;
    socket.emit('stateUpdate', { ...buildFullState(s), battle: null });
  });

  // ─── PLAYER SELECT ─────────────────────────
  socket.on('playerSelect', (data) => {
    touch();
    const session = sessions[socket.id];
    if (!session) return;
    const idx = data.idx;
    if (session.activeIdx === idx) {
      session.activeIdx = -1;
    } else {
      session.activeIdx = idx;
    }
    socket.emit('stateUpdate', buildFullState(session));
  });

  // ─── PLAYER ACTION ─────────────────────────
  socket.on('playerAction', (data) => {
    touch();
    const session = sessions[socket.id];
    if (!session) return;
    const { type, attackerIdx, defenderIdx, oracleProc } = data;

    if (type === 'endTurn') {
      // End turn
      if (session.gameOver) return socket.emit('stateUpdate', { ...buildFullState(session), error: 'Battle is over' });
      if (!session.isPlayerTurn) return socket.emit('stateUpdate', { ...buildFullState(session), error: 'Not your turn' });
      const logEntries = [];
      session.enemyCards.forEach(c => { const d = applyDOT(c); if (d) logEntries.push(`☠ Чума наносит ${d} урона ${c.name}!`); });
      session.activeIdx = -1; session.abilitiesUsedThisTurn = []; session.turnLocked = false; session.critActivated = false; session.fireballActive = false;
      session.firstTurn = false; session.enemyCards.forEach(c => { if (c.tauntActive) c.tauntActive = false; c.atkDebuff = 0; });
      const stateAfterPlayer = buildBattleState(session);
      const er = checkEnd(session);
      if (er) {
        socket.emit('sfx', session.playerCards.some(c => c.hp > 0) ? 'victory' : 'defeat');
        return socket.emit('stateUpdate', { ...buildFullState(session), stateAfterPlayer, log: logEntries, gameEnd: er });
      }
      session.isPlayerTurn = false;
      const ai = executeAiAction(session);
      socket.emit('stateUpdate', {
        ...buildFullState(session),
        stateAfterPlayer,
        log: [...logEntries, ...(ai.log || [])],
        gameEnd: ai.gameEnd || null,
        aiAction: ai.action || null
      });
      return;
    }

    if (type === 'crit') {
      // Activate crit ability
      if (session.gameOver) return socket.emit('stateUpdate', { ...buildFullState(session), error: 'Battle is over' });
      if (!session.isPlayerTurn) return socket.emit('stateUpdate', { ...buildFullState(session), error: 'Not your turn' });
      if (session.turnLocked) return socket.emit('stateUpdate', { ...buildFullState(session), error: 'Turn locked' });
      if (session.firstTurn) return socket.emit('stateUpdate', { ...buildFullState(session), error: 'Abilities unavailable on first turn' });
      if (attackerIdx == null) return socket.emit('stateUpdate', { ...buildFullState(session), error: 'Missing attackerIdx' });
      const c = session.playerCards[attackerIdx];
      if (!c || c.hp <= 0) return socket.emit('stateUpdate', { ...buildFullState(session), error: 'Invalid unit' });
      if (c.type !== 'assa' || c.mana < 2) return socket.emit('stateUpdate', { ...buildFullState(session), error: 'Cannot use crit' });
      if (session.abilitiesUsedThisTurn.includes(attackerIdx)) return socket.emit('stateUpdate', { ...buildFullState(session), error: 'Ability already used' });
      c.mana -= 2; c.critReady = true; session.abilitiesUsedThisTurn.push(attackerIdx); session.critActivated = true;
      socket.emit('sfx', 'crit');
      socket.emit('stateUpdate', { ...buildFullState(session), log: [`${c.name} готовит КРИТ x2! Выберите цель для удара.`] });
      return;
    }

    if (type === 'fireball') {
      // Fireball attack
      if (session.gameOver) return socket.emit('stateUpdate', { ...buildFullState(session), error: 'Battle is over' });
      if (!session.isPlayerTurn) return socket.emit('stateUpdate', { ...buildFullState(session), error: 'Not your turn' });
      if (session.firstTurn) return socket.emit('stateUpdate', { ...buildFullState(session), error: 'Abilities unavailable on first turn' });
      if (attackerIdx == null) return socket.emit('stateUpdate', { ...buildFullState(session), error: 'Missing attackerIdx' });
      if (defenderIdx == null) return socket.emit('stateUpdate', { ...buildFullState(session), error: 'Missing defenderIdx' });
      const att = session.playerCards[attackerIdx];
      if (!att || att.hp <= 0) return socket.emit('stateUpdate', { ...buildFullState(session), error: 'Invalid unit' });
      const cost = att.id === 'mage_01' ? 2 : 3;
      if (att.type !== 'mage' || att.mana < cost) return socket.emit('stateUpdate', { ...buildFullState(session), error: 'Cannot use fireball' });
      if (session.abilitiesUsedThisTurn.includes(attackerIdx)) return socket.emit('stateUpdate', { ...buildFullState(session), error: 'Ability already used' });
      const def = session.enemyCards[defenderIdx];
      if (!def || def.hp <= 0) return socket.emit('stateUpdate', { ...buildFullState(session), error: 'Invalid defender' });
      const logEntries = [];
      att.mana -= cost; session.abilitiesUsedThisTurn.push(attackerIdx); session.fireballActive = false;
      if (oracleProc) { att.mana = Math.min(MAX_MANA, att.mana + 2); logEntries.push(`${att.passive}: фаербол стоил 1 ману!`); }
      const defBonus = getDefBonus(def);
      let baseAtk = att.atk; if (att.id === 'mage_10' && att.hp <= att.maxHp * 0.5) baseAtk += 2;
      let dmg = Math.max(1, rollDamage(baseAtk, att.variance || 0.15) - defBonus); if (att.id === 'mage_07' && def.type === 'tank') dmg += 1;
      const wasAlive = def.hp > 0; def.hp = Math.max(0, def.hp - dmg); const isDead = def.hp <= 0 && wasAlive;
      if (att.id === 'mage_02' && def.hp > 0) { def.atkDebuff = (def.atkDebuff || 0) + 1; logEntries.push(`${att.passive}: ATK ${def.name} -1!`); }
      if (att.id === 'mage_03') { att.hp = Math.min(att.maxHp, att.hp + 2); logEntries.push(`${att.passive}: +2 HP (${att.hp}/${att.maxHp})`); }
      if (att.id === 'mage_04' && def.hp > 0) { def.dotTurns = 2; logEntries.push(`${att.passive}: ${def.name} заражён!`); }
      if (att.id === 'mage_06' && Math.random() < 0.3) { att.mana = Math.min(MAX_MANA, att.mana + 1); logEntries.push(`${att.passive}: мана возвращена!`); }
      if (att.id === 'mage_08' && def.hp > 0 && def.mana > 0) { def.mana--; att.mana = Math.min(MAX_MANA, att.mana + 1); logEntries.push(`${att.passive}: мана украдена!`); }
      if (att.id === 'mage_09' && isDead) { att.hp = Math.min(att.maxHp, att.hp + 2); att.mana = Math.min(MAX_MANA, att.mana + 1); logEntries.push(`${att.passive}: +2 HP, +1 маны!`); }
      let lg = `${att.name} — ОГНЕННЫЙ ШАР в ${def.name} — ${dmg} урона`;
      logEntries.push(lg + (defBonus > 0 ? ` [${def.passive} -${defBonus}]` : '') + (isDead ? ' [УБИТ]' : ''));
      const spl = tryMageSplash(att, session.enemyCards, defenderIdx); if (spl) spl.forEach(s => logEntries.push(`⚡ ${att.passive}: ${s.damage} урона по ${s.neighbor.name}!`));
      const playerAction = { type: 'fireball', attackerIdx, defenderIdx, damage: dmg, isDead };
      if (spl) playerAction.mageSplashes = spl.map(s => ({ neighborIdx: s.index, damage: s.damage }));
      const stateAfterPlayer = buildBattleState(session);
      session.activeIdx = -1; session.turnLocked = true;
      session.enemyCards.forEach(c => { const d = applyDOT(c); if (d) logEntries.push(`☠ Чума наносит ${d} урона ${c.name}!`); });
      session.abilitiesUsedThisTurn = []; session.turnLocked = false; session.critActivated = false; session.fireballActive = false; session.firstTurn = false;
      session.enemyCards.forEach(c => { if (c.tauntActive) c.tauntActive = false; c.atkDebuff = 0; });
      const er = checkEnd(session);
      if (er) {
        socket.emit('sfx', er.victory ? 'victory' : 'defeat');
        return socket.emit('stateUpdate', { ...buildFullState(session), stateAfterPlayer, log: logEntries, gameEnd: er, playerAction });
      }
      session.isPlayerTurn = false;
      const ai = executeAiAction(session);
      socket.emit('sfx', 'fireball');
      socket.emit('stateUpdate', {
        ...buildFullState(session),
        stateAfterPlayer,
        log: [...logEntries, ...(ai.log || [])],
        gameEnd: ai.gameEnd || null,
        aiAction: ai.action || null,
        playerAction
      });
      return;
    }

    if (type === 'taunt') {
      // Taunt ability
      if (session.gameOver) return socket.emit('stateUpdate', { ...buildFullState(session), error: 'Battle is over' });
      if (!session.isPlayerTurn) return socket.emit('stateUpdate', { ...buildFullState(session), error: 'Not your turn' });
      if (session.turnLocked) return socket.emit('stateUpdate', { ...buildFullState(session), error: 'Turn locked' });
      if (session.firstTurn) return socket.emit('stateUpdate', { ...buildFullState(session), error: 'Abilities unavailable on first turn' });
      if (attackerIdx == null) return socket.emit('stateUpdate', { ...buildFullState(session), error: 'Missing attackerIdx' });
      const c = session.playerCards[attackerIdx];
      if (!c || c.hp <= 0) return socket.emit('stateUpdate', { ...buildFullState(session), error: 'Invalid unit' });
      if (c.type !== 'tank' || c.mana < 2) return socket.emit('stateUpdate', { ...buildFullState(session), error: 'Cannot use taunt' });
      if (session.abilitiesUsedThisTurn.includes(attackerIdx)) return socket.emit('stateUpdate', { ...buildFullState(session), error: 'Ability already used' });
      c.mana -= 2; c.tauntActive = true; session.abilitiesUsedThisTurn.push(attackerIdx);
      const logEntries = [];
      if (c.id === 'tank_05') { c.hp = Math.min(c.maxHp, c.hp + 2); logEntries.push(`${c.passive}: +2 HP (${c.hp}/${c.maxHp})`); }
      logEntries.push(`${c.name} активирует ПРОВОКАЦИЮ${c.id==='tank_01'?' [Броня -1 урон]':c.id==='tank_02'?' [Отражает 1]':''}! Враг вынужден бить танка.`);
      const stateAfterPlayer = buildBattleState(session);
      session.activeIdx = -1; session.turnLocked = true;
      session.enemyCards.forEach(c => { const d = applyDOT(c); if (d) logEntries.push(`☠ Чума наносит ${d} урона ${c.name}!`); });
      session.abilitiesUsedThisTurn = []; session.turnLocked = false; session.critActivated = false; session.fireballActive = false; session.firstTurn = false;
      session.enemyCards.forEach(c => { if (c.tauntActive) c.tauntActive = false; c.atkDebuff = 0; });
      const er = checkEnd(session);
      if (er) {
        socket.emit('sfx', er.victory ? 'victory' : 'defeat');
        return socket.emit('stateUpdate', { ...buildFullState(session), log: logEntries, gameEnd: er });
      }
      session.isPlayerTurn = false;
      const ai = executeAiAction(session);
      socket.emit('sfx', 'taunt');
      socket.emit('stateUpdate', {
        ...buildFullState(session),
        stateAfterPlayer,
        log: [...logEntries, ...(ai.log || [])],
        gameEnd: ai.gameEnd || null,
        aiAction: ai.action || null
      });
      return;
    }

    if (type === 'attack') {
      // Basic attack
      if (session.gameOver) return socket.emit('stateUpdate', { ...buildFullState(session), error: 'Battle is over' });
      if (!session.isPlayerTurn) return socket.emit('stateUpdate', { ...buildFullState(session), error: 'Not your turn' });
      if (session.turnLocked) return socket.emit('stateUpdate', { ...buildFullState(session), error: 'Turn is locked' });
      if (attackerIdx == null || defenderIdx == null) return socket.emit('stateUpdate', { ...buildFullState(session), error: 'Missing indices' });
      const att = session.playerCards[attackerIdx], def = session.enemyCards[defenderIdx];
      if (!att || att.hp <= 0) return socket.emit('stateUpdate', { ...buildFullState(session), error: 'Invalid attacker' });
      if (!def || def.hp <= 0) return socket.emit('stateUpdate', { ...buildFullState(session), error: 'Invalid defender' });
      const taunter = session.enemyCards.find(e => e.tauntActive && e.hp > 0);
      const ignoreTaunt = att && att.type === 'assa' && att.id === 'assa_03' && att.critReady;
      if (taunter && !ignoreTaunt && def.id !== taunter.id) return socket.emit('stateUpdate', { ...buildFullState(session), error: 'Must attack taunting enemy' });
      const logEntries = [];
      let baseDmg, wasCrit = false;
      if (att.type === 'assa' && att.critReady) {
        baseDmg = att.atk * (att.id === 'assa_05' ? 2.5 : 2); wasCrit = true; att.critReady = false; session.critActivated = false;
        if (att.id === 'assa_01' && Math.random() < 0.3) { att.mana = Math.min(MAX_MANA, att.mana + 1); logEntries.push(`${att.passive}: мана возвращена!`); }
      } else {
        baseDmg = att.atk;
        if (att.type === 'assa' && att.id === 'assa_02' && def.hp <= def.maxHp * 0.5) baseDmg += 2;
      }
      const defBonus = getDefBonus(def);
      const dmg = Math.max(1, rollDamage(baseDmg, att.variance || 0.15) - defBonus);
      const cover = tryTankCover(session.enemyCards, defenderIdx);
      if (cover) {
        logEntries.push(`🛡 ${cover.name} прикрыл ${def.name}!`);
        const stateAfterPlayer = buildBattleState(session);
        session.activeIdx = -1; session.turnLocked = true;
        session.enemyCards.forEach(c => { const d = applyDOT(c); if (d) logEntries.push(`☠ Чума наносит ${d} урона ${c.name}!`); });
        session.abilitiesUsedThisTurn = []; session.turnLocked = false; session.critActivated = false; session.fireballActive = false; session.firstTurn = false;
        session.enemyCards.forEach(c => { if (c.tauntActive) c.tauntActive = false; c.atkDebuff = 0; });
        const er = checkEnd(session);
        if (er) {
          socket.emit('sfx', er.victory ? 'victory' : 'defeat');
          socket.emit('combatEvent', { type: 'attack_covered', tank: cover.name, target: def.name });
          return socket.emit('stateUpdate', { ...buildFullState(session), stateAfterPlayer, log: logEntries, gameEnd: er, action: 'attack_covered' });
        }
        session.isPlayerTurn = false;
        const ai = executeAiAction(session);
        socket.emit('combatEvent', { type: 'attack_covered', tank: cover.name, target: def.name });
        socket.emit('stateUpdate', {
          ...buildFullState(session),
          stateAfterPlayer,
          log: [...logEntries, ...(ai.log || [])],
          gameEnd: ai.gameEnd || null,
          aiAction: ai.action || null,
          action: 'attack_covered'
        });
        return;
      }
      const wasAlive = def.hp > 0; def.hp = Math.max(0, def.hp - dmg); const isDead = def.hp <= 0 && wasAlive;
      if (att.type === 'assa' && att.id === 'assa_04' && isDead) { att.mana = Math.min(MAX_MANA, att.mana + 2); logEntries.push(`${att.passive}: +2 маны!`); }
      let lg = `${att.name} атакует ${def.name} — ${dmg} урона`; if (defBonus > 0) lg += ` [${def.passive} -${defBonus}]`;
      logEntries.push(lg + (wasCrit ? ' [КРИТ!]' : '') + (isDead ? ' [УБИТ]' : ''));
      if (def.id === 'tank_02' && def.tauntActive && att.hp > 0) { att.hp = Math.max(0, att.hp - 1); logEntries.push(`${def.passive}: отражает 1 урон в ${att.name}!`); }
      const mageSplashes = att.type === 'mage' ? tryMageSplash(att, session.enemyCards, defenderIdx) : null;
      if (mageSplashes) mageSplashes.forEach(s => logEntries.push(`⚡ ${att.passive}: ${s.damage} урона по ${s.neighbor.name}!`));
      const asSpl = tryAssaSplash(att, session.enemyCards, defenderIdx, dmg); if (asSpl) logEntries.push(`🗡 ${att.passive}: ${asSpl.damage} урона по ${asSpl.neighbor.name}!`);
      const playerAction = { type: 'attack', attackerIdx, defenderIdx, damage: dmg, isCrit: wasCrit, isDead };
      if (mageSplashes) playerAction.mageSplashes = mageSplashes.map(s => ({ neighborIdx: s.index, damage: s.damage }));
      if (asSpl) playerAction.assaSplash = { neighborIdx: asSpl.index, damage: asSpl.damage };
      const stateAfterPlayer = buildBattleState(session);
      session.activeIdx = -1; session.turnLocked = true;
      session.enemyCards.forEach(c => { const d = applyDOT(c); if (d) logEntries.push(`☠ Чума наносит ${d} урона ${c.name}!`); });
      session.abilitiesUsedThisTurn = []; session.turnLocked = false; session.critActivated = false; session.fireballActive = false; session.firstTurn = false;
      session.enemyCards.forEach(c => { if (c.tauntActive) c.tauntActive = false; c.atkDebuff = 0; });
      const er2 = checkEnd(session);
      if (er2) {
        socket.emit('sfx', er2.victory ? 'victory' : 'defeat');
        return socket.emit('stateUpdate', { ...buildFullState(session), stateAfterPlayer, log: logEntries, gameEnd: er2, playerAction });
      }
      session.isPlayerTurn = false;
      const ai = executeAiAction(session);
      socket.emit('sfx', wasCrit ? 'crit' : 'attack');
      socket.emit('stateUpdate', {
        ...buildFullState(session),
        stateAfterPlayer,
        log: [...logEntries, ...(ai.log || [])],
        gameEnd: ai.gameEnd || null,
        aiAction: ai.action || null,
        playerAction
      });
      return;
    }

    // Unknown action type
    socket.emit('stateUpdate', { ...buildFullState(session), error: 'Unknown action type' });
  });

  // ─── DISCONNECT ─────────────────────────
  socket.on('disconnect', () => {
    delete sessions[socket.id];
  });
});

// ═══════════════ START SERVER ═══════════════
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Triad Duel server running on http://localhost:${PORT}`));
