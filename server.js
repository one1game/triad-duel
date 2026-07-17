const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

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

function createSession() {
  const sessionId = crypto.randomUUID();
  sessions[sessionId] = {
    playerGold: 100, playerCollection: ['mage_01', 'tank_01', 'assa_01'], selectedDeck: [], cardUpgrades: {},
    playerCards: [], enemyCards: [], activeIdx: -1, isPlayerTurn: true, gameOver: false,
    abilitiesUsedThisTurn: [], turnLocked: false, critActivated: false, fireballActive: false,
    firstTurn: false, aiLastTargetId: null,
  };
  return { sessionId, session: sessions[sessionId] };
}

function getSession(sessionId) { return sessions[sessionId] || null; }

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
    const avgDmg = rollDamage(e.atk * critMul, e.variance || 0.15);
    const liveP = session.playerCards.filter(c => c.hp > 0);
    liveP.forEach(p => {
      if (e.type !== 'assa' || e.id !== 'assa_03' || critMul === 1) { const t = aliveP.find(x => x.tauntActive && x.hp > 0); if (t && p !== t) return; }
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
    const coverTank = tryTankCover(session.playerCards, tgtIdx);
    if (coverTank) { logEntries.push(`🛡 ${coverTank.name} прикрыл ${target.name}!`); const r = doAiEndTurn(session); return { log: logEntries, gameEnd: r, action: { type: 'attack_blocked', actor: actor.name } }; }
    const wasAlive = target.hp > 0; target.hp = Math.max(0, target.hp - damage); const isDead = target.hp <= 0 && wasAlive;
    if (actor.id === 'assa_04' && isDead) { actor.mana = Math.min(MAX_MANA, actor.mana + 2); logEntries.push(`Враг: ${actor.passive}: +2 маны!`); }
    let am = `${actor.name} → ${target.name} -${damage} HP`; if (getDefBonus(target) > 0) am += ` [${target.passive} -${getDefBonus(target)}]`;
    logEntries.push(am + (isCrit ? ' [КРИТ!]' : '') + (isDead ? ' [УБИТ]' : ''));
    const ta = session.playerCards.find(e => e.tauntActive && e.hp > 0 && e.id === 'tank_02');
    if (ta && target.id === ta.id && actor.hp > 0) { actor.hp = Math.max(0, actor.hp - 1); logEntries.push(`${ta.passive}: отражает 1 урон в ${actor.name}!`); }
    if (actor.type === 'mage') { const sp = tryMageSplash(actor, session.playerCards, tgtIdx); if (sp) sp.forEach(s => logEntries.push(`Враг: ${actor.passive}: ${s.damage} урона по ${s.neighbor.name}!`)); }
    const as = tryAssaSplash(actor, session.playerCards, tgtIdx, damage); if (as) logEntries.push(`Враг: ${actor.passive}: ${as.damage} урона по ${as.neighbor.name}!`);
    const r = doAiEndTurn(session); return { log: logEntries, gameEnd: r, action: { type: 'attack', actor: actor.name, target: target.name, damage, isCrit, isDead } };
  }
  if (best.type === 'taunt') {
    const { actor } = best; actor.mana -= 2; actor.tauntActive = true;
    if (actor.id === 'tank_05') { actor.hp = Math.min(actor.maxHp, actor.hp + 2); logEntries.push(`Враг: ${actor.name} — ${actor.passive}: +2 HP!`); }
    logEntries.push(`Враг: ${actor.name} применяет ПРОВОКАЦИЮ!`);
    const r = doAiEndTurn(session); return { log: logEntries, gameEnd: r, action: { type: 'taunt', actor: actor.name } };
  }
  if (best.type === 'crit') {
    const { actor, target, damage, kill, mul } = best; actor.mana -= 2;
    if (actor.id === 'assa_01' && Math.random() < 0.3) { actor.mana = Math.min(MAX_MANA, actor.mana + 1); logEntries.push(`Враг: ${actor.passive}: мана возвращена!`); }
    const tgtIdx = session.playerCards.indexOf(target);
    const c = tryTankCover(session.playerCards, tgtIdx);
    if (c) { logEntries.push(`🛡 ${c.name} прикрыл ${target.name}!`); const r = doAiEndTurn(session); return { log: logEntries, gameEnd: r, action: { type: 'crit_blocked', actor: actor.name } }; }
    const w = target.hp > 0; target.hp = Math.max(0, target.hp - damage); const d = target.hp <= 0 && w;
    if (actor.id === 'assa_04' && d) { actor.mana = Math.min(MAX_MANA, actor.mana + 2); logEntries.push(`Враг: ${actor.passive}: +2 маны!`); }
    logEntries.push(`Враг: ${actor.name} — КРИТ${mul === 2.5 ? ' x2.5' : ' x2'} в ${target.name}! ${damage} урона.${d ? ' [УБИТ]' : ''}`);
    const ta = session.playerCards.find(e => e.tauntActive && e.hp > 0 && e.id === 'tank_02');
    if (ta && target.id === ta.id && actor.hp > 0) { actor.hp = Math.max(0, actor.hp - 1); logEntries.push(`${ta.passive}: отражает 1 урон в ${actor.name}!`); }
    const r = doAiEndTurn(session); return { log: logEntries, gameEnd: r, action: { type: 'crit', actor: actor.name, target: target.name, damage, isDead: d } };
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
    const sp = tryMageSplash(actor, session.playerCards, tgtIdx); if (sp) sp.forEach(s => logEntries.push(`Враг: ${actor.passive}: ${s.damage} урона по ${s.neighbor.name}!`));
    const r = doAiEndTurn(session); return { log: logEntries, gameEnd: r, action: { type: 'fireball', actor: actor.name, target: target.name, damage, isDead: d } };
  }
  const r = doAiEndTurn(session); return { log: logEntries, gameEnd: r };
}

