require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { Pool } = require('pg');
const axios = require('axios');
const crypto = require('crypto');

// Инициализация бота
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

// Инициализация базы данных
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Клавиатура главного меню
const mainKeyboard = {
  reply_markup: {
    keyboard: [
      ['💰 Пополнить баланс'],
      ['🎮 Играть в UnoDrop'],
      ['💳 Мой баланс', '📊 Статистика']
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  }
};

// Генерация уникального мемо для каждого платежа
function generateMemo() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `unodrop_${timestamp}_${random}`;
}

// Создание крипто-чека
function generateCryptoCheck(amount, paymentId, memo) {
  const checkData = {
    id: paymentId,
    address: process.env.USDT_WALLET_ADDRESS, // Один адрес для всех
    amount: amount,
    currency: 'USDT',
    network: 'The Open Network',
    memo: memo, // Уникальный мемо для идентификации
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 часа
    status: 'pending'
  };
  
  // Генерируем QR-код с адресом и мемо
  const qrUrl = `https://qr.crypt.bot/?url=${process.env.USDT_WALLET_ADDRESS}?text=${memo}`;
  
  return {
    ...checkData,
    qr_url: qrUrl,
    payment_url: `ton://transfer/${process.env.USDT_WALLET_ADDRESS}?amount=${amount}&text=${memo}`
  };
}

// Команда /start
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username || msg.from.first_name;
  
  try {
    // Создаем пользователя в БД если его нет
    await pool.query(
      'INSERT INTO users (telegram_id, username, balance) VALUES ($1, $2, 0) ON CONFLICT (telegram_id) DO UPDATE SET username = $2',
      [chatId, username]
    );
    
    await bot.sendMessage(chatId, 
      `🎉 Добро пожаловать в UnoDrop, ${username}!\n\n` +
      `💎 Уникальная игра для улучшения скинов CS2\n` +
      `💰 Пополните баланс через USDT и начните выигрывать!\n\n` +
      `Выберите действие в меню ниже:`,
      mainKeyboard
    );
  } catch (error) {
    console.error('Error in /start:', error);
    await bot.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте еще раз.');
  }
});

// Обработка кнопки "Пополнить баланс"
bot.onText(/💰 Пополнить баланс/, async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    // Получаем текущий баланс
    const userResult = await pool.query(
      'SELECT balance FROM users WHERE telegram_id = $1',
      [chatId]
    );
    
    const balance = userResult.rows[0]?.balance || 0;
    
    await bot.sendMessage(chatId,
      `💳 Ваш текущий баланс: ${balance} ₽\n\n` +
      `💎 Пополнение через USDT (The Open Network)\n\n` +
      `Выберите сумму для пополнения:`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '10 USDT (~900 ₽)', callback_data: 'topup_10' },
              { text: '25 USDT (~2250 ₽)', callback_data: 'topup_25' }
            ],
            [
              { text: '50 USDT (~4500 ₽)', callback_data: 'topup_50' },
              { text: '100 USDT (~9000 ₽)', callback_data: 'topup_100' }
            ],
            [
              { text: '💎 Другая сумма', callback_data: 'topup_custom' }
            ]
          ]
        }
      }
    );
  } catch (error) {
    console.error('Error in topup:', error);
    await bot.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте еще раз.');
  }
});

// Обработка callback'ов для пополнения
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  
  if (data.startsWith('topup_')) {
    const amount = data.replace('topup_', '');
    
    if (amount === 'custom') {
      await bot.sendMessage(chatId,
        '💎 Введите сумму в USDT (минимум 5 USDT):',
        { reply_markup: { force_reply: true } }
      );
      return;
    }
    
    await createCryptoPayment(chatId, parseFloat(amount));
    await bot.answerCallbackQuery(query.id);
  }
});

// Обработка кастомной суммы
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  
  // Проверяем, является ли сообщение ответом на запрос суммы
  if (msg.reply_to_message && msg.reply_to_message.text.includes('Введите сумму в USDT')) {
    const amount = parseFloat(text);
    
    if (isNaN(amount) || amount < 5) {
      await bot.sendMessage(chatId, '❌ Минимальная сумма пополнения: 5 USDT');
      return;
    }
    
    await createCryptoPayment(chatId, amount);
  }
});

