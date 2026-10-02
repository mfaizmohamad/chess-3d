// Chess rules engine. Pure JS, no dependencies, runs in node and the browser.
// Square index = rank * 8 + file (a1 = 0, h1 = 7, a8 = 56). Pieces: 'PNBRQK' white, 'pnbrqk' black.

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const FILES = 'abcdefgh';
const CK = 1, CQ = 2, Ck = 4, Cq = 8;

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
const KNIGHT_D = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];

const KNIGHT_T = [], KING_T = [], RAYS = [];
for (let sq = 0; sq < 64; sq++) {
  const f = sq & 7, r = sq >> 3;
  const kn = [], ki = [], rays = [];
  for (const [df, dr] of KNIGHT_D) {
    const nf = f + df, nr = r + dr;
    if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) kn.push(nr * 8 + nf);
  }
  for (const [df, dr] of DIRS) {
    const nf = f + df, nr = r + dr;
    if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) ki.push(nr * 8 + nf);
    const ray = [];
    let cf = f + df, cr = r + dr;
    while (cf >= 0 && cf < 8 && cr >= 0 && cr < 8) { ray.push(cr * 8 + cf); cf += df; cr += dr; }
    rays.push(ray);
  }
  KNIGHT_T.push(kn); KING_T.push(ki); RAYS.push(rays);
}

export const sqName = (sq) => FILES[sq & 7] + ((sq >> 3) + 1);
export const nameSq = (s) => (s.charCodeAt(1) - 49) * 8 + (s.charCodeAt(0) - 97);
export const sqFile = (sq) => sq & 7;
export const sqRank = (sq) => sq >> 3;
const isWhitePiece = (p) => p < 'a';
const colorOf = (p) => (p < 'a' ? 'w' : 'b');

export class Chess {
  constructor(fen = START_FEN) {
    this.trackKeys = true;
    this.load(fen);
  }

  load(fen) {
    const [place, turn, castling, ep, half, full] = String(fen).trim().split(/\s+/);
    const rows = (place || '').split('/');
    const valid = rows.length === 8 && rows.every((r) => r.length > 0 && /^[pnbrqkPNBRQK1-8]+$/.test(r)
      && [...r].reduce((n, ch) => n + (ch >= '1' && ch <= '8' ? +ch : 1), 0) === 8);
    const count = (ch) => (place.match(new RegExp(ch, 'g')) || []).length;
    if (!valid || count('K') !== 1 || count('k') !== 1 || (turn && turn !== 'w' && turn !== 'b')) throw new Error('Invalid FEN');
    this.board = new Array(64).fill(null);
    for (let i = 0; i < 8; i++) {
      let f = 0;
      for (const ch of rows[i]) {
        if (ch >= '1' && ch <= '8') f += +ch;
        else this.board[(7 - i) * 8 + f++] = ch;
      }
    }
    this.turn = turn || 'w';
    this.castling = 0;
    for (const ch of castling || '-') this.castling |= { K: CK, Q: CQ, k: Ck, q: Cq }[ch] || 0;
    this.ep = ep && ep !== '-' ? nameSq(ep) : -1;
    this.halfmove = +half || 0;
    this.fullmove = +full || 1;
    this.history = [];
    this.keys = [];
    this.keys.push(this.positionKey());
  }

  fen() {
    let s = '';
    for (let r = 7; r >= 0; r--) {
      let empty = 0;
      for (let f = 0; f < 8; f++) {
        const p = this.board[r * 8 + f];
        if (!p) empty++;
        else { if (empty) { s += empty; empty = 0; } s += p; }
      }
      if (empty) s += empty;
      if (r) s += '/';
    }
    const c = (this.castling & CK ? 'K' : '') + (this.castling & CQ ? 'Q' : '') + (this.castling & Ck ? 'k' : '') + (this.castling & Cq ? 'q' : '');
    return `${s} ${this.turn} ${c || '-'} ${this.ep >= 0 ? sqName(this.ep) : '-'} ${this.halfmove} ${this.fullmove}`;
  }

