import type { Metadata } from 'next';
import { PilotCreate } from './PilotCreate';

export const metadata: Metadata = { title: 'SATS WARS — ライセンス発行 / Pilot license' };

export default function PilotCreatePage() {
  return <PilotCreate />;
}
