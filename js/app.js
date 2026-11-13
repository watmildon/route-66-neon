import { aimPano, withCenter } from "./aim.js";
import { commons, hasPhoto, imageSources } from "./images.js";
import { neonColour, signTitle } from "./signs.js";
import { MAPILLARY_CLIENT_TOKEN } from "./config.js";

const BASEMAP = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const ROUTE_BOUNDS = [[-118.7, 33.8], [-87.4, 42.1]];

const $ = (sel) => document.querySelector(sel);
const isPhone = () => window.matchMedia("(max-width: 720px)").matches;
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const state = {
  signs: [], // all signs, ordered east → west (Chicago → Santa Monica)
  visible: [], // after the text filter
  byKey: new Map(),
  selected: null,
  photoIndex: 0,
  photoExpanded: false, // survives stepping between signs
  renderToken: 0,
};

// ------------------------------------------------------------------- map --

const map = new maplibregl.Map({
  container: "map",
  style: BASEMAP,
  bounds: ROUTE_BOUNDS,
  fitBoundsOptions: { padding: mapPadding() },
  attributionControl: false,
  dragRotate: false,
});
map.touchZoomRotate.disableRotation();
const ctrlCorner = isPhone() ? "bottom-right" : "top-right";
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), ctrlCorner);
map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: false } }), ctrlCorner);

// The ⓘ control carries the credits plus the data date, so it's added once the
// data has loaded (customAttribution is fixed at construction).
function addInfoControl(osmBase) {
  const d = osmBase ? new Date(osmBase) : null;
  const date = d && !Number.isNaN(d.getTime())
    ? `OSM data as of ${d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}`
    : null;
  map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: date || undefined }), "bottom-right");
}

// Initial fit: keep the route clear of the sidebar.
function mapPadding() {
  if (isPhone()) return { top: 80, left: 20, right: 20, bottom: 20 };
  return { top: 40, bottom: 40, left: 310 + 40, right: 40 };
}

// ------------------------------------------------------------------ data --

const EMPTY_FC = { type: "FeatureCollection", features: [] };

