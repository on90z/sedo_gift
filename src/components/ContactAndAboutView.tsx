import React from 'react';
import { Clock, Instagram, MapPin, MessageCircle, Phone } from 'lucide-react';
import type { Language, StoreSettings } from '../shared/types.ts';
import { toTelHref, toWhatsAppUrl } from '../shared/pricing.ts';
import { UI_COPY } from '../i18n/translations.ts';
import { SafeImage } from './SafeImage.tsx';
import { StoreMap } from './StoreMap.tsx';
import { QrCodeCard } from './QrCodeCard.tsx';

interface ContactAndAboutViewProps {
  lang: Language;
  settings: StoreSettings;
  mapsApiKey: string;
}

export const ContactAndAboutView: React.FC<ContactAndAboutViewProps> = ({
  lang,
  settings,
  mapsApiKey,
}) => {
  const t = UI_COPY[lang];
  const contactNumbers = [settings.phone, settings.secondaryPhone].filter(
    (num): num is string => Boolean(num && num.trim())
  );

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-14">
      {/* About SEDO */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch border-b border-[#944A5E] pb-12">
        <div className="lg:col-span-6 flex flex-col justify-center space-y-5">
          <div className="text-xs font-medium text-white/75">
            {lang === 'ar' ? settings.storeNameAr : settings.storeNameEn}
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-bold text-white">
            {(lang === 'ar' ? settings.aboutTitleAr : settings.aboutTitleEn) || t.aboutTitle}
          </h1>
          <p className="text-sm sm:text-base text-white/80 leading-relaxed">
            {(lang === 'ar' ? settings.aboutTextAr : settings.aboutTextEn) || t.aboutText}
          </p>

          <div className="space-y-3 pt-2 text-sm text-white">
            <div className="flex items-start gap-3">
              <MapPin className="w-4 h-4 text-white/80 mt-1 shrink-0" />
              <span>{lang === 'ar' ? settings.addressAr : settings.addressEn}</span>
            </div>

            {contactNumbers.map((num, index) => (
              <div key={`${num}-${index}`} className="flex flex-wrap items-center gap-3">
                <Phone className="w-4 h-4 text-white/80 shrink-0" />
                <a
                  href={toTelHref(num)}
                  className="tabular-nums-en font-medium text-white hover:text-white/75 transition-colors"
                  dir="ltr"
                  aria-label={`${lang === 'ar' ? 'اتصال مباشر' : 'Call'} ${num}`}
                >
                  {num}
                </a>
                <a
                  href={toWhatsAppUrl(num)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1 border border-[#944A5E] bg-[#0E0A0C] text-xs font-medium text-white hover:border-white hover:bg-[#1E1418] transition-colors whitespace-nowrap shrink-0"
                  aria-label={`${lang === 'ar' ? 'محادثة واتساب' : 'WhatsApp chat'} ${num}`}
                >
                  <MessageCircle className="w-3.5 h-3.5 text-white" />
                  <span>{lang === 'ar' ? 'واتساب' : 'WhatsApp'}</span>
                </a>
              </div>
            ))}

            <div className="flex items-center gap-3">
              <Clock className="w-4 h-4 text-white/80 shrink-0" />
              <span>{lang === 'ar' ? settings.workingHoursAr : settings.workingHoursEn}</span>
            </div>
            <div className="flex items-center gap-3">
              <Instagram className="w-4 h-4 text-white/80 shrink-0" />
              <a
                href={settings.instagramUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-white font-medium hover:underline"
                dir="ltr"
              >
                {settings.instagramHandle}
              </a>
            </div>
          </div>
        </div>

        <div className="lg:col-span-6 min-h-[300px] border border-[#944A5E] bg-[#461221] overflow-hidden">
          <SafeImage
            src={settings.storePhotoUrl}
            alt={t.aboutTitle}
            className="w-full h-full object-cover"
          />
        </div>
      </div>

      {/* Google Map + In-Store QR Code */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <div className="lg:col-span-8 space-y-4">
          <h2 className="font-display text-2xl font-semibold text-white">
            {lang === 'ar' ? 'موقعنا على خرائط Google' : 'Find SEDO on Google Maps'}
          </h2>
          <StoreMap apiKey={mapsApiKey} settings={settings} lang={lang} />
        </div>

        <div className="lg:col-span-4">
          <QrCodeCard lang={lang} />
        </div>
      </div>
    </section>
  );
};
