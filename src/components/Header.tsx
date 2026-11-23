import React, { useState } from 'react';
import { Globe, Menu, ShoppingBag, X } from 'lucide-react';
import type { Language, StoreSettings } from '../shared/types.ts';
import { UI_COPY } from '../i18n/translations.ts';

export type ActiveRoute =
  | 'home'
  | 'bouquets'
  | 'builder'
  | 'gifts'
  | 'loyalty'
  | 'contact'
  | 'admin';

interface HeaderProps {
  activeRoute: ActiveRoute;
  onNavigate: (route: ActiveRoute) => void;
  lang: Language;
  onToggleLang: () => void;
  cartCount: number;
  onOpenCart: () => void;
  settings: StoreSettings;
}

export const Header: React.FC<HeaderProps> = ({
  activeRoute,
  onNavigate,
  lang,
  onToggleLang,
  cartCount,
  onOpenCart,
  settings,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const t = UI_COPY[lang];

  const navLinks: Array<{ id: ActiveRoute; label: string }> = [
    { id: 'home', label: t.navHome },
    { id: 'bouquets', label: t.navBouquets },
    { id: 'builder', label: t.navBuilder },
    { id: 'gifts', label: t.navGifts },
    { id: 'loyalty', label: t.navLoyalty },
    { id: 'contact', label: t.navContact },
  ];

  const handleNav = (id: ActiveRoute) => {
    onNavigate(id);
    setMobileMenuOpen(false);
  };

  return (
    <header className="sticky top-0 z-40 bg-[#461221]/95 backdrop-blur-sm border-b border-[#944A5E]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4 sm:gap-8">
        {/* Zone 1: Brand Mark (Single Element) */}
        <button
          type="button"
          onClick={() => handleNav('home')}
          className="flex items-center gap-2.5 text-white whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-white"
          aria-label="SEDO Home"
        >
          {settings.logoUrl ? (
            <img
              src={settings.logoUrl}
              alt="SEDO"
              className="h-9 w-auto object-contain"
              referrerPolicy="no-referrer"
            />
          ) : (
            <span className="font-display text-2xl font-bold tracking-wider text-white whitespace-nowrap shrink-0">
              SEDO
            </span>
          )}
        </button>

        {/* Zone 2: Concise single-line navigation links */}
        <nav
          aria-label={lang === 'ar' ? 'التنقل الرئيسي' : 'Main Navigation'}
          className="hidden lg:flex items-center gap-6 text-sm font-medium text-white/80"
        >
          {navLinks.map((link) => {
            const isActive = activeRoute === link.id;
            return (
              <button
                key={link.id}
                type="button"
                onClick={() => handleNav(link.id)}
                className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                  isActive
                    ? 'border-white text-white font-semibold'
                    : 'border-transparent hover:text-white'
                }`}
              >
                {link.label}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Language & Primary Cart Action */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onToggleLang}
            aria-label={lang === 'ar' ? 'Switch to English' : 'التبديل للعربية'}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-[#5E1D2F] border border-[#944A5E] hover:bg-[#6E2438] transition-colors whitespace-nowrap shrink-0"
          >
            <Globe className="w-3.5 h-3.5 text-white" />
            <span>{lang === 'ar' ? 'EN' : 'عربي'}</span>
          </button>

          <button
            type="button"
            onClick={onOpenCart}
            aria-label={`${t.cart} (${cartCount})`}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#0E0A0C] text-white border border-[#944A5E] text-xs sm:text-sm font-medium hover:bg-[#1E1418] transition-colors whitespace-nowrap shrink-0"
          >
            <ShoppingBag className="w-4 h-4" />
            <span>{t.cart}</span>
            <span className="tabular-nums-en bg-[#6E2438] px-1.5 py-0.5 text-xs text-white">
              {cartCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setMobileMenuOpen((v) => !v)}
            aria-label={lang === 'ar' ? 'القائمة' : 'Menu'}
            aria-expanded={mobileMenuOpen}
            className="lg:hidden p-2 border border-[#944A5E] bg-[#5E1D2F] text-white hover:bg-[#6E2438]"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <nav
          aria-label="Mobile Navigation"
          className="lg:hidden border-t border-[#944A5E] bg-[#461221] px-4 py-3 grid grid-cols-2 gap-2"
        >
          {navLinks.map((link) => {
            const isActive = activeRoute === link.id;
            return (
              <button
                key={link.id}
                type="button"
                onClick={() => handleNav(link.id)}
                className={`text-start px-3 py-2.5 text-sm font-medium border transition-colors ${
                  isActive
                    ? 'border-white bg-[#0E0A0C] text-white'
                    : 'border-[#944A5E]/70 bg-[#5E1D2F] text-white/90 hover:border-white'
                }`}
              >
                {link.label}
              </button>
            );
          })}
        </nav>
      )}
    </header>
  );
};
