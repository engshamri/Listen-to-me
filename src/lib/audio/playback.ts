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

/** Listening speed: changes playback only, keeping the voice's pitch. */
export function setListeningSpeed(el: HTMLMediaElement, rate: number) {
  el.defaultPlaybackRate = rate;
  el.playbackRate = rate;
  el.preservesPitch = true;
}

/** Switches the element to a new source and continues from `at` seconds, playing if `play`. */
export function switchSource(el: HTMLMediaElement, url: string, at: number, play: boolean) {
  const resume = () => {
    el.currentTime = at;
    if (play) void el.play().catch(() => {});
  };
  el.addEventListener("loadedmetadata", resume, { once: true });
  el.src = url;
}
