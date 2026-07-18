// Auth-only microservice for Vercel (uses Supabase for state)
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

function signJWT(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' });
}

// ═══ AUTH CODES (Supabase) ═══
function generateAuthCode() {
  return crypto.randomBytes(16).toString('hex');
}

async function storeAuthCode(code) {
  // Clean old codes (older than 5 min)
  await supabase.from('kart_auth_codes').delete().lt('created_at', new Date(Date.now() - 5 * 60 * 1000).toISOString());
  await supabase.from('kart_auth_codes').insert({ code, created_at: new Date().toISOString() });
}

async function resolveAuthCode(code, telegramId) {
  const { data } = await supabase.from('kart_auth_codes').select('*').eq('code', code).single();
  if (!data || data.telegram_id) return false;
  await supabase.from('kart_auth_codes').update({ telegram_id: telegramId }).eq('code', code);
  return true;
}

async function getAuthCodeTelegramId(code) {
  const { data } = await supabase.from('kart_auth_codes').select('*').eq('code', code).single();
  if (!data || !data.telegram_id) return null;
  await supabase.from('kart_auth_codes').delete().eq('code', code);
  return data.telegram_id;
}

// ═══ PLAYER DB ═══
async function getOrCreatePlayer(telegramId, userData) {
  const { data } = await supabase.from('kart_players').select('*').eq('telegram_id', telegramId).single();
  if (data) return data;
  const defaults = {
    id: crypto.randomUUID(),
    telegram_id: telegramId,
    username: userData?.first_name || userData?.username || ('tg' + telegramId),
    gold: 100,
    collection: ['mage_01', 'tank_01', 'assa_01'],
    card_upgrades: {},
    selected_deck: [],
    wins: 0,
    losses: 0
  };
  await supabase.from('kart_players').insert(defaults);
  return defaults;
}

// ═══ HANDLER ═══
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname.replace('/api/auth', '');

  // GET /api/auth/start
  if (req.method === 'GET' && path === '/start') {
    const code = generateAuthCode();
    await storeAuthCode(code);
    return res.json({ code, bot_url: `https://t.me/triad_duel_bot?start=${code}` });
  }

  // GET /api/auth/poll
  if (req.method === 'GET' && path === '/poll') {
    const code = url.searchParams.get('code');
    if (!code) return res.status(400).json({ error: 'code required' });
    const telegramId = await getAuthCodeTelegramId(code);
    if (!telegramId) return res.json({ ready: false });
    const player = await getOrCreatePlayer(telegramId, { username: 'tg' + telegramId });
    const token = signJWT({ sub: player.id, telegram_id: telegramId, username: player.username });
    return res.json({ ready: true, token, user: { id: player.id, username: player.username } });
  }

  // POST /api/auth/webhook — receives Telegram bot updates
  if (req.method === 'POST' && path === '/webhook') {
    try {
      const msg = req.body?.message || req.body?.edited_message;
      if (msg?.text && msg?.from?.id) {
        const text = msg.text.trim();
        if (text.startsWith('/start ')) {
          const code = text.replace('/start ', '').trim();
          await resolveAuthCode(code, msg.from.id);
        }
      }
    } catch (e) { /* ignore */ }
    return res.status(200).json({ ok: true });
  }

  res.status(404).json({ error: 'not found' });
};
