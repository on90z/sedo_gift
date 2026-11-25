-- ============================================================================
-- SEDO FLOWERS & GIFTS — VERIFIED SAFE IDEMPOTENT SUPABASE MIGRATION
-- Project: sedo-flowers (tbybrpdrwngoqnjvfchq)
-- Admin Auth Account: moimlali00@gmail.com
-- Safe to run multiple times: does NOT drop/truncate tables or delete data.
-- Preserves all existing orders, customers, loyalty stamps, products & settings.
-- ============================================================================

-- 1. Extend existing products table safely (already present in live DB; idempotent)
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS description_ar text DEFAULT '',
  ADD COLUMN IF NOT EXISTS is_featured boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

-- 2. Categories table (seeded with core SEDO categories without overwriting edits)
CREATE TABLE IF NOT EXISTS public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name_ar text NOT NULL,
  description_ar text DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.categories (slug, name_ar, description_ar, sort_order, is_active)
VALUES
  ('flower', 'الزهور والورد الطبيعي', 'أنواع الورد الطبيعي بالقطعة لتصميم الباقات', 1, true),
  ('wrapping', 'التغليف الفاخر', 'أنواع التغليف والأوراق والأشرطة', 2, true),
  ('gift', 'الهدايا الإضافية', 'الشوكولاتة والدباديب والبالونات والإكسسوارات', 3, true)
ON CONFLICT (slug) DO NOTHING;

-- 3. Extend customers table safely
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS whatsapp text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS nearest_landmark text,
  ADD COLUMN IF NOT EXISTS notes text;

-- 4. Extend orders table safely (Cash on Delivery default; preserves all rows)
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS order_number text,
  ADD COLUMN IF NOT EXISTS delivery_address text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS nearest_landmark text,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'cash_on_delivery';

-- 5. Order status history table
CREATE TABLE IF NOT EXISTS public.order_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  old_status text,
  new_status text NOT NULL,
  changed_by text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 6. Extend loyalty_logs and enforce no duplicate stamp per qualifying order
ALTER TABLE public.loyalty_logs
  ADD COLUMN IF NOT EXISTS stamps_delta integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS admin_email text;

CREATE UNIQUE INDEX IF NOT EXISTS loyalty_logs_unique_order_stamp_idx
  ON public.loyalty_logs (order_id)
  WHERE order_id IS NOT NULL AND action IN ('add_stamp', 'qualifying_purchase_stamp');

-- 7. Extend store_settings with official contact, loyalty, geofencing, & daily_reset_at
-- Note: Adds daily_reset_at (timestamptz) cleanly as NULL; never deletes/modifies orders.
ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS whatsapp_numbers text DEFAULT '07762963674, 07733484176',
  ADD COLUMN IF NOT EXISTS loyalty_required_purchases integer NOT NULL DEFAULT 9,
  ADD COLUMN IF NOT EXISTS loyalty_reward_type text NOT NULL DEFAULT 'gift',
  ADD COLUMN IF NOT EXISTS loyalty_reward_value text DEFAULT 'باقة أو هدية مجانية على الطلب العاشر',
  ADD COLUMN IF NOT EXISTS cash_only boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS shop_lat double precision DEFAULT 32.6027,
  ADD COLUMN IF NOT EXISTS shop_lng double precision DEFAULT 44.0197,
  ADD COLUMN IF NOT EXISTS promo_radius_meters integer NOT NULL DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS promo_notification_text text DEFAULT 'أهلاً بك بالقرب من متجر SEDO للهدايا والزهور! تفضل بزيارتنا في حي الميلاد واستمتع بأجمل باقات الورد والهدايا الفاخرة.',
  ADD COLUMN IF NOT EXISTS daily_reset_at timestamptz;

