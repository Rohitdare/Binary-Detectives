"""9 pattern detectors on FalkorDB graph 'txn'. Eval vs labels CSVs.
Run: python detectors.py [labels_dir]
Edge tuple: (src, dst, tx_id, amount, ts)
"""
import csv, json, sys
from bisect import bisect_left
from collections import defaultdict
from itertools import combinations
from statistics import median, mean, pstdev
from falkordb import FalkorDB

H = 3600
D1 = 86400


def load(g):
    rows = g.query("MATCH (a:Account)-[t:SENT]->(b:Account) "
                   "RETURN a.id,b.id,t.tx_id,t.amount,t.ts").result_set
    types = dict(g.query("MATCH (a:Account) RETURN a.id,a.type").result_set)
    E = sorted((tuple(r) for r in rows), key=lambda e: e[4])
    out, inn = defaultdict(list), defaultdict(list)
    for e in E:
        out[e[0]].append(e)
        inn[e[1]].append(e)
    return E, out, inn, types


def burst(es, key, span, k):
    """Largest window (by edge count) with >=k distinct values at es[i][key]."""
    best, j = [], 0
    for i in range(len(es)):
        while es[i][4] - es[j][4] > span:
            j += 1
        w = es[j:i + 1]
        if len(w) > len(best) and len({e[key] for e in w}) >= k:
            best = w
    return best


def chains(out, lo, hi, gmin, gmax, rlo, rhi, closed):
    """Time-ordered edge paths. Each hop: gap in [gmin,gmax], amount ratio in [rlo,rhi]."""
    res = []

    def go(p):
        e = p[-1]
        if len(p) >= lo and closed == (e[1] == p[0][0]):
            res.append(list(p))
        if len(p) == hi or (closed and e[1] == p[0][0]):
            return
        seen = {x[0] for x in p}
        for f in out.get(e[1], []):
            if f[4] < e[4] + gmin:
                continue
            if f[4] > e[4] + gmax:
                break
            if not rlo <= f[3] / e[3] <= rhi:
                continue
            if f[1] in seen and not (closed and f[1] == p[0][0]):
                continue
            p.append(f)
            go(p)
            p.pop()

    for es in list(out.values()):
        for e in es:
            go([e])
    return res


def bipartite(E, ts):
    res, seen = [], set()
    for ws in range(E[0][4], E[-1][4], D1):
        W = E[bisect_left(ts, ws):bisect_left(ts, ws + 2 * D1)]
        tg = defaultdict(set)
        for e in W:
            tg[e[0]].add(e[1])
        S0 = [s for s, t in tg.items() if len(t) >= 3]
        idx = defaultdict(set)
        for s in S0:
            for t in tg[s]:
                idx[t].add(s)
        par = {s: s for s in S0}

        def f(x):
            while par[x] != x:
                par[x] = par[par[x]]
                x = par[x]
            return x

        cnt = defaultdict(int)
        for t, ss in idx.items():
            if len(ss) <= 8:
                for a, b in combinations(sorted(ss), 2):
                    cnt[a, b] += 1
        for (a, b), c in cnt.items():
            if c >= 3:
                par[f(a)] = f(b)
        grp = defaultdict(set)
        for s in S0:
            grp[f(s)].add(s)
        for S in grp.values():
            if not 3 <= len(S) <= 5:
                continue
            T = {t for t, ss in idx.items() if t not in S and len(ss & S) >= 0.6 * len(S)}
            if not 3 <= len(T) <= 6:
                continue
            pairs = {(e[0], e[1]) for e in W if e[0] in S and e[1] in T}
            key = frozenset(S | T)
            if len(pairs) / (len(S) * len(T)) >= 0.7 and key not in seen:
                seen.add(key)
                res.append((S | T, [e for e in W if e[0] in S and e[1] in T]))
    return res


