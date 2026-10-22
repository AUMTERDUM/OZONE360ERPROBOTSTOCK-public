export interface UsedPartLine { sparePartId: string; quantity: number }

/**
 * Nets a ticket's current used-parts against the requested replacement set and returns the
 * stock delta to apply per spare part (negative = deduct).
 *
 * The route used to restore the old lines, delete them, and only then validate the new ones —
 * so an insufficient-stock request answered 400 *after* having already wiped the ticket's
 * used-parts rows. Netting first means nothing is written unless the whole set is valid.
 */
export function planUsedParts(
  existing: UsedPartLine[],
  requested: UsedPartLine[],
  stockById: Record<string, number | undefined>,
  nameById: Record<string, string | undefined> = {},
): { error: string } | { deltas: Map<string, number> } {
  const restored = new Map<string, number>();
  const needed = new Map<string, number>();

  for (const line of existing) {
    restored.set(line.sparePartId, (restored.get(line.sparePartId) ?? 0) + line.quantity);
  }
  for (const line of requested) {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      return { error: `จำนวนอะไหล่ต้องเป็นจำนวนเต็มบวก (${nameById[line.sparePartId] ?? line.sparePartId})` };
    }
    if (stockById[line.sparePartId] === undefined) {
      return { error: `SparePart ${line.sparePartId} not found` };
    }
    needed.set(line.sparePartId, (needed.get(line.sparePartId) ?? 0) + line.quantity);
  }

  const deltas = new Map<string, number>();
  for (const sparePartId of new Set([...restored.keys(), ...needed.keys()])) {
    const delta = (restored.get(sparePartId) ?? 0) - (needed.get(sparePartId) ?? 0);
    // A part deleted from the catalog can still appear in `existing`; there is nothing left to
    // credit the restore to, so skip it rather than failing the whole save.
    const stock = stockById[sparePartId];
    if (stock === undefined) continue;
    if (stock + delta < 0) {
      const available = stock + (restored.get(sparePartId) ?? 0);
      return { error: `${nameById[sparePartId] ?? sparePartId}: สต็อกไม่พอ (ใช้ได้ ${available}, ต้องการ ${needed.get(sparePartId)})` };
    }
    if (delta !== 0) deltas.set(sparePartId, delta);
  }
  return { deltas };
}