-- Only backfill NULL/placeholder fields; preserves live coordinates, custom promo text, & daily_reset_at
UPDATE public.store_settings
SET
  phone_numbers = CASE
    WHEN phone_numbers IS NULL OR phone_numbers = '07700000000' THEN '07762963674, 07733484176'
    ELSE phone_numbers
  END,
  whatsapp_numbers = COALESCE(NULLIF(whatsapp_numbers, ''), '07762963674, 07733484176'),
  instagram_url = CASE
    WHEN instagram_url IS NULL OR instagram_url = 'https://instagram.com' THEN 'https://www.instagram.com/sedo.gift/'
    ELSE instagram_url
  END,
  cash_only = COALESCE(cash_only, true),
  shop_lat = COALESCE(shop_lat, 32.6027),
  shop_lng = COALESCE(shop_lng, 44.0197),
  promo_radius_meters = COALESCE(promo_radius_meters, 1000),
  promo_notification_text = COALESCE(NULLIF(promo_notification_text, ''), 'أهلاً بك بالقرب من متجر SEDO للهدايا والزهور! تفضل بزيارتنا في حي الميلاد واستمتع بأجمل باقات الورد والهدايا الفاخرة.')
WHERE id = 1;

-- 8. Admin audit logs table (records reset_daily_shift and all admin actions)
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_email text NOT NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_logs_action_created_at_idx
  ON public.audit_logs (action, created_at DESC);

-- 9. Enable RLS on newly added tables (existing table policies remain intact)
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Public read on categories
DROP POLICY IF EXISTS "public_read_categories" ON public.categories;
CREATE POLICY "public_read_categories" ON public.categories
  FOR SELECT TO anon, authenticated
  USING (true);

-- Admin full access policies (case-insensitive check matching Supabase Auth account)
DROP POLICY IF EXISTS "admin_all_products" ON public.products;
CREATE POLICY "admin_all_products" ON public.products
  FOR ALL TO authenticated
  USING (lower(COALESCE(auth.jwt() ->> 'email', '')) = 'moimlali00@gmail.com')
  WITH CHECK (lower(COALESCE(auth.jwt() ->> 'email', '')) = 'moimlali00@gmail.com');

DROP POLICY IF EXISTS "admin_all_categories" ON public.categories;
CREATE POLICY "admin_all_categories" ON public.categories
  FOR ALL TO authenticated
  USING (lower(COALESCE(auth.jwt() ->> 'email', '')) = 'moimlali00@gmail.com')
  WITH CHECK (lower(COALESCE(auth.jwt() ->> 'email', '')) = 'moimlali00@gmail.com');

DROP POLICY IF EXISTS "admin_all_orders" ON public.orders;
CREATE POLICY "admin_all_orders" ON public.orders
  FOR ALL TO authenticated
  USING (lower(COALESCE(auth.jwt() ->> 'email', '')) = 'moimlali00@gmail.com')
  WITH CHECK (lower(COALESCE(auth.jwt() ->> 'email', '')) = 'moimlali00@gmail.com');

DROP POLICY IF EXISTS "admin_all_order_history" ON public.order_status_history;
CREATE POLICY "admin_all_order_history" ON public.order_status_history
  FOR ALL TO authenticated
  USING (lower(COALESCE(auth.jwt() ->> 'email', '')) = 'moimlali00@gmail.com')
  WITH CHECK (lower(COALESCE(auth.jwt() ->> 'email', '')) = 'moimlali00@gmail.com');

DROP POLICY IF EXISTS "admin_all_customers" ON public.customers;
CREATE POLICY "admin_all_customers" ON public.customers
  FOR ALL TO authenticated
  USING (lower(COALESCE(auth.jwt() ->> 'email', '')) = 'moimlali00@gmail.com')
  WITH CHECK (lower(COALESCE(auth.jwt() ->> 'email', '')) = 'moimlali00@gmail.com');

DROP POLICY IF EXISTS "admin_all_loyalty_logs" ON public.loyalty_logs;
CREATE POLICY "admin_all_loyalty_logs" ON public.loyalty_logs
  FOR ALL TO authenticated
  USING (lower(COALESCE(auth.jwt() ->> 'email', '')) = 'moimlali00@gmail.com')
  WITH CHECK (lower(COALESCE(auth.jwt() ->> 'email', '')) = 'moimlali00@gmail.com');

