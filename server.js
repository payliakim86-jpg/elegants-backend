const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const TelegramBot = require('node-telegram-bot-api');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

const JWT_SECRET = process.env.JWT_SECRET || 'elegants-secret-2024';

// ─── AUTH MIDDLEWARE ───────────────────────────────────────────────
function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function adminAuth(req, res, next) {
  auth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    next();
  });
}

// ─── TELEGRAM BOT ──────────────────────────────────────────────────
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  await supabase.from('bot_subscribers').upsert({ chat_id: chatId.toString() });

  const payload = msg.text?.split(' ')[1];
  if (payload && payload.startsWith('tg')) {
    const token = payload.slice(2);
    await supabase.from('bot_subscribers').upsert({ chat_id: chatId.toString(), pending_token: token });
  }

  const siteUrl = process.env.SITE_URL || 'https://elegants-store.vercel.app';
  bot.sendMessage(chatId,
    `👗 *Ласкаво просимо до Elegant's Store!*\n\nОтримуйте сповіщення про статус ваших замовлень прямо тут у Telegram.\n\nНажміть кнопку нижче щоб почати покупки!`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '🛍 Відкрити магазин', url: `${siteUrl}?tg=${chatId}` }
        ]]
      }
    }
  );
});

bot.onText(/\/stats/, async (msg) => {
  const chatId = msg.chat.id;
  const today = new Date().toISOString().split('T')[0];
  const { data: admins } = await supabase.from('users').select('id').eq('role', 'admin');
  const adminIds = (admins || []).map(a => a.id);
  const notAdmins = (q) => adminIds.length ? q.not('user_id', 'in', `(${adminIds.join(',')})`) : q;

  const [allOrders, todayOrders, revenue, newUsers] = await Promise.all([
    notAdmins(supabase.from('orders').select('id', { count: 'exact', head: true })),
    notAdmins(supabase.from('orders').select('id', { count: 'exact', head: true }).gte('created_at', today)),
    notAdmins(supabase.from('orders').select('total').eq('status', 'completed')),
    supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'customer').gte('created_at', today)
  ]);

  const totalRevenue = (revenue.data || []).reduce((s, o) => s + o.total, 0);
  const text = `📊 *СТАТИСТИКА МАГАЗИНУ*\n\n` +
    `📦 *Замовлень сьогодні:* ${todayOrders.count || 0}\n` +
    `📦 *Всього замовлень:* ${allOrders.count || 0}\n` +
    `💰 *Виручка (виконані):* ₴${totalRevenue.toLocaleString('uk-UA')}\n` +
    `👤 *Нових покупців сьогодні:* ${newUsers.count || 0}`;

  bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
});

bot.onText(/\/users/, async (msg) => {
  const chatId = msg.chat.id;
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const today = new Date().toISOString().split('T')[0];

  const [totalRes, onlineRes, todayRes] = await Promise.all([
    supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'customer'),
    supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'customer').gte('last_seen', fiveMinAgo),
    supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'customer').gte('created_at', today)
  ]);

  const text = `👥 *СТАТИСТИКА ПОКУПЦІВ*\n\n` +
    `🟢 *Онлайн зараз:* ${onlineRes.count || 0}\n` +
    `📅 *Нових сьогодні:* ${todayRes.count || 0}\n` +
    `👤 *Всього зареєстрованих:* ${totalRes.count || 0}\n\n` +
    `_Онлайн = активні за останні 5 хв_`;

  bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
});

