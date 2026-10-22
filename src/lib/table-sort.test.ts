import assert from 'node:assert/strict';
import { compareCells, sortRows, nextSort, type SortState } from './table-sort.ts';

const keys = <T extends { id: string }>(rows: T[]) => rows.map(r => r.id).join('');
const by = { n: (r: any) => r.n, s: (r: any) => r.s };

// numbers compare numerically, not as strings ("10" < "9" lexicographically)
assert.ok(compareCells(9, 10) < 0);
assert.ok(compareCells('SN-9', 'SN-10') < 0, 'numeric collation inside strings');

const nums = [{ id: 'a', n: 10 }, { id: 'b', n: 2 }, { id: 'c', n: 33 }];
assert.equal(keys(sortRows(nums, { key: 'n', dir: 'asc' }, by)), 'bac');
assert.equal(keys(sortRows(nums, { key: 'n', dir: 'desc' }, by)), 'cab');

// input is never mutated
const original = [...nums];
sortRows(nums, { key: 'n', dir: 'desc' }, by);
assert.deepEqual(nums, original);

// empties sink to the bottom in both directions
const sparse = [{ id: 'a', s: '' }, { id: 'b', s: 'zz' }, { id: 'c', s: 'aa' }];
assert.equal(keys(sortRows(sparse, { key: 's', dir: 'asc' }, by)), 'cba');
assert.equal(keys(sortRows(sparse, { key: 's', dir: 'desc' }, by)), 'bca');

// unknown key and null sort are pass-throughs, not crashes
assert.equal(keys(sortRows(nums, { key: 'nope', dir: 'asc' }, by)), 'abc');
assert.equal(keys(sortRows(nums, null, by)), 'abc');

// header click cycle: asc → desc → off, and switching column restarts at asc
let state: SortState = null;
state = nextSort(state, 'n'); assert.deepEqual(state, { key: 'n', dir: 'asc' });
state = nextSort(state, 'n'); assert.deepEqual(state, { key: 'n', dir: 'desc' });
state = nextSort(state, 'n'); assert.equal(state, null);
assert.deepEqual(nextSort({ key: 'n', dir: 'desc' }, 's'), { key: 's', dir: 'asc' });

console.log('table-sort: 12 checks passed');