function buildBattleState(session) {
  return {
    playerCards: session.playerCards, enemyCards: session.enemyCards,
    activeIdx: session.activeIdx, isPlayerTurn: session.isPlayerTurn, gameOver: session.gameOver,
    abilitiesUsedThisTurn: session.abilitiesUsedThisTurn, turnLocked: session.turnLocked,
    critActivated: session.critActivated, fireballActive: session.fireballActive, firstTurn: session.firstTurn,
    playerGold: session.playerGold, playerCollection: session.playerCollection,
    selectedDeck: session.selectedDeck, cardUpgrades: session.cardUpgrades,
  };
}

// ═══════════════ API: NEW CAMPAIGN ═══════════════
app.post('/api/new-campaign', (req, res) => {
  const r = createSession(); res.json({ sessionId: r.sessionId, ...r.session });
});

// ═══════════════ API: GET STATE ═══════════════
app.get('/api/state/:sessionId', (req, res) => {
  const s = getSession(req.params.sessionId); if (!s) return res.status(404).json({ error: 'Session not found' }); res.json(s);
});

// ═══════════════ API: SHOP ═══════════════
app.get('/api/shop/:sessionId', (req, res) => {
  const s = getSession(req.params.sessionId); if (!s) return res.status(404).json({ error: 'Session not found' });
  res.json(sh(ALL_CARDS.filter(c => !s.playerCollection.includes(c.id))).slice(0, SHOP_SIZE));
});

// ═══════════════ API: BUY ═══════════════
app.post('/api/buy/:sessionId', (req, res) => {
  const s = getSession(req.params.sessionId); if (!s) return res.status(404).json({ error: 'Session not found' });
  const { cardId } = req.body; const c = byId(cardId);
  if (!c) return res.status(400).json({ error: 'Card not found' });
  if (s.playerGold < c.price) return res.status(400).json({ error: 'Not enough gold' });
  if (s.playerCollection.includes(cardId)) return res.status(400).json({ error: 'Card already owned' });
  s.playerGold -= c.price; s.playerCollection.push(cardId);
  res.json({ playerGold: s.playerGold, playerCollection: s.playerCollection, purchased: c });
});

// ═══════════════ API: UPGRADE ═══════════════
app.post('/api/upgrade/:sessionId', (req, res) => {
  const s = getSession(req.params.sessionId); if (!s) return res.status(404).json({ error: 'Session not found' });
  const { cardId, stat } = req.body;
  if (!['hp', 'atk', 'mana'].includes(stat)) return res.status(400).json({ error: 'Invalid stat' });
  const c = byId(cardId); if (!c) return res.status(400).json({ error: 'Card not found' });
  if (!s.playerCollection.includes(cardId)) return res.status(400).json({ error: 'Card not in collection' });
  const up = getUp(s, cardId); const lvl = up[stat]; const cost = upgradeCost(stat, lvl);
  if (s.playerGold < cost) return res.status(400).json({ error: 'Not enough gold', needed: cost - s.playerGold });
  if (stat === 'mana' && lvl >= 4) return res.status(400).json({ error: 'Mana maxed out' });
  s.playerGold -= cost; up[stat]++;
  res.json({ playerGold: s.playerGold, cardUpgrades: s.cardUpgrades, upgraded: { cardId, stat, level: up[stat], cost }, newStats: { atk: c.atk + up.atk, hp: c.hp + up.hp, mana: 2 + up.mana } });
});

