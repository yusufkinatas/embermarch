/**
 * Pure Results logic (no DOM): the Chronicle stat rows for one battle.
 */
import type { BattleResult } from '../../sim/types';

/** Label and value rows for the Results Chronicle. In the boss battle the Nests are Root Hearts. */
export function battleStatRows(result: BattleResult): [string, string | number][] {
  const st = result.stats;
  const rows: [string, string | number][] = [
    ['Thornwake slain', st.kills],
    ['Units trained', st.unitsTrained],
    ['Units lost', st.unitsLost],
    ['Buildings raised', st.buildingsBuilt],
    ['Buildings lost', st.buildingsLost],
    // The sim counts the Briar Throne's Root Hearts as its Nests.
    [result.objective === 'boss' ? 'Root Hearts burned' : 'Nests destroyed', result.nestsDestroyed],
  ];
  if (result.picketsDestroyed) rows.push(['Pickets cleared', result.picketsDestroyed]);
  if (result.cachesLooted) rows.push(['Caches looted', result.cachesLooted + (result.ancientCacheLooted ? ' (Ancient)' : '')]);
  if (result.lastStandsUsed) rows.push(['Last Stands', result.lastStandsUsed]);
  if (result.objective === 'holdfast' && result.outcome === 'victory') {
    rows.push(['Unbroken', result.unbroken ? 'Yes' : 'No']);
    rows.push(['Uprooted', result.uprooted ? 'Yes' : 'No']);
  }
  return rows;
}
