'use client';
import { useI18n } from '@/lib/i18n';

export function LanguageToggle({ className = '' }: { className?: string }) {
  const { locale, setLocale } = useI18n();
  return (
    <button
      type="button"
      onClick={() => setLocale(locale === 'ja' ? 'en' : 'ja')}
      className={`sw-focus rounded-full border border-line px-3 py-1.5 text-sm font-bold text-off/90 hover:bg-white/10 ${className}`}
      aria-label={locale === 'ja' ? 'Switch to English' : '日本語に切り替え'}
    >
      {locale === 'ja' ? 'EN' : '日本語'}
    </button>
  );
}
