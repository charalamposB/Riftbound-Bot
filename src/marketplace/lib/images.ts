// src/marketplace/lib/images.ts
export function photosToImages(
  ...photos: Array<({ url: string } | null | undefined)>
): string[] {
  return photos.map(p => p?.url).filter(Boolean) as string[];
}

// Helper: derive a file extension from a URL (best-effort)
export function extFromUrl(u: string): string {
  try {
    const m = /\.([a-zA-Z0-9]{2,5})(?:\?|$)/.exec(u);
    return m ? `.${m[1]}` : '.png';
  } catch {
    return '.png';
  }
}

// Helper: push unique value into array
export function uniquePush(arr: string[], v: string) {
  if (!arr.includes(v)) arr.push(v);
}

// Build Discord files array from approval photos
export function buildFilesFromPhotos(pid: string, p: { photo1?: { url: string } | null; photo2?: { url: string } | null }) {
  const files: any[] = [];
  if (p.photo1 && p.photo1.url) {
    const name1 = `market_${pid}_1${extFromUrl(p.photo1.url)}`;
    files.push({ attachment: p.photo1.url, name: name1 });
  }
  if (p.photo2 && p.photo2.url) {
    const name2 = `market_${pid}_2${extFromUrl(p.photo2.url)}`;
    files.push({ attachment: p.photo2.url, name: name2 });
  }
  return files;
}

export default {};
