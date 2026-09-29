/** Binary min-heap keyed by (priority, key) so ties break deterministically. */
export class Heap<T> {
  private items: { pri: number; key: number; value: T }[] = [];

  get size() {
    return this.items.length;
  }

  push(pri: number, key: number, value: T) {
    const a = this.items;
    a.push({ pri, key, value });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      [a[i], a[p]] = [a[p], a[i]];
      i = p;
    }
  }

  pop() {
    const a = this.items;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.less(l, m)) m = l;
        if (r < a.length && this.less(r, m)) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }

  private less(i: number, j: number) {
    const a = this.items[i];
    const b = this.items[j];
    return a.pri < b.pri || (a.pri === b.pri && a.key < b.key);
  }
}