async function getJson(url) {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

async function boot() {
  try {
    const [[signsFc, routeFc, alignFc]] = await Promise.all([
      Promise.all([
        getJson("data/signs.geojson"),
        getJson("data/route66.geojson"),
        // Optional: the map still works with the main line alone.
        getJson("data/alignments.geojson").catch((e) => (console.warn(e), EMPTY_FC)),
      ]),
      new Promise((resolve) => (map.loaded() ? resolve() : map.once("load", resolve))),
    ]);
    init(signsFc, routeFc, alignFc);
  } catch (e) {
    console.error(e);
    addInfoControl(null);
    $("#sign-list").innerHTML =
      `<li class="empty">Couldn't load the sign data. If you opened the file directly, serve the folder over HTTP instead.</li>`;
  }
}

function init(signsFc, routeFc, alignFc) {
  state.signs = signsFc.features
    .map((f) => {
      const { osm_type: type, osm_id: id, tags = {}, mapillary = {}, wiki = [] } = f.properties;
      const photos = imageSources(tags);
      return {
        key: `${type}/${id}`,
        type,
        id,
        tags,
        mlyViews: mapillary, // image id → { lon, lat, compass, pano, captured }
        wiki, // [{ qid, label, description, wikipedia, image, source, source_name }]
        coord: f.geometry.coordinates,
        color: neonColour(tags),
        title: signTitle(tags),
        photos,
        hasPhoto: hasPhoto(photos),
        search: [tags.inscription, tags.name, tags.brand, tags.operator, tags["addr:city"], tags.description, ...wiki.map((w) => w.label)]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(),
      };
    })
    // Route 66 runs almost monotonically east → west, so longitude is a good
    // stand-in for "order along the drive".
    .sort((a, b) => b.coord[0] - a.coord[0]);
  for (const s of state.signs) state.byKey.set(s.key, s);
  state.visible = state.signs;

  addLayers(routeFc, alignFc);
  addInfoControl(signsFc.osm_base);
  renderList();
  wireEvents();

  if (isPhone()) setSidebarCollapsed(true);
  selectFromHash({ animate: false });
}

function addLayers(routeFc, alignFc) {
  map.addSource("route", { type: "geojson", data: routeFc });
  map.addSource("alignments", { type: "geojson", data: alignFc });
  map.addSource("signs", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: state.signs.map((s) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: s.coord },
        properties: { key: s.key, color: s.color },
      })),
    },
  });

  // Find the first symbol layer so our overlays sit under the basemap labels.
  const firstLabel = map.getStyle().layers.find((l) => l.type === "symbol")?.id;

  // Other former US 66 alignments: dimmer and dashed, under the main line.
  map.addLayer(
    {
      id: "alt-glow",
      type: "line",
      source: "alignments",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": "#ff9d2e",
        "line-width": ["interpolate", ["linear"], ["zoom"], 3, 3, 10, 8, 16, 12],
        "line-blur": ["interpolate", ["linear"], ["zoom"], 3, 3, 10, 6],
        "line-opacity": 0.16,
      },
    },
    firstLabel
  );
  map.addLayer(
    {
      id: "alt-core",
      type: "line",
      source: "alignments",
      layout: { "line-join": "round" },
      paint: {
        "line-color": "#ffc46b",
        "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.8, 10, 1.8, 16, 3],
        "line-dasharray": [2, 1.5],
        "line-opacity": 0.7,
      },
    },
    firstLabel
  );

  map.addLayer(
    {
      id: "route-glow",
      type: "line",
      source: "route",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": "#ff9d2e",
        "line-width": ["interpolate", ["linear"], ["zoom"], 3, 5, 10, 12, 16, 18],
        "line-blur": ["interpolate", ["linear"], ["zoom"], 3, 4, 10, 9],
        "line-opacity": 0.32,
      },
    },
    firstLabel
  );
  map.addLayer(
    {
      id: "route-core",
      type: "line",
      source: "route",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": "#ffc46b",
        "line-width": ["interpolate", ["linear"], ["zoom"], 3, 1, 10, 2.2, 16, 3.5],
        "line-opacity": 0.85,
      },
    },
    firstLabel
  );
  // Wide invisible lines so the route is easy to hover.
  for (const [id, source] of [["alt-hit", "alignments"], ["route-hit", "route"]]) {
    map.addLayer(
      { id, type: "line", source, paint: { "line-color": "#000", "line-width": 12, "line-opacity": 0 } },
      firstLabel
    );
  }

  map.addLayer({
    id: "sign-halo",
    type: "circle",
    source: "signs",
    paint: {
      "circle-color": ["get", "color"],
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 9, 8, 15, 14, 26, 18, 34],
      "circle-blur": 0.85,
      "circle-opacity": 0.6,
    },
  });
  map.addLayer({
    id: "sign-core",
    type: "circle",
    source: "signs",
    paint: {
      "circle-color": ["get", "color"],
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 3, 8, 4.5, 14, 7, 18, 9],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 3, 1, 14, 2],
      "circle-stroke-opacity": 0.9,
    },
  });
  map.addLayer({
    id: "sign-selected",
    type: "circle",
    source: "signs",
    filter: ["==", ["get", "key"], ""],
    paint: {
      "circle-color": "rgba(0,0,0,0)",
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 10, 14, 17, 18, 22],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2.5,
    },
  });
}

// ------------------------------------------------------------- sidebar --

function renderList() {
  const list = $("#sign-list");
  const total = state.signs.length;
  const shown = state.visible.length;
  $("#sign-count").textContent =
    ` · ${shown === total ? total : `${shown} of ${total}`} sign${total === 1 ? "" : "s"}`;
  if (!state.visible.length) {
    list.innerHTML = `<li class="empty">No signs match.</li>`;
    return;
  }
  list.innerHTML = state.visible
    .map(
      (s) => `<li><button type="button" data-key="${esc(s.key)}" ${s.key === state.selected?.key ? 'aria-current="true"' : ""}>
        <span class="dot" style="--c:${s.color}"></span>
        <span class="t">${esc(s.title)}</span>
        ${s.wiki.length ? `<span class="wbadge" title="Has a Wikipedia or Wikidata link" aria-label="Has a Wikipedia or Wikidata link">W</span>` : ""}
        ${s.hasPhoto ? `<span class="cam" title="Has a photo" aria-label="Has a photo">${cameraIcon()}</span>` : ""}
      </button></li>`
    )
    .join("");
}

function applyFilter(text) {
  const q = text.trim().toLowerCase();
  state.visible = q ? state.signs.filter((s) => s.search.includes(q)) : state.signs;
  const keys = state.visible.map((s) => s.key);
  const filter = q ? ["in", ["get", "key"], ["literal", keys]] : null;
  map.setFilter("sign-halo", filter);
  map.setFilter("sign-core", filter);
  renderList();
  if (state.selected) renderStepper(state.selected);
}

