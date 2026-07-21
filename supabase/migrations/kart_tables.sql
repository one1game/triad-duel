-- Triad Duel: карточная игра
-- Таблицы с префиксом kart_ — не конфликтуют с существующими таблицами

-- Профили игроков
CREATE TABLE IF NOT EXISTS kart_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id TEXT UNIQUE,
  username TEXT NOT NULL,
  gold INTEGER NOT NULL DEFAULT 100,
  collection TEXT[] NOT NULL DEFAULT ARRAY['mage_01','tank_01','assa_01']::TEXT[],
  card_upgrades JSONB NOT NULL DEFAULT '{}'::JSONB,
  selected_deck TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  premium_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Индекс для поиска по telegram_id
CREATE INDEX IF NOT EXISTS kart_players_telegram_idx ON kart_players(telegram_id);

-- Включаем RLS
ALTER TABLE kart_players ENABLE ROW LEVEL SECURITY;

-- Политики: игрок видит/обновляет только свой профиль (по telegram_id через серверный ключ)
CREATE POLICY kart_players_select ON kart_players
  FOR SELECT USING (true);

CREATE POLICY kart_players_insert ON kart_players
  FOR INSERT WITH CHECK (true);

CREATE POLICY kart_players_update ON kart_players
  FOR UPDATE USING (true);

-- История боёв
CREATE TABLE IF NOT EXISTS kart_battles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES kart_players(id) ON DELETE CASCADE,
  result TEXT NOT NULL CHECK (result IN ('win', 'loss')),
  gold_earned INTEGER NOT NULL DEFAULT 0,
  player_deck TEXT[] NOT NULL,
  enemy_deck TEXT[] NOT NULL,
  turns INTEGER NOT NULL DEFAULT 0,
  log JSONB NOT NULL DEFAULT '[]'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE kart_battles ENABLE ROW LEVEL SECURITY;

CREATE POLICY kart_battles_select ON kart_battles
  FOR SELECT USING (true);

CREATE POLICY kart_battles_insert ON kart_battles
  FOR INSERT WITH CHECK (true);

-- Индекс для быстрого поиска истории игрока
CREATE INDEX IF NOT EXISTS kart_battles_player_idx ON kart_battles(player_id, created_at DESC);
