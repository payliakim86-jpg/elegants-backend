-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- USERS
create table users (
  id uuid default uuid_generate_v4() primary key,
  username text unique not null,
  password text not null,
  name text not null,
  role text default 'customer' check (role in ('customer', 'admin')),
  created_at timestamptz default now()
);

-- CATEGORIES
create table categories (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  slug text unique not null,
  created_at timestamptz default now()
);

-- PRODUCTS
create table products (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  description text,
  price numeric not null,
  old_price numeric,
  image_url text,
  category_id uuid references categories(id),
  stock integer default 0,
  active boolean default true,
  is_new boolean default false,
  discount_percent integer default 0,
  created_at timestamptz default now()
);

-- ORDERS
create table orders (
  id serial primary key,
  user_id uuid references users(id),
  customer_name text not null,
  phone text not null,
  items jsonb not null,
  total numeric not null,
  status text default 'new' check (status in ('new','confirmed','shipped','completed','cancelled')),
  delivery_type text not null check (delivery_type in ('nova_poshta','ukrposhta','self_pickup')),
  delivery_address text,
  comment text,
  created_at timestamptz default now()
);

-- REVIEWS
create table reviews (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references users(id),
  author text not null,
  text text not null,
  rating integer check (rating between 1 and 5),
  approved boolean default false,
  created_at timestamptz default now()
);

-- PROMOS
create table promos (
  id uuid default uuid_generate_v4() primary key,
  title text not null,
  subtitle text,
  discount_percent integer,
  product_id uuid references products(id),
  active boolean default true,
  created_at timestamptz default now()
);

-- TELEGRAM BOT SUBSCRIBERS
create table bot_subscribers (
  chat_id text primary key,
  subscribed_at timestamptz default now()
);

-- ADMIN ACCOUNTS
insert into users (username, password, name, role) values
  ('admin1', '$2a$10$elegants.admin1.hash.placeholder', 'Адмін 1', 'admin'),
  ('admin2', '$2a$10$elegants.admin2.hash.placeholder', 'Адмін 2', 'admin');

-- SAMPLE CATEGORIES
insert into categories (name, slug) values
  ('Футболки', 'futbolky'),
  ('Худі', 'hudi'),
  ('Штани', 'shtany'),
  ('Аксесуари', 'aksesuary');

-- ─── FUNCTIONS ───────────────────────────────────────────────────

-- TOP-3 PRODUCTS BY ORDER COUNT
create or replace function get_top3_products()
returns table(id uuid, name text, price numeric, image_url text, order_count bigint)
language sql as $$
  select p.id, p.name, p.price, p.image_url,
    count(o.id) as order_count
  from products p
  left join orders o on o.items @> json_build_array(json_build_object('product_id', p.id::text))::jsonb
  where p.active = true
  group by p.id
  order by order_count desc
  limit 3;
$$;

-- PRODUCT STATS (orders per product with return %)
create or replace function get_product_stats(from_date timestamptz, to_date timestamptz)
returns table(
  product_id uuid, product_name text,
  total_orders bigint, cancelled_orders bigint, return_percent numeric,
  revenue numeric
)
language sql as $$
  select
    p.id as product_id,
    p.name as product_name,
    count(o.id) as total_orders,
    count(o.id) filter (where o.status = 'cancelled') as cancelled_orders,
    round(count(o.id) filter (where o.status = 'cancelled') * 100.0 / nullif(count(o.id), 0), 1) as return_percent,
    coalesce(sum(o.total) filter (where o.status = 'completed'), 0) as revenue
  from products p
  left join orders o on o.items @> json_build_array(json_build_object('product_id', p.id::text))::jsonb
    and o.created_at between from_date and to_date
  where p.active = true
  group by p.id
  order by total_orders desc;
$$;

-- ROW LEVEL SECURITY
alter table users enable row level security;
alter table orders enable row level security;
alter table reviews enable row level security;

-- Users can only read their own data
create policy "users_own" on users for select using (auth.uid()::text = id::text);
create policy "orders_own" on orders for select using (auth.uid()::text = user_id::text);

-- PROMOCODES
create table if not exists promocodes (
  id bigint primary key generated always as identity,
  code text not null unique,
  type text not null check (type in ('fixed', 'percent')),
  value numeric not null,
  max_uses integer default null,
  uses_count integer not null default 0,
  expires_at timestamptz default null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Функція для інкременту uses_count (викликається з сервера)
create or replace function increment_promo_uses(promo_id bigint)
returns void language sql as $$
  update promocodes set uses_count = uses_count + 1 where id = promo_id;
$$;

-- Масив фото для товарів (перше фото = головне, зберігається в image_url)
alter table products add column if not exists images jsonb default '[]'::jsonb;

-- Трекінг онлайн-активності (оновлюється кожні 5 хв)
alter table users add column if not exists last_seen timestamptz default null;
-- Вважаємо "онлайн" = last_seen за останні 5 хвилин

-- Прив'язка Telegram до акаунту покупця
alter table users add column if not exists telegram_chat_id text default null;

-- Налаштування сайту (банер та інші)
create table if not exists settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
-- Початкові значення
insert into settings (key, value) values
  ('banner_enabled', 'false'),
  ('banner_text', '🔥 Знижки до 50% на весь асортимент!')
on conflict (key) do nothing;

-- Внутрішня нотатка адміна до замовлення
alter table orders add column if not exists admin_note text default null;

-- Блокування покупців
alter table users add column if not exists blocked boolean not null default false;
alter table users add column if not exists block_reason text default null;