DROP POLICY IF EXISTS "admin_all_store_settings" ON public.store_settings;
CREATE POLICY "admin_all_store_settings" ON public.store_settings
  FOR ALL TO authenticated
  USING (lower(COALESCE(auth.jwt() ->> 'email', '')) = 'moimlali00@gmail.com')
  WITH CHECK (lower(COALESCE(auth.jwt() ->> 'email', '')) = 'moimlali00@gmail.com');

DROP POLICY IF EXISTS "admin_all_audit_logs" ON public.audit_logs;
CREATE POLICY "admin_all_audit_logs" ON public.audit_logs
  FOR ALL TO authenticated
  USING (lower(COALESCE(auth.jwt() ->> 'email', '')) = 'moimlali00@gmail.com')
  WITH CHECK (lower(COALESCE(auth.jwt() ->> 'email', '')) = 'moimlali00@gmail.com');

-- 10. Supabase Storage bucket for product images (idempotent; bucket already exists)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-images',
  'product-images',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "public_read_product_images" ON storage.objects;
CREATE POLICY "public_read_product_images" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'product-images');

DROP POLICY IF EXISTS "admin_manage_product_images" ON storage.objects;
CREATE POLICY "admin_manage_product_images" ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'product-images'
    AND lower(COALESCE(auth.jwt() ->> 'email', '')) = 'moimlali00@gmail.com'
  )
  WITH CHECK (
    bucket_id = 'product-images'
    AND lower(COALESCE(auth.jwt() ->> 'email', '')) = 'moimlali00@gmail.com'
  );

-- 11. Upgrade submit_sedo_order RPC (exact parameter signature preserved; SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.submit_sedo_order(
  p_full_name text,
  p_phone text,
  p_birth_date date,
  p_order_details jsonb,
  p_total_price_iqd integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id uuid;
  v_order_id uuid;
  v_delivery_address text;
  v_city text;
  v_landmark text;
  v_notes text;
BEGIN
  v_delivery_address := NULLIF(trim(COALESCE(p_order_details ->> 'delivery_address', '')), '');
  v_city := NULLIF(trim(COALESCE(p_order_details ->> 'city', '')), '');
  v_landmark := NULLIF(trim(COALESCE(p_order_details ->> 'nearest_landmark', '')), '');
  v_notes := NULLIF(trim(COALESCE(p_order_details ->> 'notes', '')), '');

  SELECT id INTO v_customer_id FROM public.customers WHERE phone = p_phone LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (
      full_name, phone, whatsapp, birth_date, address, city, nearest_landmark, notes,
      stamps_count, total_orders
    )
    VALUES (
      p_full_name, p_phone, p_phone, p_birth_date, v_delivery_address, v_city, v_landmark, v_notes,
      0, 1
    )
    RETURNING id INTO v_customer_id;
  ELSE
    UPDATE public.customers
    SET full_name = p_full_name,
        whatsapp = COALESCE(whatsapp, p_phone),
        birth_date = COALESCE(p_birth_date, birth_date),
        address = COALESCE(v_delivery_address, address),
        city = COALESCE(v_city, city),
        nearest_landmark = COALESCE(v_landmark, nearest_landmark),
        notes = COALESCE(v_notes, notes),
        total_orders = COALESCE(total_orders, 0) + 1
    WHERE id = v_customer_id;
  END IF;

  INSERT INTO public.orders (
    customer_id, customer_name, customer_phone, customer_birth_date,
    delivery_address, city, nearest_landmark, notes, payment_method,
    order_details, total_price_iqd, status
  )
  VALUES (
    v_customer_id, p_full_name, p_phone, p_birth_date,
    v_delivery_address, v_city, v_landmark, v_notes, 'cash_on_delivery',
    p_order_details, p_total_price_iqd, 'pending'
  )
  RETURNING id INTO v_order_id;

  RETURN jsonb_build_object('order_id', v_order_id, 'customer_id', v_customer_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_sedo_order(text, text, date, jsonb, integer) TO anon, authenticated;
