"""
GranolaQuest Store Data Updater
================================
Updates March2026FullStore.json from a SPINS export.

Actions:
  - Updates UPCs for existing stores matched in SPINS (exact or prefix name match)
  - Removes orphaned stores (not in SPINS, not a hardcoded chain, not Albertsons family)
  - Geocodes new SPINS stores via Mapbox and adds them to the JSON
  - Keeps hardcoded big chains (Walmart, Kroger, etc.), Target, and Albertsons
    Companies family (Safeway, Vons, Jewel-Osco, etc.) completely untouched

Usage:
  python3 update_stores.py --spins /path/to/spins.xlsx
  python3 update_stores.py --spins /path/to/spins.xlsx --output new_stores.json
  python3 update_stores.py --spins /path/to/spins.xlsx --dry-run
"""

import argparse, json, os, time, urllib.parse, sys
from collections import defaultdict
from pathlib import Path

import openpyxl
import requests

# ── Config ────────────────────────────────────────────────────────────────────

STORE_JSON   = Path(__file__).parent / "March2026FullStore.json"
# Set MAPBOX_TOKEN env var or pass --mapbox-token argument
MAPBOX_TOKEN = os.environ.get("MAPBOX_TOKEN", "")

# Retailer logo URLs for new stores (add more as needed)
LOGO_URLS = {
    "default": "https://raw.githubusercontent.com/cookie8monster/GranolaQuest/main/Purely%20Elizabeth.png",
}

# Chains to treat as Albertsons Companies — keep regardless of SPINS
ALBERTSONS_PREFIXES = [
    "Jewel-Osco", "Safeway", "Vons", "Albertsons -", "Tom Thumb",
    "Randalls", "Acme -", "Carrs -", "Star -",
]

# Big hardcoded chains: retailer name used for 50+ stores → keep untouched
HARDCODED_MIN_STORES = 50


# ── SPINS loader ──────────────────────────────────────────────────────────────

def load_spins(filepath):
    """
    Returns:
      spins_by_name  : {store_name: {upcs, address, zip, city, state}}
      spins_name_set : set of all store names (for fast lookup)
    """
    wb = openpyxl.load_workbook(filepath, data_only=True)
    ws = wb.active
    spins = defaultdict(lambda: {
        "upcs": set(), "address": "", "zip": "", "city": "", "state": ""
    })
    for row in ws.iter_rows(min_row=2, values_only=True):
        name    = str(row[2]  or "").strip()
        upc_ean = str(row[16] or "").strip().lstrip("0")   # EAN13 → 12-digit UPC
        address = str(row[12] or "").strip()
        zip_    = str(row[13] or "").strip()
        state   = str(row[14] or "").strip()
        city    = str(row[19] or "").strip()
        if not name:
            continue
        spins[name]["upcs"].add(upc_ean)
        if not spins[name]["address"]:
            spins[name]["address"] = address
            spins[name]["zip"]     = zip_
            spins[name]["city"]    = city
            spins[name]["state"]   = state
    return dict(spins), set(spins.keys())


# ── Classifier ────────────────────────────────────────────────────────────────

def build_classifier(store_data, spins_name_set):
    """
    Returns:
      hardcoded_retailers : set of retailer names with 50+ stores (big chains)
      prefix_map          : {json_retailer → set of SPINS store names that start with it}
    """
    # Count stores per retailer name
    retailer_counts = defaultdict(int)
    for s in store_data:
        retailer_counts[s["retailer"]] += 1
    hardcoded = {r for r, c in retailer_counts.items() if c >= HARDCODED_MIN_STORES}

    # Build prefix map: for each JSON retailer, find SPINS stores that start with it
    prefix_map = defaultdict(set)
    for r in retailer_counts:
        if r in hardcoded or r.startswith("Target"):
            continue
        if any(r.startswith(p) for p in ALBERTSONS_PREFIXES):
            continue
        r_clean = r.lower().replace("'", "").strip()
        if len(r_clean) < 7:
            continue
        for s in spins_name_set:
            if s.lower().replace("'", "").startswith(r_clean[:12]):
                prefix_map[r].add(s)

    return hardcoded, dict(prefix_map)


def classify_store(retailer, hardcoded, spins_name_set, prefix_map):
    if retailer in hardcoded:             return "HARDCODED"
    if retailer.startswith("Target"):     return "TARGET"
    if any(retailer.startswith(p) for p in ALBERTSONS_PREFIXES): return "ALBERTSONS"
    if retailer in spins_name_set:        return "SPINS_EXACT"
    if retailer in prefix_map:            return "SPINS_PREFIX"
    return "REMOVE"


# ── Geocoder ──────────────────────────────────────────────────────────────────

def geocode_mapbox(address, city, state, zip_code, retries=2):
    query = f"{address}, {city}, {state} {zip_code}"
    url   = f"https://api.mapbox.com/geocoding/v5/mapbox.places/{urllib.parse.quote(query)}.json"
    for attempt in range(retries + 1):
        try:
            r = requests.get(url, params={
                "access_token": MAPBOX_TOKEN, "limit": 1, "country": "us"
            }, timeout=10)
            features = r.json().get("features", [])
            if features:
                lon, lat = features[0]["center"]
                return round(lat, 6), round(lon, 6)
        except Exception as e:
            if attempt == retries:
                print(f"    [geocode fail] {query}: {e}")
        time.sleep(0.15)   # ~6-7 req/sec — well within Mapbox free tier
    return None, None


# ── UPC helpers ───────────────────────────────────────────────────────────────

