// Vendored from src/lib/upload/storage-paths.ts so the worker package can be
// built standalone (Dockerfile.worker only copies worker/ + prisma/, not src/).
// Keep in sync with the source if path layout changes.
import path from 'node:path';

export function finalPath(
  root: string,
  libraryId: string,
  bookId: string,
  sha256: string,
  ext: string,
): string {
  return path.join(root, 'library', libraryId, bookId, `${sha256}.${ext}`);
}

export function assertUnderRoot(root: string, candidate: string): void {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
    throw new Error(`PATH_TRAVERSAL: ${candidate} escapes ${root}`);
  }
}