function setSidebarCollapsed(collapsed) {
  $("#sidebar").classList.toggle("collapsed", collapsed);
  const btn = $("#sidebar-toggle");
  btn.setAttribute("aria-expanded", String(!collapsed));
  btn.title = collapsed ? "Show the list" : "Hide the list";
  btn.setAttribute("aria-label", btn.title);
}

// ------------------------------------------------------------ selection --

function select(key, { fly = true, animate = true } = {}) {
  const s = state.byKey.get(key);
  if (!s) return;
  const changed = state.selected?.key !== key;
  state.selected = s;
  if (changed) state.photoIndex = 0;

  map.setFilter("sign-selected", ["==", ["get", "key"], key]);
  document.body.classList.add("detail-open");
  renderDetail(s);

  for (const b of document.querySelectorAll("#sign-list button")) {
    if (b.dataset.key === key) {
      b.setAttribute("aria-current", "true");
      b.scrollIntoView({ block: "nearest" });
    } else {
      b.removeAttribute("aria-current");
    }
  }
  // Arrow keys step between signs while the panel is open, so the map
  // shouldn't also pan on them.
  map.keyboard.disable();

  if (location.hash !== `#${key}`) history.replaceState(null, "", `#${key}`);
  if (isPhone()) {
    setSidebarCollapsed(true);
    // The open ⓘ credits would sit over the sign above the bottom sheet;
    // fold them back to the button (MapLibre's own toggle).
    document.querySelector(".maplibregl-ctrl-attrib.maplibregl-compact-show .maplibregl-ctrl-attrib-button")?.click();
  }

  if (fly) {
    // `offset` (unlike `padding`) doesn't persist, so closing the panel later
    // doesn't shift the map.
    const opts = { center: s.coord, zoom: Math.max(map.getZoom(), 16), offset: detailOffset() };
    if (animate) {
      map.flyTo({ ...opts, speed: 1.6 });
    } else {
      map.jumpTo({ center: s.coord, zoom: opts.zoom });
      map.panBy([-opts.offset[0], -opts.offset[1]], { duration: 0 });
    }
  }
}

/** Pixel offset that centres a sign in the part of the map not hidden by panels. */
function detailOffset() {
  const r = $("#sidebar").getBoundingClientRect();
  if (isPhone()) {
    const top = $("#sidebar").offsetParent ? r.bottom : 0;
    const bottom = window.innerHeight * 0.62;
    return [0, (top - bottom) / 2];
  }
  const left = r.right;
  const right = window.innerWidth - $("#detail").getBoundingClientRect().left;
  return [(left - right) / 2, 0];
}

function closeDetail() {
  if (!state.selected) return;
  state.selected = null;
  state.renderToken++;
  const panel = $("#detail");
  panel.hidden = true;
  panel.innerHTML = "";
  document.body.classList.remove("detail-open", "photo-expanded");
  state.photoExpanded = false;
  map.keyboard.enable();
  map.setFilter("sign-selected", ["==", ["get", "key"], ""]);
  for (const b of document.querySelectorAll("#sign-list button[aria-current]")) b.removeAttribute("aria-current");
  history.replaceState(null, "", location.pathname + location.search);
}

function step(dir) {
  if (!state.selected) return;
  const list = state.visible.length ? state.visible : state.signs;
  const i = list.findIndex((s) => s.key === state.selected.key);
  const next = list[i === -1 ? 0 : i + dir];
  if (next) select(next.key);
}

function selectFromHash(opts) {
  const m = /^#((?:node|way|relation)\/\d+)$/.exec(location.hash);
  if (m && state.byKey.has(m[1])) select(m[1], opts);
}

// --------------------------------------------------------------- detail --

const FACTS = [
  ["message", "Purpose"],
  ["support", "Mounted on"],
  ["location", "Position"],
  ["colour", "Colour"],
  ["animated", "Animated"],
  ["lit", "Externally lit"],
  ["sides", "Sides"],
  ["brand", "Brand"],
  ["operator", "Operator"],
  ["start_date", "Since"],
  ["description", "About"],
];

const human = (v) => String(v).replace(/_/g, " ").replace(/;/g, ", ");

