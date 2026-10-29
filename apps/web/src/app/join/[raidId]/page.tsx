import type { Metadata } from 'next';
import { JoinView } from './JoinView';

export const metadata: Metadata = { title: 'SATS WARS — 出撃受付 / Join' };

export default async function JoinPage({ params }: { params: Promise<{ raidId: string }> }) {
  const { raidId } = await params;
  return <JoinView raidId={raidId} />;
}
