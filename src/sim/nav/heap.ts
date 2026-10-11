/**
 * Binary min-heap of (node index, priority) pairs stored in typed arrays. Used by A* and the
 * Dijkstra flow fields. Duplicate pushes are allowed (lazy deletion): callers skip stale pops.
 * OWNER: nav.
 */
export class MinHeap {
  private ids: Int32Array;
  private keys: Float64Array;
  size = 0;
  /** Priority of the element returned by the last pop(). */
  lastKey = 0;

  constructor(capacity = 1024) {
    this.ids = new Int32Array(capacity);
    this.keys = new Float64Array(capacity);
  }

  clear(): void {
    this.size = 0;
  }

  push(id: number, key: number): void {
    if (this.size === this.ids.length) this.grow();
    const ids = this.ids;
    const keys = this.keys;
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      ids[i] = ids[p];
      keys[i] = keys[p];
      i = p;
    }
    ids[i] = id;
    keys[i] = key;
  }

  /** Remove and return the id with the smallest key (its key is left in lastKey). Heap must be non-empty. */
  pop(): number {
    const ids = this.ids;
    const keys = this.keys;
    const top = ids[0];
    this.lastKey = keys[0];
    const n = --this.size;
    if (n > 0) {
      const id = ids[n];
      const key = keys[n];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && keys[r] < keys[l] ? r : l;
        if (keys[c] >= key) break;
        ids[i] = ids[c];
        keys[i] = keys[c];
        i = c;
      }
      ids[i] = id;
      keys[i] = key;
    }
    return top;
  }

  private grow(): void {
    const ids = new Int32Array(this.ids.length * 2);
    const keys = new Float64Array(this.keys.length * 2);
    ids.set(this.ids);
    keys.set(this.keys);
    this.ids = ids;
    this.keys = keys;
  }
}
