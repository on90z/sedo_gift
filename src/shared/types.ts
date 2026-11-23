export type Language = 'ar' | 'en';

export type OrderStatus =
  | 'New'
  | 'Confirmed'
  | 'Preparing'
  | 'Ready'
  | 'Completed'
  | 'Cancelled';

export type OptionGroup =
  | 'flower_type'
  | 'flower_color'
  | 'wrapping'
  | 'arrangement'
  | 'gift';

export type ProductKind = 'bouquet' | 'gift';

export interface Product {
  id: string;
  kind: ProductKind;
  category: string;
  categoryAr: string;
  nameAr: string;
  nameEn: string;
  descriptionAr: string;
  descriptionEn: string;
  priceIqd: number;
  promoPriceIqd?: number | null;
  roseCount?: number;
  stock: number;
  isAvailable: boolean;
  isFeatured: boolean;
  isBestSeller: boolean;
  imageUrl: string;
  updatedAt: string;
}

export interface OptionItem {
  id: string;
  group: OptionGroup;
  nameAr: string;
  nameEn: string;
  priceIqd: number;
  colorHex?: string;
  stock: number;
  isAvailable: boolean;
  imageUrl: string;
}

export interface CustomBouquetSelection {
  roseQuantity: number;
  flowerTypeId: string;
  colorIds: string[];
  wrappingId: string;
  arrangementId: string;
  giftIds: string[];
  cardMessage?: string;
}

export interface BouquetPriceBreakdown {
  roseQuantity: number;
  roseUnitPriceIqd: number;
  rosesSubtotalIqd: number;
  flowerTypeSurchargeIqd: number;
  wrappingPriceIqd: number;
  arrangementPriceIqd: number;
  giftsSubtotalIqd: number;
  totalIqd: number;
}

export interface CartItemInput {
  type: 'ready_made' | 'custom_bouquet';
  productId?: string;
  quantity: number;
  customSelection?: CustomBouquetSelection;
}

export interface ValidatedOrderItem {
  id: string;
  type: 'ready_made' | 'custom_bouquet';
  titleAr: string;
  titleEn: string;
  quantity: number;
  unitPriceIqd: number;
  lineTotalIqd: number;
  details: {
    roseQuantity?: number;
    flowerTypeNameAr?: string;
    flowerTypeNameEn?: string;
    colorNamesAr?: string[];
    colorNamesEn?: string[];
    wrappingNameAr?: string;
    wrappingNameEn?: string;
    arrangementNameAr?: string;
    arrangementNameEn?: string;
    giftNamesAr?: string[];
    giftNamesEn?: string[];
    cardMessage?: string;
  };
  imageUrl: string;
}

export interface CustomerRecord {
  id: string;
  userId?: string | null;
  fullName: string;
  phone: string;
  birthDate: string;
  marketingConsent: boolean;
  locationConsent: boolean;
  totalOrders: number;
  totalSpentIqd: number;
  createdAt: string;
  updatedAt: string;
}

export interface OrderRecord {
  id: string;
  orderNumber: string;
  clientRequestId?: string;
  userId?: string | null;
  customerId: string;
  customerName: string;
  customerPhone: string;
  customerBirthDate: string;
  status: OrderStatus;
  items: ValidatedOrderItem[];
  subtotalIqd: number;
  discountIqd: number;
  promoCodeApplied?: string | null;
  totalIqd: number;
  paymentMethod: string;
  deliveryType: 'pickup' | 'delivery';
  deliveryAddress?: string;
  notes?: string;
  stampAwarded: boolean;
  createdAt: string;
  updatedAt: string;
}

export type RewardType = 'free_bouquet' | 'discount' | 'special_gift' | 'custom';

export interface LoyaltyRewardConfig {
  type: RewardType;
  titleAr: string;
  titleEn: string;
  descriptionAr: string;
  descriptionEn: string;
  discountPercent?: number;
  expirationDays: number;
  minOrderIqd: number;
  isActive: boolean;
}

export interface LoyaltyCardRecord {
  id: string;
  customerId: string;
  userId?: string | null;
  customerName: string;
  customerPhone: string;
  stampsCount: number;
  rewardStatus: 'in_progress' | 'unlocked' | 'redeemed';
  completedCardsCount: number;
  rewardExpiresAt?: string | null;
  updatedAt: string;
}