def dense(E, ts):
    res, seen = [], set()
    for ws in range(E[0][4], E[-1][4], D1):
        W = E[bisect_left(ts, ws):bisect_left(ts, ws + 4 * D1)]
        nb, dd = defaultdict(set), set()
        for e in W:
            nb[e[0]].add(e[1])
            nb[e[1]].add(e[0])
            dd.add((e[0], e[1]))
        q = [n for n in nb if len(nb[n]) < 3]
        while q:  # 3-core peel
            n = q.pop()
            if n not in nb:
                continue
            for m in nb.pop(n):
                if m in nb:
                    nb[m].discard(n)
                    if len(nb[m]) < 3:
                        q.append(m)
        left = set(nb)
        while left:
            comp, st = set(), [left.pop()]
            while st:
                n = st.pop()
                comp.add(n)
                for m in nb[n]:
                    if m in left:
                        left.discard(m)
                        st.append(m)
            k = len(comp)
            if not 5 <= k <= 10:
                continue
            dens = sum(len(nb[n] & comp) for n in comp) / 2 / (k * (k - 1) / 2)
            recip = sum((a, b) in dd and (b, a) in dd for a, b in combinations(sorted(comp), 2))
            key = frozenset(comp)
            if dens >= 0.4 and recip >= 2 and key not in seen:
                seen.add(key)
                res.append((comp, [e for e in W if e[0] in comp and e[1] in comp]))
    return res


def detect(g):
    E, out, inn, T = load(g)
    ts = [e[4] for e in E]
    D = []

    def add(p, acc, txs, sc):
        D.append(dict(pattern=p, acc=set(acc), tx=sorted({e[2] for e in txs}), score=sc))

    # gather_scatter: many in, then many out, amount mostly kept
    for h, es in list(inn.items()):
        w = burst(es, 0, D1, 5)
        if not w:
            continue
        t1 = w[-1][4]
        o = [e for e in out.get(h, []) if t1 <= e[4] <= t1 + 36 * H]
        if len({e[1] for e in o}) < 5:
            continue
        if 0.8 <= sum(e[3] for e in o) / sum(e[3] for e in w) <= 1.02:
            add('gather_scatter', {e[0] for e in w} | {e[1] for e in o} | {h}, w + o, 0.9)

    # scatter_gather: o -> k mids -> s, mids hold 30min-24h, keep 88-100%
    pairs = defaultdict(dict)
    for o, es in list(out.items()):
        for e in es:
            for f in out.get(e[1], []):
                if f[1] not in (o, e[1]) and 1800 <= f[4] - e[4] <= D1 and 0.88 <= f[3] / e[3] <= 1.0:
                    pairs[o, f[1]][e[1]] = (e, f)
    for (o, s), mids in pairs.items():
        if len(mids) < 3:
            continue
        ins = [v[0] for v in mids.values()]
        if max(e[4] for e in ins) - min(e[4] for e in ins) > 7 * H:
            continue
        med = median(e[3] for e in ins)
        ins = [e for e in ins if 0.8 * med <= e[3] <= 1.2 * med]
        if len(ins) >= 3:
            ms = {e[1] for e in ins}
            add('scatter_gather', {o, s} | ms, ins + [mids[m][1] for m in ms], 0.9)

    claimed = set().union(*[d['acc'] for d in D]) if D else set()

    # cycle: 3-5 hops, time ordered, gap<=12h, ratio .89-1.0
    seen = set()
    for p in chains(out, 3, 5, 60, 13 * H, 0.89, 1.0, True):
        k = frozenset(e[0] for e in p)
        if k not in seen:
            seen.add(k)
            add('cycle', k, p, 0.95)
    cyc_tx = {t for d in D if d['pattern'] == 'cycle' for t in d['tx']}

    # relay_chain: 3-6 open hops, gap<=6h, keep 84-100%; keep maximal chains only
    used = []
    for p in sorted(chains(out, 3, 6, 60, 6 * H, 0.84, 1.0, False), key=len, reverse=True):
        t = {e[2] for e in p}
        if t <= cyc_tx or any(t <= u for u in used):
            continue
        used.append(t)
        add('relay_chain', {e[0] for e in p} | {p[-1][1]}, p, 0.85)

    for acc, txs in bipartite(E, ts):
        add('bipartite', acc, txs, 0.85)
    for acc, txs in dense(E, ts):
        add('dense_cluster', acc, txs, 0.85)

    # fan_in: >=8 distinct senders in 48h, burst is >=half of inflow, not merchant
    for d, es in list(inn.items()):
        if d in claimed or T.get(d) == 'merchant':
            continue
        w = burst(es, 0, 48 * H, 8)
        if w and len(w) >= 0.5 * len(es):
            share = mean(42500 <= e[3] <= 49500 for e in w)
            add('fan_in', {e[0] for e in w} | {d}, w, 0.7 + 0.3 * min(1, 2 * share))

    # fan_out: >=8 distinct receivers in 48h, not payroll, not recurring
    for o, es in list(out.items()):
        if o in claimed or T.get(o) == 'payroll':
            continue
        w = burst(es, 1, 48 * H, 8)
        if not w:
            continue
        far = [e for e in es if e[4] >= w[-1][4] + 20 * D1 or e[4] <= w[0][4] - 20 * D1]
        if len({e[1] for e in far}) >= 8:
            continue  # repeats monthly = payroll-like
        add('fan_out', {e[1] for e in w} | {o}, w, 0.8)

    # hub_account: extreme distinct-neighbour degree
    deg = {n: len({e[1] for e in out.get(n, [])} | {e[0] for e in inn.get(n, [])}) for n in T}
    mu, sd = mean(deg.values()), pstdev(deg.values())
    for n, v in deg.items():
        if v >= mu + 4 * sd:
            add('hub_account', {n}, [], 0.5)
    return D


