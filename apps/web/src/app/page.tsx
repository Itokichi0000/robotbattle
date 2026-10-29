import { Logo } from '@/components/Logo';
import { LandingLive } from './LandingLive';
import { LandingHeader, LandingRules, LandingTerms } from './LandingText';

export default function Home() {
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-8">
      <section className="grid items-center gap-8 md:grid-cols-2">
        <div className="flex flex-col gap-6">
          <Logo size="lg" />
          <LandingHeader />
        </div>
        <LandingLive />
      </section>
      <LandingRules />
      <LandingTerms />
    </main>
  );
}