// ═══════════════ API: DECK SELECT ═══════════════
app.post('/api/deck/select/:sessionId', (req, res) => {
  const s = getSession(req.params.sessionId); if (!s) return res.status(404).json({ error: 'Session not found' });
  const { cardId } = req.body; if (!s.playerCollection.includes(cardId)) return res.status(400).json({ error: 'Card not in collection' });
  if (s.selectedDeck.includes(cardId)) s.selectedDeck = s.selectedDeck.filter(x => x !== cardId);
  else { if (s.selectedDeck.length >= CARDS_PER_SIDE) return res.status(400).json({ error: 'Deck full (max 3)' }); s.selectedDeck.push(cardId); }
  res.json({ playerGold: s.playerGold, playerCollection: s.playerCollection, selectedDeck: s.selectedDeck, cardUpgrades: s.cardUpgrades, deckReady: s.selectedDeck.length === CARDS_PER_SIDE });
});

// ═══════════════ API: BATTLE START ═══════════════
app.post('/api/battle/start/:sessionId', (req, res) => {
  const s = getSession(req.params.sessionId); if (!s) return res.status(404).json({ error: 'Session not found' });
  if (s.selectedDeck.length !== CARDS_PER_SIDE) return res.status(400).json({ error: 'Deck not ready (need 3 cards)' });
  s.gameOver = false; s.isPlayerTurn = Math.random() < 0.5; s.activeIdx = -1; s.abilitiesUsedThisTurn = [];
  s.turnLocked = false; s.critActivated = false; s.fireballActive = false; s.firstTurn = true; s.aiLastTargetId = null;
  s.playerCards = s.selectedDeck.map(id => { const c = byId(id); const up = getUp(s, id); return { ...c, atk: c.atk + up.atk, hp: c.hp + up.hp, maxHp: c.hp + up.hp, mana: 2 + up.mana, critReady: false, tauntActive: false, dotTurns: 0, atkDebuff: 0 }; });
  s.enemyCards = sh(ALL_CARDS.filter(c => !s.selectedDeck.includes(c.id))).slice(0, CARDS_PER_SIDE).map(c => ({ ...c, maxHp: c.hp, mana: 2, critReady: false, tauntActive: false, dotTurns: 0, atkDebuff: 0 }));
  res.json({ ...buildBattleState(s), log: [`Бой начался. ${s.isPlayerTurn ? 'Вы' : 'Противник'} ходит первым.`, 'Первый ход: только базовые атаки, способности недоступны.'] });
});