export interface LoyaltyTransaction {
  id: string;
  cardId: string;
  customerId: string;
  orderId?: string;
  orderNumber?: string;
  action: 'stamp_added' | 'stamp_reversed' | 'reward_redeemed';
  delta: number;
  performedBy: string;
  note: string;
  createdAt: string;
}

export interface AdminNotification {
  id: string;
  type: 'new_order' | 'birthday' | 'proximity' | 'system';
  titleAr: string;
  titleEn: string;
  messageAr: string;
  messageEn: string;
  orderId?: string;
  orderNumber?: string;
  isRead: boolean;
  createdAt: string;
}

export interface BirthdayCampaign {
  id: string;
  titleAr: string;
  titleEn: string;
  messageAr: string;
  messageEn: string;
  promoCode: string;
  discountPercent: number;
  giftDescriptionAr?: string;
  giftDescriptionEn?: string;
  isActive: boolean;
  sentCount: number;
  createdAt: string;
}

export interface PaymentMethodConfig {
  id: string;
  nameAr: string;
  nameEn: string;
  isActive: boolean;
  isIntegrated: boolean;
  instructionsAr: string;
  instructionsEn: string;
}

export interface AuditLogEntry {
  id: string;
  actor: string;
  action: string;
  targetId?: string;
  details: string;
  createdAt: string;
}

export interface CategoryConfig {
  id: string;
  kind: ProductKind;
  titleAr: string;
  titleEn: string;
  subtitleAr: string;
  subtitleEn: string;
  imageUrl: string;
  isActive: boolean;
  showOnHome: boolean;
}

export interface StoreSettings {
  id: string;
  storeNameAr: string;
  storeNameEn: string;
  taglineAr: string;
  taglineEn: string;
  roseUnitPriceIqd: number;
  maxCustomRoses: number;
  logoUrl: string;
  heroBannerUrl: string;
  heroHeadlineAr: string;
  heroHeadlineEn: string;
  heroSubtitleAr: string;
  heroSubtitleEn: string;
  heroPrimaryCtaAr: string;
  heroPrimaryCtaEn: string;
  heroSecondaryCtaAr: string;
  heroSecondaryCtaEn: string;
  categoriesSectionTitleAr: string;
  categoriesSectionTitleEn: string;
  featuredSectionTitleAr: string;
  featuredSectionTitleEn: string;
  loyaltyPromoBadgeAr: string;
  loyaltyPromoBadgeEn: string;
  loyaltyPromoTitleAr: string;
  loyaltyPromoTitleEn: string;
  loyaltyPromoDescAr: string;
  loyaltyPromoDescEn: string;
  aboutTitleAr: string;
  aboutTitleEn: string;
  aboutTextAr: string;
  aboutTextEn: string;
  footerTextAr: string;
  footerTextEn: string;
  builderTitleAr: string;
  builderTitleEn: string;
  builderSubtitleAr: string;
  builderSubtitleEn: string;
  offerBannerEnabled: boolean;
  offerBannerTextAr: string;
  offerBannerTextEn: string;
  categories: CategoryConfig[];
  storePhotoUrl: string;
  addressAr: string;
  addressEn: string;
  phone: string;
  secondaryPhone?: string;
  instagramHandle: string;
  instagramUrl: string;
  workingHoursAr: string;
  workingHoursEn: string;
  latitude: number | null;
  longitude: number | null;
  googleMapsUrl: string;
  googleBusinessProfileUrl: string;
  locationVerified: boolean;
  proximityEnabled: boolean;
  proximityRadiusMeters: number;
  proximityCooldownHours: number;
  proximityMessageAr: string;
  proximityMessageEn: string;
  loyaltyReward: LoyaltyRewardConfig;
  paymentMethods: PaymentMethodConfig[];
  telegramConfigured?: boolean;
  telegramNotifyOnOrder?: boolean;
  defaultLanguage: Language;
  updatedAt: string;
}

export interface CatalogPayload {
  products: Product[];
  options: OptionItem[];
  settings: StoreSettings;
  activeBirthdayPromoCodes: Array<{
    code: string;
    discountPercent: number;
    titleAr: string;
    titleEn: string;
  }>;
}