function renderDetail(s) {
  const panel = $("#detail");
  const t = s.tags;
  const addr = [[t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" "), t["addr:city"], t["addr:state"]]
    .filter(Boolean)
    .join(", ");
  const facts = FACTS.filter(([k]) => t[k]).map(([k, label]) => `<dt>${label}</dt><dd>${esc(human(t[k]))}</dd>`);
  if (addr) facts.unshift(`<dt>Address</dt><dd>${esc(addr)}</dd>`);

  const osmUrl = `https://www.openstreetmap.org/${s.type}/${s.id}`;
  const idUrl = `https://www.openstreetmap.org/edit?editor=id&${s.type}=${s.id}`;

  panel.innerHTML = `
    <div class="detail-top">
      <h2 class="sign-title" style="--c:${s.color}">${esc(s.title)}</h2>
      <button type="button" class="icon-btn" data-action="close" aria-label="Close" title="Close (Esc)">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
    </div>
    <div class="photo-frame${state.photoExpanded ? " expanded" : ""}" id="photo-frame">
      <div class="photo-top">
        <span class="photo-top-title" style="--c:${s.color}">${esc(s.title)}</span>
        <span class="photo-top-nav" id="photo-top-nav"></span>
        <button type="button" class="icon-btn" data-action="shrink" aria-label="Shrink photo" title="Shrink (Esc)">${shrinkIcon()}</button>
      </div>
      <div class="photo-stage">
        <div class="photo" id="photo"></div>
        <button type="button" class="photo-expand" data-action="expand" aria-label="Expand photo" title="Expand photo">${expandIcon()}</button>
      </div>
      <div class="photo-foot">
        <div class="photo-meta" id="photo-meta"></div>
        <div class="photo-tabs" id="photo-tabs"></div>
      </div>
    </div>
    ${s.wiki.length ? `<section class="wiki" aria-label="About"><h3 class="section-label">About</h3>${s.wiki.map(wikiCard).join("")}</section>` : ""}
    ${facts.length ? `<dl class="facts">${facts.join("")}</dl>` : ""}
    <h3 class="section-label">Open in</h3>
    <div class="open-in" role="group" aria-label="View or edit this sign">
      <a class="tool-btn" href="${osmUrl}" target="_blank" rel="noopener" title="View on OpenStreetMap" aria-label="View on OpenStreetMap">${OSM_LOGO}</a>
      <a class="tool-btn" href="${idUrl}" target="_blank" rel="noopener" title="Edit in iD" aria-label="Edit in iD"><img class="invert" src="img/editors/id.png" alt=""></a>
      <a class="tool-btn" href="${rapidUrl(s)}" target="_blank" rel="noopener" title="Edit in Rapid" aria-label="Edit in Rapid">${RAPID_LOGO}</a>
      <button class="tool-btn" type="button" data-action="josm" title="Edit in JOSM (needs JOSM running with Remote Control on)" aria-label="Edit in JOSM"><img src="img/editors/josm.png" alt=""></button>
    </div>
    <p class="josm-status" id="josm-status" role="status" aria-live="polite"></p>
    <details class="all-tags">
      <summary>All tags</summary>
      <table>${Object.entries(t)
        .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`)
        .join("")}</table>
    </details>
    <nav class="stepper" id="stepper" aria-label="Step along the route"></nav>`;
  panel.hidden = false;
  panel.scrollTop = 0;
  for (const img of panel.querySelectorAll(".wiki-thumb img")) img.onerror = () => img.closest(".wiki-thumb").remove();

  renderStepper(s);
  renderPhotoTabs(s);
  // Keep focus on the shrink button while stepping through signs full-screen.
  setPhotoExpanded(state.photoExpanded, { focus: state.photoExpanded });
  renderPhoto(s);
}

// ------------------------------------------------------- open in editors --

// Monochrome logos (currentColor), from the Rapid editor's sprite (ISC).
const OSM_LOGO = `<svg viewBox="0 0 100 100" aria-hidden="true"><path fill="currentColor" d="M4,5 L11.813,25.5 L4,46 L11.813,66.531 L4,87.031 L8.813,88.875 L34.844,62.812 L39.531,63.531 L45.219,57.844 C41.87,53.964 39.339,49.332 37.969,44.219 L40.656,42.062 C40.199,39.939 39.938,37.726 39.938,35.469 C39.938,24.191 45.95,14.277 54.938,8.781 L45.031,5 L24.5,12.813 L4,5 z M71.094,9.313 C56.734,9.313 45.094,20.953 45.094,35.312 C45.094,49.672 56.734,61.312 71.094,61.312 C85.453,61.312 97.094,49.672 97.094,35.312 C97.094,20.953 85.453,9.313 71.094,9.313 z M91.156,59.469 C85.735,63.987 78.776,66.719 71.188,66.719 C68.93,66.719 66.717,66.458 64.594,66 L62.438,68.656 C57.582,67.355 53.131,65.067 49.375,61.969 L43.5,67.844 L44.219,72.188 L22.406,94.031 L24.5,94.844 L45.031,87.031 L65.531,94.844 L86.031,87.031 L93.844,66.531 L91.156,59.469 z"/></svg>`;
const RAPID_LOGO = `<svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor"><path d="M1.998,5.76 L3.619,5.76 C3.824,5.76 3.989,5.926 3.989,6.13 L3.989,6.144 C3.989,6.349 3.824,6.514 3.619,6.514 L1.998,6.514 C1.794,6.514 1.628,6.349 1.628,6.144 L1.628,6.13 C1.628,5.926 1.794,5.76 1.998,5.76 z"/><path d="M4.971,5.76 L6.592,5.76 C6.796,5.76 6.962,5.926 6.962,6.13 L6.962,6.144 C6.962,6.349 6.796,6.514 6.592,6.514 L4.971,6.514 C4.766,6.514 4.601,6.349 4.601,6.144 L4.601,6.13 C4.601,5.926 4.766,5.76 4.971,5.76 z"/><path d="M7.958,5.76 L9.579,5.76 C9.783,5.76 9.949,5.926 9.949,6.13 L9.949,6.144 C9.949,6.349 9.783,6.514 9.579,6.514 L7.958,6.514 C7.753,6.514 7.588,6.349 7.588,6.144 L7.588,6.13 C7.588,5.926 7.753,5.76 7.958,5.76 z"/><path d="M13.206,2.987 C11.556,2.133 9.608,2.446 8.327,3.641 L1.017,3.641 C0.746,3.641 0.519,3.869 0.519,4.139 C0.519,4.409 0.746,4.637 1.017,4.637 L11.129,4.637 C11.428,4.623 11.727,4.665 12.026,4.779 C12.623,5.016 13.081,5.508 13.275,6.121 C13.468,6.734 13.375,7.4 13.021,7.937 C12.466,8.776 11.385,9.117 10.447,8.747 C9.922,8.534 9.499,8.127 9.266,7.61 L2.894,7.61 C2.624,7.61 2.396,7.837 2.396,8.107 C2.396,8.378 2.624,8.605 2.894,8.605 L7.972,8.605 C8.242,8.605 8.47,8.833 8.47,9.103 C8.47,9.373 8.242,9.601 7.972,9.601 L5.084,9.601 C4.814,9.601 4.587,9.828 4.587,10.099 C4.587,10.369 4.814,10.597 5.084,10.597 L7.232,10.597 C7.502,10.597 7.73,10.824 7.73,11.094 C7.73,11.365 7.517,11.578 7.261,11.592 L6.734,11.592 C6.464,11.592 6.237,11.82 6.237,12.09 C6.237,12.36 6.464,12.588 6.734,12.588 L7.446,12.588 C7.517,12.915 7.574,13.171 7.616,13.342 C7.645,13.456 7.773,13.527 7.886,13.484 C8.967,13.071 13.761,11.109 14.998,8.733 C15.522,7.728 15.624,6.556 15.283,5.475 C14.941,4.395 14.184,3.494 13.178,2.973 z"/></svg>`;