// ═══════════════ API: BATTLE ATTACK ═══════════════
app.post('/api/battle/attack/:sessionId', (req, res) => {
  const s = getSession(req.params.sessionId); if (!s) return res.status(404).json({ error: 'Session not found' });
  if (s.gameOver) return res.status(400).json({ error: 'Battle is over' }); if (!s.isPlayerTurn) return res.status(400).json({ error: 'Not your turn' });
  if (s.turnLocked) return res.status(400).json({ error: 'Turn is locked' });
  const { attackerIdx, defenderIdx } = req.body;
  if (attackerIdx == null || defenderIdx == null) return res.status(400).json({ error: 'Missing indices' });
  const att = s.playerCards[attackerIdx], def = s.enemyCards[defenderIdx];
  if (!att || att.hp <= 0) return res.status(400).json({ error: 'Invalid attacker' });
  if (!def || def.hp <= 0) return res.status(400).json({ error: 'Invalid defender' });
  const taunter = s.enemyCards.find(e => e.tauntActive && e.hp > 0);
  const ignoreTaunt = att && att.type === 'assa' && att.id === 'assa_03' && att.critReady;
  if (taunter && !ignoreTaunt && def.id !== taunter.id) return res.status(400).json({ error: 'Must attack taunting enemy' });
  const logEntries = []; let baseDmg, wasCrit = false;
  if (att.type === 'assa' && att.critReady) { baseDmg = att.atk * (att.id === 'assa_05' ? 2.5 : 2); wasCrit = true; att.critReady = false; s.critActivated = false; if (att.id === 'assa_01' && Math.random() < 0.3) { att.mana = Math.min(MAX_MANA, att.mana + 1); logEntries.push(`${att.passive}: мана возвращена!`); } }
  else { baseDmg = att.atk; if (att.type === 'assa' && att.id === 'assa_02' && def.hp <= def.maxHp * 0.5) baseDmg += 2; }
  const defBonus = getDefBonus(def), dmg = Math.max(1, rollDamage(baseDmg, att.variance || 0.15) - defBonus);
  const cover = tryTankCover(s.enemyCards, defenderIdx);
  if (cover) { logEntries.push(`🛡 ${cover.name} прикрыл ${def.name}!`); s.activeIdx = -1; s.turnLocked = true; return res.json({ ...buildBattleState(s), log: logEntries, action: 'attack_covered' }); }
  const wasAlive = def.hp > 0; def.hp = Math.max(0, def.hp - dmg); const isDead = def.hp <= 0 && wasAlive;
  if (att.type === 'assa' && att.id === 'assa_04' && isDead) { att.mana = Math.min(MAX_MANA, att.mana + 2); logEntries.push(`${att.passive}: +2 маны!`); }
  let lg = `${att.name} атакует ${def.name} — ${dmg} урона`; if (defBonus > 0) lg += ` [${def.passive} -${defBonus}]`;
  logEntries.push(lg + (wasCrit ? ' [КРИТ!]' : '') + (isDead ? ' [УБИТ]' : ''));
  if (def.id === 'tank_02' && def.tauntActive && att.hp > 0) { att.hp = Math.max(0, att.hp - 1); logEntries.push(`${def.passive}: отражает 1 урон в ${att.name}!`); }
  if (att.type === 'mage') { const spl = tryMageSplash(att, s.enemyCards, defenderIdx); if (spl) spl.forEach(s => logEntries.push(`⚡ ${att.passive}: ${s.damage} урона по ${s.neighbor.name}!`)); }
  const asSpl = tryAssaSplash(att, s.enemyCards, defenderIdx, dmg); if (asSpl) logEntries.push(`🗡 ${att.passive}: ${asSpl.damage} урона по ${asSpl.neighbor.name}!`);
  s.activeIdx = -1; s.turnLocked = true;
  // End player turn
  s.enemyCards.forEach(c => { const d = applyDOT(c); if (d) logEntries.push(`☠ Чума наносит ${d} урона ${c.name}!`); });
  s.abilitiesUsedThisTurn = []; s.turnLocked = false; s.critActivated = false; s.fireballActive = false; s.firstTurn = false;
  s.enemyCards.forEach(c => { if (c.tauntActive) c.tauntActive = false; c.atkDebuff = 0; });
  const er = checkEnd(s); if (er) return res.json({ ...buildBattleState(s), log: logEntries, gameEnd: er });
  s.isPlayerTurn = false; const ai = executeAiAction(s);
  res.json({ ...buildBattleState(s), log: [...logEntries, ...(ai.log || [])], gameEnd: ai.gameEnd || null, aiAction: ai.action || null });
});

