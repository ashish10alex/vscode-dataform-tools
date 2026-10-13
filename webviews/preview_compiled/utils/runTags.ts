/**
 * The tags chosen for a run, without those the Project no longer has. Gives back the same list when nothing was
 * taken out, so that a component keeping it in state does not render again for nothing.
 */
export function onlyAvailable(chosen: string[], available: string[]): string[] {
  const kept = chosen.filter((tag) => available.includes(tag));
  return kept.length === chosen.length ? chosen : kept;
}
