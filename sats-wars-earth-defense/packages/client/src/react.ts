import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Lang } from '@swed/shared';
import type { MatchStore, StoreState } from './store';

export function useStore(store: MatchStore): StoreState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

/** Re-renders every `ms` so countdowns tick smoothly between snapshots. */
export function useTicker(ms = 100): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

const LANG_KEY = 'sw.lang';

function readLang(): Lang {
  try {
    const v = localStorage.getItem(LANG_KEY);
    return v === 'en' ? 'en' : 'ja';
  } catch {
    return 'ja';
  }
}

/** Japanese by default (spec §3.4); English toggle remembered per device when storage works. */
export function useLang(): [Lang, (l: Lang) => void, (ja: string, en: string) => string] {
  const [lang, setLang] = useState<Lang>(readLang);
  const update = (l: Lang) => {
    setLang(l);
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch {
      /* storage blocked: keep it for this page view only */
    }
  };
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  return [lang, update, (ja, en) => (lang === 'ja' ? ja : en)];
}
