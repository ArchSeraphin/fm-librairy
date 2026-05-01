import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** HTTPS URL, max 2048 chars, optional + nullable. */
export const coverUrl = z
  .string()
  .url()
  .startsWith('https://', { message: 'cover URL must be HTTPS' })
  .max(2048)
  .optional()
  .nullable();

// ---------------------------------------------------------------------------
// List / Search
// ---------------------------------------------------------------------------

export const listBooksInput = z.object({
  slug: z.string(),
  q: z.string().max(200).optional(),
  hasDigital: z.boolean().optional(),
  hasPhysical: z.boolean().optional(),
  language: z.string().min(2).max(8).optional(),
  sort: z.enum(['createdAt_desc', 'createdAt_asc', 'title_asc']).default('createdAt_desc'),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(24),
  includeArchived: z.boolean().default(false),
});

export type ListBooksInput = z.infer<typeof listBooksInput>;

// ---------------------------------------------------------------------------
// Get single
// ---------------------------------------------------------------------------

export const getBookInput = z.object({
  slug: z.string(),
  id: z.string().cuid(),
});

export type GetBookInput = z.infer<typeof getBookInput>;

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export const createBookInput = z.object({
  slug: z.string(),
  title: z.string().min(1).max(500),
  authors: z.array(z.string().min(1).max(200)).min(1).max(20),
  isbn10: z
    .string()
    .regex(/^\d{9}[\dX]$/)
    .optional(),
  isbn13: z
    .string()
    .regex(/^\d{13}$/)
    .optional(),
  publisher: z.string().max(200).optional(),
  publishedYear: z.number().int().min(1000).max(2100).optional(),
  language: z.string().min(2).max(8).optional(),
  description: z.string().max(10000).optional(),
  coverPath: coverUrl,
});

export type CreateBookInput = z.infer<typeof createBookInput>;

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export const updateBookInput = z.object({
  slug: z.string(),
  id: z.string().cuid(),
  expectedUpdatedAt: z.coerce.date(),
  patch: z.object({
    title: z.string().min(1).max(500).optional(),
    authors: z.array(z.string().min(1).max(200)).min(1).max(20).optional(),
    isbn10: z
      .string()
      .regex(/^\d{9}[\dX]$/)
      .optional()
      .nullable(),
    isbn13: z
      .string()
      .regex(/^\d{13}$/)
      .optional()
      .nullable(),
    publisher: z.string().max(200).optional().nullable(),
    publishedYear: z.number().int().min(1000).max(2100).optional().nullable(),
    language: z.string().min(2).max(8).optional().nullable(),
    description: z.string().max(10000).optional().nullable(),
    coverPath: coverUrl,
  }),
});

export type UpdateBookInput = z.infer<typeof updateBookInput>;

// ---------------------------------------------------------------------------
// Archive / Unarchive / Delete
// ---------------------------------------------------------------------------

export const archiveBookInput = z.object({
  slug: z.string(),
  id: z.string().cuid(),
});

export type ArchiveBookInput = z.infer<typeof archiveBookInput>;

export const unarchiveBookInput = z.object({
  slug: z.string(),
  id: z.string().cuid(),
});

export type UnarchiveBookInput = z.infer<typeof unarchiveBookInput>;

export const deleteBookInput = z.object({
  slug: z.string(),
  id: z.string().cuid(),
});

export type DeleteBookInput = z.infer<typeof deleteBookInput>;

// ---------------------------------------------------------------------------
// Refresh metadata (Phase 2B')
// ---------------------------------------------------------------------------

export const refreshMetadataInput = z.object({
  slug: z.string(),
  id: z.string().cuid(),
});

export type RefreshMetadataInput = z.infer<typeof refreshMetadataInput>;