  // Key for repetition: placement, turn, castling, and ep only if an ep capture is actually possible.
  positionKey() {
    const parts = this.fen().split(' ');
    let ep = '-';
    if (this.ep >= 0) {
      const pawn = this.turn === 'w' ? 'P' : 'p';
      const rr = this.turn === 'w' ? -1 : 1;
      const f = this.ep & 7, r = (this.ep >> 3) + rr;
      const cand = [f - 1, f + 1].filter((x) => x >= 0 && x < 8).some((x) => this.board[r * 8 + x] === pawn);
      if (cand) ep = sqName(this.ep);
    }
    return `${parts[0]} ${parts[1]} ${parts[2]} ${ep}`;
  }

  kingSquare(color) {
    const k = color === 'w' ? 'K' : 'k';
    for (let i = 0; i < 64; i++) if (this.board[i] === k) return i;
    return -1;
  }

  // Is square attacked by pieces of color `by`?
  isAttacked(sq, by) {
    const b = this.board;
    const f = sq & 7, r = sq >> 3;
    // pawns
    if (by === 'w') {
      if (r > 0) {
        if (f > 0 && b[sq - 9] === 'P') return true;
        if (f < 7 && b[sq - 7] === 'P') return true;
      }
    } else if (r < 7) {
      if (f > 0 && b[sq + 7] === 'p') return true;
      if (f < 7 && b[sq + 9] === 'p') return true;
    }
    const N = by === 'w' ? 'N' : 'n', K = by === 'w' ? 'K' : 'k';
    const Bs = by === 'w' ? 'B' : 'b', R = by === 'w' ? 'R' : 'r', Q = by === 'w' ? 'Q' : 'q';
    for (const t of KNIGHT_T[sq]) if (b[t] === N) return true;
    for (const t of KING_T[sq]) if (b[t] === K) return true;
    const rays = RAYS[sq];
    for (let d = 0; d < 8; d++) {
      const ray = rays[d];
      for (let i = 0; i < ray.length; i++) {
        const p = b[ray[i]];
        if (!p) continue;
        if (p === Q || (d < 4 ? p === R : p === Bs)) return true;
        break;
      }
    }
    return false;
  }

  inCheck(color = this.turn) {
    const k = this.kingSquare(color);
    return k >= 0 && this.isAttacked(k, color === 'w' ? 'b' : 'w');
  }

  pseudoMoves() {
    const b = this.board, us = this.turn, white = us === 'w';
    const them = white ? 'b' : 'w';
    const out = [];
    const push = (from, to, piece, captured, flag, promo) =>
      out.push({ from, to, piece: piece.toLowerCase(), color: us, captured, flag, promo: promo || null });

    for (let from = 0; from < 64; from++) {
      const p = b[from];
      if (!p || isWhitePiece(p) !== white) continue;
      const t = p.toLowerCase();
      const f = from & 7, r = from >> 3;
      if (t === 'p') {
        const dir = white ? 8 : -8;
        const startR = white ? 1 : 6, lastR = white ? 6 : 1;
        const one = from + dir;
        const addPromo = (to, cap, flag) => {
          for (const pr of ['q', 'r', 'b', 'n']) push(from, to, p, cap, flag, pr);
        };
        if (!b[one]) {
          if (r === lastR) addPromo(one, null, 'n');
          else {
            push(from, one, p, null, 'n');
            if (r === startR && !b[one + dir]) push(from, one + dir, p, null, 'd');
          }
        }
        for (const df of [-1, 1]) {
          const nf = f + df;
          if (nf < 0 || nf > 7) continue;
          const to = one + df;
          const tp = b[to];
          if (tp && colorOf(tp) === them) {
            if (r === lastR) addPromo(to, tp.toLowerCase(), 'c');
            else push(from, to, p, tp.toLowerCase(), 'c');
          } else if (!tp && to === this.ep) {
            push(from, to, p, 'p', 'e');
          }
        }
      } else if (t === 'n' || t === 'k') {
        const targets = t === 'n' ? KNIGHT_T[from] : KING_T[from];
        for (const to of targets) {
          const tp = b[to];
          if (!tp) push(from, to, p, null, 'n');
          else if (colorOf(tp) === them) push(from, to, p, tp.toLowerCase(), 'c');
        }
        if (t === 'k') {
          const home = white ? 4 : 60;
          if (from === home && !this.isAttacked(home, them)) {
            const ks = white ? CK : Ck, qs = white ? CQ : Cq;
            const rook = white ? 'R' : 'r';
            if ((this.castling & ks) && b[home + 3] === rook && !b[home + 1] && !b[home + 2] &&
                !this.isAttacked(home + 1, them) && !this.isAttacked(home + 2, them)) push(from, home + 2, p, null, 'k');
            if ((this.castling & qs) && b[home - 4] === rook && !b[home - 1] && !b[home - 2] && !b[home - 3] &&
                !this.isAttacked(home - 1, them) && !this.isAttacked(home - 2, them)) push(from, home - 2, p, null, 'q');
          }
        }
      } else {
        const d0 = t === 'b' ? 4 : 0, d1 = t === 'r' ? 4 : 8;
        for (let d = d0; d < d1; d++) {
          const ray = RAYS[from][d];
          for (let i = 0; i < ray.length; i++) {
            const to = ray[i], tp = b[to];
            if (!tp) push(from, to, p, null, 'n');
            else { if (colorOf(tp) === them) push(from, to, p, tp.toLowerCase(), 'c'); break; }
          }
        }
      }
    }
    return out;
  }

