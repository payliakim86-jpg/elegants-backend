// ─── НАЛАШТУВАННЯ ────────────────────────────────────────────────
// Замість констант нижче можна використати process.env
const SUPABASE_URL = process.env.SUPABASE_URL || 'YOUR_SUPABASE_URL';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'YOUR_SUPABASE_SERVICE_KEY';

// ─── ПАРОЛІ (вже захешовані, не змінюй) ─────────────────────────
const admins = [
  {
    username: 'admin1',
    password_hash: '$2b$10$hgzb.jfm7U.H.2.PriDJCuwMWPTDsSiGTofVQPno5z6D0gMB5e8jK'
  },
  {
    username: 'admin2',
    password_hash: '$2b$10$9huWaDtwXLlwlgTv9cwZcuLMPK76jvWEL9Jg2g.pjxKFS28i1fcK.'
  }
];

// ─── СКРИПТ ──────────────────────────────────────────────────────
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function setupAdmins() {
  console.log('🔧 Встановлення паролів адміністраторів...\n');

  for (const admin of admins) {
    const { error } = await supabase
      .from('users')
      .update({ password: admin.password_hash })
      .eq('username', admin.username);

    if (error) {
      console.error(`❌ Помилка для ${admin.username}:`, error.message);
    } else {
      console.log(`✅ Пароль для ${admin.username} встановлено`);
    }
  }

  console.log('\n✅ Готово! Тепер можеш увійти в адмін-панель.');
  console.log('─────────────────────────────────────');
  console.log('Логін:  admin1');
  console.log('Пароль: Elegants@Admin1#2024');
  console.log('─────────────────────────────────────');
  console.log('Логін:  admin2');
  console.log('Пароль: Elegants@Admin2#2024');
  console.log('─────────────────────────────────────');
}

setupAdmins();
