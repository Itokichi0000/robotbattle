import type { Metadata } from 'next';
import { DemoView } from './DemoView';

export const metadata: Metadata = { title: 'SATS WARS — デモ / Demo' };

export default function DemoPage() {
  return <DemoView />;
}