  // Legal moves for the side to move. Optional square filter.
  moves(fromSq = -1) {
    const res = [];
    const us = this.turn;
    for (const m of this.pseudoMoves()) {
      if (fromSq >= 0 && m.from !== fromSq) continue;
      this._make(m, false);
      const ok = !this.inCheck(us);
      this._unmake();
      if (ok) res.push(m);
    }
    return res;
  }

  _make(m, record) {
    const b = this.board;
    const piece = b[m.from];
    const entry = {
      m, piece, captured: m.flag === 'e' ? b[m.to + (m.color === 'w' ? -8 : 8)] : b[m.to],
      castling: this.castling, ep: this.ep, halfmove: this.halfmove, fullmove: this.fullmove,
    };
    this.history.push(entry);
    b[m.from] = null;
    b[m.to] = m.promo ? (m.color === 'w' ? m.promo.toUpperCase() : m.promo) : piece;
    if (m.flag === 'e') b[m.to + (m.color === 'w' ? -8 : 8)] = null;
    else if (m.flag === 'k') { b[m.to - 1] = b[m.to + 1]; b[m.to + 1] = null; }
    else if (m.flag === 'q') { b[m.to + 1] = b[m.to - 2]; b[m.to - 2] = null; }
    this.ep = m.flag === 'd' ? (m.from + m.to) >> 1 : -1;
    // castling rights
    for (const s of [m.from, m.to]) {
      if (s === 4) this.castling &= ~(CK | CQ);
      else if (s === 60) this.castling &= ~(Ck | Cq);
      else if (s === 0) this.castling &= ~CQ;
      else if (s === 7) this.castling &= ~CK;
      else if (s === 56) this.castling &= ~Cq;
      else if (s === 63) this.castling &= ~Ck;
    }
    this.halfmove = (m.piece === 'p' || m.captured) ? 0 : this.halfmove + 1;
    if (m.color === 'b') this.fullmove++;
    this.turn = m.color === 'w' ? 'b' : 'w';
    if (record && this.trackKeys) this.keys.push(this.positionKey());
  }

  _unmake() {
    const e = this.history.pop();
    const m = e.m, b = this.board;
    b[m.from] = e.piece;
    if (m.flag === 'e') { b[m.to] = null; b[m.to + (m.color === 'w' ? -8 : 8)] = e.captured; }
    else {
      b[m.to] = e.captured || null;
      if (m.flag === 'k') { b[m.to + 1] = b[m.to - 1]; b[m.to - 1] = null; }
      else if (m.flag === 'q') { b[m.to - 2] = b[m.to + 1]; b[m.to + 1] = null; }
    }
    this.castling = e.castling; this.ep = e.ep; this.halfmove = e.halfmove; this.fullmove = e.fullmove;
    this.turn = m.color;
  }

