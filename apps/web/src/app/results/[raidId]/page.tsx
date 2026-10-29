import { ResultsView } from './ResultsView';

export default async function ResultsPage({ params }: { params: Promise<{ raidId: string }> }) {
  const { raidId } = await params;
  return <ResultsView raidId={raidId} />;
}
