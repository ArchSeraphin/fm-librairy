'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Check, ChevronsUpDown, LibraryBig } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const LAST_LIBRARY_KEY = 'biblioshare:lastLibrarySlug';

export function LibrarySwitcher({ currentSlug }: { currentSlug?: string }) {
  const t = useTranslations('member.switcher');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { data: libs, isLoading } = trpc.library.libraries.listAccessible.useQuery();
  const current = libs?.find((l) => l.slug === currentSlug);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={t('label')}
          className="w-[220px] justify-between"
        >
          <span className="flex items-center gap-2 truncate">
            <LibraryBig className="h-4 w-4 shrink-0" aria-hidden />
            <span className="truncate">
              {isLoading ? t('loading') : (current?.name ?? t('placeholder'))}
            </span>
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-0">
        <Command>
          <CommandInput placeholder={t('searchPlaceholder')} />
          <CommandList>
            <CommandEmpty>{t('noResults')}</CommandEmpty>
            <CommandGroup>
              {(libs ?? []).map((lib) => (
                <CommandItem
                  key={lib.id}
                  value={lib.name}
                  onSelect={() => {
                    setOpen(false);
                    if (typeof window !== 'undefined') {
                      window.localStorage.setItem(LAST_LIBRARY_KEY, lib.slug);
                    }
                    router.push(`/library/${lib.slug}/books`);
                  }}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      currentSlug === lib.slug ? 'opacity-100' : 'opacity-0',
                    )}
                    aria-hidden
                  />
                  <span className="truncate">{lib.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
