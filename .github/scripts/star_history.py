#!/usr/bin/env python3
"""Render this repo's star history as an SVG, using only the GitHub API and the stdlib.

Usage: star_history.py OWNER/REPO OUTPUT.svg   (reads GITHUB_TOKEN or GH_TOKEN if set)
"""
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone

W, H = 800, 400
PAD_L, PAD_R, PAD_T, PAD_B = 56, 32, 48, 44


def api(path, accept="application/vnd.github+json"):
    req = urllib.request.Request(
        f"https://api.github.com/{path}", headers={"Accept": accept, "User-Agent": "star-history-script"}
    )
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req) as r:
        return json.load(r)


def parse(ts):
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def fetch_created(repo):
    return parse(api(f"repos/{repo}")["created_at"])


def fetch_star_dates(repo):
    dates, page = [], 1
    while True:
        batch = api(f"repos/{repo}/stargazers?per_page=100&page={page}", "application/vnd.github.star+json")
        if not batch:
            break
        dates += [parse(s["starred_at"]) for s in batch]
        if len(batch) < 100:
            break
        page += 1
    return sorted(dates)


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def render(repo, created, dates):
    now = datetime.now(timezone.utc)
    pw, ph = W - PAD_L - PAD_R, H - PAD_T - PAD_B
    start = min([created] + dates)
    span = max((now - start).total_seconds(), 86400)
    top = max(len(dates), 1)
    # round the y-axis max up to a tidy number
    step = 1
    for s in (1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000):
        step = s
        if top / s <= 5:
            break
    ymax = -(-top // step) * step

    def x(t):
        return PAD_L + (t - start).total_seconds() / span * pw

    def y(n):
        return PAD_T + ph - n / ymax * ph

    pts = [(x(start), y(0))]
    for i, d in enumerate(dates, 1):
        pts.append((x(d), pts[-1][1]))  # step chart: hold, then rise
        pts.append((x(d), y(i)))
    pts.append((x(now), y(len(dates))))
    line = " ".join(f"{a:.1f},{b:.1f}" for a, b in pts)
    area = f"{PAD_L:.1f},{y(0):.1f} {line} {x(now):.1f},{y(0):.1f}"

    grid = []
    for v in range(0, ymax + 1, step):
        grid.append(f'<line class="grid" x1="{PAD_L}" x2="{W-PAD_R}" y1="{y(v):.1f}" y2="{y(v):.1f}"/>')
        grid.append(f'<text class="lbl" x="{PAD_L-8}" y="{y(v)+4:.1f}" text-anchor="end">{v}</text>')
    for frac, anchor in ((0, "start"), (0.5, "middle"), (1, "end")):
        t = datetime.fromtimestamp(start.timestamp() + span * frac, timezone.utc)
        grid.append(f'<text class="lbl" x="{PAD_L+pw*frac:.1f}" y="{H-PAD_B+20}" text-anchor="{anchor}">{t:%b %Y}</text>')

    note = "" if dates else f'<text class="lbl" x="{PAD_L+pw/2}" y="{PAD_T+ph/2}" text-anchor="middle">No stars yet</text>'
    total = f"{len(dates)} star" + ("" if len(dates) == 1 else "s")
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" role="img" aria-label="Star history for {esc(repo)}: {total}">
<style>
  text {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; fill: #848d97; }}
  .title {{ font-size: 16px; font-weight: 600; }}
  .lbl {{ font-size: 12px; }}
  .grid {{ stroke: #848d97; stroke-opacity: 0.3; stroke-width: 1; }}
  .line {{ fill: none; stroke: #3b82f6; stroke-width: 2.5; stroke-linejoin: round; }}
  .area {{ fill: #3b82f6; fill-opacity: 0.15; }}
</style>
<text class="title" x="{PAD_L}" y="28">{esc(repo)}</text>
<text class="lbl" x="{W-PAD_R}" y="28" text-anchor="end">{total} · updated {now:%d %b %Y}</text>
{''.join(grid)}
<polygon class="area" points="{area}"/>
<polyline class="line" points="{line}"/>
{note}
</svg>
"""


if __name__ == "__main__":
    repo, out = sys.argv[1], sys.argv[2]
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    svg = render(repo, fetch_created(repo), fetch_star_dates(repo))  # fetch first so a failed API call never blanks the chart
    with open(out, "w") as f:
        f.write(svg)
    print(f"wrote {out}")
