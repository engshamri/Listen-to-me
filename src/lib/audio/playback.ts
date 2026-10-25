/**
 * Ensures only one audio source plays at a time across the app (the result
 * player and voice previews): when any registered element starts playing,
 * every other registered element is paused.
 */
const players = new Set<HTMLMediaElement>();

export function registerExclusivePlayer(el: HTMLMediaElement): () => void {
  const onPlay = () => {
    for (const p of players) if (p !== el && !p.paused) p.pause();
  };
  players.add(el);
  el.addEventListener("play", onPlay);
  return () => {
    players.delete(el);
    el.removeEventListener("play", onPlay);
  };
}
