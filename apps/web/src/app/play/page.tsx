import type { Metadata } from 'next';
import { PlayApp } from './PlayApp';

export const metadata: Metadata = { title: 'SATS WARS — 参加 / Play' };

export default function PlayPage() {
  return <PlayApp />;
}
