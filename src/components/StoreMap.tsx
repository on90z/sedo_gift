import React, { useState } from 'react';
import {
  APIProvider,
  AdvancedMarker,
  InfoWindow,
  Map as GoogleMap,
  Pin,
  useAdvancedMarkerRef,
} from '@vis.gl/react-google-maps';
import { MapPin, Navigation } from 'lucide-react';
import type { Language, StoreSettings } from '../shared/types.ts';
import { UI_COPY } from '../i18n/translations.ts';

interface StoreMapProps {
  apiKey: string;
  settings: StoreSettings;
  lang: Language;
}

const KarbalaFallbackCenter = { lat: 32.616, lng: 44.0249 };

const StoreMarkerWithInfo: React.FC<{
  position: { lat: number; lng: number };
  settings: StoreSettings;
  lang: Language;
}> = ({ position, settings, lang }) => {
  const [markerRef, marker] = useAdvancedMarkerRef();
  const [open, setOpen] = useState(true);

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={position}
        onClick={() => setOpen((v) => !v)}
        title={lang === 'ar' ? settings.storeNameAr : settings.storeNameEn}
      >
        <Pin background="#5E1D2F" borderColor="#0E0A0C" glyphColor="#FFFFFF" scale={1.15} />
      </AdvancedMarker>
      {open && marker && (
        <InfoWindow anchor={marker} onCloseClick={() => setOpen(false)} maxWidth={260}>
          <div className="text-[#0E0A0C] p-1 space-y-1">
            <div className="font-bold text-sm text-[#461221]">
              {lang === 'ar' ? settings.storeNameAr : settings.storeNameEn}
            </div>
            <div className="text-xs text-[#0E0A0C]/80">
              {lang === 'ar' ? settings.addressAr : settings.addressEn}
            </div>
            <div className="text-xs text-[#5E1D2F] tabular-nums-en" dir="ltr">
              {settings.phone}
              {settings.secondaryPhone ? ` · ${settings.secondaryPhone}` : ''}
            </div>
          </div>
        </InfoWindow>
      )}
    </>
  );
};

export const StoreMap: React.FC<StoreMapProps> = ({ apiKey, settings, lang }) => {
  const t = UI_COPY[lang];
  const hasCoords =
    typeof settings.latitude === 'number' &&
    typeof settings.longitude === 'number' &&
    Number.isFinite(settings.latitude) &&
    Number.isFinite(settings.longitude);

  const center = hasCoords
    ? { lat: settings.latitude!, lng: settings.longitude! }
    : KarbalaFallbackCenter;

  const directionsUrl =
    settings.googleMapsUrl ||
    (hasCoords
      ? `https://www.google.com/maps/dir/?api=1&destination=${settings.latitude},${settings.longitude}`
      : 'https://www.google.com/maps/search/?api=1&query=Karbala+Iraq');

  return (
    <div className="space-y-4">
      {!settings.locationVerified && (
        <div className="border border-[#944A5E] bg-[#6E2438] px-4 py-3 text-xs text-white/90 flex items-center gap-2">
          <MapPin className="w-4 h-4 text-white shrink-0" />
          <span>
            {lang === 'ar'
              ? 'إحداثيات المتجر الدقيقة قيد التأكيد من مالك المتجر في لوحة الإدارة (الموقع المعروض مركز مدينة كربلاء).'
              : 'Exact storefront coordinates are awaiting verification by the store owner in Admin Settings (showing central Karbala).'}
          </span>
        </div>
      )}

      <div className="w-full h-[360px] border border-[#944A5E] bg-[#461221] overflow-hidden relative">
        {apiKey ? (
          <APIProvider apiKey={apiKey} region="IQ">
            <GoogleMap
              mapId="DEMO_MAP_ID"
              defaultCenter={center}
              center={center}
              defaultZoom={hasCoords ? 16 : 13}
              gestureHandling="cooperative"
              internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
              style={{ width: '100%', height: '100%' }}
            >
              {hasCoords && <StoreMarkerWithInfo position={center} settings={settings} lang={lang} />}
            </GoogleMap>
          </APIProvider>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center gap-3 text-white">
            <MapPin className="w-8 h-8 text-white/80" />
            <p className="text-sm font-medium text-white">
              {lang === 'ar' ? settings.addressAr : settings.addressEn}
            </p>
            <p className="text-xs text-white/75">
              {lang === 'ar'
                ? 'للعرض التفاعلي للخريطة، تأكد من تفعيل مفتاح خرائط Google في إعدادات المشروع.'
                : 'Enable Google Maps API key in environment settings for interactive embedded map.'}
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-white/75">
          {hasCoords ? (
            <span className="tabular-nums-en" dir="ltr">
              {settings.latitude!.toFixed(5)}, {settings.longitude!.toFixed(5)}
            </span>
          ) : (
            <span>Karbala, Iraq</span>
          )}
        </div>
        <a
          href={directionsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#0E0A0C] border border-[#944A5E] text-white text-xs font-medium hover:bg-[#1E1418] transition-colors whitespace-nowrap shrink-0"
        >
          <Navigation className="w-4 h-4" />
          <span>{t.openInMaps}</span>
        </a>
      </div>
    </div>
  );
};
