import { useEffect, useState } from 'react';

/** Re-render every `ms` and return the client's estimate of game time. */
export function useGameNow(gameNow: () => number, ms = 250): number {
  const [t, setT] = useState(gameNow);
  useEffect(() => {
    const id = setInterval(() => setT(gameNow()), ms);
    return () => clearInterval(id);
  }, [gameNow, ms]);
  return t;
}
