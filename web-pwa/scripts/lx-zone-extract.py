#!/usr/bin/env python3
"""
Extract address → zone mappings from downloaded Libanex (LX) orders and build a
CSV suitable for the jett.delivery /zones Seed import.

Pipeline:
1. Read data/lx_zones/orders_raw.jsonl (order_id, address, city, zone, location).
2. Normalize addresses exactly like lib/addressNormalizer.ts normalizeAddress().
3. Cluster spelling variants (Dekweneh / Dekwene / Dekwaneh) via union-find on
   string similarity, within same-prefix buckets.
4. Aggregate zone votes per cluster. Assign the zone when the winning zone has
   >= MIN_VOTES occurrences and is a clear winner.
5. Emit:
   - data/lx_zones/lx_address_zone.csv        (City,Zone)  → upload via Seed
   - data/lx_zones/lx_address_zone_audit.csv  (full vote breakdown, flags)
"""

import csv
import json
import re
import sys
from collections import Counter, defaultdict
from difflib import SequenceMatcher

IN_FILE = "data/lx_zones/orders_raw.jsonl"
OUT_CSV = "data/lx_zones/lx_address_zone.csv"
OUT_AUDIT = "data/lx_zones/lx_address_zone_audit.csv"

MIN_VOTES = 5            # user rule: same zone >= 5 occurrences
SIM_THRESHOLD = 0.86     # variant clustering threshold (normalized strings)
# Zones that exist on jett.delivery (verified from the Zone table)
ALLOWED_ZONES = {str(i) for i in range(19)} | {"14B"}
# Zone names in LX data that must be normalized before the allow-list check
ZONE_FIXUP = {"14B": "14B"}

# Operator-confirmed manual zone assignments (2026-10-06) — bypass the
# >=5-vote threshold and contested checks; always included in the output CSV.
MANUAL_OVERRIDES = {
    "سوديكو": "1",
    "مزيارة": "15",
    "زقاق بلاط": "1",
    "مونتفردي": "4",
}

JUNK_TERMS = {
    "placeholder", "test", "tests", "n a", "na", "none", "null", "unknown",
    "غير", "غير محدد", "مجهول", "awbs", "awb", "jett", "jett delivery",
    "pickup", "branch", "office", "warehouse", "store",
}