  // Play a legal move (object from moves(), or {from,to,promo}). Returns the move record with san, or null.
  play(input) {
    const legal = this.moves();
    const m = legal.find((x) => x.from === input.from && x.to === input.to && (x.promo || null) === (input.promo || null));
    if (!m) return null;
    m.san = this.san(m, legal);
    this._make(m, true);
    return m;
  }

  undo() {
    if (!this.history.length) return null;
    const m = this.history[this.history.length - 1].m;
    this._unmake();
    if (this.trackKeys) this.keys.pop();
    return m;
  }

  san(m, legal = this.moves()) {
    let s;
    if (m.flag === 'k') s = 'O-O';
    else if (m.flag === 'q') s = 'O-O-O';
    else {
      const capture = !!m.captured;
      if (m.piece === 'p') {
        s = capture ? FILES[m.from & 7] + 'x' + sqName(m.to) : sqName(m.to);
        if (m.promo) s += '=' + m.promo.toUpperCase();
      } else {
        s = m.piece.toUpperCase();
        const others = legal.filter((x) => x.piece === m.piece && x.to === m.to && x.from !== m.from);
        if (others.length) {
          const sameFile = others.some((x) => (x.from & 7) === (m.from & 7));
          const sameRank = others.some((x) => (x.from >> 3) === (m.from >> 3));
          if (!sameFile) s += FILES[m.from & 7];
          else if (!sameRank) s += (m.from >> 3) + 1;
          else s += sqName(m.from);
        }
        if (capture) s += 'x';
        s += sqName(m.to);
      }
    }
    this._make(m, false);
    const chk = this.inCheck(this.turn);
    const any = chk ? this.moves().length > 0 : false;
    this._unmake();
    if (chk) s += any ? '+' : '#';
    return s;
  }

  isInsufficientMaterial() {
    const minors = [];
    for (let i = 0; i < 64; i++) {
      const p = this.board[i];
      if (!p) continue;
      const t = p.toLowerCase();
      if (t === 'k') continue;
      if (t === 'p' || t === 'r' || t === 'q') return false;
      minors.push({ t, sq: i, c: colorOf(p) });
    }
    if (minors.length <= 1) return true;
    // only bishops, all on same square colour
    if (minors.every((x) => x.t === 'b')) {
      const col = ((minors[0].sq >> 3) + (minors[0].sq & 7)) & 1;
      return minors.every((x) => (((x.sq >> 3) + (x.sq & 7)) & 1) === col);
    }
    return false;
  }

  repetitionCount() {
    const k = this.keys[this.keys.length - 1];
    let n = 0;
    for (const x of this.keys) if (x === k) n++;
    return n;
  }

  // { over, result: '1-0'|'0-1'|'1/2-1/2'|null, reason, check, winner }
  status() {
    const check = this.inCheck();
    const any = this.moves().length > 0;
    if (!any) {
      if (check) {
        const winner = this.turn === 'w' ? 'b' : 'w';
        return { over: true, result: winner === 'w' ? '1-0' : '0-1', reason: 'checkmate', check, winner };
      }
      return { over: true, result: '1/2-1/2', reason: 'stalemate', check, winner: null };
    }
    if (this.isInsufficientMaterial()) return { over: true, result: '1/2-1/2', reason: 'insufficient material', check, winner: null };
    if (this.halfmove >= 100) return { over: true, result: '1/2-1/2', reason: 'fifty-move rule', check, winner: null };
    if (this.trackKeys && this.repetitionCount() >= 3) return { over: true, result: '1/2-1/2', reason: 'threefold repetition', check, winner: null };
    return { over: false, result: null, reason: null, check, winner: null };
  }

  perft(depth) {
    if (depth === 0) return 1;
    const ms = this.moves();
    if (depth === 1) return ms.length;
    let n = 0;
    for (const m of ms) { this._make(m, false); n += this.perft(depth - 1); this._unmake(); }
    return n;
  }
}