const OSM_TYPE_LETTER = { node: "n", way: "w", relation: "r" };

/** Rapid opens with the sign selected. */
function rapidUrl(s) {
  const [lon, lat] = s.coord;
  return `https://rapideditor.org/edit#map=19.00/${lat.toFixed(6)}/${lon.toFixed(6)}&id=${OSM_TYPE_LETTER[s.type]}${s.id}`;
}

/**
 * Hand the sign to a running JOSM through Remote Control: download ~150 m
 * around it (so the motel or diner it belongs to comes along) and select it.
 * `no-cors` because we only need to know JOSM answered, not read the reply.
 */
async function openInJosm(s) {
  const status = $("#josm-status");
  const [lon, lat] = s.coord;
  const d = 0.0015;
  const params = new URLSearchParams({
    left: (lon - d).toFixed(6),
    right: (lon + d).toFixed(6),
    bottom: (lat - d).toFixed(6),
    top: (lat + d).toFixed(6),
    select: `${OSM_TYPE_LETTER[s.type]}${s.id}`,
  });
  status.textContent = "Sending to JOSM…";
  try {
    await fetch(`http://127.0.0.1:8111/load_and_zoom?${params}`, { mode: "no-cors", cache: "no-store" });
    if (state.selected === s) status.textContent = "Sent to JOSM.";
  } catch {
    if (state.selected === s) {
      status.innerHTML = "JOSM didn't answer. Start JOSM and turn on <b>Remote Control</b> (Preferences → Remote Control).";
    }
  }
}

