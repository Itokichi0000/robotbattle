import { Suspense } from 'react';
import { LightningLogin } from './LightningLogin';

export default function LightningLoginPage() {
  return (
    <Suspense fallback={null}>
      <LightningLogin />
    </Suspense>
  );
}