def upcs_to_list(upc_set):
    """Store UPCs as the existing format: array with one comma-separated string."""
    return [", ".join(sorted(upc_set))]


def parse_existing_upcs(store):
    upcs = set()
    for upc_str in store.get("available_upcs", []):
        for u in str(upc_str).split(","):
            u = u.strip()
            if u:
                upcs.add(u)
    return upcs


# ── Main ──────────────────────────────────────────────────────────────────────

def run(spins_path, output_path, dry_run=False):
    print(f"\nGranolaQuest Store Updater")
    print(f"  SPINS file : {spins_path}")
    print(f"  Store JSON : {STORE_JSON}")
    print(f"  Output     : {output_path}")
    print(f"  Dry run    : {dry_run}\n")

    # Load data
    print("Loading SPINS data...", end=" ", flush=True)
    spins_by_name, spins_name_set = load_spins(spins_path)
    print(f"{len(spins_by_name)} stores")

    print("Loading store JSON...", end=" ", flush=True)
    with open(STORE_JSON) as f:
        store_data = json.load(f)
    print(f"{len(store_data)} stores")

    # Build classifier
    hardcoded, prefix_map = build_classifier(store_data, spins_name_set)
    print(f"\nChain breakdown:")
    print(f"  Hardcoded big chains (kept):     {len(hardcoded)} chains")
    print(f"  Prefix-matched to SPINS:         {len(prefix_map)} chains")

    # Build a union of UPCs per prefix group (all SPINS stores that match the chain)
    prefix_upcs = {}
    for retailer, spins_names in prefix_map.items():
        union_upcs = set()
        for s in spins_names:
            union_upcs |= spins_by_name[s]["upcs"]
        prefix_upcs[retailer] = union_upcs

    # Process existing stores
    kept_stores   = []
    removed_count = 0
    updated_count = 0
    json_retailers = {s["retailer"] for s in store_data}

    for store in store_data:
        r    = store["retailer"]
        cat  = classify_store(r, hardcoded, spins_name_set, prefix_map)

        if cat == "REMOVE":
            removed_count += 1
            continue

        if cat == "SPINS_EXACT":
            new_upcs = spins_by_name[r]["upcs"]
            old_upcs = parse_existing_upcs(store)
            if new_upcs != old_upcs:
                store = dict(store)
                store["available_upcs"] = upcs_to_list(new_upcs)
                updated_count += 1

        elif cat == "SPINS_PREFIX":
            new_upcs = prefix_upcs[r]
            old_upcs = parse_existing_upcs(store)
            if new_upcs != old_upcs:
                store = dict(store)
                store["available_upcs"] = upcs_to_list(new_upcs)
                updated_count += 1

        kept_stores.append(store)

    print(f"\nExisting stores:")
    print(f"  Kept (no change):  {len(kept_stores) - updated_count}")
    print(f"  Updated UPCs:      {updated_count}")
    print(f"  Removed (orphan):  {removed_count}")

    # Find new SPINS stores not already in JSON
    new_spins_names = [
        name for name in spins_name_set
        if name not in json_retailers
        and not any(name.lower().replace("'","").startswith(
            r.lower().replace("'","")[:12]
        ) for r in json_retailers if len(r) > 6)
    ]
    print(f"\nNew SPINS stores to geocode & add: {len(new_spins_names)}")

    if dry_run:
        print("\n[DRY RUN] No files written.")
        print(f"Final store count would be: {len(kept_stores) + len(new_spins_names)}")
        return

    # Geocode new stores
    new_stores = []
    print("\nGeocoding new stores via Mapbox...")
    no_geo = 0
    for i, name in enumerate(new_spins_names):
        v = spins_by_name[name]
        lat, lon = geocode_mapbox(v["address"], v["city"], v["state"], v["zip"])
        if lat is None:
            no_geo += 1
            continue
        new_stores.append({
            "store_id":          f"spins_{i}",
            "retailer":          name,
            "name":              name,
            "address":           f"{v['address']}, {v['city']}, {v['state']} {v['zip']}",
            "latitude":          lat,
            "longitude":         lon,
            "phone":             "",
            "zip_code":          v["zip"],
            "logo_url":          LOGO_URLS.get("default"),
            "available_upcs":    upcs_to_list(v["upcs"]),
            "available_upc_names": [],
        })
        if (i + 1) % 100 == 0:
            print(f"  {i+1}/{len(new_spins_names)} geocoded ({no_geo} failed)...")

    print(f"  Done. {len(new_stores)} geocoded, {no_geo} failed (no address match)")

    # Write output
    final = kept_stores + new_stores
    with open(output_path, "w") as f:
        json.dump(final, f, indent=4)

    print(f"\nWrote {len(final)} stores to {output_path}")
    print(f"  Before: {len(store_data)}")
    print(f"  After:  {len(final)} ({len(new_stores)} added, {removed_count} removed)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--spins",         required=True, help="Path to SPINS .xlsx export")
    parser.add_argument("--output",        default=str(Path(__file__).parent / "March2026FullStore.json"),
                        help="Output JSON path (default: overwrites existing)")
    parser.add_argument("--mapbox-token",  default="", help="Mapbox public token (or set MAPBOX_TOKEN env var)")
    parser.add_argument("--dry-run",       action="store_true", help="Show counts without writing files")
    args = parser.parse_args()
    if args.mapbox_token:
        MAPBOX_TOKEN = args.mapbox_token
    if not MAPBOX_TOKEN and not args.dry_run:
        print("Error: Mapbox token required. Set MAPBOX_TOKEN env var or pass --mapbox-token")
        sys.exit(1)
    run(args.spins, args.output, args.dry_run)