def writeback(g, D):
    risk = defaultdict(lambda: [1.0, set()])
    for d in D:
        for a in d['acc']:
            r = risk[a]
            r[0] *= 1 - d['score']
            r[1].add(d['pattern'])
    g.query("MATCH (a:Account) SET a.risk=0.0, a.patterns=''")
    rows = [dict(id=a, risk=round(1 - v[0], 3), pat=','.join(sorted(v[1]))) for a, v in risk.items()]
    for i in range(0, len(rows), 5000):
        g.query("UNWIND $rows AS r MATCH (a:Account {id:r.id}) SET a.risk=r.risk, a.patterns=r.pat",
                {'rows': rows[i:i + 5000]})
    json.dump([{**d, 'acc': sorted(d['acc'])} for d in D], open('detections.json', 'w'))


def evaluate(D, path):
    A = {r['alert_id']: r for r in csv.DictReader(open(f'{path}/alerts.csv'))}
    M = defaultdict(set)
    for r in csv.DictReader(open(f'{path}/alert_accounts.csv')):
        M[r['alert_id']].add(r['account_id'])
    fraud = {a: r for a, r in A.items() if r['is_fraud'].lower() == 'true'}
    st = defaultdict(lambda: dict(alerts=0, hit=0, dets=0, tp=0))
    fp_benign = defaultdict(int)
    for aid, a in fraud.items():
        s = st[a['pattern']]
        s['alerts'] += 1
        need = 1 if a['pattern'] == 'hub_account' else 0.6 * len(M[aid])
        if any(d['pattern'] == a['pattern'] and len(d['acc'] & M[aid]) >= need for d in D):
            s['hit'] += 1
        else:
            print('MISS', aid, a['pattern'], a.get('n_accounts'))
    for d in D:
        s = st[d['pattern']]
        s['dets'] += 1
        if any(a['pattern'] == d['pattern'] and len(d['acc'] & M[i]) >= 0.5 * len(d['acc'])
               for i, a in fraud.items()):
            s['tp'] += 1
            continue
        for i, a in A.items():
            if i not in fraud and len(d['acc'] & M[i]) >= 0.5 * len(d['acc']):
                fp_benign[(d['pattern'], a['kind'])] += 1
    print(f"{'pattern':16}{'alerts':>7}{'recall':>8}{'dets':>6}{'prec':>7}")
    for p, s in sorted(st.items()):
        print(f"{p:16}{s['alerts']:>7}{s['hit'] / max(1, s['alerts']):>8.2f}"
              f"{s['dets']:>6}{s['tp'] / max(1, s['dets']):>7.2f}")
    print('FP hitting benign look-alikes:', dict(fp_benign))


if __name__ == '__main__':
    g = FalkorDB(host='localhost', port=6379).select_graph('txn')
    D = detect(g)
    writeback(g, D)
    print(len(D), 'detections')
    if len(sys.argv) > 1:
        evaluate(D, sys.argv[1])
