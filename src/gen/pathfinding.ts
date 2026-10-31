export interface Edge {
  to: number;
  cost: number;
}

/** Binary min-heap keyed by priority. */
class Heap {
  private items: { n: number; p: number }[] = [];
  get size() {
    return this.items.length;
  }
  push(n: number, p: number) {
    const a = this.items;
    a.push({ n, p });
    let i = a.length - 1;
    while (i > 0) {
      const j = (i - 1) >> 1;
      if (a[j].p <= a[i].p) break;
      [a[i], a[j]] = [a[j], a[i]];
      i = j;
    }
  }
  pop(): number {
    const a = this.items;
    const top = a[0].n;
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].p < a[m].p) m = l;
        if (r < a.length && a[r].p < a[m].p) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}

/** A* over an implicit graph. Returns the node path (start..goal) or null. */
export function astar(start: number, goal: number, neighbors: (n: number) => Edge[], heuristic: (n: number) => number): number[] | null {
  const g = new Map<number, number>([[start, 0]]);
  const came = new Map<number, number>();
  const closed = new Set<number>();
  const open = new Heap();
  open.push(start, heuristic(start));
  while (open.size) {
    const cur = open.pop();
    if (cur === goal) {
      const path = [cur];
      let c = cur;
      while (came.has(c)) path.push((c = came.get(c)!));
      return path.reverse();
    }
    if (closed.has(cur)) continue;
    closed.add(cur);
    const gc = g.get(cur)!;
    for (const e of neighbors(cur)) {
      const ng = gc + e.cost;
      if (ng < (g.get(e.to) ?? Infinity)) {
        g.set(e.to, ng);
        came.set(e.to, cur);
        open.push(e.to, ng + heuristic(e.to));
      }
    }
  }
  return null;
}

/** Unweighted BFS distances from a source. */
export function bfsDistances(start: number, neighbors: (n: number) => Edge[]): Map<number, number> {
  const dist = new Map<number, number>([[start, 0]]);
  const q = [start];
  for (let i = 0; i < q.length; i++) {
    const n = q[i];
    for (const e of neighbors(n)) {
      if (!dist.has(e.to)) {
        dist.set(e.to, dist.get(n)! + 1);
        q.push(e.to);
      }
    }
  }
  return dist;
}
