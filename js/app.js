import { aimPano, withCenter } from "./aim.js";
import { JOSM_MIN_ZOOM, josmLoadParams, latLonText, viewUrls } from "./editors.js";
import {
  commons,
  commonsCategoryUrl,
  commonsInfoUrl,
  imageSources,
  parseCategoryFiles,
  parseCommonsInfo,
  yesterdaysMapUrl,
} from "./images.js";
import { neonColour, signLifecycle, signTitle } from "./signs.js";
import { ROUTE_STATES, routeState } from "./states.js";
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
  galleryItem: null, // index of the enlarged photo in a Commons gallery, or null for the grid
  galleryFocus: null, // thumbnail to focus when returning to the grid
  renderToken: 0,
  query: "", // the text filter
  chips: new Set(), // active filter chips (ids from CHIPS); all must match
  collapsed: loadCollapsed(), // state headings folded shut in the list
};

// Filter chips under the search box. Each narrows the list and the map.
const CHIPS = [
  { id: "commons", label: "Commons", title: "Only signs with a Wikimedia Commons photo (often a night shot)", test: (s) => s.hasCommons },
  { id: "yesterdays", label: "Yesterdays", title: "Only signs with historical photos on Yesterdays", test: (s) => s.hasYesterdays },
  { id: "wiki", label: "Wikipedia", title: "Only signs with a Wikipedia or Wikidata link", test: (s) => s.wiki.length > 0 },
];