// Создание крипто-платежа
async function createCryptoPayment(chatId, amount) {
  try {
    const paymentId = `payment_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const memo = generateMemo();
    const cryptoCheck = generateCryptoCheck(amount, paymentId, memo);
    
    // Сохраняем информацию о платеже в БД
    await pool.query(
      'INSERT INTO crypto_payments (payment_id, telegram_id, amount, address, status, expires_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [paymentId, chatId, amount, cryptoCheck.address, 'pending', cryptoCheck.expires_at]
    );
    
    // Отправляем QR-код и информацию о платеже
    await bot.sendPhoto(chatId, cryptoCheck.qr_url, {
      caption: 
        `💎 КРИПТО-ЧЕК #${paymentId}\n\n` +
        `💰 Сумма: ${amount} USDT\n` +
        `🌐 Сеть: The Open Network (TON)\n` +
        `⏰ Действителен до: ${new Date(cryptoCheck.expires_at).toLocaleString('ru-RU')}\n\n` +
        `📋 Адрес для пополнения:\n` +
        `\`${cryptoCheck.address}\`\n\n` +
        `🏷️ Обязательно укажите MEMO:\n` +
        `\`${memo}\`\n\n` +
        `⚠️ Важно: Отправляйте только USDT в сети The Open Network с указанным MEMO!\n` +
        `✅ Баланс пополнится автоматически после получения средств.\n\n` +
        `🔄 Статус платежа: /status_${paymentId}`,
      reply_markup: {
        inline_keyboard: [
          [
            { text: '📋 Скопировать адрес', callback_data: `copy_address_${paymentId}` },
            { text: '🏷️ Скопировать MEMO', callback_data: `copy_memo_${paymentId}` }
          ],
          [
            { text: '🔄 Проверить статус', callback_data: `status_${paymentId}` }
          ]
        ]
      }
    });
    
    // Запускаем проверку статуса платежа каждые 30 секунд
    startPaymentMonitoring(paymentId, chatId);
    
  } catch (error) {
    console.error('Error creating crypto payment:', error);
    await bot.sendMessage(chatId, '❌ Не удалось создать платеж. Попробуйте другую сумму.');
  }
}

// Мониторинг статуса платежа
function startPaymentMonitoring(paymentId, chatId) {
  const checkInterval = setInterval(async () => {
    try {
      // Здесь должна быть интеграция с TON API для проверки транзакций
      // Для демонстрации используем симуляцию
      
      const result = await pool.query(
        'SELECT status FROM crypto_payments WHERE payment_id = $1',
        [paymentId]
      );
      
      if (result.rows[0]?.status === 'completed') {
        clearInterval(checkInterval);
        
        await bot.sendMessage(chatId,
          `✅ Платеж #${paymentId} успешно получен!\n` +
          `💰 Баланс пополнен!\n\n` +
          `🎮 Можете начать играть!`,
          mainKeyboard
        );
      }
    } catch (error) {
      console.error('Error checking payment status:', error);
    }
  }, 30000); // Проверка каждые 30 секунд
  
  // Останавливаем проверку через 24 часа
  setTimeout(() => {
    clearInterval(checkInterval);
  }, 24 * 60 * 60 * 1000);
}

// Копирование адреса
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  
  if (data.startsWith('copy_address_')) {
    const paymentId = data.replace('copy_address_', '');
    
    try {
      const result = await pool.query(
        'SELECT address FROM crypto_payments WHERE payment_id = $1',
        [paymentId]
      );
      
      const address = result.rows[0]?.address;
      if (address) {
        await bot.sendMessage(chatId, `📋 Адрес скопирован:\n\`${address}\`\n\n🏷️ Не забудьте указать MEMO!`);
      }
    } catch (error) {
      console.error('Error copying address:', error);
    }
    
    await bot.answerCallbackQuery(query.id);
  }
  
  if (data.startsWith('copy_memo_')) {
    const paymentId = data.replace('copy_memo_', '');
    
    try {
      const result = await pool.query(
        'SELECT payment_id FROM crypto_payments WHERE payment_id = $1',
        [paymentId]
      );
      
      if (result.rows[0]) {
        const memo = generateMemo(); // Генерируем тот же мемо
        await bot.sendMessage(chatId, `🏷️ MEMO скопирован:\n\`${memo}\`\n\n⚠️ Обязательно укажите этот MEMO при отправке!`);
      }
    } catch (error) {
      console.error('Error copying memo:', error);
    }
    
    await bot.answerCallbackQuery(query.id);
  }
  
  if (data.startsWith('status_')) {
    const paymentId = data.replace('status_', '');
    
    try {
      const result = await pool.query(
        'SELECT status, created_at FROM crypto_payments WHERE payment_id = $1',
        [paymentId]
      );
      
      const payment = result.rows[0];
      if (payment) {
        const statusEmoji = payment.status === 'pending' ? '⏳' : 
                          payment.status === 'completed' ? '✅' : '❌';
        
        await bot.sendMessage(chatId,
          `${statusEmoji} Статус платежа #${paymentId}\n` +
          `� Создан: ${new Date(payment.created_at).toLocaleString('ru-RU')}\n` +
          `🔄 Текущий статус: ${payment.status}`
        );
      }
    } catch (error) {
      console.error('Error checking status:', error);
    }
    
    await bot.answerCallbackQuery(query.id);
  }
});

// Команда для проверки баланса
bot.onText(/💳 Мой баланс/, async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    const userResult = await pool.query(
      'SELECT balance FROM users WHERE telegram_id = $1',
      [chatId]
    );
    
    const balance = userResult.rows[0]?.balance || 0;
    
    await bot.sendMessage(chatId,
      `💳 Ваш баланс: ${balance} ₽\n\n` +
      `💎 Пополните баланс через USDT чтобы играть!`,
      mainKeyboard
    );
  } catch (error) {
    console.error('Error checking balance:', error);
  }
});

console.log('🤖 UnoDrop Telegram Bot с крипто-оплатой запущен!');
