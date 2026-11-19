/* Türk daması kuralları — sunucu ve sanal hal sayfası aynı dosyayı kullanır.
   Tahta 8x8. 1 beyaz taş, 2 beyaz dama, -1 siyah taş, -2 siyah dama, 0 boş.
   Beyaz aşağıdan (6. ve 7. sıra) yukarı, siyah yukarıdan aşağı oynar. Beyaz başlar.
   Taşlar ileri ve yana birer kare gider, geri gidemez. Damalar dört yöne istediği kadar gider.
   Taş alma zorunludur ve en çok taş alınan yol seçilmelidir. Alınan taş hemen kalkar.
   Dama zincirleme alırken geldiği yöne hemen geri dönemez. Son sıraya varan taş hamle bitince dama olur. */
(function (root) {
  const inB = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
  const side = v => Math.sign(v);

  function init() {
    const b = Array.from({ length: 8 }, () => Array(8).fill(0));
    for (let c = 0; c < 8; c++) { b[1][c] = -1; b[2][c] = -1; b[5][c] = 1; b[6][c] = 1; }
    return b;
  }

  function dirsFor(v) {
    if (Math.abs(v) === 2) return [[1, 0], [-1, 0], [0, 1], [0, -1]];
    return [[v > 0 ? -1 : 1, 0], [0, 1], [0, -1]];
  }

  function captures(b, r, c, v, prevDir, path, acc) {
    let found = false;
    for (const [dr, dc] of dirsFor(v)) {
      if (prevDir && dr === -prevDir[0] && dc === -prevDir[1]) continue;
      if (Math.abs(v) === 1) {
        const r1 = r + dr, c1 = c + dc, r2 = r + 2 * dr, c2 = c + 2 * dc;
        if (inB(r2, c2) && side(b[r1][c1]) === -side(v) && b[r2][c2] === 0) {
          const cap = b[r1][c1];
          b[r1][c1] = 0; b[r][c] = 0; b[r2][c2] = v;
          found = true;
          captures(b, r2, c2, v, [dr, dc], path.concat([[r2, c2]]), acc);
          b[r2][c2] = 0; b[r][c] = v; b[r1][c1] = cap;
        }
      } else {
        let rr = r + dr, cc = c + dc;
        while (inB(rr, cc) && b[rr][cc] === 0) { rr += dr; cc += dc; }
        if (inB(rr, cc) && side(b[rr][cc]) === -side(v)) {
          let lr = rr + dr, lc = cc + dc;
          while (inB(lr, lc) && b[lr][lc] === 0) {
            const cap = b[rr][cc];
            b[rr][cc] = 0; b[r][c] = 0; b[lr][lc] = v;
            found = true;
            captures(b, lr, lc, v, [dr, dc], path.concat([[lr, lc]]), acc);
            b[lr][lc] = 0; b[r][c] = v; b[rr][cc] = cap;
            lr += dr; lc += dc;
          }
        }
      }
    }
    if (!found && path.length > 1) acc.push(path);
  }

  function legalMoves(b, turn) {
    const caps = [];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      if (side(b[r][c]) === turn) captures(b, r, c, b[r][c], null, [[r, c]], caps);
    }
    if (caps.length) {
      const max = Math.max(...caps.map(p => p.length));
      return caps.filter(p => p.length === max);
    }
    const out = [];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const v = b[r][c];
      if (side(v) !== turn) continue;
      for (const [dr, dc] of dirsFor(v)) {
        let rr = r + dr, cc = c + dc;
        while (inB(rr, cc) && b[rr][cc] === 0) {
          out.push([[r, c], [rr, cc]]);
          if (Math.abs(v) === 1) break;
          rr += dr; cc += dc;
        }
      }
    }
    return out;
  }

  function apply(b, path) {
    const n = b.map(row => row.slice());
    let [r, c] = path[0];
    const v = n[r][c];
    n[r][c] = 0;
    let taken = 0;
    for (let i = 1; i < path.length; i++) {
      const [tr, tc] = path[i];
      const dr = Math.sign(tr - r), dc = Math.sign(tc - c);
      let rr = r + dr, cc = c + dc;
      while (rr !== tr || cc !== tc) { if (n[rr][cc]) { n[rr][cc] = 0; taken++; } rr += dr; cc += dc; }
      r = tr; c = tc;
    }
    let nv = v;
    if (v === 1 && r === 0) nv = 2;
    if (v === -1 && r === 7) nv = -2;
    n[r][c] = nv;
    return { board: n, taken };
  }

  const samePath = (a, b) => a.length === b.length && a.every((p, i) => p[0] === b[i][0] && p[1] === b[i][1]);
  function isLegal(b, turn, path) { return legalMoves(b, turn).some(m => samePath(m, path)); }
  function count(b, s) { let n = 0; for (const row of b) for (const v of row) if (side(v) === s) n++; return n; }

  const Dama = { init, legalMoves, apply, isLegal, count, samePath };
  if (typeof module !== 'undefined' && module.exports) module.exports = Dama;
  else root.Dama = Dama;
})(typeof window !== 'undefined' ? window : globalThis);
