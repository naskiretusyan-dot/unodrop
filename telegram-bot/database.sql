-- Создание таблицы пользователей
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    telegram_id BIGINT UNIQUE NOT NULL,
    username VARCHAR(255),
    balance DECIMAL(10, 2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Создание таблицы крипто-платежей
CREATE TABLE crypto_payments (
    id SERIAL PRIMARY KEY,
    payment_id VARCHAR(255) UNIQUE NOT NULL,
    telegram_id BIGINT NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    address TEXT NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL
);

-- Создание таблицы игр
CREATE TABLE games (
    id SERIAL PRIMARY KEY,
    telegram_id BIGINT NOT NULL,
    bet_amount DECIMAL(10, 2) NOT NULL,
    target_skin VARCHAR(255),
    result VARCHAR(20) NOT NULL, -- 'win' или 'loss'
    win_amount DECIMAL(10, 2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Создание таблицы скинов (можно импортировать из основного сайта)
CREATE TABLE skins (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    rarity VARCHAR(50),
    image_url VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Индексы для производительности
CREATE INDEX idx_users_telegram_id ON users(telegram_id);
CREATE INDEX idx_crypto_payments_telegram_id ON crypto_payments(telegram_id);
CREATE INDEX idx_crypto_payments_payment_id ON crypto_payments(payment_id);
CREATE INDEX idx_games_telegram_id ON games(telegram_id);
CREATE INDEX idx_skins_price ON skins(price);
