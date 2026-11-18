/** ARIA-Live-Region: Screenreader lesen neue Ausgaben vor. */
export interface LiveRegion {
  announce(text: string): void;
}

const MAX_ENTRIES = 30;

export function createLiveRegion(el: HTMLElement): LiveRegion {
  return {
    announce(text) {
      const value = text.trim();
      if (!value) return;
      const entry = document.createElement('pre');
      entry.textContent = value;
      el.append(entry);
      while (el.childElementCount > MAX_ENTRIES) el.firstElementChild?.remove();
    },
  };
}
