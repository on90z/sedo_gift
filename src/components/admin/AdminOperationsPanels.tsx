import React, { useEffect, useState } from 'react';
import {
  Award,
  Bell,
  Cake,
  Check,
  CloudUpload,
  Download,
  Edit3,
  MapPin,
  RotateCcw,
  Send,
  Shield,
  Store,
  Trash2,
  Upload,
} from 'lucide-react';
import { signInWithPopup } from 'firebase/auth';
import type {
  AdminNotification,
  AuditLogEntry,
  BirthdayCampaign,
  CustomerRecord,
  Language,
  LoyaltyCardRecord,
  LoyaltyTransaction,
  OptionItem,
  OrderRecord,
  Product,
  RewardType,
  StoreSettings,
} from '../../shared/types.ts';
import { formatIqd } from '../../shared/pricing.ts';
import { auth, googleProvider } from '../../lib/firebase.ts';
import {
  isOwnerFirebaseAuthed,
  syncFullCatalogToFirestore,
  syncSettingsToFirestore,
} from '../../lib/firestoreCatalogSync.ts';
import { QrCodeCard } from '../QrCodeCard.tsx';
import { SafeImage } from '../SafeImage.tsx';

interface LoyaltyPanelProps {
  lang: Language;
  adminToken: string;
  loyaltyCards: LoyaltyCardRecord[];
  loyaltyTransactions: LoyaltyTransaction[];
  orders: OrderRecord[];
  settings: StoreSettings;
  onRefresh: () => Promise<void>;
}

