import type { BouquetOrderDetails } from './pricing.ts';

export type RoutePath = 'home' | 'admin';

export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'preparing'
  | 'out_for_delivery'
  | 'delivered'
  | 'completed'
  | 'cancelled';

export type AdminTab =
  | 'dashboard'
  | 'orders'
  | 'today_orders'
  | 'products'
  | 'add_product'
  | 'categories'
  | 'customers'
  | 'loyalty'
  | 'reports'
  | 'settings'
  | 'contact';

export interface ProductRow {
  id: string;
  name_ar: string;
  description_ar?: string | null;
  category: string;
  price_iqd: number;
  image_url: string | null;
  stock_quantity: number;
  low_stock_threshold: number;
  is_active: boolean;
  is_featured?: boolean;
  sort_order?: number;
  created_at?: string;
}

export interface CategoryRow {
  id: string;
  slug: string;
  name_ar: string;
  description_ar?: string | null;
  sort_order: number;
  is_active: boolean;
  created_at?: string;
}

export interface CustomerRow {
  id: string;
  created_at?: string;
  full_name: string;
  phone: string;
  whatsapp?: string | null;
  address?: string | null;
  city?: string | null;
  nearest_landmark?: string | null;
  notes?: string | null;
  birth_date: string | null;
  stamps_count: number;
  total_orders: number;
}

export interface OrderRow {
  id: string;
  order_number?: string | null;
  created_at: string;
  status: OrderStatus | string;
  total_price_iqd: number;
  customer_id: string | null;
  customer_name: string;
  customer_phone: string;
  customer_birth_date: string | null;
  delivery_address?: string | null;
  city?: string | null;
  nearest_landmark?: string | null;
  notes?: string | null;
  payment_method?: string | null;
  order_details: BouquetOrderDetails | Record<string, unknown> | string | null;
}

export interface OrderStatusHistoryRow {
  id: string;
  order_id: string;
  old_status: string | null;
  new_status: string;
  changed_by?: string | null;
  note?: string | null;
  created_at: string;
}

export interface LoyaltyLogRow {
  id: string;
  created_at: string;
  customer_id: string;
  order_id: string | null;
  action: string;
  notes: string | null;
  stamps_delta?: number;
  reason?: string | null;
  admin_email?: string | null;
}

export interface AuditLogRow {
  id: string;
  actor_email: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface StoreSettingsRow {
  id: number;
  shop_name: string;
  address: string;
  working_hours: string;
  phone_numbers: string | null;
  whatsapp_numbers?: string | null;
  instagram_url: string | null;
  google_maps_url: string | null;
  loyalty_required_purchases?: number;
  loyalty_reward_type?: 'gift' | 'discount' | string;
  loyalty_reward_value?: string | null;
  cash_only?: boolean;
  shop_lat?: number | null;
  shop_lng?: number | null;
  promo_radius_meters?: number | null;
  promo_notification_text?: string | null;
}
