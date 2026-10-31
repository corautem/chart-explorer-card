/**
 * Saves a file. Inside the Home Assistant Companion app, where ordinary
 * downloads may not work, it offers the phone's share sheet instead.
 */
export async function saveFile(blob: Blob, fileName: string): Promise<void> {
  const inCompanionApp = /Home ?Assistant\//i.test(navigator.userAgent);
  if (inCompanionApp && typeof navigator.canShare === 'function') {
    const file = new File([blob], fileName, { type: blob.type });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: fileName });
        return;
      } catch (err) {
        if ((err as DOMException)?.name === 'AbortError') return;
        // Fall through to an ordinary download.
      }
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