export const AdminLoyaltyPanel: React.FC<LoyaltyPanelProps> = ({
  lang,
  adminToken,
  loyaltyCards,
  loyaltyTransactions,
  orders,
  settings,
  onRefresh,
}) => {
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [stampNote, setStampNote] = useState('');
  const [reverseReasonByCard, setReverseReasonByCard] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [savingReward, setSavingReward] = useState(false);

  const [rewardForm, setRewardForm] = useState({
    type: settings.loyaltyReward.type as RewardType,
    titleAr: settings.loyaltyReward.titleAr,
    titleEn: settings.loyaltyReward.titleEn,
    descriptionAr: settings.loyaltyReward.descriptionAr,
    descriptionEn: settings.loyaltyReward.descriptionEn,
    discountPercent: String(settings.loyaltyReward.discountPercent ?? 0),
    expirationDays: String(settings.loyaltyReward.expirationDays),
    minOrderIqd: String(settings.loyaltyReward.minOrderIqd),
    isActive: settings.loyaltyReward.isActive,
  });

  useEffect(() => {
    setRewardForm({
      type: settings.loyaltyReward.type as RewardType,
      titleAr: settings.loyaltyReward.titleAr,
      titleEn: settings.loyaltyReward.titleEn,
      descriptionAr: settings.loyaltyReward.descriptionAr,
      descriptionEn: settings.loyaltyReward.descriptionEn,
      discountPercent: String(settings.loyaltyReward.discountPercent ?? 0),
      expirationDays: String(settings.loyaltyReward.expirationDays),
      minOrderIqd: String(settings.loyaltyReward.minOrderIqd),
      isActive: settings.loyaltyReward.isActive,
    });
  }, [settings]);

  const eligibleOrders = orders.filter((o) => !o.stampAwarded && o.status !== 'Cancelled');

  const handleAwardStamp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrderId) return;
    setFeedback('');
    setErrorMsg('');
    const resp = await fetch('/api/admin/loyalty/award-stamp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ orderId: selectedOrderId, note: stampNote.trim() || undefined }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      setErrorMsg(data.error || 'Could not award stamp');
      return;
    }
    setSelectedOrderId('');
    setStampNote('');
    setFeedback(
      lang === 'ar'
        ? `تمت الموافقة ومنح ختم جديد للطلب (${data.card.stampsCount}/10)`
        : `Approved +1 stamp (${data.card.stampsCount}/10)`
    );
    await onRefresh();
  };

  const handleReverseStamp = async (cardId: string) => {
    const note = (reverseReasonByCard[cardId] || '').trim();
    if (note.length < 3) {
      setErrorMsg(
        lang === 'ar'
          ? 'يرجى كتابة سبب سحب الختم (3 أحرف على الأقل) لحفظه في سجل التدقيق.'
          : 'Please enter a reversal reason (3+ chars) for the audit log.'
      );
      return;
    }
    setFeedback('');
    setErrorMsg('');
    const resp = await fetch('/api/admin/loyalty/reverse-stamp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ cardId, note }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      setErrorMsg(data.error || 'Reverse failed');
      return;
    }
    setReverseReasonByCard((prev) => ({ ...prev, [cardId]: '' }));
    setFeedback(lang === 'ar' ? 'تم عكس الختم وتسجيله في سجل الحركات.' : 'Stamp reversed and audited.');
    await onRefresh();
  };

  const handleRedeemReward = async (cardId: string) => {
    setFeedback('');
    setErrorMsg('');
    const resp = await fetch('/api/admin/loyalty/redeem-reward', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ cardId }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      setErrorMsg(data.error || 'Redemption failed');
      return;
    }
    setFeedback(
      lang === 'ar'
        ? 'تم تسليم مكافأة الختم العاشر وتصفير البطاقة للدورة الجديدة.'
        : '10-stamp reward redeemed and card reset for next cycle.'
    );
    await onRefresh();
  };

  const handleSaveRewardConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingReward(true);
    setFeedback('');
    setErrorMsg('');
    try {
      const resp = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          loyaltyReward: {
            type: rewardForm.type,
            titleAr: rewardForm.titleAr,
            titleEn: rewardForm.titleEn,
            descriptionAr: rewardForm.descriptionAr,
            descriptionEn: rewardForm.descriptionEn,
            discountPercent: Number(rewardForm.discountPercent) || 0,
            expirationDays: Number(rewardForm.expirationDays) || 60,
            minOrderIqd: Number(rewardForm.minOrderIqd) || 0,
            isActive: rewardForm.isActive,
          },
        }),
      });
      if (!resp.ok) throw new Error('Failed to save reward settings');
      const data = await resp.json();
      if (data.settings) {
        try {
          await syncSettingsToFirestore(data.settings);
        } catch {
          // Local DB saved; cloud sync happens when owner Google session is connected
        }
      }
      await onRefresh();
      setFeedback(lang === 'ar' ? 'تم حفظ إعدادات مكافأة الولاء.' : 'Loyalty reward configuration saved.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingReward(false);
    }
  };

  return (
    <div className="space-y-8 text-white">
      {feedback && (
        <div className="border border-[#944A5E] bg-[#0E0A0C] px-4 py-3 text-xs text-white">
          {feedback}
        </div>
      )}
      {errorMsg && (
        <div className="border border-[#944A5E] bg-[#0E0A0C] px-4 py-3 text-xs text-white">
          {errorMsg}
        </div>
      )}

      {/* Approve Stamp for Verified Order */}
      <form
        onSubmit={handleAwardStamp}
        className="border border-[#944A5E] bg-[#6E2438] p-6 space-y-4"
      >
        <div className="flex items-center gap-2 text-[#F8BBD0]">
          <Award className="w-5 h-5 text-[#F48FB1]" />
          <h3 className="text-base font-semibold text-white">
            {lang === 'ar'
              ? 'اعتماد ختم جديد لطلب مكتمل / موثق (حماية من التكرار)'
              : 'Approve +1 Loyalty Stamp for Verified Order'}
          </h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <select
            required
            value={selectedOrderId}
            onChange={(e) => setSelectedOrderId(e.target.value)}
            aria-label="Select order to award stamp"
            className="px-3 py-2.5 border border-[#944A5E] bg-[#461221] text-white"
          >
            <option value="">
              {lang === 'ar' ? 'اختر رقم الطلب المؤهل...' : 'Select qualifying order...'}
            </option>
            {eligibleOrders.map((o) => (
              <option key={o.id} value={o.id}>
                {o.orderNumber} — {o.customerName} ({formatIqd(o.totalIqd, 'en')})
              </option>
            ))}
          </select>
          <input
            type="text"
            value={stampNote}
            onChange={(e) => setStampNote(e.target.value)}
            placeholder={lang === 'ar' ? 'ملاحظة الإدارة (اختياري)' : 'Admin note (optional)'}
            className="px-3 py-2.5 border border-[#944A5E] bg-[#461221] text-white placeholder:text-white/45"
          />
          <button
            type="submit"
            disabled={!selectedOrderId}
            className="px-5 py-2.5 bg-[#0E0A0C] border border-[#944A5E] text-white font-medium hover:bg-[#1E1418] disabled:opacity-50 transition-colors"
          >
            {lang === 'ar' ? 'منح ختم (+1)' : 'Approve +1 Stamp'}
          </button>
        </div>
      </form>

      {/* Customer Loyalty Cards */}
      <div className="space-y-3">
        <h3 className="text-base font-semibold text-white">
          {lang === 'ar' ? 'بطاقات العملاء الرقمية' : 'Customer Digital Loyalty Cards'}
        </h3>
        {loyaltyCards.length === 0 ? (
          <div className="border border-[#944A5E] bg-[#6E2438] p-6 text-xs text-white/75">
            {lang === 'ar' ? 'لا توجد بطاقات ولاء مسجلة بعد.' : 'No customer loyalty cards yet.'}
          </div>
        ) : (
          <div className="border border-[#944A5E] divide-y divide-[#944A5E] bg-[#6E2438]">
            {loyaltyCards.map((card) => (
              <div key={card.id} className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 text-xs">
                <div className="space-y-1">
                  <div className="font-bold text-sm text-white">{card.customerName}</div>
                  <div className="text-white/80 tabular-nums-en" dir="ltr">
                    {card.customerPhone} · Stamps: {card.stampsCount} / 10 · Completed Cycles:{' '}
                    {card.completedCardsCount}
                  </div>
                  {card.stampsCount === 10 && (
                    <div className="text-[#F8BBD0] font-bold">
                      مبروك! أكملت 10 أختام مع SEDO ❤️ — {lang === 'ar' ? 'جاهز لاستبدال المكافأة' : 'Ready to Redeem'}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {card.stampsCount === 10 && (
                    <button
                      type="button"
                      onClick={() => handleRedeemReward(card.id)}
                      className="px-3.5 py-2 bg-[#0E0A0C] border border-[#F48FB1] text-[#F8BBD0] font-medium hover:bg-[#1E1418] transition-colors"
                    >
                      {lang === 'ar' ? 'تسليم المكافأة وتصفير البطاقة' : 'Redeem 10-Stamp Reward'}
                    </button>
                  )}

                  {card.stampsCount > 0 && (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        placeholder={lang === 'ar' ? 'سبب العكس...' : 'Reversal reason...'}
                        value={reverseReasonByCard[card.id] || ''}
                        onChange={(e) =>
                          setReverseReasonByCard((prev) => ({ ...prev, [card.id]: e.target.value }))
                        }
                        className="px-2.5 py-1.5 border border-[#944A5E] bg-[#461221] text-white placeholder:text-white/45 w-40"
                      />
                      <button
                        type="button"
                        onClick={() => handleReverseStamp(card.id)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 border border-[#944A5E] bg-[#461221] text-white hover:border-white transition-colors"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>{lang === 'ar' ? 'سحب ختم (-1)' : 'Reverse -1'}</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Reward Configuration */}
      <form onSubmit={handleSaveRewardConfig} className="border border-[#944A5E] bg-[#6E2438] p-6 space-y-4">
        <h3 className="text-base font-semibold text-white">
          {lang === 'ar' ? 'إعدادات مكافأة الشراء العاشر' : '10th-Purchase Reward Configuration'}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
          <div className="space-y-1">
            <label className="font-medium text-white">
              {lang === 'ar' ? 'نوع المكافأة' : 'Reward Type'}
            </label>
            <select
              value={rewardForm.type}
              onChange={(e) => setRewardForm({ ...rewardForm, type: e.target.value as RewardType })}
              className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
            >
              <option value="free_bouquet">{lang === 'ar' ? 'باقة مجانية' : 'Free Bouquet'}</option>
              <option value="discount">{lang === 'ar' ? 'نسبة خصم' : 'Discount %'}</option>
              <option value="special_gift">{lang === 'ar' ? 'هدية خاصة' : 'Special Gift'}</option>
              <option value="custom">{lang === 'ar' ? 'مكافأة مخصصة' : 'Custom Reward'}</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="font-medium text-white">
              {lang === 'ar' ? 'الحد الأدنى المؤهل (IQD)' : 'Min Qualifying Order (IQD)'}
            </label>
            <input
              type="number"
              min={0}
              step={1000}
              value={rewardForm.minOrderIqd}
              onChange={(e) => setRewardForm({ ...rewardForm, minOrderIqd: e.target.value })}
              className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white tabular-nums-en"
            />
          </div>
          <div className="space-y-1">
            <label className="font-medium text-white">
              {lang === 'ar' ? 'صلاحية المكافأة (أيام)' : 'Expiration (Days)'}
            </label>
            <input
              type="number"
              min={1}
              value={rewardForm.expirationDays}
              onChange={(e) => setRewardForm({ ...rewardForm, expirationDays: e.target.value })}
              className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white tabular-nums-en"
            />
          </div>
          <div className="space-y-1">
            <label className="font-medium text-white">
              {lang === 'ar' ? 'عنوان المكافأة (عربي)' : 'Reward Title (AR)'}
            </label>
            <input
              required
              value={rewardForm.titleAr}
              onChange={(e) => setRewardForm({ ...rewardForm, titleAr: e.target.value })}
              className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
            />
          </div>
          <div className="space-y-1">
            <label className="font-medium text-white">
              {lang === 'ar' ? 'عنوان المكافأة (إنجليزي)' : 'Reward Title (EN)'}
            </label>
            <input
              required
              value={rewardForm.titleEn}
              onChange={(e) => setRewardForm({ ...rewardForm, titleEn: e.target.value })}
              className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
            />
          </div>
          <div className="space-y-1">
            <label className="font-medium text-white">
              {lang === 'ar' ? 'نسبة الخصم % (اختياري)' : 'Discount % (if discount)'}
            </label>
            <input
              type="number"
              min={0}
              max={100}
              value={rewardForm.discountPercent}
              onChange={(e) => setRewardForm({ ...rewardForm, discountPercent: e.target.value })}
              className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white tabular-nums-en"
            />
          </div>
          <div className="space-y-1 sm:col-span-3">
            <label className="font-medium text-white">
              {lang === 'ar' ? 'وصف المكافأة (عربي)' : 'Reward Description (AR)'}
            </label>
            <input
              value={rewardForm.descriptionAr}
              onChange={(e) => setRewardForm({ ...rewardForm, descriptionAr: e.target.value })}
              className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
            />
          </div>
          <div className="space-y-1 sm:col-span-3">
            <label className="font-medium text-white">
              {lang === 'ar' ? 'وصف المكافأة (إنجليزي)' : 'Reward Description (EN)'}
            </label>
            <input
              value={rewardForm.descriptionEn}
              onChange={(e) => setRewardForm({ ...rewardForm, descriptionEn: e.target.value })}
              className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="inline-flex items-center gap-2 text-xs cursor-pointer text-white">
            <input
              type="checkbox"
              checked={rewardForm.isActive}
              onChange={(e) => setRewardForm({ ...rewardForm, isActive: e.target.checked })}
              className="accent-[#0E0A0C]"
            />
            <span>{lang === 'ar' ? 'تفعيل مكافأة الـ 10 أختام' : 'Reward Active'}</span>
          </label>
          <button
            type="submit"
            disabled={savingReward}
            className="px-5 py-2.5 bg-[#0E0A0C] border border-[#944A5E] text-white text-xs font-medium hover:bg-[#1E1418] transition-colors"
          >
            {savingReward ? '...' : lang === 'ar' ? 'حفظ إعدادات المكافأة' : 'Save Reward Config'}
          </button>
        </div>
      </form>

      {/* Loyalty Ledger */}
      {loyaltyTransactions.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-base font-semibold text-white">
            {lang === 'ar' ? 'سجل حركات الأختام' : 'Loyalty Transaction History'}
          </h3>
          <div className="border border-[#944A5E] divide-y divide-[#944A5E] bg-[#6E2438]">
            {loyaltyTransactions.slice(0, 25).map((tx) => (
              <div key={tx.id} className="px-4 py-3 flex items-center justify-between gap-4 text-xs">
                <div>
                  <span className="font-semibold text-white">{tx.note}</span>
                  <span className="text-white/70 ms-2">
                    ({tx.performedBy}) ·{' '}
                    <span className="tabular-nums-en" dir="ltr">
                      {new Date(tx.createdAt).toLocaleString('en-US')}
                    </span>
                  </span>
                </div>
                <span className="font-bold text-[#F8BBD0] tabular-nums-en" dir="ltr">
                  {tx.delta > 0 ? `+${tx.delta}` : tx.delta}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

interface CustomersAndBirthdaysPanelProps {
  lang: Language;
  adminToken: string;
  customers: CustomerRecord[];
  birthdayMatches: CustomerRecord[];
  campaigns: BirthdayCampaign[];
  onRefresh: () => Promise<void>;
}

export const AdminCustomersAndBirthdaysPanel: React.FC<CustomersAndBirthdaysPanelProps> = ({
  lang,
  adminToken,
  customers,
  birthdayMatches,
  campaigns,
  onRefresh,
}) => {
  const [search, setSearch] = useState('');
  const [feedback, setFeedback] = useState('');
  const [editingCampaignId, setEditingCampaignId] = useState<string | null>(null);
  const [editCampForm, setEditCampForm] = useState({
    titleAr: '',
    titleEn: '',
    messageAr: '',
    messageEn: '',
    promoCode: '',
    discountPercent: '15',
    isActive: true,
  });
  const [newCamp, setNewCamp] = useState({
    titleAr: '',
    titleEn: '',
    messageAr: 'كل عام وأنتِ بألف خير من SEDO! استمتع بهدية عيد ميلادك.',
    messageEn: 'Happy Birthday from SEDO! Enjoy your birthday floral privilege.',
    promoCode: '',
    discountPercent: '15',
  });

  const filteredCustomers = customers.filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return c.fullName.toLowerCase().includes(q) || c.phone.includes(q);
  });

  const handleSaveCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback('');
    const resp = await fetch('/api/admin/birthdays/campaigns', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        titleAr: newCamp.titleAr,
        titleEn: newCamp.titleEn,
        messageAr: newCamp.messageAr,
        messageEn: newCamp.messageEn,
        promoCode: newCamp.promoCode,
        discountPercent: Number(newCamp.discountPercent) || 0,
        isActive: true,
      }),
    });
    if (resp.ok) {
      setNewCamp({ ...newCamp, titleAr: '', titleEn: '', promoCode: '' });
      await onRefresh();
      setFeedback(lang === 'ar' ? 'تم حفظ حملة عيد الميلاد' : 'Birthday campaign saved');
    }
  };

  const handleToggleCampaign = async (c: BirthdayCampaign) => {
    await fetch('/api/admin/birthdays/campaigns', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ ...c, isActive: !c.isActive }),
    });
    await onRefresh();
  };

  const handleStartEditCampaign = (c: BirthdayCampaign) => {
    setEditingCampaignId(c.id);
    setEditCampForm({
      titleAr: c.titleAr,
      titleEn: c.titleEn,
      messageAr: c.messageAr,
      messageEn: c.messageEn,
      promoCode: c.promoCode,
      discountPercent: String(c.discountPercent),
      isActive: c.isActive,
    });
  };

  const handleSaveEditCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCampaignId) return;
    setFeedback('');
    const resp = await fetch('/api/admin/birthdays/campaigns', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        id: editingCampaignId,
        titleAr: editCampForm.titleAr,
        titleEn: editCampForm.titleEn,
        messageAr: editCampForm.messageAr,
        messageEn: editCampForm.messageEn,
        promoCode: editCampForm.promoCode,
        discountPercent: Number(editCampForm.discountPercent) || 0,
        isActive: editCampForm.isActive,
      }),
    });
    if (resp.ok) {
      setEditingCampaignId(null);
      await onRefresh();
      setFeedback(lang === 'ar' ? 'تم تحديث الحملة بنجاح.' : 'Campaign updated.');
    }
  };

  const handleDeleteCampaign = async (campaignId: string) => {
    setFeedback('');
    const resp = await fetch(`/api/admin/birthdays/campaigns/${campaignId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (resp.ok) {
      if (editingCampaignId === campaignId) setEditingCampaignId(null);
      await onRefresh();
      setFeedback(lang === 'ar' ? 'تم حذف الحملة.' : 'Campaign deleted.');
    }
  };

  const handleDispatchBirthday = async (customerId: string, campaignId: string) => {
    setFeedback('');
    const resp = await fetch('/api/admin/birthdays/dispatch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ customerId, campaignId }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      setFeedback(data.error || 'Dispatch failed');
      return;
    }
    await onRefresh();
    setFeedback(
      lang === 'ar' ? 'تم تجهيز وإرسال تهنئة عيد الميلاد للعميل.' : 'Birthday greeting prepared & dispatched.'
    );
  };

  const activeCamp = campaigns.find((c) => c.isActive) || campaigns[0];

  return (
    <div className="space-y-8 text-white">
      {feedback && (
        <div className="border border-[#944A5E] bg-[#0E0A0C] px-4 py-3 text-xs text-white">
          {feedback}
        </div>
      )}

      {/* Today's Birthday Matches */}
      <div className="border border-[#944A5E] bg-[#6E2438] p-6 space-y-4">
        <div className="flex items-center gap-2 text-white">
          <Cake className="w-5 h-5" />
          <h3 className="text-base font-semibold">
            {lang === 'ar' ? 'أعياد ميلاد اليوم' : "Today's Birthday Matches"}
          </h3>
        </div>
        {birthdayMatches.length === 0 ? (
          <p className="text-xs text-white/80">
            {lang === 'ar'
              ? 'لا يوجد عملاء يصادف عيد ميلادهم اليوم.'
              : 'No registered customer birthdays fall on today.'}
          </p>
        ) : (
          <div className="space-y-2">
            {birthdayMatches.map((cust) => (
              <div
                key={cust.id}
                className="border border-[#944A5E] bg-[#461221] p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs"
              >
                <div>
                  <span className="font-bold text-white">{cust.fullName}</span> ·{' '}
                  <span className="tabular-nums-en text-white/85" dir="ltr">
                    {cust.phone}
                  </span>{' '}
                  ·{' '}
                  <span className="text-white/80">
                    {cust.marketingConsent
                      ? lang === 'ar'
                        ? 'موافق على الإشعارات'
                        : 'Marketing Opt-in'
                      : lang === 'ar'
                        ? 'بدون موافقة تسويقية'
                        : 'No Marketing Consent'}
                  </span>
                </div>
                {activeCamp && cust.marketingConsent && (
                  <button
                    type="button"
                    onClick={() => handleDispatchBirthday(cust.id, activeCamp.id)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-[#0E0A0C] border border-[#944A5E] text-white hover:bg-[#1E1418]"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>
                      {lang === 'ar' ? `إرسال تهنئة (${activeCamp.promoCode})` : `Send (${activeCamp.promoCode})`}
                    </span>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Birthday Campaigns */}
      <div className="space-y-4">
        <h3 className="text-base font-semibold text-white">
          {lang === 'ar' ? 'حملات وأكواد أعياد الميلاد' : 'Birthday Promo Campaigns'}
        </h3>
        <form onSubmit={handleSaveCampaign} className="border border-[#944A5E] bg-[#6E2438] p-4 grid grid-cols-1 sm:grid-cols-5 gap-3 text-xs">
          <input
            required
            placeholder={lang === 'ar' ? 'عنوان الحملة (عربي)' : 'Title (AR)'}
            value={newCamp.titleAr}
            onChange={(e) => setNewCamp({ ...newCamp, titleAr: e.target.value })}
            className="px-3 py-2 border border-[#944A5E] bg-[#461221] text-white placeholder:text-white/45"
          />
          <input
            required
            placeholder={lang === 'ar' ? 'عنوان الحملة (إنجليزي)' : 'Title (EN)'}
            value={newCamp.titleEn}
            onChange={(e) => setNewCamp({ ...newCamp, titleEn: e.target.value })}
            className="px-3 py-2 border border-[#944A5E] bg-[#461221] text-white placeholder:text-white/45"
          />
          <input
            required
            placeholder="PROMO20"
            dir="ltr"
            value={newCamp.promoCode}
            onChange={(e) => setNewCamp({ ...newCamp, promoCode: e.target.value.toUpperCase() })}
            className="px-3 py-2 border border-[#944A5E] bg-[#461221] text-white placeholder:text-white/45 tabular-nums-en"
          />
          <input
            required
            type="number"
            min={1}
            max={50}
            placeholder="Discount %"
            value={newCamp.discountPercent}
            onChange={(e) => setNewCamp({ ...newCamp, discountPercent: e.target.value })}
            className="px-3 py-2 border border-[#944A5E] bg-[#461221] text-white placeholder:text-white/45 tabular-nums-en"
          />
          <button type="submit" className="px-4 py-2 bg-[#0E0A0C] border border-[#944A5E] text-white font-medium hover:bg-[#1E1418]">
            {lang === 'ar' ? 'إضافة حملة' : 'Create Campaign'}
          </button>
        </form>

        <div className="border border-[#944A5E] divide-y divide-[#944A5E] bg-[#6E2438]">
          {campaigns.map((camp) => (
            <div key={camp.id} className="p-4 space-y-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-bold text-white">
                    {lang === 'ar' ? camp.titleAr : camp.titleEn} ·{' '}
                    <span className="text-white/85 tabular-nums-en" dir="ltr">
                      {camp.promoCode} ({camp.discountPercent}%)
                    </span>
                  </div>
                  <div className="text-white/75">{lang === 'ar' ? camp.messageAr : camp.messageEn}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleToggleCampaign(camp)}
                    className={`px-3 py-1.5 border transition-colors ${
                      camp.isActive
                        ? 'border-white bg-[#0E0A0C] text-white'
                        : 'border-[#944A5E] bg-[#461221] text-white/60'
                    }`}
                  >
                    {camp.isActive ? (lang === 'ar' ? 'نشطة' : 'Active') : lang === 'ar' ? 'متوقفة' : 'Paused'}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      editingCampaignId === camp.id ? setEditingCampaignId(null) : handleStartEditCampaign(camp)
                    }
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-[#944A5E] bg-[#461221] text-white hover:border-white"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>{lang === 'ar' ? 'تعديل' : 'Edit'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteCampaign(camp.id)}
                    aria-label={`Delete ${camp.promoCode}`}
                    className="p-1.5 border border-[#944A5E] bg-[#461221] text-white hover:border-white"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {editingCampaignId === camp.id && (
                <form
                  onSubmit={handleSaveEditCampaign}
                  className="border border-[#944A5E] bg-[#461221] p-3 grid grid-cols-1 sm:grid-cols-2 gap-2"
                >
                  <input
                    required
                    value={editCampForm.titleAr}
                    onChange={(e) => setEditCampForm({ ...editCampForm, titleAr: e.target.value })}
                    placeholder="Title (AR)"
                    className="px-2.5 py-1.5 border border-[#944A5E] bg-[#5E1D2F] text-white"
                  />
                  <input
                    required
                    value={editCampForm.titleEn}
                    onChange={(e) => setEditCampForm({ ...editCampForm, titleEn: e.target.value })}
                    placeholder="Title (EN)"
                    className="px-2.5 py-1.5 border border-[#944A5E] bg-[#5E1D2F] text-white"
                  />
                  <input
                    required
                    value={editCampForm.messageAr}
                    onChange={(e) => setEditCampForm({ ...editCampForm, messageAr: e.target.value })}
                    placeholder="Message (AR)"
                    className="px-2.5 py-1.5 border border-[#944A5E] bg-[#5E1D2F] text-white"
                  />
                  <input
                    required
                    value={editCampForm.messageEn}
                    onChange={(e) => setEditCampForm({ ...editCampForm, messageEn: e.target.value })}
                    placeholder="Message (EN)"
                    className="px-2.5 py-1.5 border border-[#944A5E] bg-[#5E1D2F] text-white"
                  />
                  <input
                    required
                    dir="ltr"
                    value={editCampForm.promoCode}
                    onChange={(e) =>
                      setEditCampForm({ ...editCampForm, promoCode: e.target.value.toUpperCase() })
                    }
                    placeholder="Promo Code"
                    className="px-2.5 py-1.5 border border-[#944A5E] bg-[#5E1D2F] text-white tabular-nums-en"
                  />
                  <input
                    required
                    type="number"
                    min={0}
                    max={50}
                    value={editCampForm.discountPercent}
                    onChange={(e) => setEditCampForm({ ...editCampForm, discountPercent: e.target.value })}
                    placeholder="Discount %"
                    className="px-2.5 py-1.5 border border-[#944A5E] bg-[#5E1D2F] text-white tabular-nums-en"
                  />
                  <div className="sm:col-span-2 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingCampaignId(null)}
                      className="px-3 py-1.5 border border-[#944A5E] bg-[#5E1D2F] text-white"
                    >
                      {lang === 'ar' ? 'إلغاء' : 'Cancel'}
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-1.5 bg-[#0E0A0C] border border-[#944A5E] text-white font-medium"
                    >
                      {lang === 'ar' ? 'حفظ التعديل' : 'Save Campaign'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Customer Directory */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-base font-semibold text-white">
            {lang === 'ar' ? 'سجل العملاء' : 'Customer Directory'}
          </h3>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={lang === 'ar' ? 'بحث بالاسم أو الهاتف...' : 'Search name or phone...'}
            className="px-3 py-2 border border-[#944A5E] bg-[#461221] text-white placeholder:text-white/45 text-xs w-64"
          />
        </div>
        <div className="border border-[#944A5E] divide-y divide-[#944A5E] bg-[#6E2438]">
          {filteredCustomers.length === 0 ? (
            <div className="p-6 text-xs text-white/75">
              {lang === 'ar' ? 'لا يوجد عملاء مطابقون.' : 'No customers found.'}
            </div>
          ) : (
            filteredCustomers.map((c) => (
              <div key={c.id} className="p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="space-y-1">
                  <div className="font-bold text-sm text-white">{c.fullName}</div>
                  <div className="text-white/80 tabular-nums-en" dir="ltr">
                    {c.phone} · DOB: {c.birthDate} · Orders: {c.totalOrders} · Spent:{' '}
                    {formatIqd(c.totalSpentIqd, 'en')}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-white/75">
                    {c.marketingConsent ? 'Marketing OK' : 'No Marketing'} ·{' '}
                    {c.locationConsent ? 'Location OK' : 'No Location'}
                  </span>
                  {activeCamp && c.marketingConsent && (
                    <button
                      type="button"
                      onClick={() => handleDispatchBirthday(c.id, activeCamp.id)}
                      className="px-3 py-1.5 border border-[#944A5E] bg-[#461221] text-white hover:border-white transition-colors"
                    >
                      {lang === 'ar' ? 'إرسال تهنئة' : 'Send Greeting'}
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

interface NotificationsAndProximityPanelProps {
  lang: Language;
  adminToken: string;
  notifications: AdminNotification[];
  settings: StoreSettings;
  onRefresh: () => Promise<void>;
  onJumpToOrder: (orderId: string) => void;
}

export const AdminNotificationsAndProximityPanel: React.FC<NotificationsAndProximityPanelProps> = ({
  lang,
  adminToken,
  notifications,
  settings,
  onRefresh,
  onJumpToOrder,
}) => {
  const [tgToken, setTgToken] = useState('');
  const [tgChatId, setTgChatId] = useState('');
  const [tgNotify, setTgNotify] = useState(Boolean(settings.telegramNotifyOnOrder));
  const [proxEnabled, setProxEnabled] = useState(settings.proximityEnabled);
  const [proxRadius, setProxRadius] = useState(String(settings.proximityRadiusMeters ?? 2000));
  const [proxCooldown, setProxCooldown] = useState(String(settings.proximityCooldownHours ?? 24));
  const [proxMsgAr, setProxMsgAr] = useState(settings.proximityMessageAr);
  const [proxMsgEn, setProxMsgEn] = useState(settings.proximityMessageEn);
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    setTgNotify(Boolean(settings.telegramNotifyOnOrder));
    setProxEnabled(settings.proximityEnabled);
    setProxRadius(String(settings.proximityRadiusMeters ?? 2000));
    setProxCooldown(String(settings.proximityCooldownHours ?? 24));
    setProxMsgAr(settings.proximityMessageAr);
    setProxMsgEn(settings.proximityMessageEn);
  }, [settings]);

  const handleMarkRead = async (notif: AdminNotification) => {
    await fetch(`/api/admin/notifications/${notif.id}/read`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    await onRefresh();
    if (notif.orderId) onJumpToOrder(notif.orderId);
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback('');
    const parsedRadius = Number(proxRadius);
    const payload: Record<string, unknown> = {
      telegramNotifyOnOrder: tgNotify,
      proximityEnabled: proxEnabled,
      proximityRadiusMeters:
        Number.isFinite(parsedRadius) && parsedRadius >= 50 ? Math.round(parsedRadius) : 2000,
      proximityCooldownHours: Math.max(1, Number(proxCooldown) || 24),
      proximityMessageAr: proxMsgAr,
      proximityMessageEn: proxMsgEn,
    };
    if (tgToken.trim()) payload.telegramBotToken = tgToken.trim();
    if (tgChatId.trim()) payload.telegramChatId = tgChatId.trim();

    const resp = await fetch('/api/admin/settings', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify(payload),
    });
    if (resp.ok) {
      const saved = await resp.json();
      if (saved.settings) {
        try {
          await syncSettingsToFirestore(saved.settings);
        } catch {
          // Local DB updated
        }
      }
      setTgToken('');
      setTgChatId('');
      await onRefresh();
      setFeedback(
        lang === 'ar'
          ? 'تم حفظ إعدادات التليغرام وإشعارات القرب بنجاح.'
          : 'Telegram and proximity notification settings saved.'
      );
    }
  };

  return (
    <div className="space-y-8 text-white">
      {feedback && (
        <div className="border border-[#944A5E] bg-[#0E0A0C] px-4 py-3 text-xs text-white">
          {feedback}
        </div>
      )}

      {/* Notification Feed */}
      <div className="space-y-3">
        <h3 className="text-base font-semibold text-white flex items-center gap-2">
          <Bell className="w-4 h-4 text-white" />
          <span>{lang === 'ar' ? 'سجل الإشعارات الفورية' : 'Real-Time Notification Feed'}</span>
        </h3>
        <div className="border border-[#944A5E] divide-y divide-[#944A5E] bg-[#6E2438]">
          {notifications.length === 0 ? (
            <div className="p-6 text-xs text-white/75">
              {lang === 'ar' ? 'لا توجد إشعارات بعد.' : 'No notifications yet.'}
            </div>
          ) : (
            notifications.slice(0, 30).map((n) => (
              <div
                key={n.id}
                className={`p-4 flex flex-wrap items-center justify-between gap-3 text-xs ${
                  n.isRead ? 'bg-[#6E2438]' : 'bg-[#7C2C42]'
                }`}
              >
                <div className="space-y-1">
                  <div className="font-bold text-white">
                    {lang === 'ar' ? n.titleAr : n.titleEn}
                  </div>
                  <div className="text-white/85">{lang === 'ar' ? n.messageAr : n.messageEn}</div>
                  <div className="text-white/65 tabular-nums-en" dir="ltr">
                    {new Date(n.createdAt).toLocaleString('en-US')}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleMarkRead(n)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 border border-[#944A5E] bg-[#461221] text-white hover:border-white transition-colors"
                >
                  <Check className="w-3.5 h-3.5 text-white" />
                  <span>
                    {n.orderId
                      ? lang === 'ar'
                        ? 'عرض الطلب'
                        : 'Open Order'
                      : lang === 'ar'
                        ? 'تمت القراءة'
                        : 'Mark Read'}
                  </span>
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Telegram & Proximity Configuration */}
      <form onSubmit={handleSaveSettings} className="border border-[#944A5E] bg-[#6E2438] p-6 space-y-6">
        <div className="space-y-3 border-b border-[#944A5E] pb-5">
          <h3 className="text-base font-semibold text-white">
            {lang === 'ar' ? 'تنبيهات Telegram التلقائية' : 'Telegram Bot Order Alerts'}
          </h3>
          <p className="text-xs text-white/80">
            {settings.telegramConfigured
              ? lang === 'ar'
                ? 'ربط التليغرام مفعل حالياً.'
                : 'Telegram credentials are configured.'
              : lang === 'ar'
                ? 'أدخل توكن البوت ومعرف الدردشة (أو أضفها في أسرار البيئة TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID).'
                : 'Enter bot token and chat ID (or configure TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID in Secrets).'}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <input
              type="password"
              dir="ltr"
              placeholder="Telegram Bot Token (optional update)"
              value={tgToken}
              onChange={(e) => setTgToken(e.target.value)}
              className="px-3 py-2 border border-[#944A5E] bg-[#461221] text-white placeholder:text-white/45"
            />
            <input
              type="text"
              dir="ltr"
              placeholder="Telegram Chat ID (optional update)"
              value={tgChatId}
              onChange={(e) => setTgChatId(e.target.value)}
              className="px-3 py-2 border border-[#944A5E] bg-[#461221] text-white placeholder:text-white/45"
            />
          </div>
          <label className="inline-flex items-center gap-2 text-xs cursor-pointer text-white">
            <input
              type="checkbox"
              checked={tgNotify}
              onChange={(e) => setTgNotify(e.target.checked)}
              className="accent-[#0E0A0C]"
            />
            <span>{lang === 'ar' ? 'إرسال تنبيه فوري عند كل طلب جديد' : 'Send instant Telegram message per new order'}</span>
          </label>
        </div>

        <div className="space-y-3">
          <h3 className="text-base font-semibold text-white">
            {lang === 'ar' ? 'إعدادات رسائل القرب من المتجر (بالموافقة الصريحة)' : 'Proximity Marketing Settings (Opt-in Browser Session)'}
          </h3>
          <label className="inline-flex items-center gap-2 text-xs cursor-pointer text-white">
            <input
              type="checkbox"
              checked={proxEnabled}
              onChange={(e) => setProxEnabled(e.target.checked)}
              className="accent-[#0E0A0C]"
            />
            <span>{lang === 'ar' ? 'تفعيل إشعارات القرب الجغرافي' : 'Enable proximity marketing check'}</span>
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="space-y-1">
              <label className="font-medium text-white">
                {lang === 'ar' ? 'نطاق المسافة (متر — الافتراضي 2000م / 2 كم)' : 'Radius (meters — default 2000m / 2 km)'}
              </label>
              <input
                type="number"
                min={50}
                value={proxRadius}
                onChange={(e) => setProxRadius(e.target.value)}
                className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white tabular-nums-en"
              />
            </div>
            <div className="space-y-1">
              <label className="font-medium text-white">{lang === 'ar' ? 'فترة التهدئة (ساعات)' : 'Cooldown (hours)'}</label>
              <input
                type="number"
                min={1}
                value={proxCooldown}
                onChange={(e) => setProxCooldown(e.target.value)}
                className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white tabular-nums-en"
              />
            </div>
            <input
              value={proxMsgAr}
              onChange={(e) => setProxMsgAr(e.target.value)}
              placeholder="رسالة القرب بالعربية"
              className="px-3 py-2 border border-[#944A5E] bg-[#461221] text-white placeholder:text-white/45"
            />
            <input
              value={proxMsgEn}
              onChange={(e) => setProxMsgEn(e.target.value)}
              placeholder="Proximity message in English"
              className="px-3 py-2 border border-[#944A5E] bg-[#461221] text-white placeholder:text-white/45"
            />
          </div>
        </div>

        <button
          type="submit"
          className="px-6 py-2.5 bg-[#0E0A0C] border border-[#944A5E] text-white text-xs font-medium hover:bg-[#1E1418] transition-colors"
        >
          {lang === 'ar' ? 'حفظ الإعدادات' : 'Save Notification Settings'}
        </button>
      </form>
    </div>
  );
};

interface StoreAndMapsPanelProps {
  lang: Language;
  adminToken: string;
  settings: StoreSettings;
  products?: Product[];
  options?: OptionItem[];
  onRefresh: () => Promise<void>;
}

interface BackupSnapshotInfo {
  filename: string;
  createdAt: string;
  sizeBytes: number;
}

export const AdminStoreAndMapsPanel: React.FC<StoreAndMapsPanelProps> = ({
  lang,
  adminToken,
  settings,
  products = [],
  options = [],
  onRefresh,
}) => {
  const buildFormState = (s: StoreSettings) => ({
    storeNameAr: s.storeNameAr,
    storeNameEn: s.storeNameEn,
    taglineAr: s.taglineAr,
    taglineEn: s.taglineEn,
    heroHeadlineAr: s.heroHeadlineAr,
    heroHeadlineEn: s.heroHeadlineEn,
    heroSubtitleAr: s.heroSubtitleAr,
    heroSubtitleEn: s.heroSubtitleEn,
    heroPrimaryCtaAr: s.heroPrimaryCtaAr,
    heroPrimaryCtaEn: s.heroPrimaryCtaEn,
    heroSecondaryCtaAr: s.heroSecondaryCtaAr,
    heroSecondaryCtaEn: s.heroSecondaryCtaEn,
    offerBannerEnabled: Boolean(s.offerBannerEnabled),
    offerBannerTextAr: s.offerBannerTextAr,
    offerBannerTextEn: s.offerBannerTextEn,
    categoriesSectionTitleAr: s.categoriesSectionTitleAr,
    categoriesSectionTitleEn: s.categoriesSectionTitleEn,
    featuredSectionTitleAr: s.featuredSectionTitleAr,
    featuredSectionTitleEn: s.featuredSectionTitleEn,
    loyaltyPromoBadgeAr: s.loyaltyPromoBadgeAr,
    loyaltyPromoBadgeEn: s.loyaltyPromoBadgeEn,
    loyaltyPromoTitleAr: s.loyaltyPromoTitleAr,
    loyaltyPromoTitleEn: s.loyaltyPromoTitleEn,
    loyaltyPromoDescAr: s.loyaltyPromoDescAr,
    loyaltyPromoDescEn: s.loyaltyPromoDescEn,
    aboutTitleAr: s.aboutTitleAr,
    aboutTitleEn: s.aboutTitleEn,
    aboutTextAr: s.aboutTextAr,
    aboutTextEn: s.aboutTextEn,
    builderTitleAr: s.builderTitleAr,
    builderTitleEn: s.builderTitleEn,
    builderSubtitleAr: s.builderSubtitleAr,
    builderSubtitleEn: s.builderSubtitleEn,
    footerTextAr: s.footerTextAr,
    footerTextEn: s.footerTextEn,
    defaultLanguage: s.defaultLanguage,
    maxCustomRoses: String(s.maxCustomRoses || 101),
    logoUrl: s.logoUrl,
    heroBannerUrl: s.heroBannerUrl,
    storePhotoUrl: s.storePhotoUrl,
    addressAr: s.addressAr,
    addressEn: s.addressEn,
    phone: s.phone,
    secondaryPhone: s.secondaryPhone || '',
    instagramHandle: s.instagramHandle,
    instagramUrl: s.instagramUrl,
    workingHoursAr: s.workingHoursAr,
    workingHoursEn: s.workingHoursEn,
    latitude: s.latitude !== null ? String(s.latitude) : '',
    longitude: s.longitude !== null ? String(s.longitude) : '',
    googleMapsUrl: s.googleMapsUrl,
    googleBusinessProfileUrl: s.googleBusinessProfileUrl,
    locationVerified: s.locationVerified,
  });

  const [form, setForm] = useState(() => buildFormState(settings));
  const [paymentMethods, setPaymentMethods] = useState(settings.paymentMethods);
  const [backups, setBackups] = useState<BackupSnapshotInfo[]>([]);
  const [cloudAuthed, setCloudAuthed] = useState(() => isOwnerFirebaseAuthed());
  const [busyAction, setBusyAction] = useState('');
  const [feedback, setFeedback] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    setForm(buildFormState(settings));
    setPaymentMethods(settings.paymentMethods);
  }, [settings]);

  useEffect(() => {
    let active = true;
    fetch('/api/admin/backups', {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (active && json?.backups) setBackups(json.backups);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [adminToken]);

  const handleUploadAsset = async (
    file: File,
    field: 'logoUrl' | 'heroBannerUrl' | 'storePhotoUrl'
  ) => {
    setErrorMsg('');
    const fd = new FormData();
    fd.append('image', file);
    const resp = await fetch('/api/admin/upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: fd,
    });
    const data = await resp.json();
    if (resp.ok && data.url) {
      setForm((prev) => ({ ...prev, [field]: data.url }));
      setFeedback(
        lang === 'ar' ? 'تم رفع الصورة. اضغط حفظ لتطبيقها على المتجر.' : 'Image uploaded. Click Save to apply.'
      );
    } else {
      setErrorMsg(data.error || 'Upload failed');
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback('');
    setErrorMsg('');
    setBusyAction('save');
    try {
      const latNum = form.latitude.trim() ? Number(form.latitude) : null;
      const lngNum = form.longitude.trim() ? Number(form.longitude) : null;

      const resp = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          ...form,
          maxCustomRoses: Math.max(1, Math.min(500, Number(form.maxCustomRoses) || 101)),
          latitude: Number.isFinite(latNum as number) ? latNum : null,
          longitude: Number.isFinite(lngNum as number) ? lngNum : null,
          paymentMethods,
        }),
      });
      const saved = await resp.json();
      if (!resp.ok) {
        setErrorMsg(saved.error || 'Could not save settings');
        return;
      }
      let cloudSynced = false;
      if (saved.settings) {
        try {
          cloudSynced = await syncSettingsToFirestore(saved.settings);
        } catch {
          cloudSynced = false;
        }
      }
      await onRefresh();
      setFeedback(
        lang === 'ar'
          ? cloudSynced
            ? 'تم حفظ كافة إعدادات المتجر ومزامنتها سحابياً بنجاح.'
            : 'تم حفظ كافة إعدادات المتجر في قاعدة البيانات بنجاح.'
          : cloudSynced
            ? 'Store settings saved to database & synced to cloud.'
            : 'Store settings saved permanently to database.'
      );
    } finally {
      setBusyAction('');
    }
  };

  const handleCreateAndDownloadBackup = async () => {
    setBusyAction('backup');
    setFeedback('');
    setErrorMsg('');
    try {
      const resp = await fetch('/api/admin/backups', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const json = await resp.json();
      if (!resp.ok) {
        setErrorMsg(json.error || 'Backup failed');
        return;
      }
      if (json.backups) setBackups(json.backups);
      if (json.exportData) {
        const blob = new Blob([JSON.stringify(json.exportData, null, 2)], {
          type: 'application/json',
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `sedo-backup-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }
      setFeedback(
        lang === 'ar'
          ? 'تم إنشاء نسخة احتياطية على الخادم وتحميل نسخة JSON.'
          : 'Server backup snapshot created and JSON downloaded.'
      );
    } finally {
      setBusyAction('');
    }
  };

  const handleCloudSync = async () => {
    setBusyAction('cloud');
    setFeedback('');
    setErrorMsg('');
    try {
      if (!isOwnerFirebaseAuthed()) {
        const cred = await signInWithPopup(auth, googleProvider);
        if (cred.user.email !== 'moimlali00@gmail.com') {
          setErrorMsg(
            lang === 'ar'
              ? 'حساب Google غير مصرح للمزامنة السحابية.'
              : 'Google account is not authorized as store owner.'
          );
          return;
        }
      }
      setCloudAuthed(isOwnerFirebaseAuthed());
      const ok = await syncFullCatalogToFirestore({
        products,
        options,
        settings,
      });
      setFeedback(
        ok
          ? lang === 'ar'
            ? 'تمت مزامنة كافة المنتجات والإعدادات والفئات مع السحابة الدائمة (Firestore).'
            : 'All products, options, categories & settings synced permanently to Cloud Firestore.'
          : lang === 'ar'
            ? 'يرجى تأكيد تسجيل الدخول بحساب المالك.'
            : 'Please complete owner Google sign-in to sync.'
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Cloud sync failed');
    } finally {
      setBusyAction('');
    }
  };

  return (
    <div className="space-y-8 text-white">
      {feedback && (
        <div className="border border-[#944A5E] bg-[#0E0A0C] px-4 py-3 text-xs text-white">
          {feedback}
        </div>
      )}
      {errorMsg && (
        <div className="border border-white/60 bg-[#0E0A0C] px-4 py-3 text-xs text-white">
          {errorMsg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <form onSubmit={handleSave} className="lg:col-span-8 border border-[#944A5E] bg-[#6E2438] p-6 space-y-6">
          <div className="flex items-center gap-2 text-white border-b border-[#944A5E] pb-3">
            <Store className="w-5 h-5" />
            <h3 className="text-base font-semibold">
              {lang === 'ar'
                ? 'إدارة نصوص الموقع والصور والبانر والخرائط والإعدادات'
                : 'Website Text, Banners, Brand Assets, Maps & Settings'}
            </h3>
          </div>

          {/* Media Uploads & Direct Image URLs */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            {(
              [
                { key: 'logoUrl', labelAr: 'شعار SEDO', labelEn: 'SEDO Logo' },
                { key: 'heroBannerUrl', labelAr: 'صورة الواجهة الرئيسية', labelEn: 'Hero Floral Banner' },
                { key: 'storePhotoUrl', labelAr: 'صورة المتجر في كربلاء', labelEn: 'Karbala Store Photo' },
              ] as const
            ).map((item) => (
              <div key={item.key} className="border border-[#944A5E] p-3 space-y-2 bg-[#461221]">
                <div className="font-semibold text-white">
                  {lang === 'ar' ? item.labelAr : item.labelEn}
                </div>
                <div className="aspect-[4/3] bg-[#5E1D2F] border border-[#944A5E] overflow-hidden flex items-center justify-center">
                  {form[item.key] ? (
                    <SafeImage src={form[item.key]} alt={item.labelEn} />
                  ) : (
                    <span className="text-white/65">SEDO Text Mark</span>
                  )}
                </div>
                <input
                  type="text"
                  dir="ltr"
                  value={form[item.key]}
                  onChange={(e) => setForm((prev) => ({ ...prev, [item.key]: e.target.value }))}
                  placeholder="/uploads/... or https://..."
                  className="w-full px-2.5 py-1.5 border border-[#944A5E] bg-[#5E1D2F] text-white placeholder:text-white/45"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-[#944A5E] bg-[#0E0A0C] text-white cursor-pointer hover:border-white transition-colors">
                    <Upload className="w-3.5 h-3.5 text-white" />
                    <span>{lang === 'ar' ? 'رفع / تغيير' : 'Upload'}</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleUploadAsset(f, item.key);
                      }}
                    />
                  </label>
                  {item.key === 'logoUrl' && form.logoUrl && (
                    <button
                      type="button"
                      onClick={() => setForm((prev) => ({ ...prev, logoUrl: '' }))}
                      className="px-2.5 py-1.5 border border-[#944A5E] bg-[#5E1D2F] text-white hover:border-white"
                    >
                      {lang === 'ar' ? 'إزالة' : 'Clear'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Store Identity & Hero Text */}
          <div className="border-t border-[#944A5E] pt-5 space-y-3 text-xs">
            <div className="font-bold text-white">
              {lang === 'ar' ? 'هوية المتجر ونصوص الواجهة الرئيسية' : 'Brand Identity & Hero Copy'}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="font-medium">{lang === 'ar' ? 'اسم المتجر (AR)' : 'Store Name (AR)'}</label>
                <input
                  value={form.storeNameAr}
                  onChange={(e) => setForm({ ...form, storeNameAr: e.target.value })}
                  className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="font-medium">{lang === 'ar' ? 'اسم المتجر (EN)' : 'Store Name (EN)'}</label>
                <input
                  value={form.storeNameEn}
                  onChange={(e) => setForm({ ...form, storeNameEn: e.target.value })}
                  className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="font-medium">{lang === 'ar' ? 'الشارة التعريفية (AR)' : 'Tagline (AR)'}</label>
                <input
                  value={form.taglineAr}
                  onChange={(e) => setForm({ ...form, taglineAr: e.target.value })}
                  className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="font-medium">{lang === 'ar' ? 'الشارة التعريفية (EN)' : 'Tagline (EN)'}</label>
                <input
                  value={form.taglineEn}
                  onChange={(e) => setForm({ ...form, taglineEn: e.target.value })}
                  className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="font-medium">{lang === 'ar' ? 'عنوان الهيرو (AR)' : 'Hero Headline (AR)'}</label>
                <input
                  value={form.heroHeadlineAr}
                  onChange={(e) => setForm({ ...form, heroHeadlineAr: e.target.value })}
                  className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="font-medium">{lang === 'ar' ? 'عنوان الهيرو (EN)' : 'Hero Headline (EN)'}</label>
                <input
                  value={form.heroHeadlineEn}
                  onChange={(e) => setForm({ ...form, heroHeadlineEn: e.target.value })}
                  className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="font-medium">{lang === 'ar' ? 'وصف الهيرو (AR)' : 'Hero Subtitle (AR)'}</label>
                <textarea
                  rows={2}
                  value={form.heroSubtitleAr}
                  onChange={(e) => setForm({ ...form, heroSubtitleAr: e.target.value })}
                  className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="font-medium">{lang === 'ar' ? 'وصف الهيرو (EN)' : 'Hero Subtitle (EN)'}</label>
                <textarea
                  rows={2}
                  value={form.heroSubtitleEn}
                  onChange={(e) => setForm({ ...form, heroSubtitleEn: e.target.value })}
                  className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="font-medium">{lang === 'ar' ? 'زر الهيرو الرئيسي (AR)' : 'Hero Primary CTA (AR)'}</label>
                <input
                  value={form.heroPrimaryCtaAr}
                  onChange={(e) => setForm({ ...form, heroPrimaryCtaAr: e.target.value })}
                  className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="font-medium">{lang === 'ar' ? 'زر الهيرو الرئيسي (EN)' : 'Hero Primary CTA (EN)'}</label>
                <input
                  value={form.heroPrimaryCtaEn}
                  onChange={(e) => setForm({ ...form, heroPrimaryCtaEn: e.target.value })}
                  className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="font-medium">{lang === 'ar' ? 'زر الهيرو الثانوي (AR)' : 'Hero Secondary CTA (AR)'}</label>
                <input
                  value={form.heroSecondaryCtaAr}
                  onChange={(e) => setForm({ ...form, heroSecondaryCtaAr: e.target.value })}
                  className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="font-medium">{lang === 'ar' ? 'زر الهيرو الثانوي (EN)' : 'Hero Secondary CTA (EN)'}</label>
                <input
                  value={form.heroSecondaryCtaEn}
                  onChange={(e) => setForm({ ...form, heroSecondaryCtaEn: e.target.value })}
                  className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="font-medium">{lang === 'ar' ? 'اللغة الافتراضية للموقع' : 'Default Storefront Language'}</label>
                <select
                  value={form.defaultLanguage}
                  onChange={(e) => setForm({ ...form, defaultLanguage: e.target.value as Language })}
                  className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
                >
                  <option value="ar">العربية (AR)</option>
                  <option value="en">English (EN)</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="font-medium">{lang === 'ar' ? 'الحد الأقصى لعدد الورود المخصصة' : 'Max Custom Roses Limit'}</label>
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={form.maxCustomRoses}
                  onChange={(e) => setForm({ ...form, maxCustomRoses: e.target.value })}
                  className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white tabular-nums-en"
                />
              </div>
            </div>
          </div>

          {/* Offer Banner & Homepage Section Texts */}
          <div className="border-t border-[#944A5E] pt-5 space-y-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-bold text-white">
                {lang === 'ar' ? 'شريط العروض وعناوين أقسام الرئيسية' : 'Offer Banner & Homepage Sections'}
              </div>
              <label className="inline-flex items-center gap-2 cursor-pointer text-white">
                <input
                  type="checkbox"
                  checked={form.offerBannerEnabled}
                  onChange={(e) => setForm({ ...form, offerBannerEnabled: e.target.checked })}
                  className="accent-[#0E0A0C]"
                />
                <span>{lang === 'ar' ? 'تفعيل شريط العروض في الرئيسية' : 'Show Offer Banner on Homepage'}</span>
              </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="font-medium">{lang === 'ar' ? 'نص شريط العرض (AR)' : 'Offer Banner Text (AR)'}</label>
                <input
                  value={form.offerBannerTextAr}
                  onChange={(e) => setForm({ ...form, offerBannerTextAr: e.target.value })}
                  className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="font-medium">{lang === 'ar' ? 'نص شريط العرض (EN)' : 'Offer Banner Text (EN)'}</label>
                <input
                  value={form.offerBannerTextEn}
                  onChange={(e) => setForm({ ...form, offerBannerTextEn: e.target.value })}
                  className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="font-medium">{lang === 'ar' ? 'عنوان قسم الفئات (AR)' : 'Categories Heading (AR)'}</label>
                <input
                  value={form.categoriesSectionTitleAr}
                  onChange={(e) => setForm({ ...form, categoriesSectionTitleAr: e.target.value })}
                  className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="font-medium">{lang === 'ar' ? 'عنوان قسم الفئات (EN)' : 'Categories Heading (EN)'}</label>
                <input
                  value={form.categoriesSectionTitleEn}
                  onChange={(e) => setForm({ ...form, categoriesSectionTitleEn: e.target.value })}
                  className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="font-medium">{lang === 'ar' ? 'عنوان القسم المختار (AR)' : 'Featured Heading (AR)'}</label>
                <input
                  value={form.featuredSectionTitleAr}
                  onChange={(e) => setForm({ ...form, featuredSectionTitleAr: e.target.value })}
                  className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="font-medium">{lang === 'ar' ? 'عنوان القسم المختار (EN)' : 'Featured Heading (EN)'}</label>
                <input
                  value={form.featuredSectionTitleEn}
                  onChange={(e) => setForm({ ...form, featuredSectionTitleEn: e.target.value })}
                  className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="font-medium">{lang === 'ar' ? 'شارة قسم الولاء (AR)' : 'Loyalty Promo Badge (AR)'}</label>
                <input
                  value={form.loyaltyPromoBadgeAr}
                  onChange={(e) => setForm({ ...form, loyaltyPromoBadgeAr: e.target.value })}
                  className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="font-medium">{lang === 'ar' ? 'شارة قسم الولاء (EN)' : 'Loyalty Promo Badge (EN)'}</label>
                <input
                  value={form.loyaltyPromoBadgeEn}
                  onChange={(e) => setForm({ ...form, loyaltyPromoBadgeEn: e.target.value })}
                  className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="font-medium">{lang === 'ar' ? 'عنوان قسم الولاء (AR)' : 'Loyalty Promo Title (AR)'}</label>
                <input
                  value={form.loyaltyPromoTitleAr}
                  onChange={(e) => setForm({ ...form, loyaltyPromoTitleAr: e.target.value })}
                  className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="font-medium">{lang === 'ar' ? 'عنوان قسم الولاء (EN)' : 'Loyalty Promo Title (EN)'}</label>
                <input
                  value={form.loyaltyPromoTitleEn}
                  onChange={(e) => setForm({ ...form, loyaltyPromoTitleEn: e.target.value })}
                  className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="font-medium">{lang === 'ar' ? 'وصف قسم الولاء (AR)' : 'Loyalty Promo Desc (AR)'}</label>
                <input
                  value={form.loyaltyPromoDescAr}
                  onChange={(e) => setForm({ ...form, loyaltyPromoDescAr: e.target.value })}
                  className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="font-medium">{lang === 'ar' ? 'وصف قسم الولاء (EN)' : 'Loyalty Promo Desc (EN)'}</label>
                <input
                  value={form.loyaltyPromoDescEn}
                  onChange={(e) => setForm({ ...form, loyaltyPromoDescEn: e.target.value })}
                  className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
                />
              </div>
            </div>
          </div>

          {/* About, Builder & Footer Text */}
          <div className="border-t border-[#944A5E] pt-5 space-y-3 text-xs">
            <div className="font-bold text-white">
              {lang === 'ar' ? 'نصوص من نحن ومصمم الباقات والتذييل' : 'About, Bouquet Builder & Footer Copy'}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="font-medium">{lang === 'ar' ? 'عنوان من نحن (AR)' : 'About Title (AR)'}</label>
                <input
                  value={form.aboutTitleAr}
                  onChange={(e) => setForm({ ...form, aboutTitleAr: e.target.value })}
                  className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="font-medium">{lang === 'ar' ? 'عنوان من نحن (EN)' : 'About Title (EN)'}</label>
                <input
                  value={form.aboutTitleEn}
                  onChange={(e) => setForm({ ...form, aboutTitleEn: e.target.value })}
                  className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="font-medium">{lang === 'ar' ? 'نص من نحن (AR)' : 'About Text (AR)'}</label>
                <textarea
                  rows={3}
                  value={form.aboutTextAr}
                  onChange={(e) => setForm({ ...form, aboutTextAr: e.target.value })}
                  className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="font-medium">{lang === 'ar' ? 'نص من نحن (EN)' : 'About Text (EN)'}</label>
                <textarea
                  rows={3}
                  value={form.aboutTextEn}
                  onChange={(e) => setForm({ ...form, aboutTextEn: e.target.value })}
                  className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="font-medium">{lang === 'ar' ? 'عنوان مصمم الباقة (AR)' : 'Builder Title (AR)'}</label>
                <input
                  value={form.builderTitleAr}
                  onChange={(e) => setForm({ ...form, builderTitleAr: e.target.value })}
                  className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="font-medium">{lang === 'ar' ? 'عنوان مصمم الباقة (EN)' : 'Builder Title (EN)'}</label>
                <input
                  value={form.builderTitleEn}
                  onChange={(e) => setForm({ ...form, builderTitleEn: e.target.value })}
                  className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="font-medium">{lang === 'ar' ? 'وصف مصمم الباقة (AR)' : 'Builder Subtitle (AR)'}</label>
                <input
                  value={form.builderSubtitleAr}
                  onChange={(e) => setForm({ ...form, builderSubtitleAr: e.target.value })}
                  className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="font-medium">{lang === 'ar' ? 'وصف مصمم الباقة (EN)' : 'Builder Subtitle (EN)'}</label>
                <input
                  value={form.builderSubtitleEn}
                  onChange={(e) => setForm({ ...form, builderSubtitleEn: e.target.value })}
                  className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="font-medium">{lang === 'ar' ? 'وصف تذييل الموقع (AR)' : 'Footer Description (AR)'}</label>
                <input
                  value={form.footerTextAr}
                  onChange={(e) => setForm({ ...form, footerTextAr: e.target.value })}
                  className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="font-medium">{lang === 'ar' ? 'وصف تذييل الموقع (EN)' : 'Footer Description (EN)'}</label>
                <input
                  value={form.footerTextEn}
                  onChange={(e) => setForm({ ...form, footerTextEn: e.target.value })}
                  className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
                />
              </div>
            </div>
          </div>

          {/* Contact & Hours */}
          <div className="border-t border-[#944A5E] pt-5 space-y-3 text-xs">
            <div className="font-bold text-white">
              {lang === 'ar' ? 'معلومات التواصل وأوقات الدوام' : 'Contact Information & Working Hours'}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="font-medium">{lang === 'ar' ? 'العنوان في كربلاء (AR)' : 'Address (AR)'}</label>
                <input
                  value={form.addressAr}
                  onChange={(e) => setForm({ ...form, addressAr: e.target.value })}
                  className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="font-medium">{lang === 'ar' ? 'العنوان (EN)' : 'Address (EN)'}</label>
                <input
                  value={form.addressEn}
                  onChange={(e) => setForm({ ...form, addressEn: e.target.value })}
                  className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="font-medium">{lang === 'ar' ? 'رقم الهاتف الأساسي' : 'Primary Phone & WhatsApp'}</label>
                <input
                  dir="ltr"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white tabular-nums-en"
                />
              </div>
              <div className="space-y-1">
                <label className="font-medium">{lang === 'ar' ? 'رقم الهاتف الثاني' : 'Secondary Phone & WhatsApp'}</label>
                <input
                  dir="ltr"
                  value={form.secondaryPhone}
                  onChange={(e) => setForm({ ...form, secondaryPhone: e.target.value })}
                  className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white tabular-nums-en"
                />
              </div>
              <div className="space-y-1">
                <label className="font-medium">{lang === 'ar' ? 'معرف إنستغرام' : 'Instagram Handle'}</label>
                <input
                  dir="ltr"
                  value={form.instagramHandle}
                  onChange={(e) => setForm({ ...form, instagramHandle: e.target.value })}
                  className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="font-medium">{lang === 'ar' ? 'رابط إنستغرام' : 'Instagram URL'}</label>
                <input
                  dir="ltr"
                  value={form.instagramUrl}
                  onChange={(e) => setForm({ ...form, instagramUrl: e.target.value })}
                  className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="font-medium">{lang === 'ar' ? 'أوقات العمل (AR)' : 'Working Hours (AR)'}</label>
                <input
                  value={form.workingHoursAr}
                  onChange={(e) => setForm({ ...form, workingHoursAr: e.target.value })}
                  className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="font-medium">{lang === 'ar' ? 'أوقات العمل (EN)' : 'Working Hours (EN)'}</label>
                <input
                  value={form.workingHoursEn}
                  onChange={(e) => setForm({ ...form, workingHoursEn: e.target.value })}
                  className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
                />
              </div>
            </div>
          </div>

          {/* Exact Karbala Maps Verification */}
          <div className="border-t border-[#944A5E] pt-5 space-y-3 text-xs">
            <div className="flex items-center gap-2 font-bold text-white">
              <MapPin className="w-4 h-4" />
              <span>{lang === 'ar' ? 'تأكيد موقع المتجر على خرائط Google' : 'Google Maps & Coordinates'}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="number"
                step="any"
                dir="ltr"
                placeholder="Latitude (e.g. 32.6160)"
                value={form.latitude}
                onChange={(e) => setForm({ ...form, latitude: e.target.value })}
                className="px-3 py-2 border border-[#944A5E] bg-[#461221] text-white placeholder:text-white/45 tabular-nums-en"
              />
              <input
                type="number"
                step="any"
                dir="ltr"
                placeholder="Longitude (e.g. 44.0249)"
                value={form.longitude}
                onChange={(e) => setForm({ ...form, longitude: e.target.value })}
                className="px-3 py-2 border border-[#944A5E] bg-[#461221] text-white placeholder:text-white/45 tabular-nums-en"
              />
              <input
                dir="ltr"
                placeholder="Google Maps URL"
                value={form.googleMapsUrl}
                onChange={(e) => setForm({ ...form, googleMapsUrl: e.target.value })}
                className="px-3 py-2 border border-[#944A5E] bg-[#461221] text-white placeholder:text-white/45"
              />
              <input
                dir="ltr"
                placeholder="Google Business Profile URL"
                value={form.googleBusinessProfileUrl}
                onChange={(e) => setForm({ ...form, googleBusinessProfileUrl: e.target.value })}
                className="px-3 py-2 border border-[#944A5E] bg-[#461221] text-white placeholder:text-white/45"
              />
            </div>
            <label className="inline-flex items-center gap-2 cursor-pointer text-white">
              <input
                type="checkbox"
                checked={form.locationVerified}
                onChange={(e) => setForm({ ...form, locationVerified: e.target.checked })}
                className="accent-[#0E0A0C]"
              />
              <span>
                {lang === 'ar'
                  ? 'أؤكد صحة إحداثيات فرع SEDO في كربلاء لعرضها للعملاء'
                  : 'Confirm exact SEDO Karbala coordinates are verified'}
              </span>
            </label>
          </div>

          {/* Payment Methods Visibility & Editable Details */}
          <div className="border-t border-[#944A5E] pt-5 space-y-3 text-xs">
            <div className="font-bold text-white">
              {lang === 'ar' ? 'طرق الدفع المفعّلة والتعليمات' : 'Payment Methods & Instructions'}
            </div>
            {paymentMethods.map((pm) => (
              <div key={pm.id} className="border border-[#944A5E] bg-[#461221] p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-white">{lang === 'ar' ? pm.nameAr : pm.nameEn}</span>
                    <span className="text-white/70">
                      ({pm.isIntegrated ? 'Integrated' : 'Gateway Credentials Required'})
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    disabled={!pm.isIntegrated}
                    checked={pm.isActive && pm.isIntegrated}
                    onChange={(e) =>
                      setPaymentMethods((prev) =>
                        prev.map((m) => (m.id === pm.id ? { ...m, isActive: e.target.checked } : m))
                      )
                    }
                    className="accent-[#0E0A0C]"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    value={pm.nameAr}
                    onChange={(e) =>
                      setPaymentMethods((prev) =>
                        prev.map((m) => (m.id === pm.id ? { ...m, nameAr: e.target.value } : m))
                      )
                    }
                    placeholder="Name (AR)"
                    className="px-2.5 py-1.5 border border-[#944A5E] bg-[#5E1D2F] text-white"
                  />
                  <input
                    value={pm.nameEn}
                    onChange={(e) =>
                      setPaymentMethods((prev) =>
                        prev.map((m) => (m.id === pm.id ? { ...m, nameEn: e.target.value } : m))
                      )
                    }
                    placeholder="Name (EN)"
                    className="px-2.5 py-1.5 border border-[#944A5E] bg-[#5E1D2F] text-white"
                  />
                  <input
                    value={pm.instructionsAr}
                    onChange={(e) =>
                      setPaymentMethods((prev) =>
                        prev.map((m) => (m.id === pm.id ? { ...m, instructionsAr: e.target.value } : m))
                      )
                    }
                    placeholder="Instructions (AR)"
                    className="px-2.5 py-1.5 border border-[#944A5E] bg-[#5E1D2F] text-white"
                  />
                  <input
                    value={pm.instructionsEn}
                    onChange={(e) =>
                      setPaymentMethods((prev) =>
                        prev.map((m) => (m.id === pm.id ? { ...m, instructionsEn: e.target.value } : m))
                      )
                    }
                    placeholder="Instructions (EN)"
                    className="px-2.5 py-1.5 border border-[#944A5E] bg-[#5E1D2F] text-white"
                  />
                </div>
              </div>
            ))}
          </div>

          <button
            type="submit"
            disabled={busyAction === 'save'}
            className="px-6 py-2.5 bg-[#0E0A0C] border border-[#944A5E] text-white text-xs font-medium hover:bg-[#1E1418] transition-colors disabled:opacity-60"
          >
            {busyAction === 'save'
              ? '...'
              : lang === 'ar'
                ? 'حفظ كافة إعدادات المتجر والموقع'
                : 'Save All Store & Website Settings'}
          </button>
        </form>

        <div className="lg:col-span-4 space-y-6">
          <QrCodeCard lang={lang} />

          {/* Database Backup & Permanent Cloud Sync Card */}
          <div className="border border-[#944A5E] bg-[#6E2438] p-5 space-y-4 text-xs">
            <h4 className="text-sm font-semibold text-white">
              {lang === 'ar' ? 'النسخ الاحتياطي والمزامنة السحابية' : 'Database Backup & Cloud Sync'}
            </h4>
            <p className="text-white/80 leading-relaxed">
              {lang === 'ar'
                ? 'احفظ نسخة احتياطية كاملة لقاعدة البيانات أو زامن تعديلاتك مع السحابة الدائمة لضمان بقاء التغييرات بعد أي نشر أو إعادة تشغيل.'
                : 'Export a database backup or sync your catalog and settings to Cloud Firestore so changes persist across deployments.'}
            </p>
            <div className="space-y-2.5">
              <button
                type="button"
                disabled={busyAction === 'backup'}
                onClick={handleCreateAndDownloadBackup}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#0E0A0C] border border-[#944A5E] text-white font-medium hover:bg-[#1E1418] transition-colors"
              >
                <Download className="w-4 h-4" />
                <span>
                  {lang === 'ar' ? 'إنشاء وتحميل نسخة احتياطية JSON' : 'Create & Download JSON Backup'}
                </span>
              </button>
              <button
                type="button"
                disabled={busyAction === 'cloud'}
                onClick={handleCloudSync}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#461221] border border-[#944A5E] text-white font-medium hover:border-white transition-colors"
              >
                <CloudUpload className="w-4 h-4" />
                <span>
                  {cloudAuthed
                    ? lang === 'ar'
                      ? 'مزامنة كافة البيانات مع Firestore'
                      : 'Sync Full Catalog to Cloud Firestore'
                    : lang === 'ar'
                      ? 'ربط حساب المالك ومزامنة السحابة'
                      : 'Connect Owner Google & Sync Cloud'}
                </span>
              </button>
            </div>

            {backups.length > 0 && (
              <div className="border-t border-[#944A5E] pt-3 space-y-1.5">
                <div className="font-semibold text-white/90">
                  {lang === 'ar' ? 'أحدث النسخ المحفوظة على الخادم:' : 'Recent Server Snapshots:'}
                </div>
                <div className="space-y-1 max-h-36 overflow-y-auto">
                  {backups.slice(0, 5).map((b) => (
                    <div
                      key={b.filename}
                      className="flex items-center justify-between gap-2 text-[11px] text-white/75 tabular-nums-en"
                      dir="ltr"
                    >
                      <span className="truncate">{b.filename}</span>
                      <span>{Math.round(b.sizeBytes / 1024)} KB</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export const AdminAuditLogsPanel: React.FC<{
  lang: Language;
  auditLogs: AuditLogEntry[];
}> = ({ lang, auditLogs }) => (
  <div className="space-y-4 text-white">
    <div className="flex items-center gap-2 text-white">
      <Shield className="w-5 h-5" />
      <h3 className="text-base font-semibold">
        {lang === 'ar' ? 'سجل التدقيق الأمني والإداري' : 'Administrative Audit Trail'}
      </h3>
    </div>
    <div className="border border-[#944A5E] divide-y divide-[#944A5E] bg-[#6E2438]">
      {auditLogs.length === 0 ? (
        <div className="p-6 text-xs text-white/75">No audit records yet.</div>
      ) : (
        auditLogs.map((log) => (
          <div key={log.id} className="px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div>
              <span className="font-bold text-white">{log.action}</span> ·{' '}
              <span className="text-white/85">{log.details}</span>
            </div>
            <div className="text-white/70 tabular-nums-en" dir="ltr">
              {log.actor} · {new Date(log.createdAt).toLocaleString('en-US')}
            </div>
          </div>
        ))
      )}
    </div>
  </div>
);