// ═══════════════ API: USE TAUNT ═══════════════
app.post('/api/battle/taunt/:sessionId', (req, res) => {
  const s = getSession(req.params.sessionId); if (!s) return res.status(404).json({ error: 'Session not found' });
  if (s.gameOver) return res.status(400).json({ error: 'Battle is over' }); if (!s.isPlayerTurn) return res.status(400).json({ error: 'Not your turn' });
  if (s.turnLocked) return res.status(400).json({ error: 'Turn locked' }); if (s.firstTurn) return res.status(400).json({ error: 'Abilities unavailable on first turn' });
  if (s.activeIdx < 0) return res.status(400).json({ error: 'No active unit' });
  const c = s.playerCards[s.activeIdx];
  if (c.type !== 'tank' || c.mana < 2) return res.status(400).json({ error: 'Cannot use taunt' });
  if (s.abilitiesUsedThisTurn.includes(s.activeIdx)) return res.status(400).json({ error: 'Ability already used' });
  c.mana -= 2; c.tauntActive = true; s.abilitiesUsedThisTurn.push(s.activeIdx);
  const logEntries = [];
  if (c.id === 'tank_05') { c.hp = Math.min(c.maxHp, c.hp + 2); logEntries.push(`${c.passive}: +2 HP (${c.hp}/${c.maxHp})`); }
  logEntries.push(`${c.name} активирует ПРОВОКАЦИЮ! Враг вынужден бить танка.`);
  s.activeIdx = -1; s.turnLocked = true;
  s.enemyCards.forEach(c => { const d = applyDOT(c); if (d) logEntries.push(`☠ Чума наносит ${d} урона ${c.name}!`); });
  s.abilitiesUsedThisTurn = []; s.turnLocked = false; s.critActivated = false; s.fireballActive = false; s.firstTurn = false;
  s.enemyCards.forEach(c => { if (c.tauntActive) c.tauntActive = false; c.atkDebuff = 0; });
  const er = checkEnd(s); if (er) return res.json({ ...buildBattleState(s), log: logEntries, gameEnd: er });
  s.isPlayerTurn = false; const ai = executeAiAction(s);
  res.json({ ...buildBattleState(s), log: [...logEntries, ...(ai.log || [])], gameEnd: ai.gameEnd || null, aiAction: ai.action || null });
});

// ═══════════════ API: USE CRIT ═══════════════
app.post('/api/battle/crit/:sessionId', (req, res) => {
  const s = getSession(req.params.sessionId); if (!s) return res.status(404).json({ error: 'Session not found' });
  if (s.gameOver) return res.status(400).json({ error: 'Battle is over' }); if (!s.isPlayerTurn) return res.status(400).json({ error: 'Not your turn' });
  if (s.turnLocked) return res.status(400).json({ error: 'Turn locked' }); if (s.firstTurn) return res.status(400).json({ error: 'Abilities unavailable on first turn' });
  if (s.activeIdx < 0) return res.status(400).json({ error: 'No active unit' });
  const c = s.playerCards[s.activeIdx];
  if (c.type !== 'assa' || c.mana < 2) return res.status(400).json({ error: 'Cannot use crit' });
  if (s.abilitiesUsedThisTurn.includes(s.activeIdx)) return res.status(400).json({ error: 'Ability already used' });
  c.mana -= 2; c.critReady = true; s.abilitiesUsedThisTurn.push(s.activeIdx); s.critActivated = true;
  res.json({ ...buildBattleState(s), log: [`${c.name} готовит КРИТ x2! Выберите цель для удара.`] });
});

