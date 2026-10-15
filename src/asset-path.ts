/** Vite's relative-base build resolves emitted URLs against the JS module.
 * The engine wants a path beneath its document-relative `assets/` root instead.
 * Keep nested source paths in development and emitted names in production.
 */
export function assetPath(url: string): string {
  const path = url.includes("://") ? new URL(url).pathname : url;
  const marker = path.lastIndexOf("/assets/");
  return marker >= 0
    ? path.slice(marker + "/assets/".length)
    : path.replace(/^\.?\/?assets\//, "");
}
