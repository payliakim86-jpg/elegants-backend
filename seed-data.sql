-- INSERT SAMPLE PRODUCTS (до запуску замініть УРЛ на реальні фото)
insert into products (name, description, price, category_id, stock, is_new, discount_percent, image_url) values
  ('Классическая Черная Футболка', 'Комфортна чорна футболка з якісного бавовни. Ідеальна для щоденного носіння.', 299, (select id from categories where slug='futbolky'), 50, true, 0, 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=400'),
  ('Белая Оверсайз Футболка', 'Просторна біла футболка оверсайз крою. Трендовий вибір для стилю.', 349, (select id from categories where slug='futbolky'), 45, true, 10, 'https://images.unsplash.com/photo-1503341504253-836fc69443a7?w=400'),
  ('Красная Футболка с Принтом', 'Червона футболка з оригінальним принтом. Привертає увагу та виділяє вас.', 329, (select id from categories where slug='futbolky'), 30, false, 15, 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=400'),
  ('Премиум Худи Черное', 'Теплий чорний худі з якісного матеріалу. Ідеально для холодної погоди.', 599, (select id from categories where slug='hudi'), 35, true, 0, 'https://images.unsplash.com/photo-1556821552-7f41c5d440db?w=400'),
  ('Серое Худи с Капюшоном', 'Сіре худі з високою якістю та комфортом. Популярний вибір.', 579, (select id from categories where slug='hudi'), 40, true, 5, 'https://images.unsplash.com/photo-1540932239986-a18d874628ae?w=400'),
  ('Удобные Черные Штаны', 'Зручні чорні штани зі спортивного матеріалу. Для активного стилю.', 499, (select id from categories where slug='shtany'), 25, false, 20, 'https://images.unsplash.com/photo-1542272604-787c62d465d1?w=400'),
  ('Серые Спортивные Штаны', 'Сірі спортивні штани з еластичним поясом. Комфорт гарантований.', 459, (select id from categories where slug='shtany'), 28, true, 0, 'https://images.unsplash.com/photo-1506629082632-dd80d8aca7ad?w=400'),
  ('Белые Кроссовки', 'Біле кросівки на всесезонне носіння. Універсальна класика.', 799, (select id from categories where slug='aksesuary'), 20, true, 10, 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400');

-- INSERT SAMPLE PROMOS
insert into promos (title, subtitle, discount_percent, product_id, active) values
  ('Літня Колекція', 'Знижки до 50% на вибрані товари', 30, (select id from products where name='Белая Оверсайз Футболка'), true),
  ('Спортивна Лінія', 'Подвійні знижки на худі та штани', 25, (select id from products where name='Премиум Худи Черное'), true),
  ('Новинки Сезону', 'Свіжі моделі за спеціальною ціною', 15, (select id from products where name='Классическая Черная Футболка'), true);

-- INSERT SAMPLE REVIEWS
insert into reviews (author, text, rating, approved) values
  ('Марія К.', '🎉 Чудовий магазин! Товари вищої якості, швидка доставка. Дуже задоволена покупкою!', 5, true),
  ('Іван П.', 'Хорошая якість, але трошки дорого. Все одно рекомендую.', 4, true),
  ('Анна М.', 'Обслуговування на найвищому рівні. Буду замовляти ще!', 5, true);
