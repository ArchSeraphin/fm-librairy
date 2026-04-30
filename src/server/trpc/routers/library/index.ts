import { t } from '../../trpc';
import { libraryBooksRouter } from './books';

export const libraryRouter = t.router({
  books: libraryBooksRouter,
});
