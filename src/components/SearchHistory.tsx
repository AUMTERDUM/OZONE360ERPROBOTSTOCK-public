import { useEffect } from 'react';

const STORAGE_KEY = 'search-history:v1';
const LIST_ID = 'search-history-suggestions';
const MAX_TERMS_PER_PAGE = 40;
const MAX_SHOWN = 8;
const MIN_LENGTH = 2;
const MAX_LENGTH = 60;

interface Entry { n: number; t: number }
type Store = Record<string, Record<string, Entry>>;

const readStore = (): Store => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}; } catch { return {}; }
};
const writeStore = (store: Store) => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); } catch { /* storage can be unavailable (private mode) */ }
};

// Any text box labelled as a search box. Custom comboboxes (customer pickers, global search) keep their own dropdown.
const isSearchInput = (target: EventTarget | null): target is HTMLInputElement => {
  if (!(target instanceof HTMLInputElement)) return false;
  if (!['text', 'search'].includes(target.type)) return false;
  if (target.getAttribute('role') === 'combobox') return false;
  return `${target.placeholder} ${target.getAttribute('aria-label') ?? ''}`.includes('ค้นหา');
};

const scopeOf = () => window.location.pathname;

function suggestionsFor(typed: string): string[] {
  const terms = Object.entries(readStore()[scopeOf()] ?? {});
  const needle = typed.trim().toLowerCase();
  return terms
    .filter(([term]) => term.toLowerCase() !== needle && (!needle || term.toLowerCase().includes(needle)))
    .sort((a, b) => b[1].n - a[1].n || b[1].t - a[1].t)
    .slice(0, MAX_SHOWN)
    .map(([term]) => term);
}

function record(term: string) {
  const value = term.trim();
  if (value.length < MIN_LENGTH || value.length > MAX_LENGTH) return;
  const store = readStore();
  const page = (store[scopeOf()] ??= {});
  page[value] = { n: (page[value]?.n ?? 0) + 1, t: Date.now() };
  const keys = Object.keys(page);
  if (keys.length > MAX_TERMS_PER_PAGE) {
    keys.sort((a, b) => page[a].n - page[b].n || page[a].t - page[b].t);
    for (const key of keys.slice(0, keys.length - MAX_TERMS_PER_PAGE)) delete page[key];
  }
  writeStore(store);
}

/**
 * Remembers what people search for on each page and offers the most frequent terms as suggestions
 * (a native <datalist>) in every search box. A term counts when the box is left or Enter is pressed.
 */
export default function SearchHistory() {
  useEffect(() => {
    const list = document.createElement('datalist');
    list.id = LIST_ID;
    document.body.appendChild(list);
    const recorded = new WeakMap<HTMLInputElement, string>();

    const refresh = (input: HTMLInputElement) => {
      list.replaceChildren(...suggestionsFor(input.value).map(term => {
        const option = document.createElement('option');
        option.value = term;
        return option;
      }));
    };
    const commit = (input: HTMLInputElement) => {
      if (recorded.get(input) === input.value) return;
      recorded.set(input, input.value);
      record(input.value);
    };

    const onFocusIn = (event: FocusEvent) => {
      if (!isSearchInput(event.target)) return;
      recorded.delete(event.target);
      event.target.setAttribute('list', LIST_ID);
      event.target.setAttribute('autocomplete', 'off');
      refresh(event.target);
    };
    const onInput = (event: Event) => { if (isSearchInput(event.target)) refresh(event.target); };
    const onFocusOut = (event: FocusEvent) => { if (isSearchInput(event.target)) commit(event.target); };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Enter' && isSearchInput(event.target)) commit(event.target); };

    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('input', onInput);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('input', onInput);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('keydown', onKeyDown);
      list.remove();
    };
  }, []);

  return null;
}
