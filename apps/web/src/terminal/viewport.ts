/**
 * Hält das Layout auf der sichtbaren Fläche über der Bildschirmtastatur
 * (visualViewport), damit Eingabezeile und letzte Ausgabe nie verdeckt werden.
 */
export function trackVisualViewport(root: HTMLElement, onChange: () => void): void {
  const vv = window.visualViewport;
  let frame = 0;

  const apply = (): void => {
    frame = 0;
    const height = vv ? vv.height : window.innerHeight;
    const top = vv ? vv.offsetTop : 0;
    root.style.setProperty('--app-h', `${Math.round(height)}px`);
    root.style.setProperty('--app-top', `${Math.round(top)}px`);
    onChange();
  };
  const schedule = (): void => {
    if (!frame) frame = requestAnimationFrame(apply);
  };

  vv?.addEventListener('resize', schedule);
  vv?.addEventListener('scroll', schedule);
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  // Falls der Browser die Seite beim Fokussieren doch scrollt: zurücksetzen.
  window.addEventListener('scroll', () => window.scrollTo(0, 0));
  apply();
}
