-- Triad Duel: карточная игра
-- Таблицы с префиксом kart_ — не конфликтуют с существующими таблицами

-- Профили игроков (связаны с auth.users через id)
CREATE TABLE IF NOT EXISTS kart_players (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  gold INTEGER NOT NULL DEFAULT 100,
  collection TEXT[] NOT NULL DEFAULT ARRAY['mage_01','tank_01','assa_01']::TEXT[],
  card_upgrades JSONB NOT NULL DEFAULT '{}'::JSONB,
  selected_deck TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Включаем RLS
ALTER TABLE kart_players ENABLE ROW LEVEL SECURITY;

-- Политики: игрок видит только свой профиль
CREATE POLICY kart_players_select ON kart_players
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY kart_players_insert ON kart_players
  FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY kart_players_update ON kart_players
  FOR UPDATE USING (auth.uid() = id);

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
  FOR SELECT USING (auth.uid() = player_id);

CREATE POLICY kart_battles_insert ON kart_battles
  FOR INSERT WITH CHECK (auth.uid() = player_id);

-- Индекс для быстрого поиска истории игрока
CREATE INDEX IF NOT EXISTS kart_battles_player_idx ON kart_battles(player_id, created_at DESC);
