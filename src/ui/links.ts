/** "Label | https://…" lines; anything else is refused with the line that failed. */
export function parseLinks(text: string): { label: string; url: string }[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const bar = line.indexOf('|');
      const label = bar === -1 ? '' : line.slice(0, bar).trim();
      const url = bar === -1 ? '' : line.slice(bar + 1).trim();
      if (!label || !url || !/^https:\/\/\S+$/i.test(url))
        throw new Error(`Write each link as Label | https://… ("${line.slice(0, 40)}").`);
      return { label, url };
    });
}

export function linksText(links: { label: string; url: string }[]): string {
  return links.map((l) => `${l.label} | ${l.url}`).join('\n');
}
