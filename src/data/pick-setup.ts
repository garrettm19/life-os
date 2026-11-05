import { pickJson } from './pick-json';
export function pickSetup(): Promise<string | null> {
  return pickJson(2_000_000, 'setup');
}
