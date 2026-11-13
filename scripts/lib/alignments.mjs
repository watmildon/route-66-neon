// Which former US 66 alignments the map adds to the Historic Route 66 relations.
// Used by scripts/fetch-route.mjs.

// Route relations that follow former US 66 but aren't part of the Historic
// Route 66 relations. Labels and notes are what the map shows on hover.
// See corridor-candidates.md for how these were chosen.
export const EXTRA_RELATIONS = {
  181740: { label: "Missouri Route 366", note: "Chippewa St and Watson Rd in St. Louis, a former US 66 alignment." },
  69454: { label: "Missouri Route 66", note: "Missouri's state Route 66, on old US 66 around Joplin." },
  1796821: { label: "Kansas K-66", note: "Old US 66 through Galena, Riverton and Baxter Springs." },
  7507551: { label: "Oklahoma State Highway 66", note: "Created in 1985 on US 66's last alignment before it was decommissioned." },
  7507587: { label: "Oklahoma State Highway 66", note: "Created in 1985 on US 66's last alignment before it was decommissioned." },
  3546777: { label: "Oklahoma State Highway 66B", note: "The loop through Wellston, on the old route through town." },
  1493244: { label: "Arizona State Route 66", note: "Old US 66 between Kingman and Seligman, by way of Peach Springs." },
  6785046: { label: "Old US 66 (Arizona)", note: "Mapped in OSM as an Old US 66 route." },
  20030979: { label: "Old Highway 66 (California)", note: "Mapped in OSM as an Old US 66 route." },
  2119804: { label: "California State Route 66", note: "Foothill Blvd in the Inland Empire, old US 66." },
  2862619: { label: "US 66 / US 99, 1926–1934", note: "US 66's first route into Los Angeles, through Pasadena, shared with US 99." },
};

/**
 * Is this old_ref value a former US 66? Accepts "US 66", "U.S. 66", "Route 66",
 * "AZ 66", "CA 66", a bare "66", and lists like "US 66;US 99". Leaves out
 * Colorado's CO 66, Nevada's SR 66 (Lovelock) and the US 666 entry north of
 * Gallup, which are other roads that happen to match.
 */
export function isFormerUS66(v) {
  if (!v) return false;
  if (/\bCO 66\b|^SR 66$|^US 666 \(old US 66/.test(v)) return false;
  return /(^|[;(\s])((US|U\.S\.|AZ|CA|RT|Route)[ -]?)?66(?![0-9])/i.test(v) || /original us 66/i.test(v);
}