// ═══════════════ API: USE FIREBALL ═══════════════
app.post('/api/battle/fireball/:sessionId', (req, res) => {
  const s = getSession(req.params.sessionId); if (!s) return res.status(404).json({ error: 'Session not found' });
  if (s.gameOver) return res.status(400).json({ error: 'Battle is over' }); if (!s.isPlayerTurn) return res.status(400).json({ error: 'Not your turn' });
  if (s.firstTurn) return res.status(400).json({ error: 'Abilities unavailable on first turn' });
  if (s.activeIdx < 0) return res.status(400).json({ error: 'No active unit' });
  const { defenderIdx } = req.body; if (defenderIdx == null) return res.status(400).json({ error: 'Missing defenderIdx' });
  const att = s.playerCards[s.activeIdx], cost = att.id === 'mage_01' ? 2 : 3;
  if (att.type !== 'mage' || att.mana < cost) return res.status(400).json({ error: 'Cannot use fireball' });
  if (s.abilitiesUsedThisTurn.includes(s.activeIdx)) return res.status(400).json({ error: 'Ability already used' });
  const def = s.enemyCards[defenderIdx]; if (!def || def.hp <= 0) return res.status(400).json({ error: 'Invalid defender' });
  const logEntries = []; att.mana -= cost; s.abilitiesUsedThisTurn.push(s.activeIdx); s.fireballActive = false;
  if (att.id === 'mage_11' && Math.random() < 0.4) { att.mana = Math.min(MAX_MANA, att.mana + 2); logEntries.push(`${att.passive}: фаербол стоил 1 ману!`); }
  const defBonus = getDefBonus(def); let baseAtk = att.atk; if (att.id === 'mage_10' && att.hp <= att.maxHp * 0.5) baseAtk += 2;
  let dmg = Math.max(1, rollDamage(baseAtk, att.variance || 0.15) - defBonus); if (att.id === 'mage_07' && def.type === 'tank') dmg += 1;
  const wasAlive = def.hp > 0; def.hp = Math.max(0, def.hp - dmg); const isDead = def.hp <= 0 && wasAlive;
  if (att.id === 'mage_02' && def.hp > 0) { def.atkDebuff = (def.atkDebuff || 0) + 1; logEntries.push(`${att.passive}: ATK ${def.name} -1!`); }
  if (att.id === 'mage_03') { att.hp = Math.min(att.maxHp, att.hp + 2); logEntries.push(`${att.passive}: +2 HP (${att.hp}/${att.maxHp})`); }
  if (att.id === 'mage_04' && def.hp > 0) { def.dotTurns = 2; logEntries.push(`${att.passive}: ${def.name} заражён!`); }
  if (att.id === 'mage_06' && Math.random() < 0.3) { att.mana = Math.min(MAX_MANA, att.mana + 1); logEntries.push(`${att.passive}: мана возвращена!`); }
  if (att.id === 'mage_08' && def.hp > 0 && def.mana > 0) { def.mana--; att.mana = Math.min(MAX_MANA, att.mana + 1); logEntries.push(`${att.passive}: мана украдена!`); }
  if (att.id === 'mage_09' && isDead) { att.hp = Math.min(att.maxHp, att.hp + 2); att.mana = Math.min(MAX_MANA, att.mana + 1); logEntries.push(`${att.passive}: +2 HP, +1 маны!`); }
  let lg = `${att.name} — ОГНЕННЫЙ ШАР в ${def.name} — ${dmg} урона`; logEntries.push(lg + (defBonus > 0 ? ` [${def.passive} -${defBonus}]` : '') + (isDead ? ' [УБИТ]' : ''));
  const spl = tryMageSplash(att, s.enemyCards, defenderIdx); if (spl) spl.forEach(s => logEntries.push(`⚡ ${att.passive}: ${s.damage} урона по ${s.neighbor.name}!`));
  s.activeIdx = -1; s.turnLocked = true;
  s.enemyCards.forEach(c => { const d = applyDOT(c); if (d) logEntries.push(`☠ Чума наносит ${d} урона ${c.name}!`); });
  s.abilitiesUsedThisTurn = []; s.turnLocked = false; s.critActivated = false; s.fireballActive = false; s.firstTurn = false;
  s.enemyCards.forEach(c => { if (c.tauntActive) c.tauntActive = false; c.atkDebuff = 0; });
  const er = checkEnd(s); if (er) return res.json({ ...buildBattleState(s), log: logEntries, gameEnd: er });
  s.isPlayerTurn = false; const ai = executeAiAction(s);
  res.json({ ...buildBattleState(s), log: [...logEntries, ...(ai.log || [])], gameEnd: ai.gameEnd || null, aiAction: ai.action || null });
});

// ═══════════════ API: END TURN ═══════════════
app.post('/api/battle/end-turn/:sessionId', (req, res) => {
  const s = getSession(req.params.sessionId); if (!s) return res.status(404).json({ error: 'Session not found' });
  if (s.gameOver) return res.status(400).json({ error: 'Battle is over' }); if (!s.isPlayerTurn) return res.status(400).json({ error: 'Not your turn' });
  const logEntries = [];
  s.enemyCards.forEach(c => { const d = applyDOT(c); if (d) logEntries.push(`☠ Чума наносит ${d} урона ${c.name}!`); });
  s.activeIdx = -1; s.abilitiesUsedThisTurn = []; s.turnLocked = false; s.critActivated = false; s.fireballActive = false;
  s.firstTurn = false; s.enemyCards.forEach(c => { if (c.tauntActive) c.tauntActive = false; c.atkDebuff = 0; });
  const er = checkEnd(s); if (er) return res.json({ ...buildBattleState(s), log: logEntries, gameEnd: er });
  s.isPlayerTurn = false; const ai = executeAiAction(s);
  res.json({ ...buildBattleState(s), log: [...logEntries, ...(ai.log || [])], gameEnd: ai.gameEnd || null, aiAction: ai.action || null });
});

// ═══════════════ START SERVER ═══════════════
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => { console.log(`Triad Duel server running on http://localhost:${PORT}`); });
