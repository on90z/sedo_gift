import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Download, QrCode } from 'lucide-react';
import type { Language } from '../shared/types.ts';
import { UI_COPY } from '../i18n/translations.ts';

interface QrCodeCardProps {
  url?: string;
  lang: Language;
  compact?: boolean;
}

export const QrCodeCard: React.FC<QrCodeCardProps> = ({ url, lang, compact = false }) => {
  const [dataUrl, setDataUrl] = useState<string>('');
  const [svgMarkup, setSvgMarkup] = useState<string>('');
  const t = UI_COPY[lang];
  const defaultPublicUrl =
    typeof window !== 'undefined'
      ? `${window.location.protocol}//${window.location.hostname.replace(/^admin\./i, 'www.')}${window.location.port ? `:${window.location.port}` : ''}`
      : 'https://sedo-flowers.iq';
  const targetUrl = url || defaultPublicUrl;

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(targetUrl, {
      width: 320,
      margin: 2,
      color: {
        dark: '#0E0A0C',
        light: '#FFFFFF',
      },
    })
      .then((res) => {
        if (active) setDataUrl(res);
      })
      .catch((err) => console.error('QR generation error:', err));

    QRCode.toString(targetUrl, {
      type: 'svg',
      margin: 2,
      color: {
        dark: '#0E0A0C',
        light: '#FFFFFF',
      },
    })
      .then((svg) => {
        if (active) setSvgMarkup(svg);
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [targetUrl]);

  const handleDownload = () => {
    if (!dataUrl) return;
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = 'sedo-flowers-karbala-qr.png';
    link.click();
  };

  return (
    <div className="border border-[#944A5E] bg-[#6E2438] p-6 flex flex-col items-center text-center gap-4 text-white">
      <div className="flex items-center gap-2 text-white">
        <QrCode className="w-5 h-5" />
        <h3 className="text-lg font-semibold">{t.qrTitle}</h3>
      </div>
      {!compact && <p className="text-sm text-white/80 max-w-sm">{t.qrSubtitle}</p>}

      {dataUrl ? (
        <div className="p-3 bg-white border border-[#944A5E]">
          <img
            src={dataUrl}
            alt="SEDO Flowers & Gifts QR Code"
            className={compact ? 'w-36 h-36' : 'w-48 h-48'}
          />
        </div>
      ) : (
        <div className="w-44 h-44 bg-[#461221] border border-[#944A5E] flex items-center justify-center text-xs text-white/60">
          Generating QR...
        </div>
      )}

      <div className="text-xs text-white/75 break-all max-w-xs tabular-nums-en" dir="ltr">
        {targetUrl}
      </div>

      {svgMarkup && (
        <button
          type="button"
          onClick={handleDownload}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#0E0A0C] border border-[#944A5E] text-white text-xs font-medium hover:bg-[#1E1418] transition-colors whitespace-nowrap shrink-0"
        >
          <Download className="w-4 h-4" />
          <span>{t.downloadQr}</span>
        </button>
      )}
    </div>
  );
};