// Callback від кнопок статусу замовлення
bot.on('callback_query', async (query) => {
  const [action, orderId] = query.data.split(':');
  const statusMap = {
    confirm: 'confirmed',
    ship: 'shipped',
    cancel: 'cancelled'
  };
  const newStatus = statusMap[action];
  if (!newStatus || !orderId) return bot.answerCallbackQuery(query.id, { text: 'Невідома дія' });

  const { data: order, error } = await supabase
    .from('orders').update({ status: newStatus }).eq('id', orderId).select('*, users(telegram_chat_id, name)').single();

  if (error) return bot.answerCallbackQuery(query.id, { text: '❌ Помилка оновлення' });

  const statusLabels = { confirmed: '✅ Підтверджено', shipped: '🚚 Відправлено', cancelled: '❌ Скасовано' };
  bot.answerCallbackQuery(query.id, { text: `${statusLabels[newStatus]} — замовлення #${orderId}` });

  try {
    const newKeyboard = newStatus === 'confirmed'
      ? { inline_keyboard: [[{ text: '🚚 Відправити', callback_data: `ship:${orderId}` }, { text: '❌ Скасувати', callback_data: `cancel:${orderId}` }]] }
      : { inline_keyboard: [] };
    await bot.editMessageReplyMarkup(newKeyboard, { chat_id: query.message.chat.id, message_id: query.message.message_id });
  } catch {}

  const buyerChatId = order.users?.telegram_chat_id;
  if (buyerChatId) {
    const msgMap = {
      confirmed: `✅ *Ваше замовлення #${orderId} підтверджено!*\n\nМи вже готуємо ваше замовлення. Очікуйте відправки.`,
      shipped: `🚚 *Ваше замовлення #${orderId} відправлено!*\n\nПосилка в дорозі. Слідкуйте за трекінгом у вашій пошті.`,
      cancelled: `❌ *Замовлення #${orderId} скасовано.*\n\nЯкщо у вас є питання — зв'яжіться з нами.`
    };
    try {
      await bot.sendMessage(buyerChatId, msgMap[newStatus], { parse_mode: 'Markdown' });
    } catch (e) {
      console.error(`Cannot notify buyer ${buyerChatId}:`, e.message);
    }
  }
});

async function notifyOrder(order) {
  const { data: subscribers } = await supabase.from('bot_subscribers').select('chat_id');
  if (!subscribers?.length) return;

  const items = order.items.map(i => `• ${i.name} x${i.qty} — ₴${i.price * i.qty}`).join('\n');
  const delivery = {
    nova_poshta: '📦 Нова Пошта',
    ukrposhta: '✉️ Укрпошта',
    self_pickup: '🏪 Самовивіз'
  }[order.delivery_type] || order.delivery_type;

  const text = `🛍 *НОВЕ ЗАМОВЛЕННЯ #${order.id}*\n\n` +
    `👤 *Покупець:* ${order.customer_name}\n` +
    `📞 *Телефон:* ${order.phone}\n\n` +
    `📋 *Товари:*\n${items}\n\n` +
    `💰 *Сума:* ₴${order.total}\n` +
    `${delivery}\n` +
    (order.delivery_address ? `📍 *Адреса:* ${order.delivery_address}\n` : '') +
    (order.comment ? `💬 *Коментар:* ${order.comment}` : '');

  const keyboard = {
    inline_keyboard: [[
      { text: '✅ Підтвердити', callback_data: `confirm:${order.id}` },
      { text: '🚚 Відправити', callback_data: `ship:${order.id}` },
      { text: '❌ Скасувати', callback_data: `cancel:${order.id}` }
    ]]
  };

  for (const sub of subscribers) {
    try {
      await bot.sendMessage(sub.chat_id, text, { parse_mode: 'Markdown', reply_markup: keyboard });
    } catch (e) {
      console.error(`Failed to send to ${sub.chat_id}:`, e.message);
    }
  }
}