const COLLAPSED_KEY = "route66neon.collapsedStates";
function loadCollapsed() {
  try {
    const v = JSON.parse(localStorage.getItem(COLLAPSED_KEY) || "[]");
    return new Set(Array.isArray(v) ? v.filter((x) => ROUTE_STATES.includes(x)) : []);
  } catch {
    return new Set();
  }
}
function saveCollapsed() {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...state.collapsed]));
  } catch {
    /* private mode etc.: folding still works for this visit */
  }
}

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
// "Open this view in…" control (see that section below). Declared here because
// addControl runs its onAdd straight away.
let viewBtn = null;
let viewMenu = null;
const PENCIL_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), ctrlCorner);
map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: false } }), ctrlCorner);
map.addControl({ onAdd: viewMenuButton, onRemove() {} }, ctrlCorner);

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
      const { osm_type: type, osm_id: id, tags = {}, mapillary = {}, wiki = [], yesterdays = [], flickr = {} } = f.properties;
      const photos = imageSources(tags, { yesterdays, flickr });
      return {
        key: `${type}/${id}`,
        type,
        id,
        tags,
        mlyViews: mapillary, // image id → { lon, lat, compass, pano, captured }
        wiki, // [{ qid, label, description, wikipedia, image, source, source_name }]
        coord: f.geometry.coordinates,
        color: neonColour(tags),
        life: signLifecycle(tags) || "active", // "active" | "disused" | "abandoned"
        title: signTitle(tags),
        photos,
        hasCommons: photos.some((p) => p.kind === "commons" || p.kind === "gallery"),
        hasYesterdays: photos.some((p) => p.kind === "yesterdays"),
        state: routeState(f.geometry.coordinates, tags),
        search: [tags.inscription, tags.name, tags.brand, tags.operator, tags["addr:city"], tags.description, ...wiki.map((w) => w.label)]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(),
      };
    })
    // Route 66 runs almost monotonically east → west, so longitude is a good
    // stand-in for "order along the drive". State first keeps each state's
    // signs together under its heading even where a border wiggles.
    .sort((a, b) => ROUTE_STATES.indexOf(a.state) - ROUTE_STATES.indexOf(b.state) || b.coord[0] - a.coord[0]);
  for (const s of state.signs) state.byKey.set(s.key, s);
  state.visible = state.signs;

  addLayers(routeFc, alignFc);
  addInfoControl(signsFc.osm_base);
  renderChips();
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
        properties: { key: s.key, color: s.color, life: s.life },
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

  // Lifecycle (see signLifecycle): disused signs lose the glow; abandoned ones
  // also become a ring in their colour. The halo stays as an invisible hit
  // target so they're as easy to click as the rest.
  const life = ["get", "life"];
  map.addLayer({
    id: "sign-halo",
    type: "circle",
    source: "signs",
    paint: {
      "circle-color": ["get", "color"],
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 9, 8, 15, 14, 26, 18, 34],
      "circle-blur": 0.85,
      "circle-opacity": ["case", ["==", life, "active"], 0.6, 0],
    },
  });
  map.addLayer({
    id: "sign-core",
    type: "circle",
    source: "signs",
    paint: {
      "circle-color": ["case", ["==", life, "abandoned"], "rgba(0,0,0,0)", ["get", "color"]],
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 3, 8, 4.5, 14, 7, 18, 9],
      "circle-stroke-color": ["case", ["==", life, "abandoned"], ["get", "color"], "#ffffff"],
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
  const perState = {};
  for (const s of state.visible) perState[s.state] = (perState[s.state] || 0) + 1;
  const rows = [];
  let current = null;
  for (const s of state.visible) {
    if (s.state !== current) {
      current = s.state;
      const open = !state.collapsed.has(current);
      rows.push(`<li class="state-head"><button type="button" data-state="${esc(current)}" aria-expanded="${open}">
        <svg class="caret" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span>${esc(current)}</span><span class="n">${perState[current]}</span>
      </button></li>`);
    }
    if (state.collapsed.has(current)) continue;
    rows.push(`<li><button type="button" data-key="${esc(s.key)}" ${s.key === state.selected?.key ? 'aria-current="true"' : ""}>
        <span class="dot ${s.life}" style="--c:${s.color}"></span>
        <span class="t">${esc(s.title)}</span>
        ${signBadges(s)}
      </button></li>`);
  }
  list.innerHTML = rows.join("");
}

// The list only marks what's uncommon: almost every sign has a street-level
// photo, so a camera on every row would say nothing.
const BADGE = {
  wiki: `<span class="wbadge" role="img" title="Has a Wikipedia or Wikidata link" aria-label="Has a Wikipedia or Wikidata link">W</span>`,
  commons: () => `<span class="ico" role="img" title="Has a Wikimedia Commons photo" aria-label="Has a Wikimedia Commons photo">${SPARKLE_ICON}</span>`,
  yesterdays: () => `<span class="ico" role="img" title="Has historical photos on Yesterdays" aria-label="Has historical photos on Yesterdays">${YESTERDAYS_ICON}</span>`,
};
function signBadges(s) {
  return [s.wiki.length ? BADGE.wiki : "", s.hasCommons ? BADGE.commons() : "", s.hasYesterdays ? BADGE.yesterdays() : ""].join("");
}

function renderChips() {
  const el = $("#chips");
  if (!el) return;
  const icon = { commons: SPARKLE_ICON, yesterdays: YESTERDAYS_ICON };
  el.innerHTML = CHIPS.map((c) => {
    const n = state.signs.filter(c.test).length;
    const mark = c.id === "wiki" ? `<span class="wbadge" aria-hidden="true">W</span>` : `<span class="ico" aria-hidden="true">${icon[c.id]}</span>`;
    return `<button type="button" class="chip" data-chip="${c.id}" aria-pressed="${state.chips.has(c.id)}" title="${esc(c.title)}">${mark}${esc(c.label)} <span class="n">${n}</span></button>`;
  }).join("");
}

function applyFilter() {
  const q = state.query.trim().toLowerCase();
  const tests = CHIPS.filter((c) => state.chips.has(c.id)).map((c) => c.test);
  const active = q || tests.length;
  state.visible = active
    ? state.signs.filter((s) => (!q || s.search.includes(q)) && tests.every((t) => t(s)))
    : state.signs;
  const keys = state.visible.map((s) => s.key);
  const filter = active ? ["in", ["get", "key"], ["literal", keys]] : null;
  map.setFilter("sign-halo", filter);
  map.setFilter("sign-core", filter);
  renderList();
  if (state.selected) renderStepper(state.selected);
}

function toggleState(name) {
  if (state.collapsed.has(name)) state.collapsed.delete(name);
  else state.collapsed.add(name);
  saveCollapsed();
  renderList();
  $(`#sign-list button[data-state="${CSS.escape(name)}"]`)?.focus({ preventScroll: true });
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
  if (changed) {
    state.photoIndex = 0;
    state.galleryItem = null;
  }

  map.setFilter("sign-selected", ["==", ["get", "key"], key]);
  document.body.classList.add("detail-open");
  renderDetail(s);

  // Unfold the sign's state so it can be highlighted in the list.
  if (state.collapsed.has(s.state)) {
    state.collapsed.delete(s.state);
    saveCollapsed();
    renderList();
  }

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
  if (s.life !== "active") facts.unshift(`<dt>Condition</dt><dd>${s.life === "disused" ? "Disused" : "Abandoned"}</dd>`);

  const osmUrl = `https://www.openstreetmap.org/${s.type}/${s.id}`;
  const idUrl = `https://www.openstreetmap.org/edit?editor=id&${s.type}=${s.id}`;

  panel.innerHTML = `
    <div class="detail-top">
      <h2 class="sign-title ${s.life}" style="--c:${s.color}">${esc(s.title)}</h2>
      <button type="button" class="icon-btn" data-action="close" aria-label="Close" title="Close (Esc)">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
    </div>
    <div class="photo-frame${state.photoExpanded ? " expanded" : ""}" id="photo-frame">
      <div class="photo-top">
        <span class="photo-top-title ${s.life}" style="--c:${s.color}">${esc(s.title)}</span>
        <span class="photo-top-nav" id="photo-top-nav"></span>
        <button type="button" class="icon-btn" data-action="shrink" aria-label="Shrink photo" title="Shrink (Esc)">${shrinkIcon()}</button>
      </div>
      <div class="photo-tabs" id="photo-tabs" role="group" aria-label="Photo source"></div>
      <div class="photo-stage">
        <div class="photo" id="photo"></div>
        <button type="button" class="photo-expand" data-action="expand" aria-label="Expand photo" title="Expand photo">${expandIcon()}</button>
      </div>
      <div class="photo-foot">
        <div class="photo-meta" id="photo-meta"></div>
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
      <a class="tool-btn" href="${esc(yesterdaysMapUrl(s.coord))}" target="_blank" rel="noopener" title="Old photos of this spot on Yesterdays" aria-label="Old photos of this spot on Yesterdays">${YESTERDAYS_ICON}</a>
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

// The Yesterdays mark: Font Awesome Free 7.3.1 "map-location-dot", chosen with
// the Yesterdays team. License CC BY 4.0, https://fontawesome.com/license/free
// Copyright 2026 Fonticons, Inc.
const YESTERDAYS_ICON = `<svg viewBox="0 0 640 640" aria-hidden="true" fill="currentColor"><path d="M576 112C576 100.9 570.3 90.6 560.8 84.8C551.3 79 539.6 78.4 529.7 83.4L413.5 141.5L234.1 81.6C226 78.9 217.3 79.5 209.7 83.3L81.7 147.3C70.8 152.8 64 163.9 64 176L64 528C64 539.1 69.7 549.4 79.2 555.2C88.7 561 100.4 561.6 110.3 556.6L226.4 498.5L399.7 556.3C395.4 549.9 391.2 543.2 387.1 536.4C376.1 518.1 365.2 497.1 357.1 474.6L255.9 440.9L255.9 156.4L383.9 199.1L383.9 298.4C414.9 262.6 460.9 240 511.9 240C534.5 240 556.1 244.4 575.9 252.5L576 112zM512 288C445.7 288 392 340.8 392 405.9C392 474.8 456.1 556.3 490.6 595.2C502.2 608.2 521.9 608.2 533.5 595.2C568 556.3 632.1 474.8 632.1 405.9C632.1 340.8 578.4 288 512.1 288zM472 408C472 385.9 489.9 368 512 368C534.1 368 552 385.9 552 408C552 430.1 534.1 448 512 448C489.9 448 472 430.1 472 408z"/></svg>`;

// Two overlapping sheets: copy to clipboard.
const COPY_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;

// Four-point sparkle: a Wikimedia Commons photo, usually a night shot.
const SPARKLE_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M12 2C12.6 7.6 16.4 11.4 22 12C16.4 12.6 12.6 16.4 12 22C11.4 16.4 7.6 12.6 2 12C7.6 11.4 11.4 7.6 12 2Z"/></svg>`;

const OSM_TYPE_LETTER = { node: "n", way: "w", relation: "r" };

/** Rapid opens with the sign selected. */
function rapidUrl(s) {
  const [lon, lat] = s.coord;
  return `https://rapideditor.org/edit#map=19.00/${lat.toFixed(6)}/${lon.toFixed(6)}&id=${OSM_TYPE_LETTER[s.type]}${s.id}`;
}

const JOSM_NO_ANSWER =
  "JOSM didn't answer. Start JOSM and turn on <b>Remote Control</b> (Preferences → Remote Control).";

/**
 * Ask a running JOSM to download an area through Remote Control. Resolves
 * true if JOSM answered. `no-cors` because we only need to know it answered,
 * not read the reply.
 */
async function sendToJosm(query) {
  try {
    await fetch(`http://127.0.0.1:8111/load_and_zoom?${query}`, { mode: "no-cors", cache: "no-store" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Hand the sign to JOSM: download ~150 m around it (so the motel or diner it
 * belongs to comes along) and select it.
 */
async function openInJosm(s) {
  const status = $("#josm-status");
  const [lon, lat] = s.coord;
  const d = 0.0015;
  const box = { west: lon - d, south: lat - d, east: lon + d, north: lat + d };
  status.textContent = "Sending to JOSM…";
  const ok = await sendToJosm(josmLoadParams(box, `${OSM_TYPE_LETTER[s.type]}${s.id}`));
  if (state.selected !== s) return;
  if (ok) status.textContent = "Sent to JOSM.";
  else status.innerHTML = JOSM_NO_ANSWER;
}

// ------------------------------------------------ open this view in… --

// A map control that opens whatever area is on screen in the same tools as a
// sign's "Open in" row. The menu lives on <body>, not inside the control, so
// it can sit above the detail panel that hugs the control column.

function viewMenuButton() {
  const box = document.createElement("div");
  box.className = "maplibregl-ctrl maplibregl-ctrl-group";
  viewBtn = document.createElement("button");
  viewBtn.type = "button";
  viewBtn.className = "view-menu-btn";
  viewBtn.title = "Open this view in an editor";
  viewBtn.setAttribute("aria-label", viewBtn.title);
  viewBtn.setAttribute("aria-haspopup", "true");
  viewBtn.setAttribute("aria-expanded", "false");
  viewBtn.setAttribute("aria-controls", "view-menu");
  viewBtn.innerHTML = PENCIL_ICON;
  viewBtn.addEventListener("click", () => setViewMenuOpen(viewMenu?.hidden ?? true));
  box.append(viewBtn);
  return box;
}

/** Built on first open: the logos it uses are declared further down the module. */
function buildViewMenu() {
  viewMenu = document.createElement("div");
  viewMenu.id = "view-menu";
  viewMenu.className = "view-menu";
  viewMenu.hidden = true;
  viewMenu.setAttribute("aria-label", "Open this view in");
  const link = (key, icon, label) =>
    `<a class="view-item" data-link="${key}" target="_blank" rel="noopener">${icon}<span>${label}</span></a>`;
  viewMenu.innerHTML = `
    <p class="view-menu-head">Open this view in</p>
    ${link("osm", OSM_LOGO, "OpenStreetMap")}
    ${link("id", `<img class="invert" src="img/editors/id.png" alt="">`, "iD")}
    ${link("rapid", RAPID_LOGO, "Rapid")}
    <button class="view-item" type="button" data-action="josm-view"><img src="img/editors/josm.png" alt=""><span>JOSM</span></button>
    ${link("yesterdays", YESTERDAYS_ICON, "Yesterdays")}
    <hr class="view-sep">
    <button class="view-item" type="button" data-action="copy-latlon" title="Copy the map centre as “lat, lon”">${COPY_ICON}<span>Copy lat/lon</span></button>
    <p class="josm-status" id="view-status" role="status" aria-live="polite"></p>`;
  document.body.append(viewMenu);

  viewMenu.addEventListener("click", async (e) => {
    if (e.target.closest("a[data-link]")) return setViewMenuOpen(false);
    const status = $("#view-status");
    if (e.target.closest("[data-action=copy-latlon]")) {
      const c = map.getCenter();
      const text = latLonText({ lat: c.lat, lon: c.lng });
      try {
        await navigator.clipboard.writeText(text);
        status.textContent = `Copied ${text}`;
      } catch {
        // No clipboard access (e.g. plain http on another host): show it to copy by hand.
        status.textContent = text;
      }
      return;
    }
    const josm = e.target.closest("[data-action=josm-view]");
    if (!josm || josm.disabled) return;
    const b = map.getBounds();
    status.textContent = "Sending to JOSM…";
    const ok = await sendToJosm(
      josmLoadParams({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() })
    );
    if (ok) status.textContent = "Sent to JOSM.";
    else status.innerHTML = JOSM_NO_ANSWER;
  });
  // Close on any press outside the menu and its button (including the map).
  document.addEventListener("pointerdown", (e) => {
    if (!viewMenu.hidden && !viewMenu.contains(e.target) && !viewBtn.contains(e.target)) setViewMenuOpen(false);
  });
  map.on("moveend", () => viewMenu.hidden || updateViewMenu());
  window.addEventListener("resize", () => setViewMenuOpen(false));
}

/** Point the links at the current view. */
function updateViewMenu() {
  const c = map.getCenter();
  const zoom = map.getZoom();
  const urls = viewUrls({ lat: c.lat, lon: c.lng, zoom });
  for (const a of viewMenu.querySelectorAll("a[data-link]")) a.href = urls[a.dataset.link];
  const josm = viewMenu.querySelector("[data-action=josm-view]");
  josm.disabled = zoom < JOSM_MIN_ZOOM;
  josm.title = josm.disabled ? "Zoom in further to load this area in JOSM" : "Load this area in JOSM (needs Remote Control on)";
}

function setViewMenuOpen(open, { focus = true } = {}) {
  if (!viewMenu) {
    if (!open) return;
    buildViewMenu();
  }
  viewBtn.setAttribute("aria-expanded", String(open));
  if (!open) {
    if (!viewMenu.hidden && focus && viewMenu.contains(document.activeElement)) viewBtn.focus();
    viewMenu.hidden = true;
    return;
  }
  updateViewMenu();
  $("#view-status").textContent = "";
  // Beside the button, opening leftward; on phones the controls sit at the
  // bottom, so the menu grows upward from the button instead.
  const r = viewBtn.getBoundingClientRect();
  Object.assign(viewMenu.style, {
    right: `${window.innerWidth - r.left + 8}px`,
    top: ctrlCorner.startsWith("top") ? `${r.top}px` : "",
    bottom: ctrlCorner.startsWith("bottom") ? `${window.innerHeight - r.bottom}px` : "",
  });
  viewMenu.hidden = false;
  viewMenu.querySelector(".view-item")?.focus();
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
  // The list runs east → west (Chicago first), but on screen west is left, so
  // the L.A. button goes on the left and Chicago on the right, like the map.
  const eastOff = i <= 0 ? "disabled" : "";
  const westOff = i === -1 || i >= list.length - 1 ? "disabled" : "";
  const count = `${i === -1 ? "–" : i + 1} / ${list.length}`;
  el.innerHTML = `
    <button type="button" data-step="1" ${westOff} title="Next sign west (←)">◀ Toward L.A.</button>
    <span>${count}</span>
    <button type="button" data-step="-1" ${eastOff} title="Next sign east (→)">Toward Chicago ▶</button>`;
  // Compact copy for the expanded photo's top bar.
  $("#photo-top-nav").innerHTML = `
    <button type="button" data-step="1" ${westOff} aria-label="Next sign toward L.A." title="Toward L.A. (←)">◀</button>
    <span>${count}</span>
    <button type="button" data-step="-1" ${eastOff} aria-label="Next sign toward Chicago" title="Toward Chicago (→)">▶</button>`;
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
  if (p.kind === "flickr") return renderFlickr(s, p, box, meta);
  if (p.kind === "gallery" || p.kind === "yesterdays") return renderGallery(s, p, token, box, meta);

  const original = originalLink(p.href);
  meta.innerHTML = `${esc(p.credit)} · ${original}`;

  if (p.kind === "link") {
    box.innerHTML = `<div class="msg">This sign links to a photo page that can't be shown inline.<br>${original}</div>`;
    return;
  }

  showImage(box, p.src, s.title, () => {
    box.innerHTML = `<div class="msg">Couldn't load this photo.<br>${original}</div>`;
  });

  if (p.kind === "commons") {
    // Fill in author and licence once Commons answers; keep the generic credit if it doesn't.
    commonsJson(commonsInfoUrl(p.id))
      .then(parseCommonsInfo)
      .then((c) => {
        if (token === state.renderToken) meta.innerHTML = `${commonsCreditHtml(c)} · ${original}`;
      })
      .catch((e) => console.warn("Commons credit lookup failed.", e));
  }
}

const originalLink = (href) => `<a href="${esc(href)}" target="_blank" rel="noopener">Open original ↗</a>`;

/**
 * A Flickr photo, from what the data pipeline looked up (p.info). All Rights
 * Reserved photos, and ones not looked up yet, have no src: they get a link.
 */
function renderFlickr(s, p, box, meta) {
  const open = `<a href="${esc(p.href)}" target="_blank" rel="noopener">Open on Flickr ↗</a>`;
  meta.innerHTML = `${flickrCreditHtml(p.info)} · ${open}`;
  if (!p.src) {
    const why = p.info ? "Its owner reserves all rights, so it can't be shown here." : "It hasn't been looked up yet.";
    box.innerHTML = `<div class="msg">This sign links to a photo on Flickr. ${why}<br>${open}</div>`;
    return;
  }
  showImage(box, p.src, s.title, () => {
    box.innerHTML = `<div class="msg">Couldn't load this photo.<br>${open}</div>`;
  });
}

/** “Title” · © Author · Licence · Flickr, with author and licence linked. */
function flickrCreditHtml(i) {
  if (!i) return "Flickr";
  const free = /public domain|cc0|no known copyright|government work/i.test(i.license || "");
  const name = i.author ? `${free ? "" : "© "}${esc(i.author)}` : "";
  const author = name && i.author_url ? `<a href="${esc(i.author_url)}" target="_blank" rel="noopener">${name}</a>` : name;
  const license = i.license
    ? i.license_url
      ? `<a href="${esc(i.license_url)}" target="_blank" rel="noopener license">${esc(i.license)}</a>`
      : esc(i.license)
    : "";
  return [i.title ? `“${esc(i.title)}”` : "", author, license, "Flickr"].filter(Boolean).join(" · ");
}

/** "© Author · Licence · Wikimedia Commons", with the licence linked when Commons gives a URL. */
function commonsCreditHtml(c) {
  const free = /public domain|^pd\b|cc0/i.test(c?.license || "");
  const author = c?.author ? `${free ? "" : "© "}${esc(c.author)}` : "";
  const license = c?.license
    ? c.licenseUrl
      ? `<a href="${esc(c.licenseUrl)}" target="_blank" rel="noopener license">${esc(c.license)}</a>`
      : esc(c.license)
    : "";
  return [author, license, "Wikimedia Commons"].filter(Boolean).join(" · ");
}

/**
 * A gallery tab — a Commons category, or the sign's Yesterdays photos: a grid
 * of thumbnails; clicking one enlarges it in the same frame with a "Gallery"
 * button to go back. A gallery of one photo opens straight to it.
 * Items: { src, href, thumb, alt, caption (HTML), link (HTML) }.
 */
async function renderGallery(s, p, token, box, meta) {
  let g, intro, emptyMsg;
  if (p.kind === "yesterdays") {
    g = { items: p.items.map(yesterdaysItem), more: false };
    const n = g.items.length;
    intro = `${n} historical photo${n === 1 ? "" : "s"} on <a href="${esc(yesterdaysMapUrl(s.coord))}" target="_blank" rel="noopener">Yesterdays</a>`;
  } else {
    const catLink = `<a href="${esc(p.href)}" target="_blank" rel="noopener">${esc(p.id)}</a>`;
    box.innerHTML = `<div class="spinner" role="status" aria-label="Loading gallery"></div>`;
    meta.textContent = "";
    try {
      const c = parseCategoryFiles(await commonsJson(commonsCategoryUrl(p.id)));
      g = { items: c.items.map(commonsItem), more: c.more };
    } catch (e) {
      console.warn("Commons gallery lookup failed.", e);
      if (token === state.renderToken) {
        box.innerHTML = `<div class="msg">Couldn't load this Commons gallery.<br>${originalLink(p.href)}</div>`;
      }
      return;
    }
    intro = `${g.items.length}${g.more ? "+" : ""} photos in ${catLink} on Wikimedia Commons${g.more ? ` (first ${g.items.length} shown)` : ""}`;
    emptyMsg = `No photos in this Commons category yet.<br>${originalLink(p.href)}`;
  }
  if (token !== state.renderToken) return;

  if (!g.items.length) {
    box.innerHTML = `<div class="msg">${emptyMsg || "No photos."}</div>`;
    meta.innerHTML = intro;
    return;
  }

  const single = g.items.length === 1;
  const count = `${g.items.length}${g.more ? "+" : ""}`;
  const index = single ? 0 : state.galleryItem;
  const item = index == null ? null : g.items[index];
  if (!item) {
    state.galleryItem = null;
    box.innerHTML = `<ul class="gallery" aria-label="${esc(p.label)} photos">${g.items
      .map(
        (it, n) => `<li><button type="button" class="gallery-thumb" data-gallery="${n}" title="${esc(it.alt)}">
          <img src="${esc(it.thumb)}" alt="${esc(it.alt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">
        </button></li>`
      )
      .join("")}</ul>`;
    meta.innerHTML = intro;
    if (state.galleryFocus != null) {
      box.querySelector(`[data-gallery="${state.galleryFocus}"]`)?.focus({ preventScroll: false });
      state.galleryFocus = null;
    }
    return;
  }

  showImage(box, item.src, s.title, () => {
    box.innerHTML = `<div class="msg">Couldn't load this photo.<br>${item.link}</div>`;
    if (!single) box.append(galleryBackButton());
  });
  if (!single) {
    const back = galleryBackButton();
    box.append(back);
    back.focus({ preventScroll: true });
  }
  meta.innerHTML = [item.caption, single ? "" : `${index + 1} of ${count}`, item.link].filter(Boolean).join(" · ");
}

function commonsItem(it) {
  return {
    src: it.file.src,
    href: it.file.href,
    thumb: it.thumb,
    alt: it.file.id.replace(/\.[a-z0-9]+$/i, ""),
    caption: commonsCreditHtml(it.credit),
    link: originalLink(it.file.href),
  };
}

/** A Yesterdays photo: “Title” · date · creator · source · licence, then a link to its page. */
function yesterdaysItem(e) {
  const source = e.source
    ? e.collection
      ? `<span title="${esc(e.collection)}">${esc(e.source)}</span>`
      : esc(e.source)
    : "";
  const license = e.license
    ? /^https:\/\//.test(e.license_url || "")
      ? `<a href="${esc(e.license_url)}" target="_blank" rel="noopener license">${esc(e.license)}</a>`
      : esc(e.license)
    : /^https:\/\//.test(e.original || "")
      ? `<a href="${esc(e.original)}" target="_blank" rel="noopener">Rights at source ↗</a>`
      : "";
  return {
    src: e.thumb, // the largest single image Yesterdays serves (~500 px)
    href: e.page,
    thumb: e.thumb,
    alt: e.title,
    caption: [`“${esc(e.title)}”`, esc(e.date || ""), esc(e.creator || ""), source, license].filter(Boolean).join(" · "),
    link: `<a href="${esc(e.page)}" target="_blank" rel="noopener">Open on Yesterdays ↗</a>`,
  };
}

function galleryBackButton() {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "gallery-back";
  b.dataset.action = "gallery-back";
  b.title = "Back to the gallery (Esc)";
  b.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Gallery`;
  return b;
}

function galleryBack() {
  state.galleryFocus = state.galleryItem;
  state.galleryItem = null;
  if (state.selected) renderPhoto(state.selected);
}

// Commons API answers, shared by credits and galleries. Failures aren't cached.
const commonsCache = new Map();
function commonsJson(url) {
  if (!commonsCache.has(url)) {
    const p = fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))));
    p.catch(() => commonsCache.delete(url));
    commonsCache.set(url, p);
  }
  return commonsCache.get(url);
}
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
    const head = e.target.closest("button[data-state]");
    if (head) return toggleState(head.dataset.state);
    const b = e.target.closest("button[data-key]");
    if (b) select(b.dataset.key);
  });

  $("#filter").addEventListener("input", (e) => {
    state.query = e.target.value;
    applyFilter();
  });

  $("#chips").addEventListener("click", (e) => {
    const chip = e.target.closest("button[data-chip]");
    if (!chip) return;
    const id = chip.dataset.chip;
    if (state.chips.has(id)) state.chips.delete(id);
    else state.chips.add(id);
    renderChips();
    applyFilter();
  });

  $("#sidebar-toggle").addEventListener("click", () =>
    setSidebarCollapsed(!$("#sidebar").classList.contains("collapsed"))
  );

  $("#detail").addEventListener("click", (e) => {
    if (e.target.closest("[data-action=close]")) return closeDetail();
    if (e.target.closest("[data-action=expand]")) return setPhotoExpanded(true);
    if (e.target.closest("[data-action=shrink]")) return setPhotoExpanded(false);
    if (e.target.closest("[data-action=josm]") && state.selected) return openInJosm(state.selected);
    if (e.target.closest("[data-action=gallery-back]")) return galleryBack();
    const thumb = e.target.closest("button[data-gallery]");
    if (thumb && state.selected) {
      state.galleryItem = Number(thumb.dataset.gallery);
      return renderPhoto(state.selected);
    }
    const stepBtn = e.target.closest("button[data-step]");
    if (stepBtn) return step(Number(stepBtn.dataset.step));
    const tab = e.target.closest("button[data-photo]");
    if (tab && state.selected) {
      state.photoIndex = Number(tab.dataset.photo);
      state.galleryItem = null;
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
    // Escape backs out one level: view menu, then enlarged gallery photo → full screen → panel.
    if (e.key === "Escape" && viewMenu && !viewMenu.hidden) setViewMenuOpen(false);
    else if (e.key === "Escape") {
      const kind = state.selected?.photos[state.photoIndex]?.kind;
      if (state.galleryItem != null && (kind === "gallery" || kind === "yesterdays")) galleryBack();
      else if (state.photoExpanded) setPhotoExpanded(false);
      else closeDetail();
    }
    // Left/right follow the map: ← heads west toward L.A., → east toward Chicago.
    else if (e.key === "ArrowLeft" && state.selected) step(1);
    else if (e.key === "ArrowRight" && state.selected) step(-1);
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
    </div>`;
}

function expandIcon() {
  return `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function shrinkIcon() {
  return `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M20 10h-6V4M4 14h6v6M14 10l7-7M10 14l-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

// Last, so every module-level constant above is initialised before use.
boot();
