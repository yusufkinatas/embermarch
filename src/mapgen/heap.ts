/** Binary min-heap of (node, priority) pairs. Deterministic for a given push sequence. */
export class MinHeap {
  private nodes: number[] = [];
  private pri: number[] = [];

  get size(): number {
    return this.nodes.length;
  }

  push(node: number, p: number): void {
    const nodes = this.nodes;
    const pri = this.pri;
    let i = nodes.length;
    nodes.push(node);
    pri.push(p);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (pri[parent] <= p) break;
      nodes[i] = nodes[parent];
      pri[i] = pri[parent];
      i = parent;
    }
    nodes[i] = node;
    pri[i] = p;
  }

  /** Remove and return the node with the smallest priority. Caller checks `size` first. */
  pop(): number {
    const nodes = this.nodes;
    const pri = this.pri;
    const top = nodes[0];
    const lastN = nodes.pop() as number;
    const lastP = pri.pop() as number;
    const n = nodes.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && pri[c + 1] < pri[c]) c++;
        if (pri[c] >= lastP) break;
        nodes[i] = nodes[c];
        pri[i] = pri[c];
        i = c;
      }
      nodes[i] = lastN;
      pri[i] = lastP;
    }
    return top;
  }
}