// ─── AUTH ROUTES ───────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  const { username, password, name, telegram_chat_id } = req.body;
  if (!username || !password || !name) return res.status(400).json({ error: 'All fields required' });

  const hash = await bcrypt.hash(password, 10);
  const insertData = { username, password: hash, name, role: 'customer' };
  if (telegram_chat_id) insertData.telegram_chat_id = telegram_chat_id.toString();

  const { data, error } = await supabase.from('users').insert(insertData).select().single();
  if (error) return res.status(400).json({ error: 'Username already exists' });

  const token = jwt.sign({ id: data.id, role: data.role, name: data.name }, JWT_SECRET);
  res.json({ token, user: { id: data.id, name: data.name, role: data.role } });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password, telegram_chat_id } = req.body;
  const { data } = await supabase.from('users').select('*').eq('username', username).single();
  if (!data || !(await bcrypt.compare(password, data.password))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  if (data.blocked) {
    return res.status(403).json({ error: data.block_reason || 'Ваш акаунт заблоковано. Зверніться до адміністратора.' });
  }
  if (telegram_chat_id && !data.telegram_chat_id) {
    await supabase.from('users').update({ telegram_chat_id: telegram_chat_id.toString() }).eq('id', data.id);
  }
  const token = jwt.sign({ id: data.id, role: data.role, name: data.name }, JWT_SECRET);
  res.json({ token, user: { id: data.id, name: data.name, role: data.role } });
});

// ─── PROFILE ROUTES ────────────────────────────────────────────────
app.get('/api/auth/me', auth, async (req, res) => {
  const { data, error } = await supabase.from('users').select('id, username, name, role, created_at').eq('id', req.user.id).single();
  if (error || !data) return res.status(404).json({ error: 'User not found' });
  res.json(data);
});

app.put('/api/auth/profile', auth, async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  const { data, error } = await supabase.from('users').update({ name: name.trim() }).eq('id', req.user.id).select('id, username, name, role').single();
  if (error) return res.status(400).json({ error: 'Update failed' });
  res.json(data);
});

app.put('/api/auth/password', auth, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) return res.status(400).json({ error: 'All fields required' });
  if (new_password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const { data: userRow } = await supabase.from('users').select('password').eq('id', req.user.id).single();
  if (!userRow || !(await bcrypt.compare(current_password, userRow.password))) {
    return res.status(401).json({ error: 'Incorrect current password' });
  }
  const hash = await bcrypt.hash(new_password, 10);
  await supabase.from('users').update({ password: hash }).eq('id', req.user.id);
  res.json({ ok: true });
});

// ─── PRODUCTS ──────────────────────────────────────────────────────
app.get('/api/products', async (req, res) => {
  let query = supabase.from('products').select('*, categories(name)').eq('active', true);
  if (req.query.category) query = query.eq('category_id', req.query.category);
  if (req.query.min_price) query = query.gte('price', req.query.min_price);
  if (req.query.max_price) query = query.lte('price', req.query.max_price);
  if (req.query.search) query = query.ilike('name', `%${req.query.search}%`);
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error });
  res.json(data);
});

app.get('/api/products/top3', async (req, res) => {
  const { data } = await supabase.rpc('get_top3_products');
  res.json(data || []);
});

app.get('/api/products/:id', async (req, res) => {
  const { data, error } = await supabase.from('products').select('*, categories(name)').eq('id', req.params.id).single();
  if (error) return res.status(404).json({ error: 'Not found' });
  res.json(data);
});

// Admin CRUD
app.post('/api/products', adminAuth, async (req, res) => {
  const { data, error } = await supabase.from('products').insert(req.body).select().single();
  if (error) return res.status(400).json({ error });
  res.json(data);
});

app.put('/api/products/:id', adminAuth, async (req, res) => {
  const { data, error } = await supabase.from('products').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error });
  res.json(data);
});

app.delete('/api/products/:id', adminAuth, async (req, res) => {
  await supabase.from('products').update({ active: false }).eq('id', req.params.id);
  res.json({ success: true });
});

// ─── CATEGORIES ────────────────────────────────────────────────────
app.get('/api/categories', async (req, res) => {
  const { data } = await supabase.from('categories').select('*').order('name');
  res.json(data || []);
});

app.post('/api/categories', adminAuth, async (req, res) => {
  const { data, error } = await supabase.from('categories').insert(req.body).select().single();
  if (error) return res.status(400).json({ error });
  res.json(data);
});

app.delete('/api/categories/:id', adminAuth, async (req, res) => {
  await supabase.from('categories').delete().eq('id', req.params.id);
  res.json({ success: true });
});