/**
 * One Wikipedia/Wikidata card. Values come from the data pipeline but are
 * still validated here, since they end up in URLs.
 */
function wikiCard(e) {
  const wp = /^([a-z][a-z-]{1,15}):(.+)$/.exec(e.wikipedia || "");
  const wpUrl = wp ? `https://${wp[1]}.wikipedia.org/wiki/${encodeURIComponent(wp[2].trim().replace(/ /g, "_"))}` : null;
  const wdUrl = /^Q\d+$/.test(e.qid || "") ? `https://www.wikidata.org/wiki/${e.qid}` : null;
  const titleUrl = wpUrl || wdUrl;
  const label = esc(e.label || e.source_name || e.qid || "");
  const img = e.image ? commons(e.image, "wikidata", 240) : null;
  const via =
    e.source !== "self" && /^(node|way|relation)\/\d+$/.test(e.source || "")
      ? `<p class="wiki-via">Linked through <a href="https://www.openstreetmap.org/${e.source}" target="_blank" rel="noopener">${esc(e.source_name || e.source)}</a> in OSM</p>`
      : "";
  return `<article class="wiki-card">
      ${img ? `<a class="wiki-thumb" href="${esc(img.href)}" target="_blank" rel="noopener" title="Photo on Wikimedia Commons"><img src="${esc(img.src)}" alt="" loading="lazy" referrerpolicy="no-referrer"></a>` : ""}
      <div class="wiki-body">
        <p class="wiki-title">${titleUrl ? `<a href="${titleUrl}" target="_blank" rel="noopener">${label}</a>` : label}</p>
        ${e.description ? `<p class="wiki-desc">${esc(e.description)}</p>` : ""}
        <p class="wiki-links">
          ${wpUrl ? `<a href="${wpUrl}" target="_blank" rel="noopener">Wikipedia ↗</a>` : ""}
          ${wdUrl ? `<a href="${wdUrl}" target="_blank" rel="noopener">Wikidata ↗</a>` : ""}
        </p>
        ${via}
      </div>
    </article>`;
}

// Expanding restyles the same element in place (no re-parenting), so a
// loaded 360° viewer keeps its state and doesn't reload.
function setPhotoExpanded(on, { focus = true } = {}) {
  state.photoExpanded = on;
  const frame = $("#photo-frame");
  if (!frame) return;
  frame.classList.toggle("expanded", on);
  frame.setAttribute("role", on ? "dialog" : "group");
  frame.setAttribute("aria-label", "Sign photo");
  document.body.classList.toggle("photo-expanded", on);
  if (focus) frame.querySelector(on ? "[data-action=shrink]" : ".photo-expand")?.focus({ preventScroll: true });
}

function renderStepper(s) {
  const el = $("#stepper");
  if (!el) return;
  const list = state.visible;
  const i = list.findIndex((x) => x.key === s.key);
  const prevOff = i <= 0 ? "disabled" : "";
  const nextOff = i === -1 || i >= list.length - 1 ? "disabled" : "";
  const count = `${i === -1 ? "–" : i + 1} / ${list.length}`;
  el.innerHTML = `
    <button type="button" data-step="-1" ${prevOff} title="Previous sign (←)">◀ Toward Chicago</button>
    <span>${count}</span>
    <button type="button" data-step="1" ${nextOff} title="Next sign (→)">Toward L.A. ▶</button>`;
  // Compact copy for the expanded photo's top bar.
  $("#photo-top-nav").innerHTML = `
    <button type="button" data-step="-1" ${prevOff} aria-label="Previous sign, toward Chicago" title="Toward Chicago (←)">◀</button>
    <span>${count}</span>
    <button type="button" data-step="1" ${nextOff} aria-label="Next sign, toward L.A." title="Toward L.A. (→)">▶</button>`;
}