def normalize(s: str) -> str:
    """Mirror of lib/addressNormalizer.ts normalizeAddress()."""
    ar_map = {
        "\u0623": "\u0627", "\u0625": "\u0627", "\u0622": "\u0627",
        "\u0649": "\u064A", "\u0629": "\u0647",
    }
    s = s.strip().lower()
    s = "".join(ar_map.get(ch, ch) for ch in s)
    s = re.sub(r"[^\w\s\u0600-\u06FF]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def clean_zone(z: str) -> str:
    z = (z or "").strip().upper()
    return ZONE_FIXUP.get(z, z)


def is_junk(norm_addr: str) -> bool:
    if len(norm_addr) < 3:
        return True
    if norm_addr in JUNK_TERMS:
        return True
    # pure digits / phone-like / postal-code-like
    compact = norm_addr.replace(" ", "")
    if compact.isdigit():
        return True
    # mostly digits (street numbers + fragments)
    digit_ratio = sum(c.isdigit() for c in compact) / max(1, len(compact))
    if digit_ratio > 0.6:
        return True
    # single repeated char
    if len(set(compact)) <= 1:
        return True
    return False


class UnionFind:
    def __init__(self, keys):
        self.parent = {k: k for k in keys}

    def find(self, x):
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[rb] = ra


def sim(a: str, b: str) -> float:
    if abs(len(a) - len(b)) > max(2, 0.25 * max(len(a), len(b))):
        return 0.0
    sm = SequenceMatcher(None, a, b)
    if sm.quick_ratio() < SIM_THRESHOLD:
        return 0.0
    return sm.ratio()


def main():
    # ── 1. Aggregate raw votes per normalized address ────────────────────────
    votes = defaultdict(Counter)          # norm → Counter(zone)
    raw_forms = defaultdict(Counter)      # norm → Counter(raw address)
    skipped = Counter()

    with open(IN_FILE, encoding="utf-8") as f:
        for line in f:
            r = json.loads(line)
            raw_addr = (r.get("address") or "").strip()
            zone = clean_zone(r.get("zone") or "")
            if not raw_addr:
                skipped["empty address"] += 1
                continue
            if not zone:
                skipped["empty zone"] += 1
                continue
            if zone == "99":
                skipped["zone 99 (fallback)"] += 1
                continue
            if zone not in ALLOWED_ZONES:
                skipped[f"zone not on site: {zone}"] += 1
                continue
            norm = normalize(raw_addr)
            if is_junk(norm):
                skipped["junk address"] += 1
                continue
            votes[norm][zone] += 1
            raw_forms[norm][raw_addr] += 1

    print(f"distinct normalized addresses: {len(votes)}")
    for k, c in skipped.most_common():
        print(f"  skipped {k}: {c}")

    # ── 2. Candidate set: >= MIN_VOTES total, then cluster variants ──────────
    candidates = [n for n, c in votes.items() if sum(c.values()) >= MIN_VOTES]
    print(f"candidates with >= {MIN_VOTES} votes: {len(candidates)}")

    # bucket by first 3 chars (and article-stripped variant) to keep pairwise
    # comparisons tractable while still merging "el dahye" with "dahye"
    def strip_articles(s: str) -> str:
        for art in ("el ", "al ", "baal "), :
            if s.startswith(art):
                return s[len(art):]
        return s

    buckets = defaultdict(list)
    for n in candidates:
        keys = {n[:3]}
        s = strip_articles(n)
        if len(s) >= 3:
            keys.add(s[:3])
        for k in keys:
            buckets[k].append(n)

    uf = UnionFind(candidates)
    for bucket in buckets.values():
        bucket.sort(key=len)
        for i in range(len(bucket)):
            a = bucket[i]
            maxdiff = max(2, int(0.25 * len(a)))
            for j in range(i + 1, len(bucket)):
                b = bucket[j]
                if len(b) - len(a) > maxdiff:
                    break
                if sim(a, b) >= SIM_THRESHOLD:
                    uf.union(a, b)

    clusters = defaultdict(list)
    for n in candidates:
        clusters[uf.find(n)].append(n)
    print(f"clusters after variant merge: {len(clusters)}")

    # ── 3. Aggregate cluster votes, pick winner ──────────────────────────────
    results = []
    merged_count = 0
    for members in clusters.values():
        total = Counter()
        for m in members:
            total.update(votes[m])
        if not total:
            continue
        winner, wcount = total.most_common(1)[0]
        runner = total.most_common(2)[1][1] if len(total) > 1 else 0
        if wcount < MIN_VOTES:
            continue
        # representative = most frequent raw form among members
        rep_raw, _ = max(
            ((raw, c) for m in members for raw, c in raw_forms[m].items()),
            key=lambda t: t[1],
        )
        contested = runner >= 0.4 * wcount
        results.append({
            "raw": rep_raw,
            "norm": min(members, key=len),
            "zone": winner,
            "votes": wcount,
            "total": sum(total.values()),
            "contested": contested,
            "breakdown": ";".join(f"{z}:{c}" for z, c in total.most_common()),
            "variants": len(members),
        })
        if len(members) > 1:
            merged_count += 1

    # ── 3b. Apply operator-confirmed manual assignments ──────────────────────
    manual_norms = {normalize(k) for k in MANUAL_OVERRIDES}
    results = [r for r in results if r["norm"] not in manual_norms]
    for raw, zone in MANUAL_OVERRIDES.items():
        results.append({
            "raw": raw,
            "norm": normalize(raw),
            "zone": zone,
            "votes": 0,
            "total": 0,
            "contested": False,
            "breakdown": "manual",
            "variants": 1,
        })

    results.sort(key=lambda r: (-r["votes"], r["norm"]))
    accepted = [r for r in results if not r["contested"]]
    contested = [r for r in results if r["contested"]]
    print(f"merged variant groups: {merged_count}")
    print(f"accepted (clear winner >= {MIN_VOTES}): {len(accepted)}")
    print(f"contested (flagged, excluded from main CSV): {len(contested)}")

    # ── 4. Write outputs ─────────────────────────────────────────────────────
    with open(OUT_CSV, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["City", "Zone"])
        for r in accepted:
            w.writerow([r["raw"], r["zone"]])

    with open(OUT_AUDIT, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["address", "normalized", "zone", "zone_votes", "total_votes",
                    "contested", "variant_count", "zone_breakdown"])
        for r in results:
            w.writerow([r["raw"], r["norm"], r["zone"], r["votes"], r["total"],
                        "yes" if r["contested"] else "no", r["variants"],
                        r["breakdown"]])

    print(f"wrote {OUT_CSV} ({len(accepted)} rows) and {OUT_AUDIT} ({len(results)} rows)")

    # zone distribution of accepted mappings
    zc = Counter(r["zone"] for r in accepted)
    print("accepted mappings per zone:", dict(sorted(zc.items(), key=lambda t: int(t[0]) if t[0].isdigit() else 999)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
