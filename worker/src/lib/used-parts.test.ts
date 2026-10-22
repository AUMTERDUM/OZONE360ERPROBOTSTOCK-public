// Run: npm test  (worker/)
import assert from 'node:assert/strict';
import { planUsedParts } from './used-parts';

const stock = { a: 5, b: 0 };
const names = { a: 'ล้อ', b: 'แบต' };

// Adding parts deducts stock.
assert.deepEqual(
  (planUsedParts([], [{ sparePartId: 'a', quantity: 2 }], stock, names) as { deltas: Map<string, number> }).deltas,
  new Map([['a', -2]]),
);

// Replacing 3 with 2 of the same part credits the net 1 back.
assert.deepEqual(
  (planUsedParts([{ sparePartId: 'a', quantity: 3 }], [{ sparePartId: 'a', quantity: 2 }], stock, names) as { deltas: Map<string, number> }).deltas,
  new Map([['a', 1]]),
);

// The restored quantity counts toward availability: 0 in stock + 4 restored covers 4.
assert.deepEqual(
  (planUsedParts([{ sparePartId: 'b', quantity: 4 }], [{ sparePartId: 'b', quantity: 4 }], stock, names) as { deltas: Map<string, number> }).deltas,
  new Map(),
);

// Over-request is rejected, and nothing is applied.
assert.match(
  (planUsedParts([], [{ sparePartId: 'a', quantity: 9 }], stock, names) as { error: string }).error,
  /ล้อ: สต็อกไม่พอ/,
);

// A negative quantity can no longer be used to inflate stock.
assert.match(
  (planUsedParts([], [{ sparePartId: 'a', quantity: -3 }], stock, names) as { error: string }).error,
  /จำนวนเต็มบวก/,
);

// An unknown part is rejected before any write.
assert.match(
  (planUsedParts([], [{ sparePartId: 'zz', quantity: 1 }], stock, names) as { error: string }).error,
  /not found/,
);

// A part deleted from the catalog no longer blocks clearing the ticket's lines.
assert.deepEqual(
  (planUsedParts([{ sparePartId: 'gone', quantity: 2 }], [], stock, names) as { deltas: Map<string, number> }).deltas,
  new Map(),
);

console.log('used-parts: 7 checks passed');