// ─── ORDERS ────────────────────────────────────────────────────────
app.post('/api/orders', auth, async (req, res) => {
  const { items, delivery_type, delivery_address, phone, comment, promocode_id, discount } = req.body;
  if (!items?.length) return res.status(400).json({ error: 'No items' });

  const rawTotal = items.reduce((sum, i) => sum + i.price * i.qty, 0);
  const total = discount ? Math.max(0, rawTotal - discount) : rawTotal;

  const { data: order, error } = await supabase.from('orders').insert({
    user_id: req.user.id,
    customer_name: req.user.name,
    phone,
    items,
    total,
    delivery_type,
    delivery_address,
    comment,
    status: 'new'
  }).select().single();

  if (error) return res.status(500).json({ error });

  if (promocode_id) {
    await supabase.rpc('increment_promo_uses', { promo_id: promocode_id }).catch(() => {
      supabase.from('promocodes').select('uses_count').eq('id', promocode_id).single()
        .then(({ data: p }) => p && supabase.from('promocodes').update({ uses_count: p.uses_count + 1 }).eq('id', promocode_id));
    });
  }

  await notifyOrder(order);

  res.json(order);
});

app.get('/api/orders/my', auth, async (req, res) => {
  const { data } = await supabase.from('orders').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false });
  res.json(data || []);
});

app.get('/api/orders', adminAuth, async (req, res) => {
  const { data: admins } = await supabase.from('users').select('id').eq('role', 'admin');
  const adminIds = (admins || []).map(a => a.id);

  let query = supabase.from('orders').select('*');
  if (adminIds.length) query = query.not('user_id', 'in', `(${adminIds.join(',')})`);
  if (req.query.status) query = query.eq('status', req.query.status);
  if (req.query.from) query = query.gte('created_at', req.query.from);
  if (req.query.to) query = query.lte('created_at', req.query.to);
  const { data } = await query.order('created_at', { ascending: false });
  res.json(data || []);
});

app.patch('/api/orders/:id/status', adminAuth, async (req, res) => {
  const { data, error } = await supabase.from('orders').update({ status: req.body.status }).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error });
  res.json(data);
});

app.patch('/api/orders/:id/note', adminAuth, async (req, res) => {
  const { data, error } = await supabase.from('orders').update({ admin_note: req.body.note }).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error });
  res.json(data);
});

// ─── REVIEWS ───────────────────────────────────────────────────────
app.get('/api/reviews', async (req, res) => {
  const { data } = await supabase.from('reviews').select('*').eq('approved', true).order('created_at', { ascending: false });
  res.json(data || []);
});

app.post('/api/reviews', auth, async (req, res) => {
  const { data, error } = await supabase.from('reviews').insert({ ...req.body, user_id: req.user.id, author: req.user.name }).select().single();
  if (error) return res.status(400).json({ error });
  res.json(data);
});

app.patch('/api/reviews/:id/approve', adminAuth, async (req, res) => {
  const { data } = await supabase.from('reviews').update({ approved: req.body.approved }).eq('id', req.params.id).select().single();
  res.json(data);
});

// ─── PROMOS ────────────────────────────────────────────────────────
app.get('/api/promos', async (req, res) => {
  const { data } = await supabase.from('promos').select('*, products(name, image_url, price)').eq('active', true);
  res.json(data || []);
});

app.post('/api/promos', adminAuth, async (req, res) => {
  const { data, error } = await supabase.from('promos').insert(req.body).select().single();
  if (error) return res.status(400).json({ error });
  res.json(data);
});

app.put('/api/promos/:id', adminAuth, async (req, res) => {
  const { data } = await supabase.from('promos').update(req.body).eq('id', req.params.id).select().single();
  res.json(data);
});

app.delete('/api/promos/:id', adminAuth, async (req, res) => {
  await supabase.from('promos').delete().eq('id', req.params.id);
  res.json({ success: true });
});

