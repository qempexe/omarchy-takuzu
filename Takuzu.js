.pragma library

// Takuzu (binary puzzle) engine: pure, seeded, deterministic. No QML, no timers.
// Testable headless with node (tests/test_engine.js).
//
// Rules, for an n x n board (n even):
//   1. every cell is 0 or 1
//   2. no more than two equal cells side by side, in any row or column
//   3. every row and every column holds exactly n/2 zeros and n/2 ones
//   4. no two rows are identical, and no two columns are identical
//
// Cells are -1 (empty), 0 or 1, in row-major order.

var LEVELS = {
    easy:   { n: 6,  tier: 1, keep: 0.55, label: "EASY" },
    medium: { n: 8,  tier: 1, keep: 0.45, label: "MED"  },
    hard:   { n: 10, tier: 2, keep: 0.34, label: "HARD" }
};

function levelNames() { return ["easy", "medium", "hard"]; }

function makeRng(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        var t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function emptyBoard(n) {
    var b = new Array(n * n);
    for (var i = 0; i < b.length; i++) b[i] = -1;
    return b;
}

// ---- lines -----------------------------------------------------------------
var _lines = {};
function allLines(n) {
    if (_lines[n]) return _lines[n];
    var rows = [], cols = [];
    for (var k = 0; k < n; k++) {
        var r = [], c = [];
        for (var i = 0; i < n; i++) { r.push(k * n + i); c.push(i * n + k); }
        rows.push({ kind: "row", k: k, idx: r });
        cols.push({ kind: "column", k: k, idx: c });
    }
    _lines[n] = rows.concat(cols);
    return _lines[n];
}

function valuesOf(b, line) {
    var v = [];
    for (var i = 0; i < line.idx.length; i++) v.push(b[line.idx[i]]);
    return v;
}

function sameVals(a, b) {
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

function isComplete(vals) {
    for (var i = 0; i < vals.length; i++) if (vals[i] === -1) return false;
    return true;
}

// ---- rule violations (for highlighting and win detection) ----------------------
// Returns a boolean per cell: true when the cell takes part in a broken rule.
function conflicts(b, n) {
    var bad = new Array(n * n);
    for (var i = 0; i < bad.length; i++) bad[i] = false;
    var lines = allLines(n), half = n / 2, t;
    for (var li = 0; li < lines.length; li++) {
        var ln = lines[li], v = valuesOf(b, ln);
        var c0 = 0, c1 = 0;
        for (t = 0; t < n; t++) { if (v[t] === 0) c0++; else if (v[t] === 1) c1++; }
        for (t = 0; t + 2 < n; t++) {
            if (v[t] !== -1 && v[t] === v[t + 1] && v[t] === v[t + 2]) {
                bad[ln.idx[t]] = bad[ln.idx[t + 1]] = bad[ln.idx[t + 2]] = true;
            }
        }
        if (c0 > half) for (t = 0; t < n; t++) if (v[t] === 0) bad[ln.idx[t]] = true;
        if (c1 > half) for (t = 0; t < n; t++) if (v[t] === 1) bad[ln.idx[t]] = true;
    }
    for (var a = 0; a < lines.length; a++) {
        for (var d = a + 1; d < lines.length; d++) {
            if (lines[a].kind !== lines[d].kind) continue;
            var va = valuesOf(b, lines[a]), vb = valuesOf(b, lines[d]);
            if (isComplete(va) && isComplete(vb) && sameVals(va, vb)) {
                for (t = 0; t < n; t++) { bad[lines[a].idx[t]] = true; bad[lines[d].idx[t]] = true; }
            }
        }
    }
    return bad;
}

function hasConflicts(b, n) {
    var c = conflicts(b, n);
    for (var i = 0; i < c.length; i++) if (c[i]) return true;
    return false;
}

function isFull(b) {
    for (var i = 0; i < b.length; i++) if (b[i] === -1) return false;
    return true;
}

function isSolved(b, n) { return isFull(b) && !hasConflicts(b, n); }

// ---- logic rules (used by the solver, the generator and the hints) ---------------
function ruleTriples(b, n) {
    var ds = [], lines = allLines(n);
    for (var li = 0; li < lines.length; li++) {
        var ln = lines[li];
        for (var i = 0; i + 2 < n; i++) {
            var p = ln.idx[i], q = ln.idx[i + 1], r = ln.idx[i + 2];
            var x = b[p], y = b[q], z = b[r];
            if (x !== -1 && x === y && z === -1)
                ds.push({ idx: r, value: 1 - x, rule: "triple",
                          reason: "Two " + x + "s side by side: a third would make three in a row." });
            if (y !== -1 && y === z && x === -1)
                ds.push({ idx: p, value: 1 - y, rule: "triple",
                          reason: "Two " + y + "s side by side: a third would make three in a row." });
            if (x !== -1 && x === z && y === -1)
                ds.push({ idx: q, value: 1 - x, rule: "triple",
                          reason: "A " + x + " on both sides of this gap, so it cannot be a " + x + "." });
        }
    }
    return ds;
}

function ruleCounts(b, n) {
    var ds = [], lines = allLines(n), half = n / 2;
    for (var li = 0; li < lines.length; li++) {
        var ln = lines[li], v = valuesOf(b, ln);
        var c0 = 0, c1 = 0, empties = [];
        for (var t = 0; t < n; t++) {
            if (v[t] === 0) c0++; else if (v[t] === 1) c1++; else empties.push(ln.idx[t]);
        }
        if (!empties.length) continue;
        var fill = -1;
        if (c0 === half) fill = 1; else if (c1 === half) fill = 0;
        if (fill === -1) continue;
        for (var e = 0; e < empties.length; e++)
            ds.push({ idx: empties[e], value: fill, rule: "count",
                      reason: "This " + ln.kind + " already has " + half + " " + (1 - fill)
                              + "s, so the rest must be " + fill + "s." });
    }
    return ds;
}

// All ways to finish one line (exactly half zeros, no three in a row).
function lineCompletions(vals, n) {
    var half = n / 2, out = [], cur = new Array(n);
    function rec(i, c0, c1) {
        if (c0 > half || c1 > half) return;
        if (i === n) { out.push(cur.slice()); return; }
        var opts = vals[i] === -1 ? [0, 1] : [vals[i]];
        for (var o = 0; o < opts.length; o++) {
            var v = opts[o];
            if (i >= 2 && cur[i - 1] === v && cur[i - 2] === v) continue;
            cur[i] = v;
            rec(i + 1, c0 + (v === 0 ? 1 : 0), c1 + (v === 1 ? 1 : 0));
        }
    }
    rec(0, 0, 0);
    return out;
}

// Tier 2: look at every way to finish a line, throw away the ones that would
// copy another finished line, and keep what all survivors agree on.
function ruleEnumerate(b, n) {
    var ds = [], lines = allLines(n);
    for (var li = 0; li < lines.length; li++) {
        var ln = lines[li], v = valuesOf(b, ln);
        if (isComplete(v)) continue;
        var comps = lineCompletions(v, n);
        if (!comps.length) return { ds: [], bad: true };
        var others = [];
        for (var oi = 0; oi < lines.length; oi++) {
            if (oi === li || lines[oi].kind !== ln.kind) continue;
            var ov = valuesOf(b, lines[oi]);
            if (isComplete(ov)) others.push(ov);
        }
        var kept = comps;
        if (others.length) {
            kept = comps.filter(function (c) {
                for (var q = 0; q < others.length; q++) if (sameVals(c, others[q])) return false;
                return true;
            });
        }
        if (!kept.length) return { ds: [], bad: true };
        for (var t = 0; t < n; t++) {
            if (v[t] !== -1) continue;
            var agree = true, agreeAll = true;
            for (var k = 1; k < kept.length; k++) if (kept[k][t] !== kept[0][t]) { agree = false; break; }
            if (!agree) continue;
            for (var k2 = 1; k2 < comps.length; k2++) if (comps[k2][t] !== comps[0][t]) { agreeAll = false; break; }
            ds.push({ idx: ln.idx[t], value: kept[0][t], rule: agreeAll ? "line" : "unique",
                      reason: agreeAll
                          ? "Counts and the no-three-in-a-row rule leave only one way to finish this " + ln.kind + "."
                          : "Every other way to finish this " + ln.kind + " would copy another " + ln.kind + "." });
        }
    }
    return { ds: ds };
}

// First family of rules that finds anything. tier 1: triples + counts. tier 2: + line enumeration.
function rulesOnce(b, n, tier) {
    var ds = ruleTriples(b, n);
    if (ds.length) return { ds: ds };
    ds = ruleCounts(b, n);
    if (ds.length) return { ds: ds };
    if (tier >= 2) {
        var e = ruleEnumerate(b, n);
        if (e.bad) return { ds: [], bad: true };
        if (e.ds.length) return e;
    }
    return { ds: [] };
}

// Apply rules until nothing more can be deduced. complete = fully and validly solved by logic alone.
function propagate(start, n, tier) {
    var b = start.slice(), guard = 0;
    while (guard++ < 600) {
        var r = rulesOnce(b, n, tier);
        if (r.bad) return { board: b, complete: false, bad: true };
        if (!r.ds.length) break;
        for (var i = 0; i < r.ds.length; i++) {
            var d = r.ds[i];
            if (b[d.idx] !== -1 && b[d.idx] !== d.value) return { board: b, complete: false, bad: true };
            b[d.idx] = d.value;
        }
    }
    return { board: b, complete: isSolved(b, n), bad: false };
}

// ---- brute force (tests only: independent of the logic rules above) --------------
function countSolutions(start, n, limit) {
    var half = n / 2, b = start.slice(), found = 0;
    var rc0 = [], rc1 = [], cc0 = [], cc1 = [], i, r, c;
    for (i = 0; i < n; i++) { rc0.push(0); rc1.push(0); cc0.push(0); cc1.push(0); }
    for (i = 0; i < n * n; i++) {
        if (b[i] === -1) continue;
        r = Math.floor(i / n); c = i % n;
        if (b[i] === 0) { rc0[r]++; cc0[c]++; } else { rc1[r]++; cc1[c]++; }
    }
    for (i = 0; i < n; i++)
        if (rc0[i] > half || rc1[i] > half || cc0[i] > half || cc1[i] > half) return 0;

    function rowEq(a, d) {
        for (var t = 0; t < n; t++) if (b[a * n + t] !== b[d * n + t]) return false;
        return true;
    }
    function colEq(a, d) {
        for (var t = 0; t < n; t++) if (b[t * n + a] !== b[t * n + d]) return false;
        return true;
    }
    function rec(pos) {
        if (found >= limit) return;
        if (pos === n * n) {
            for (var x = 0; x < n; x++) for (var y = x + 1; y < n; y++) if (colEq(x, y)) return;
            found++;
            return;
        }
        var rr = Math.floor(pos / n), cc = pos % n, given = start[pos] !== -1;
        for (var v = 0; v < 2; v++) {
            if (given && start[pos] !== v) continue;
            b[pos] = v;
            if (cc >= 2 && b[pos - 1] === v && b[pos - 2] === v) continue;
            if (rr >= 2 && b[pos - n] === v && b[pos - 2 * n] === v) continue;
            if (!given) {
                if (v === 0) { if (rc0[rr] >= half || cc0[cc] >= half) continue; rc0[rr]++; cc0[cc]++; }
                else { if (rc1[rr] >= half || cc1[cc] >= half) continue; rc1[rr]++; cc1[cc]++; }
            }
            var ok = true;
            if (cc === n - 1) { for (var q = 0; q < rr; q++) if (rowEq(q, rr)) { ok = false; break; } }
            if (ok) rec(pos + 1);
            if (!given) {
                if (v === 0) { rc0[rr]--; cc0[cc]--; } else { rc1[rr]--; cc1[cc]--; }
            }
            if (found >= limit) break;
        }
        b[pos] = start[pos];
    }
    rec(0);
    return found;
}

// ---- generation ---------------------------------------------------------------
function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
        var j = Math.floor(rng() * (i + 1));
        var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
}

function fullSolution(n, rng) {
    var half = n / 2, b = emptyBoard(n), nodes = 0, LIMIT = 200000;
    var rc0 = [], rc1 = [], cc0 = [], cc1 = [], i;
    for (i = 0; i < n; i++) { rc0.push(0); rc1.push(0); cc0.push(0); cc1.push(0); }
    function rec(pos) {
        if (++nodes > LIMIT) return false;
        if (pos === n * n) {
            for (var x = 0; x < n; x++) for (var y = x + 1; y < n; y++) {
                var same = true;
                for (var t = 0; t < n; t++) if (b[t * n + x] !== b[t * n + y]) { same = false; break; }
                if (same) return false;
            }
            return true;
        }
        var r = Math.floor(pos / n), c = pos % n;
        var first = rng() < 0.5 ? 0 : 1;
        for (var k = 0; k < 2; k++) {
            var v = k === 0 ? first : 1 - first;
            if (c >= 2 && b[pos - 1] === v && b[pos - 2] === v) continue;
            if (r >= 2 && b[pos - n] === v && b[pos - 2 * n] === v) continue;
            if (v === 0) { if (rc0[r] >= half || cc0[c] >= half) continue; }
            else if (rc1[r] >= half || cc1[c] >= half) continue;
            b[pos] = v;
            if (v === 0) { rc0[r]++; cc0[c]++; } else { rc1[r]++; cc1[c]++; }
            var ok = true;
            if (c === n - 1) {
                for (var q = 0; q < r && ok; q++) {
                    var eq = true;
                    for (var t2 = 0; t2 < n; t2++) if (b[q * n + t2] !== b[r * n + t2]) { eq = false; break; }
                    if (eq) ok = false;
                }
            }
            if (ok && rec(pos + 1)) return true;
            if (v === 0) { rc0[r]--; cc0[c]--; } else { rc1[r]--; cc1[c]--; }
            b[pos] = -1;
        }
        return false;
    }
    return rec(0) ? b : null;
}

// Puzzle with exactly one solution, solvable by logic of the level's tier (no guessing).
function generate(level, seed) {
    var lv = LEVELS[level] || LEVELS.easy;
    var name = LEVELS[level] ? level : "easy";
    var n = lv.n, rng = makeRng(seed), best = null;
    for (var attempt = 0; attempt < 8; attempt++) {
        var sol = null;
        while (!sol) sol = fullSolution(n, rng);
        var puz = sol.slice();
        var order = [];
        for (var i = 0; i < n * n; i++) order.push(i);
        shuffle(order, rng);
        var target = Math.round(n * n * lv.keep), given = n * n;
        for (var o = 0; o < order.length && given > target; o++) {
            var keepVal = puz[order[o]];
            puz[order[o]] = -1;
            if (propagate(puz, n, lv.tier).complete) given--;
            else puz[order[o]] = keepVal;
        }
        best = { level: name, n: n, tier: lv.tier, puzzle: puz, solution: sol };
        // A "hard" puzzle should really need the line-uniqueness reasoning.
        if (lv.tier < 2 || !propagate(puz, n, 1).complete) break;
    }
    return best;
}

// ---- game state ----------------------------------------------------------------
function newState(gen) {
    var given = [];
    for (var i = 0; i < gen.puzzle.length; i++) given.push(gen.puzzle[i] !== -1);
    return {
        level: gen.level, n: gen.n, tier: gen.tier,
        puzzle: gen.puzzle.slice(), solution: gen.solution.slice(),
        cells: gen.puzzle.slice(), given: given,
        mistakes: 0, hints: 0, moves: 0, undo: [], won: false
    };
}

function setCell(s, idx, v) {
    if (s.won || idx < 0 || idx >= s.cells.length || s.given[idx]) return { changed: false };
    if (v !== -1 && v !== 0 && v !== 1) return { changed: false };
    var old = s.cells[idx];
    if (old === v) return { changed: false };
    s.undo.push([idx, old]);
    if (s.undo.length > 300) s.undo.shift();
    s.cells[idx] = v;
    s.moves += 1;
    var mistake = v !== -1 && v !== s.solution[idx];
    if (mistake) s.mistakes += 1;
    s.won = isSolved(s.cells, s.n);
    return { changed: true, mistake: mistake, won: s.won };
}

function nextValue(cur) { return cur === -1 ? 0 : (cur === 0 ? 1 : -1); }

function cycleCell(s, idx) { return setCell(s, idx, nextValue(s.cells[idx])); }

function undo(s) {
    if (s.won || !s.undo.length) return false;
    var u = s.undo.pop();
    s.cells[u[0]] = u[1];
    return true;
}

function wrongCells(s) {
    var out = [];
    for (var i = 0; i < s.cells.length; i++)
        if (!s.given[i] && s.cells[i] !== -1 && s.cells[i] !== s.solution[i]) out.push(i);
    return out;
}

// Next helpful move: a wrong entry first, then the simplest logical deduction.
function hint(s) {
    var wrong = wrongCells(s);
    if (wrong.length)
        return { idx: wrong[0], value: s.solution[wrong[0]], kind: "wrong",
                 reason: "This cell does not match the solution." };
    var r = rulesOnce(s.cells, s.n, 2);
    if (r.ds.length) {
        var d = r.ds[0];
        return { idx: d.idx, value: d.value, kind: "logic", reason: d.reason };
    }
    for (var i = 0; i < s.cells.length; i++)
        if (s.cells[i] === -1)
            return { idx: i, value: s.solution[i], kind: "reveal", reason: "No simple rule applies, so here is one cell." };
    return null;
}

function applyHint(s) {
    if (s.won) return null;
    var h = hint(s);
    if (!h) return null;
    s.hints += 1;
    setCell(s, h.idx, h.value);
    return h;
}

function progress(s) {
    var free = 0, done = 0;
    for (var i = 0; i < s.cells.length; i++) {
        if (s.given[i]) continue;
        free++;
        if (s.cells[i] !== -1) done++;
    }
    return free ? done / free : 1;
}

// ---- persistence helpers ----------------------------------------------------------
function enc(arr) {
    var out = "";
    for (var i = 0; i < arr.length; i++) out += arr[i] === -1 ? "." : String(arr[i]);
    return out;
}

function dec(str, len) {
    str = String(str || "");
    if (str.length !== len) return null;
    var out = [];
    for (var i = 0; i < len; i++) {
        var ch = str.charAt(i);
        if (ch === ".") out.push(-1);
        else if (ch === "0") out.push(0);
        else if (ch === "1") out.push(1);
        else return null;
    }
    return out;
}

function encodeState(s) {
    return { level: s.level, puzzle: enc(s.puzzle), solution: enc(s.solution), cells: enc(s.cells),
             mistakes: s.mistakes, hints: s.hints, moves: s.moves };
}

// Returns a state, or null when the saved data is damaged or not a valid puzzle.
function decodeState(o) {
    if (!o || typeof o !== "object" || !LEVELS[o.level]) return null;
    var n = LEVELS[o.level].n, len = n * n;
    var puz = dec(o.puzzle, len), sol = dec(o.solution, len), cells = dec(o.cells, len);
    if (!puz || !sol || !cells) return null;
    if (!isSolved(sol, n)) return null;
    for (var i = 0; i < len; i++) {
        if (sol[i] === -1) return null;
        if (puz[i] !== -1 && puz[i] !== sol[i]) return null;
        if (puz[i] !== -1 && cells[i] !== puz[i]) return null;
    }
    var s = newState({ level: o.level, n: n, tier: LEVELS[o.level].tier, puzzle: puz, solution: sol });
    s.cells = cells;
    s.mistakes = Math.max(0, Math.min(999, Math.round(Number(o.mistakes) || 0)));
    s.hints = Math.max(0, Math.min(999, Math.round(Number(o.hints) || 0)));
    s.moves = Math.max(0, Math.min(99999, Math.round(Number(o.moves) || 0)));
    s.won = isSolved(cells, n);
    return s;
}

function formatTime(sec) {
    sec = Math.max(0, Math.floor(sec));
    var m = Math.floor(sec / 60), s = sec % 60;
    return (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
}
