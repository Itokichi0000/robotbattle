import type { Metadata } from 'next';
import { ArenaApp } from './ArenaApp';

export const metadata: Metadata = { title: 'SATS WARS — Arena' };

export default function ArenaPage() {
  return <ArenaApp />;
}