// ─── ANALYTICS ─────────────────────────────────────────────────────
app.get('/api/admin/stats', adminAuth, async (req, res) => {
  const today = new Date().toISOString().split('T')[0];

  const { data: admins } = await supabase.from('users').select('id').eq('role', 'admin');
  const adminIds = (admins || []).map(a => a.id);
  const notAdmins = (q) => adminIds.length ? q.not('user_id', 'in', `(${adminIds.join(',')})`) : q;

  const [ordersRes, revenueRes, newUsersRes, productStatsRes] = await Promise.all([
    notAdmins(supabase.from('orders').select('id, total, created_at, status')),
    notAdmins(supabase.from('orders').select('total').eq('status', 'completed')),
    supabase.from('users').select('id').gte('created_at', today).eq('role', 'customer'),
    supabase.rpc('get_product_stats', { from_date: req.query.from || '2024-01-01', to_date: req.query.to || new Date().toISOString() })
  ]);

  const orders = ordersRes.data || [];
  const revenue = (revenueRes.data || []).reduce((s, o) => s + o.total, 0);

  const chartData = {};
  orders.forEach(o => {
    const d = o.created_at?.split('T')[0];
    if (d) chartData[d] = (chartData[d] || 0) + 1;
  });

  res.json({
    total_orders: orders.length,
    total_revenue: revenue,
    new_users_today: newUsersRes.data?.length || 0,
    orders_chart: chartData,
    product_stats: productStatsRes.data || []
  });
});

// ─── ONLINE TRACKING ──────────────────────────────────────────────
app.post('/api/ping', auth, async (req, res) => {
  await supabase.from('users').update({ last_seen: new Date().toISOString() }).eq('id', req.user.id);
  res.json({ ok: true });
});

app.get('/api/admin/users/stats', adminAuth, async (req, res) => {
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const today = new Date().toISOString().split('T')[0];
  const [totalRes, onlineRes, todayRes] = await Promise.all([
    supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'customer'),
    supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'customer').gte('last_seen', fiveMinAgo),
    supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'customer').gte('created_at', today)
  ]);
  res.json({
    total: totalRes.count || 0,
    online: onlineRes.count || 0,
    new_today: todayRes.count || 0
  });
});

// ─── PROMOCODES ───────────────────────────────────────────────────
app.post('/api/promocodes/check', async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Введіть промокод' });
  const { data, error } = await supabase
    .from('promocodes')
    .select('*')
    .eq('code', code.toUpperCase().trim())
    .eq('active', true)
    .single();
  if (error || !data) return res.status(404).json({ error: 'Промокод не знайдено' });
  if (data.expires_at && new Date(data.expires_at) < new Date())
    return res.status(400).json({ error: 'Термін дії промокоду закінчився' });
  if (data.max_uses !== null && data.uses_count >= data.max_uses)
    return res.status(400).json({ error: 'Промокод вичерпано' });
  res.json({ id: data.id, type: data.type, value: data.value });
});

app.get('/api/promocodes', adminAuth, async (req, res) => {
  const { data } = await supabase.from('promocodes').select('*').order('created_at', { ascending: false });
  res.json(data || []);
});