function renderPhotoTabs(s) {
  const el = $("#photo-tabs");
  if (s.photos.length < 2) {
    el.innerHTML = "";
    return;
  }
  const counts = {};
  el.innerHTML = s.photos
    .map((p, i) => {
      counts[p.label] = (counts[p.label] || 0) + 1;
      const n = s.photos.filter((q) => q.label === p.label).length > 1 ? ` ${counts[p.label]}` : "";
      return `<button type="button" data-photo="${i}" aria-pressed="${i === state.photoIndex}">${esc(p.label + n)}</button>`;
    })
    .join("");
}

async function renderPhoto(s) {
  const token = ++state.renderToken;
  const box = $("#photo");
  const meta = $("#photo-meta");
  const p = s.photos[state.photoIndex];

  if (!p) {
    box.innerHTML = `<div class="msg">No photo tagged for this sign yet.<br>
      Add a <code>mapillary=*</code> image ID in <a href="https://www.openstreetmap.org/edit?editor=id&${s.type}=${s.id}" target="_blank" rel="noopener">iD</a>.</div>`;
    meta.textContent = "";
    return;
  }

  if (p.kind === "mapillary") return renderMapillary(s, p, token, box, meta);

  const original = originalLink(p.href);
  meta.innerHTML = `${esc(p.credit)} · ${original}`;

  if (p.kind === "link") {
    box.innerHTML = `<div class="msg">This sign links to a photo page that can't be shown inline.<br>${original}</div>`;
    return;
  }

  showImage(box, p.src, s.title, () => {
    box.innerHTML = `<div class="msg">Couldn't load this photo.<br>${original}</div>`;
  });
}

const originalLink = (href) => `<a href="${esc(href)}" target="_blank" rel="noopener">Open original ↗</a>`;
const fmtDay = (iso) =>
  new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });

/**
 * Mapillary photos. 360° panoramas open in Mapillary's viewer turned toward
 * the sign, using where the photo was taken (from data/signs.geojson, or the
 * Graph API when a client token is configured) and the sign's OSM position.
 */
async function renderMapillary(s, p, token, box, meta) {
  let view = s.mlyViews[p.id] || null;
  let info = null;

  if (MAPILLARY_CLIENT_TOKEN) {
    box.innerHTML = `<div class="spinner" role="status" aria-label="Loading photo"></div>`;
    try {
      info = await mapillaryInfo(p.id);
    } catch (e) {
      console.warn("Mapillary lookup failed; using the embedded viewer.", e);
    }
    if (token !== state.renderToken) return;
    // The Graph API can aim photos the data pipeline hasn't resolved yet. Its
    // computed_compass_angle is Mapillary's own alignment of the image, so it
    // needs no per-uploader lens offset.
    const g = info?.computed_geometry?.coordinates || info?.geometry?.coordinates;
    if (!view && g && typeof info.computed_compass_angle === "number") {
      view = { lon: g[0], lat: g[1], computedCompass: info.computed_compass_angle, pano: info.is_pano === true };
    }
  }

  const aim = aimPano(view, s.coord, s.tags);
  const when = view?.captured ? fmtDay(view.captured) : info?.captured_at ? fmtDay(info.captured_at) : "";
  const who = info?.creator?.username ? `© ${esc(info.creator.username)} on ` : "";
  meta.innerHTML = [
    `${who}Mapillary (CC BY-SA 4.0)`,
    aim ? "360° view turned toward the sign" : view?.pano ? "360° photo" : "",
    when,
    originalLink(withCenter(p.href, aim)),
  ]
    .filter(Boolean)
    .join(" · ");

  // A flat thumbnail of a panorama is a stretched 360° strip, so panoramas
  // always get the interactive viewer.
  if (info?.thumb_1024_url && !view?.pano && info.is_pano !== true) {
    showImage(box, info.thumb_1024_url, s.title, () => showMapillaryEmbed(box, p, aim));
  } else {
    showMapillaryEmbed(box, p, aim);
  }
}

function showImage(box, src, alt, onError) {
  const img = new Image();
  img.alt = `Photo of the “${alt}” sign`;
  img.decoding = "async";
  img.referrerPolicy = "no-referrer";
  img.onerror = onError;
  img.src = src;
  box.replaceChildren(img);
}

function showMapillaryEmbed(box, p, aim) {
  const frame = document.createElement("iframe");
  frame.src = withCenter(p.embed, aim);
  frame.title = "Mapillary street-level photo";
  frame.loading = "lazy";
  frame.allow = "fullscreen";
  box.replaceChildren(frame);
}

