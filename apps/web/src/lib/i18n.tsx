'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Locale, UiStringKey } from '@sats-wars/shared';
import { UI_STRINGS } from '@sats-wars/shared';
import { storage } from './api';

interface I18n {
  locale: Locale;
  setLocale(l: Locale): void;
  /** Language chosen on this device or via ?lang= (venue defaults must not override it). */
  explicit: boolean;
  /** Apply a default (e.g. the venue screen language) without remembering it. */
  setDefaultLocale(l: Locale): void;
  t(key: UiStringKey): string;
  /** Pick between inline ja/en strings. */
  L(ja: string, en: string): string;
}

const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  // Japanese is the default; English is opt-in and remembered per device.
  const [locale, setLocaleState] = useState<Locale>('ja');
  const [explicit, setExplicit] = useState(false);
  useEffect(() => {
    const saved = storage.get('sw.locale');
    const fromQuery = new URLSearchParams(window.location.search).get('lang');
    const next =
      fromQuery === 'en' || fromQuery === 'ja' ? fromQuery : saved === 'en' ? 'en' : 'ja';
    setLocaleState(next);
    setExplicit(!!fromQuery || !!saved);
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    setExplicit(true);
    storage.set('sw.locale', l);
  }, []);
  const setDefaultLocale = useCallback((l: Locale) => setLocaleState(l), []);
  const value = useMemo<I18n>(
    () => ({
      locale,
      setLocale,
      explicit,
      setDefaultLocale,
      t: (key) => UI_STRINGS[locale][key],
      L: (ja, en) => (locale === 'ja' ? ja : en),
    }),
    [locale, setLocale, explicit, setDefaultLocale],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n outside I18nProvider');
  return v;
}