app.post('/api/promocodes', adminAuth, async (req, res) => {
  const { code, type, value, max_uses, expires_at, active } = req.body;
  const { data, error } = await supabase.from('promocodes')
    .insert({ code: code.toUpperCase().trim(), type, value, max_uses: max_uses || null, expires_at: expires_at || null, active: active !== false })
    .select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.put('/api/promocodes/:id', adminAuth, async (req, res) => {
  const { data } = await supabase.from('promocodes').update(req.body).eq('id', req.params.id).select().single();
  res.json(data);
});

app.delete('/api/promocodes/:id', adminAuth, async (req, res) => {
  await supabase.from('promocodes').delete().eq('id', req.params.id);
  res.json({ ok: true });
});

app.post('/api/promocodes/:id/broadcast', adminAuth, async (req, res) => {
  const { data: promo } = await supabase.from('promocodes').select('*').eq('id', req.params.id).single();
  if (!promo) return res.status(404).json({ error: 'Промокод не знайдено' });

  const { data: users } = await supabase.from('users')
    .select('telegram_chat_id')
    .eq('role', 'customer')
    .not('telegram_chat_id', 'is', null);

  if (!users?.length) return res.json({ sent: 0, message: 'Немає покупців з прив\'язаним Telegram' });

  const label = promo.type === 'fixed' ? `₴${promo.value}` : `${promo.value}%`;
  const expires = promo.expires_at ? `\nДійсний до: ${new Date(promo.expires_at).toLocaleDateString('uk-UA')}` : '';
  const uses = promo.max_uses ? `\nКількість активацій: ${promo.max_uses - promo.uses_count}` : '';
  const text = `🎁 *Спеціальна пропозиція від Elegant's Store!*\n\n` +
    `Використай промокод і отримай знижку ${label}:\n\n` +
    `*${promo.code}*${expires}${uses}\n\n` +
    `Введи його в кошику при оформленні замовлення 🛍`;

  let sent = 0;
  for (const u of users) {
    try {
      await bot.sendMessage(u.telegram_chat_id, text, { parse_mode: 'Markdown' });
      sent++;
    } catch {}
  }
  res.json({ sent, total: users.length });
});

app.get('/api/admin/customers', adminAuth, async (req, res) => {
  const { data: users } = await supabase
    .from('users')
    .select('id, username, name, created_at, last_seen, telegram_chat_id, blocked')
    .eq('role', 'customer')
    .order('created_at', { ascending: false });

  if (!users?.length) return res.json([]);

  const { data: orders } = await supabase
    .from('orders')
    .select('user_id, total, status');

  const orderMap = {};
  (orders || []).forEach(o => {
    if (!orderMap[o.user_id]) orderMap[o.user_id] = { count: 0, total: 0, completed: 0 };
    orderMap[o.user_id].count++;
    if (o.status === 'completed') { orderMap[o.user_id].total += o.total; orderMap[o.user_id].completed++; }
  });

  res.json(users.map(u => ({
    ...u,
    orders_count: orderMap[u.id]?.count || 0,
    orders_total: orderMap[u.id]?.total || 0,
    completed_orders: orderMap[u.id]?.completed || 0
  })));
});

app.patch('/api/admin/customers/:id/block', adminAuth, async (req, res) => {
  const { blocked, reason } = req.body;
  const { data, error } = await supabase.from('users')
    .update({ blocked: !!blocked, block_reason: blocked ? (reason || null) : null })
    .eq('id', req.params.id).select('id, name, blocked').single();
  if (error) return res.status(400).json({ error });
  res.json(data);
});

// ─── SETTINGS ─────────────────────────────────────────────────────
app.get('/api/settings', async (req, res) => {
  const { data } = await supabase.from('settings').select('key, value');
  const obj = {};
  (data || []).forEach(r => { obj[r.key] = r.value; });
  res.json(obj);
});

app.patch('/api/settings', adminAuth, async (req, res) => {
  const updates = Object.entries(req.body);
  for (const [key, value] of updates) {
    await supabase.from('settings').upsert({ key, value: String(value), updated_at: new Date().toISOString() });
  }
  res.json({ ok: true });
});

// ─── UPLOAD PHOTO ─────────────────────────────────────────────────
app.post('/api/upload', adminAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не знайдено' });
  const ext = req.file.originalname.split('.').pop().toLowerCase();
  const allowed = ['jpg', 'jpeg', 'png', 'webp'];
  if (!allowed.includes(ext)) return res.status(400).json({ error: 'Дозволені формати: jpg, png, webp' });
  const fileName = `products/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await supabase.storage
    .from('product-images')
    .upload(fileName, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
  if (error) return res.status(500).json({ error: error.message });
  const { data: { publicUrl } } = supabase.storage.from('product-images').getPublicUrl(fileName);
  res.json({ url: publicUrl });
});

// ─── HEALTH CHECK ─────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

app.listen(process.env.PORT || 4000, () => {
  console.log('✅ Server running on port', process.env.PORT || 4000);
  console.log('🤖 Telegram bot is connected');
  console.log('📊 Supabase connected');
});
