import { ResultsView } from './ResultsView';

export default async function ResultsPage({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;
  return <ResultsView matchId={matchId} />;
}