const mapillaryCache = new Map();
function mapillaryInfo(id) {
  if (!mapillaryCache.has(id)) {
    const url =
      `https://graph.mapillary.com/${id}?fields=thumb_1024_url,captured_at,creator,is_pano,` +
      `compass_angle,computed_compass_angle,geometry,computed_geometry` +
      `&access_token=${encodeURIComponent(MAPILLARY_CLIENT_TOKEN)}`;
    const p = fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => (j.thumb_1024_url ? j : Promise.reject(new Error("no thumbnail"))));
    p.catch(() => mapillaryCache.delete(id)); // never cache failures
    mapillaryCache.set(id, p);
  }
  return mapillaryCache.get(id);
}

// --------------------------------------------------------------- events --

function wireEvents() {
  $("#sign-list").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-key]");
    if (b) select(b.dataset.key);
  });

  $("#filter").addEventListener("input", (e) => applyFilter(e.target.value));

  $("#sidebar-toggle").addEventListener("click", () =>
    setSidebarCollapsed(!$("#sidebar").classList.contains("collapsed"))
  );

  $("#detail").addEventListener("click", (e) => {
    if (e.target.closest("[data-action=close]")) return closeDetail();
    if (e.target.closest("[data-action=expand]")) return setPhotoExpanded(true);
    if (e.target.closest("[data-action=shrink]")) return setPhotoExpanded(false);
    if (e.target.closest("[data-action=josm]") && state.selected) return openInJosm(state.selected);
    const stepBtn = e.target.closest("button[data-step]");
    if (stepBtn) return step(Number(stepBtn.dataset.step));
    const tab = e.target.closest("button[data-photo]");
    if (tab && state.selected) {
      state.photoIndex = Number(tab.dataset.photo);
      renderPhotoTabs(state.selected);
      renderPhoto(state.selected);
    }
  });

  const tip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, className: "hover-tip", maxWidth: "280px" });
  // Signs win over lines; the added alignments win over the main line.
  const showTip = (e) => {
    const hits = map.queryRenderedFeatures(e.point, { layers: ["sign-halo", "alt-hit", "route-hit"] });
    const sign = hits.find((f) => f.layer.id === "sign-halo");
    const s = sign && state.byKey.get(sign.properties.key);
    map.getCanvas().style.cursor = s ? "pointer" : "";
    if (s) return tip.setLngLat(s.coord).setText(s.title).addTo(map);
    const line = hits.find((f) => f.layer.id === "alt-hit") || hits.find((f) => f.layer.id === "route-hit");
    if (line) return tip.setLngLat(e.lngLat).setHTML(routeTip(line.properties)).addTo(map);
    tip.remove();
  };

  map.on("click", (e) => {
    const [f] = map.queryRenderedFeatures(e.point, { layers: ["sign-halo"] });
    if (f) return select(f.properties.key);
    closeDetail();
    showTip(e); // touch screens have no hover, so a tap on a line shows its info
  });
  map.on("mousemove", (e) => (e.originalEvent.buttons ? tip.remove() : showTip(e)));
  map.getCanvas().addEventListener("mouseleave", () => tip.remove());

  window.addEventListener("hashchange", () => selectFromHash());

  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea")) return;
    if (e.key === "Escape") state.photoExpanded ? setPhotoExpanded(false) : closeDetail();
    else if (e.key === "ArrowLeft" && state.selected) step(-1);
    else if (e.key === "ArrowRight" && state.selected) step(1);
  });
}

/** Hover text for a route line: the main relations, or one of the added alignments. */
function routeTip(p) {
  if (!p.label) {
    return `<div class="route-tip"><strong>Historic U.S. Route 66</strong>
      <span class="sub">In OpenStreetMap's Historic Route 66 relations</span></div>`;
  }
  return `<div class="route-tip">
      <strong>${esc(p.name || p.label)}</strong>
      ${p.name ? `<span class="sub">${esc(p.label)}</span>` : ""}
      <span class="note">${esc(p.note)}</span>
      <span class="foot">Not in OSM's Historic Route 66 relations; included so the signs along it show.</span>
    </div>`;
}

function cameraIcon() {
  return `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M4 8h3l2-2h6l2 2h3v11H4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>`;
}

function expandIcon() {
  return `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function shrinkIcon() {
  return `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M20 10h-6V4M4 14h6v6M14 10l7-7M10 14l-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

// Last, so every module-level constant above is initialised before use.
boot();
