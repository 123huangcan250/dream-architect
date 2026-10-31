/** XZ uniform-grid broad phase. Items are AABBs; queries return each item at most once. */
export interface AABBItem {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

export class SpatialHash<T extends AABBItem> {
  private cells = new Map<number, T[]>();
  private stamp = new Map<T, number>();
  private queryId = 0;
  readonly items: T[] = [];

  constructor(readonly cellSize = 8) {}

  private key(ix: number, iz: number): number {
    // Pack two signed 16-bit cell coordinates into one number.
    return ((ix + 32768) & 0xffff) * 65536 + ((iz + 32768) & 0xffff);
  }

  insert(item: T): void {
    this.items.push(item);
    const cs = this.cellSize;
    const x0 = Math.floor(item.min.x / cs), x1 = Math.floor(item.max.x / cs);
    const z0 = Math.floor(item.min.z / cs), z1 = Math.floor(item.max.z / cs);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const k = this.key(ix, iz);
        let list = this.cells.get(k);
        if (!list) this.cells.set(k, (list = []));
        list.push(item);
      }
    }
  }

  remove(item: T): void {
    const i = this.items.indexOf(item);
    if (i < 0) return;
    this.items.splice(i, 1);
    for (const list of this.cells.values()) {
      const j = list.indexOf(item);
      if (j >= 0) list.splice(j, 1);
    }
  }

  query(minX: number, minZ: number, maxX: number, maxZ: number, out: T[] = []): T[] {
    const cs = this.cellSize;
    const id = ++this.queryId;
    const x0 = Math.floor(minX / cs), x1 = Math.floor(maxX / cs);
    const z0 = Math.floor(minZ / cs), z1 = Math.floor(maxZ / cs);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const list = this.cells.get(this.key(ix, iz));
        if (!list) continue;
        for (const it of list) {
          if (this.stamp.get(it) === id) continue;
          this.stamp.set(it, id);
          if (it.max.x < minX || it.min.x > maxX || it.max.z < minZ || it.min.z > maxZ) continue;
          out.push(it);
        }
      }
    }
    return out;
  }
}
