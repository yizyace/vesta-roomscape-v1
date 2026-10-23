#!/usr/bin/env python3
"""Writes data/staging.md from the layouts, the catalog and catalog/lists.json: per room, each variant's
name, pieces, extras and total; the kitchen and bathroom lists; the apartment total for the staged
layouts (variant a). Re-run after any layout or price change.

    python3 scripts/staging_report.py [--check]
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys
from collections import Counter

DATA = pathlib.Path(__file__).resolve().parent.parent / "data"
ROOM_ORDER = ["living-room", "dining-room", "master-bedroom", "back-bedroom", "maddie-room"]
APP = "https://yizyace.github.io/vesta-roomscape-v1/"


def money(x: float) -> str:
    return f"${x:,.2f}"


def load_items() -> dict[str, dict]:
    return {d["id"]: d for d in (json.loads(f.read_text()) for f in sorted((DATA / "catalog/items").glob("*.json")))}


def load_rooms() -> dict[str, dict]:
    return {r["id"]: r for r in json.loads((DATA / "rooms.json").read_text())["rooms"]}


def variants(room: str) -> list[dict]:
    d = DATA / "layouts" / room
    return [json.loads(f.read_text()) for f in sorted(d.glob("*.json"))] if d.is_dir() else []


def price(it: dict | None) -> float | None:
    return it["price"]["amount"] if it and it.get("price") else None


def link(it: dict) -> str:
    name = it["name"].split(",")[0].strip()
    return f"[{name}]({it['url']})" if it.get("url") else name


def lines_for(layout: dict, items: dict) -> tuple[list[str], float, list[str]]:
    rows, total, unpriced = [], 0.0, []
    counts = Counter(p["itemId"] for p in layout.get("placements", []))
    for item_id, n in counts.items():
        it = items.get(item_id)
        if not it:
            rows.append(f"| {item_id} (missing from the catalog) | {n} | | |"); continue
        p = price(it)
        sub = p * n if p is not None else None
        total += sub or 0
        if p is None: unpriced.append(item_id)
        rows.append(f"| {link(it)} | {n} | {money(p) if p is not None else 'no price'} | {money(sub) if sub is not None else ''} |")
    for e in layout.get("extras", []):
        it = items.get(e["itemId"]); q = e.get("qty", 1)
        if not it:
            rows.append(f"| {e['itemId']} (missing from the catalog) | {q} | | |"); continue
        p = price(it)
        sub = p * q if p is not None else None
        total += sub or 0
        if p is None: unpriced.append(e["itemId"])
        rows.append(f"| {link(it)} *(room list)* | {q} | {money(p) if p is not None else 'no price'} | {money(sub) if sub is not None else ''} |")
    return rows, total, unpriced


def list_section(title: str, spec: dict, items: dict) -> tuple[list[str], float, int]:
    """A kitchen or bathroom list from catalog/lists.json: core items with quantities, then optional ones."""
    out = [f"## {title}", "", spec.get("note", ""), "", "| Item | Qty | Each | Subtotal | Note |", "|---|---|---|---|---|"]
    core_total, optional_rows, n = 0.0, [], 0
    for e in spec["items"]:
        it = items.get(e["itemId"])
        if not it:
            out.append(f"| {e['itemId']} (missing from the catalog) | {e.get('qty', 1)} | | | |"); continue
        q, p = e.get("qty", 1), price(it)
        row = f"| {link(it)} | {q} | {money(p) if p is not None else 'no price'} | {money(p * q) if p is not None else ''} | {e.get('note', '')} |"
        if e.get("optional"):
            optional_rows.append(row)
        else:
            out.append(row); core_total += (p or 0) * q; n += 1
    out += ["", f"**Core total: {money(core_total)}**", ""]
    if optional_rows:
        out += ["Optional:", "", "| Item | Qty | Each | Subtotal | Note |", "|---|---|---|---|---|", *optional_rows, ""]
    return out, core_total, n


def build() -> str:
    items, rooms = load_items(), load_rooms()
    md: list[str] = []
    summary: list[str] = []
    grand = 0.0
    body: list[str] = []
    for rid in ROOM_ORDER:
        vs = variants(rid)
        name = rooms[rid]["name"]
        body += [f"## {name}", ""]
        if not vs:
            body += ["No layouts yet.", ""]; continue
        for lay in vs:
            rows, total, unpriced = lines_for(lay, items)
            v = lay["variant"]
            if v == "a":
                grand += total
                summary.append(f"| [{name}]({APP}#/{rid}) | {lay.get('name','')} | {len(lay.get('placements', []))} placed, {len(lay.get('extras', []))} on the list | {money(total)} |")
            body += [f"### {v.upper()} · {lay.get('name','')}" + ("  (staged)" if v == "a" else ""), "",
                     f"Open: {APP}#/{rid}/{v} · printable: {APP}#/{rid}/{v}/view", "",
                     "| Item | Qty | Each | Subtotal |", "|---|---|---|---|", *rows, "",
                     f"**Total: {money(total)}**" + (f" (not counted, no price: {', '.join(unpriced)})" if unpriced else ""), ""]
            if lay.get("notes"):
                body += ["<details><summary>Why it's laid out this way</summary>", "", lay["notes"], "", "</details>", ""]
    lists = json.loads((DATA / "catalog/lists.json").read_text())
    ksec, ktot, kn = list_section("Kitchen essentials (no layout: the kitchen isn't measured)", lists["kitchen"], items)
    bsec, btot, bn = list_section("Bathroom (no layout: not measured)", lists["bathroom"], items)
    used = {e["itemId"] for lst in lists.values() for e in lst["items"]}
    used |= {p["itemId"] for rid in ROOM_ORDER for lay in variants(rid) for p in lay.get("placements", []) + lay.get("extras", [])}
    dates = sorted({items[i]["price"]["asOf"] for i in used if i in items and items[i].get("price")})
    read_on = dates[0] if len(dates) == 1 else ", ".join(dates[:-1]) + " and " + dates[-1]
    md += ["---", 'title: "L01 staged: every room furnished"', "area: home",
           "tags: [home-furniture, home-move, home-apartment]", f'date: "{dates[-1]}"', "status: proposed",
           "related: [summary.md, rules.md, measurements.md]", "---", "",
           "# L01 staged: every room furnished", "",
           "Generated by `staging_report.py` from `layouts/` and `catalog/items/`; re-run it after any change. "
           f"Every room but the kitchen has a staged layout (**A**) and alternatives (**B**, **C**, **D**); open them in the planner ({APP}) "
           f"and switch with the letters in the toolbar. Prices are IKEA US / Amazon list prices as read on {read_on}, "
           "each item's own date in its catalog file (rules.md F-02); nothing has been bought.", "",
           "## The staged apartment (layout A in every room)", "", "| Room | Staged layout | Pieces | Total |", "|---|---|---|---|",
           *summary,
           f"| Kitchen essentials | list | {kn} core items | {money(ktot)} |",
           f"| Bathroom | list | {bn} core items | {money(btot)} |",
           f"| **Apartment** | | | **{money(grand + ktot + btot)}** |", ""]
    md += body + ksec + bsec
    return "\n".join(md).rstrip() + "\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="exit 1 if staging.md is out of date instead of writing it")
    opts = ap.parse_args(argv)
    text = build()
    out = DATA / "staging.md"
    if opts.check:
        current = out.read_text() if out.exists() else ""
        if current != text:
            print("staging.md is out of date; run python3 scripts/staging_report.py", file=sys.stderr)
            return 1
        return 0
    out.write_text(text)
    print(out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
