/* Drone Detector - map screen. The Android app pushes the full picture once a second via RID.onState(). */
'use strict';
(function () {
  const FT = 3.28084, MPH = 2.23694, MI = 1609.344, LIVE_S = 15, SHOW_S = 1800, M_LAT = 110540;
  const A = window.Android || null;
  const $ = (s, el) => (el || document).querySelector(s);
  const S = {
    st: null, t: 0, sel: null, kind: null, follow: false, mode3d: false, sheet: 'peek', fitted: false, view: '',
    settings: { labels: true, trail3d: true, aircraft: true, demo: false, alertSound: true, keepScreenOn: true, airspace: true, wind: true },
    mapReady: false, safeTop: 0, safeBottom: 0,
  };
  const mk = { drone: new Map(), pilot: new Map(), ac: new Map(), me: null };

  // ------------------------------------------------------------------ helpers
  const rad = x => x * Math.PI / 180;
  function dist(a1, o1, a2, o2) {
    const p1 = rad(a1), p2 = rad(a2), dp = p2 - p1, dl = rad(o2 - o1);
    const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function bearing(a1, o1, a2, o2) {
    const p1 = rad(a1), p2 = rad(a2), dl = rad(o2 - o1);
    const y = Math.sin(dl) * Math.cos(p2), x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }
  const compass = b => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(b / 45) % 8];
  const ft = m => m == null || !isFinite(m) ? '—' : Math.round(m * FT).toLocaleString('en-US');
  const fmtDist = m => m == null ? '—' : (m * FT < 1000 ? Math.round(m * FT) + ' ft' : (m / MI).toFixed(m / MI < 10 ? 2 : 1) + ' mi');
  const mph = v => v == null ? '—' : String(Math.round(v * MPH));
  const ago = s => s < 3 ? 'now' : s < 60 ? Math.round(s) + ' s ago' : s < 3600 ? Math.round(s / 60) + ' min ago' : Math.round(s / 3600) + ' h ago';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const clock = t => new Date(t * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  // serial-number prefix -> model, from FAA Remote ID declarations (models.json, updated over the air)
  let MODELS = { '1581F8HG': 'DJI Matrice 4TD', '1581F5FH': 'DJI Mavic 3E' }, MAKERS = { '1581': 'DJI' };
  fetch('models.json').then(r => r.json()).then(j => { MODELS = j.models || MODELS; MAKERS = j.makers || MAKERS; }).catch(() => { });
  function modelOf(d) {
    if (d.model) return d.model;
    const s = String(d.serial || '').toUpperCase();
    for (let n = Math.min(s.length, 16); n >= 5; n--) { const m = MODELS[s.slice(0, n)]; if (m) return m; }
    const mk = MAKERS[s.slice(0, 4)];
    return mk ? mk + ' drone' : 'Unknown drone';
  }
  const shortModel = d => modelOf(d).replace(/^DJI\s+/, '');
  const isLive = d => S.t - d.lastSeen < LIVE_S;
  // Each drone keeps one color for the session, shared by its icon, pilot, connecting line and path.
  // Order (Jason): green, blue, red, orange, yellow, then purple and the rest.
  const PAL = ['#9fc928', '#3b82f6', '#ef4444', '#f97316', '#eab308', '#a855f7', '#06b6d4', '#ec4899', '#84cc16', '#14b8a6'];
  const CMAP = {};
  let cNext = 0;
  function assignColors(drones) {
    for (const d of [...drones].sort((a, b) => a.firstSeen - b.firstSeen)) if (CMAP[d.id] == null) CMAP[d.id] = cNext++ % PAL.length;
  }
  const ci = d => CMAP[d.id] == null ? 0 : CMAP[d.id];
  const dcol = d => PAL[ci(d)];
  function lighten(hex, f) {   // mix toward white
    const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255, m = v => Math.round(v + (255 - v) * f);
    return `rgb(${m(r)},${m(g)},${m(b)})`;
  }
  function shade2hex(hex, f) {   // darken, returned as #rrggbb
    const n = parseInt(hex.slice(1), 16), c = v => Math.round(v * f).toString(16).padStart(2, '0');
    return '#' + c(n >> 16) + c((n >> 8) & 255) + c(n & 255);
  }
  function shade(hex, f) {   // f < 1 darkens toward black
    const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    return `rgb(${Math.round(r * f)},${Math.round(g * f)},${Math.round(b * f)})`;
  }
  const hdgOf = d => d.heading != null ? d.heading : d.lastHeading;
  const hasPos = d => d.lat != null && d.lon != null;
  const hasPilot = d => d.pilotLat != null && d.pilotLon != null;
  function sigBars(rssi) {
    const n = rssi == null ? 0 : rssi > -70 ? 4 : rssi > -80 ? 3 : rssi > -88 ? 2 : rssi > -96 ? 1 : 0;
    return `<span class="bars b${n}"><i></i><i></i><i></i><i></i></span>`;
  }
  const me = () => (S.st && S.st.me) || null;
  function setF(root, f, html) { const el = root.querySelector(`[data-f="${f}"]`); if (el && el.innerHTML !== html) el.innerHTML = html; return el; }
  function haptic() { try { A && A.haptic(); } catch (e) { } }

  const ICON = {
    person: '<svg viewBox="0 0 24 24" fill="#fff"><circle cx="12" cy="7.3" r="3.7"/><path d="M4.3 20.6c.7-4.3 3.7-6.8 7.7-6.8s7 2.5 7.7 6.8z"/></svg>',
    back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    arrow: '<svg viewBox="0 0 24 24"><path d="M12 2.3l6.8 18-6.8-3.8-6.8 3.8z" fill="#60a5fa"/></svg>',
    hdg: '<svg viewBox="0 0 24 24"><path d="M12 3l6 16-6-3.4L6 19z" fill="#ffb37a"/></svg>',
    nav: '<svg viewBox="0 0 24 24"><path d="M3.5 11.2 20.5 3.5l-7.7 17-2.1-7.2z" fill="currentColor"/></svg>',
    pin: '<svg viewBox="0 0 24 24"><path d="M12 21.5s-6.5-6.2-6.5-11.4a6.5 6.5 0 0 1 13 0c0 5.2-6.5 11.4-6.5 11.4Z" fill="none" stroke="currentColor" stroke-width="1.9"/><circle cx="12" cy="10" r="2.4" fill="currentColor"/></svg>',
    follow: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="1.9"/><circle cx="12" cy="12" r="2.6" fill="currentColor"/><path d="M12 1.8v3.4M12 18.8v3.4M1.8 12h3.4M18.8 12h3.4" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
    cube: '<svg viewBox="0 0 24 24"><path d="M12 2.8 20 7.2v9.6L12 21.2 4 16.8V7.2Z M4 7.2l8 4.4 8-4.4 M12 11.6v9.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    fit: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  // ------------------------------------------------------------------ detailed drone icon (top view, nose up)
  // Gradients live in index.html (#g-*). Props spin while the drone is live; front lights red, rear green.
  const MOT = [[44, 44, 'r'], [156, 44, 'l'], [44, 156, 'l'], [156, 156, 'r']];
  function droneSvg() {
    let s = '<svg class="dsvg" viewBox="0 0 200 200" aria-hidden="true">';
    for (const [x, y] of MOT) {   // carbon arms with a lit edge
      const bx = x < 100 ? 84 : 116, by = y < 100 ? 82 : 118;
      s += `<path d="M${bx} ${by}L${x} ${y}" stroke="url(#g-arm)" stroke-width="12.5" stroke-linecap="round"/>` +
           `<path d="M${bx} ${by}L${x} ${y}" stroke="#a7b0bb" stroke-width="1.3" stroke-linecap="round" opacity=".5" transform="translate(-2.2 -2.2)"/>`;
    }
    for (const [x, y] of MOT) {   // motor bells
      s += `<circle cx="${x}" cy="${y}" r="15.5" fill="url(#g-shell)"/><circle cx="${x}" cy="${y}" r="11.5" fill="url(#g-motor)"/>` +
           `<circle cx="${x}" cy="${y}" r="7" fill="none" stroke="#2b3139" stroke-width="1.2" opacity=".7"/>`;
    }
    // gimbal camera out front, then the airframe over it
    s += '<rect x="85" y="29" width="30" height="25" rx="9" fill="url(#g-shell)"/><rect x="88.5" y="32.5" width="23" height="18" rx="7" fill="#232931"/>' +
         '<circle cx="100" cy="41.5" r="7.6" fill="url(#g-lens)"/><circle cx="97.3" cy="38.8" r="2.1" fill="#fff" opacity=".85"/>' +
         '<path d="M100 50C117 50 127 61 129 76L131 124C131 141 118 152 100 152C82 152 69 141 69 124L71 76C73 61 83 50 100 50Z" fill="url(#g-shell)"/>' +
         '<path d="M100 57C113 57 121 66 122.5 78L124 120C124 134 114 144 100 144C86 144 76 134 76 120L77.5 78C79 66 87 57 100 57Z" fill="url(#g-body)"/>' +
         '<path d="M86 71Q100 63.5 114 71" stroke="var(--acc)" stroke-width="3.4" fill="none" stroke-linecap="round"/>' +
         '<g fill="#5d6671" opacity=".75"><rect x="83" y="79" width="3.2" height="13" rx="1.6"/><rect x="113.8" y="79" width="3.2" height="13" rx="1.6"/></g>' +
         '<path d="M79.5 97H120.5M81.5 125H118.5" stroke="#76808c" stroke-width="1.3" opacity=".7"/>' +
         '<rect x="87.5" y="103" width="25" height="15" rx="4.5" fill="#1f242b" opacity=".9"/><rect x="91" y="106.5" width="18" height="2.4" rx="1.2" fill="var(--acc)"/>' +
         '<rect x="91" y="111" width="11" height="2" rx="1" fill="#6b7480"/>' +
         '<circle cx="100" cy="134" r="6.4" fill="#262b33"/><circle cx="100" cy="134" r="3.6" fill="#5b646f"/><circle cx="98.8" cy="132.8" r="1.2" fill="#c5ccd4"/>';
    for (const [x, y, dir] of MOT) {   // two-blade props with a blur disc
      s += `<g class="prop ${dir}" style="transform-origin:${x}px ${y}px"><circle cx="${x}" cy="${y}" r="37" fill="url(#g-disc)"/>` +
           `<path class="blade" d="M${x - 35} ${y}C${x - 20} ${y - 6} ${x - 6} ${y - 4.5} ${x} ${y}C${x + 6} ${y + 4.5} ${x + 20} ${y + 6} ${x + 35} ${y}` +
           `C${x + 20} ${y + 2} ${x + 6} ${y + 1.2} ${x} ${y}C${x - 6} ${y - 1.2} ${x - 20} ${y - 2} ${x - 35} ${y}Z" fill="#e3e8ee"/></g>` +
           `<circle cx="${x}" cy="${y}" r="4.2" fill="#1a1e24"/><circle cx="${x - 1}" cy="${y - 1}" r="1.4" fill="#9aa3ad"/>`;
    }
    for (const [x, y] of MOT) {   // navigation lights at the arm tips
      const lx = x < 100 ? x - 16 : x + 16, ly = y < 100 ? y - 16 : y + 16, red = y < 100;
      s += `<circle class="led" cx="${lx}" cy="${ly}" r="9.5" fill="url(#g-${red ? 'red' : 'green'})"/>` +
           `<circle cx="${lx}" cy="${ly}" r="2.4" fill="${red ? '#ffc2c2' : '#c4ffda'}"/>`;
    }
    return s + '</svg>';
  }
  const DRONE_SVG = droneSvg();
  document.querySelector('.banner-icon').innerHTML = DRONE_SVG;

  // ------------------------------------------------------------------ map
  const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
  const IMG = {
    latest: ESRI + 'World_Imagery/MapServer/tile/{z}/{y}/{x}',
    ohio: 'https://maps.ohio.gov/image/rest/services/osip_3_cache/MapServer/tile/{z}/{y}/{x}',   // OSIP III leaf-off, 3-6 in
    wbCfg: 'https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json',
    wbMap: 'https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tilemap/',
  };
  const OHIO = [-84.83, 38.40, -80.51, 41.98];
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem('rid.' + k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem('rid.' + k, JSON.stringify(v)); } catch (e) { } },
  };
  S.base = store.get('base') || 'latest';
  S.hist = store.get('hist');
  S.histList = [];
  const map = new maplibregl.Map({
    container: 'map',
    style: {
      version: 8,
      sources: {
        sat: { type: 'raster', tiles: [IMG.latest], tileSize: 256, maxzoom: 19,
          attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' },
        osip: { type: 'raster', tiles: [IMG.ohio], tileSize: 256, minzoom: 7, maxzoom: 21, bounds: OHIO,
          attribution: 'Ohio leaf-off imagery: OGRIP OSIP III' },
        roads: { type: 'raster', tiles: [ESRI + 'Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19 },
        places: { type: 'raster', tiles: [ESRI + 'Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19 },
        dem: { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 15,
          encoding: 'terrarium', attribution: 'Terrain: Mapzen, AWS Open Data' },
      },
      glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#0a0d12' } },
        { id: 'sat', type: 'raster', source: 'sat', paint: { 'raster-fade-duration': 150 } },
        { id: 'osip', type: 'raster', source: 'osip', layout: { visibility: 'none' }, paint: { 'raster-fade-duration': 150 } },
        { id: 'roads', type: 'raster', source: 'roads', paint: { 'raster-opacity': 0.85 } },
        { id: 'places', type: 'raster', source: 'places' },
      ],
    },
    center: [-81.44, 40.67], zoom: 11, maxZoom: 21, maxPitch: 80, attributionControl: false, fadeDuration: 120,
  });
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'top-right');
  function placeAttrib() { const c = $('#controls'), el = document.querySelector('.maplibregl-ctrl-top-right'); if (c && el) el.style.top = (c.getBoundingClientRect().bottom + 6) + 'px'; }
  window.addEventListener('resize', placeAttrib); setTimeout(placeAttrib, 0);
  window.RIDmap = map;   // for debugging over USB (chrome://inspect)
  const EMPTY = { type: 'FeatureCollection', features: [] };
  const fc = features => ({ type: 'FeatureCollection', features });

  map.on('load', () => {
    // Terrain is switched on only in 3D view (apply3d). In 2D it made the drone and pilot icons
    // jump around while zooming, as coarser or finer elevation tiles loaded under them.
    const src = (id, extra) => map.addSource(id, Object.assign({ type: 'geojson', data: EMPTY }, extra || {}));
    ['sua', 'nofly', 'stadium', 'laanc', 'topilot', 'meacc', 'airtrails', 'trailold', 'links', 'shadow', 'stalk', 'trail3d', 'drone3d', 'airspace', 'airports'].forEach(id => src(id));
    src('trail', { lineMetrics: true });
    addAviationLayers();
    map.addLayer({ id: 'meacc', type: 'fill', source: 'meacc', paint: { 'fill-color': '#3b82f6', 'fill-opacity': 0.13 } });
    // straight dashed line from you to the pilot (as the crow flies, not a road route), in that drone's colour on a dark casing
    map.addLayer({ id: 'topilot-case', type: 'line', source: 'topilot', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#05080c', 'line-opacity': 0.55, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 4, 16, 6] } });
    map.addLayer({ id: 'topilot', type: 'line', source: 'topilot', layout: { 'line-join': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2.2, 16, 3.2], 'line-dasharray': [2, 1.6] } });
    map.addLayer({ id: 'airtrails', type: 'line', source: 'airtrails', paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-opacity': 0.6, 'line-dasharray': [1.5, 1.5] } });
    // Flight paths: one opaque line per drone on a dark casing, so crossings never stack into blotches.
    const lineLayout = { 'line-cap': 'round', 'line-join': 'round' };
    map.addLayer({ id: 'trailold-case', type: 'line', source: 'trailold', layout: lineLayout,
      paint: { 'line-color': '#9aa3af', 'line-opacity': 0.7, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.4, 17, 3.8] } });
    map.addLayer({ id: 'trailold', type: 'line', source: 'trailold', layout: lineLayout,
      paint: { 'line-color': '#4b5563', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.1, 17, 1.9] } });
    map.addLayer({ id: 'trail-case', type: 'line', source: 'trail', layout: lineLayout,
      paint: { 'line-color': ['get', 'edge'], 'line-opacity': 0.8, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.4, 17, 3.8] } });
    // one path layer per drone color (a gradient can't vary per feature), each fading from dark to full color
    PAL.forEach((c, i) => map.addLayer({ id: 'trail-' + i, type: 'line', source: 'trail', filter: ['==', ['get', 'ci'], i], layout: lineLayout,
      paint: {
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.1, 17, 1.9],
        'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, shade(c, 0.3), 0.6, shade(c, 0.45), 1, shade(c, 0.58)],
      } }));
    map.addLayer({ id: 'links', type: 'line', source: 'links', paint: { 'line-color': ['get', 'color'], 'line-width': 2.4, 'line-dasharray': [1.2, 1.4], 'line-opacity': 0.95 } });
    map.addLayer({ id: 'shadow', type: 'fill', source: 'shadow', paint: { 'fill-color': '#000', 'fill-opacity': 0.38 } });
    for (const id of ['stalk', 'trail3d', 'drone3d']) {
      map.addLayer({ id, type: 'fill-extrusion', source: id, paint: {
        'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': ['get', 'top'], 'fill-extrusion-base': ['get', 'base'],
        'fill-extrusion-opacity': id === 'stalk' ? 0.45 : 0.95, 'fill-extrusion-vertical-gradient': false,
      } });
    }
    try { map.addLayer(PATH3D); } catch (e) { log('JS', 'path3d layer: ' + e); }
    S.mapReady = true;
    setTimeout(() => { if (CLOUDS.on) loadClouds(); }, 500);
    const attr = document.querySelector('.maplibregl-ctrl-attrib');
    if (attr) attr.classList.remove('maplibregl-compact-show');
    applyLabels();
    applyBase();
    apply3d();
    if (S.st) renderMap();
  });
  map.on('click', e => {
    const lay = ids => ids.filter(id => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none');
    const ap = map.queryRenderedFeatures(e.point, { layers: lay(['ap-dot', 'hp-dot']) });
    if (ap.length) { S.apt = ap[0].properties; S.aptLL = ap[0].geometry.coordinates; select('apt', S.apt.code || S.apt.IDENT, false); return; }
    const lines = S.settings.airspace !== false ? avLines(e.point) : [];
    if (lines.length || CLOUDS.on) cloudAt(e.lngLat, lines.slice(0, 5)); else if (cloudPop) { cloudPop.remove(); cloudPop = null; }
    if (S.sel) deselect(); else if (S.sheet !== 'peek') setSheet('peek');
  });
  map.on('dragstart', () => { if (S.follow) { S.follow = false; S.view = ''; renderSheet(); } });
  map.on('rotate', rotateMarkers);
  // Switch 3D on/off only when a tilt has finished: changing terrain mid-animation cancelled the tilt
  // and left the map stuck nearly flat in "3D" (seen on the S24 screen recording).
  map.on('pitchend', () => { const on = map.getPitch() > 15; if (on !== S.mode3d) { S.mode3d = on; apply3d(); if (S.st) renderMap(); } });
  function go3d(opts) {   // terrain first, wait until its heights have loaded, then tilt (else the scene sits too high)
    const tilt = () => map.easeTo(Object.assign({ pitch: 62, duration: 1200 }, opts || {}));
    if (S.mode3d) { tilt(); return; }
    S.mode3d = true; apply3d();
    let done = false;
    const go = () => { if (!done) { done = true; tilt(); } };
    map.once('idle', go);
    setTimeout(go, 1800);
  }
  map.on('zoomend', () => { if (S.st && S.mode3d) render3d(); });
  // In 3D, lift each drone's tag up to the drone's real height so it sits on the floating model and path
  // (it used to stay on the ground underneath, making the path look like it ran beside the drone).
  function float3dMarkers() {
    const t = map.transform;
    for (const [id, m] of mk.drone) {
      const d = S.st && S.st.drones.find(x => x.id === id);
      if (!S.mode3d || !map.terrain || !d || !hasPos(d) || typeof t.coordinatePoint !== 'function') {
        if (m.lifted) { m.marker.setOffset([0, 0]); m.lifted = false; }
        continue;
      }
      try {
        const ll = maplibregl.LngLat.convert([d.lon, d.lat]), mc = maplibregl.MercatorCoordinate.fromLngLat(ll);
        const ground = map.terrain.getElevationForLngLatZoom(ll, t.tileZoom) || 0, h = Math.max(1, d.height || 0) * (map.terrain.exaggeration || 1);
        const p0 = t.coordinatePoint(mc, ground, t.pixelMatrix3D), p1 = t.coordinatePoint(mc, ground + h, t.pixelMatrix3D);
        m.marker.setOffset([p1.x - p0.x, p1.y - p0.y]);
        m.lifted = true;
      } catch (e) { }
    }
  }
  map.on('render', float3dMarkers);
  map.on('zoom', () => map.getContainer().classList.toggle('far', map.getZoom() < 11.5));   // hide name tags when zoomed far out

  /** Ground elevation above sea level (m) at a point, read straight from a terrain tile (z13, ~15 m pixels).
   *  Returns null until that tile has downloaded; the drone card refreshes every second. */
  const DEM = new Map();
  function groundAt(lat, lon) {
    const z = 13, n = 2 ** z;
    const xf = (lon + 180) / 360 * n, yf = (1 - Math.log(Math.tan(rad(lat)) + 1 / Math.cos(rad(lat))) / Math.PI) / 2 * n;
    const x = Math.floor(xf), y = Math.floor(yf), key = `${z}/${x}/${y}`, t = DEM.get(key);
    if (!t) {
      DEM.set(key, 'loading');
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const c = document.createElement('canvas'); c.width = c.height = 256;
          const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
          DEM.set(key, g.getImageData(0, 0, 256, 256).data);
        } catch (e) { DEM.set(key, 'err'); }
      };
      img.onerror = () => DEM.set(key, 'err');
      img.src = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${key}.png`;
      return null;
    }
    if (typeof t === 'string') return null;
    const px = Math.min(255, Math.floor((xf - x) * 256)), py = Math.min(255, Math.floor((yf - y) * 256)), i = (py * 256 + px) * 4;
    return t[i] * 256 + t[i + 1] + t[i + 2] / 256 - 32768;   // Terrarium encoding
  }

  function pad() {
    const vis = Math.max(116, sheet.offsetHeight - stops()[S.sheet]) + S.safeBottom + 6;   // where the sheet is going, not mid-slide
    return { top: S.safeTop + 90, bottom: Math.min(vis + 56, window.innerHeight * 0.66), left: 44, right: 80 };
  }

  // ------------------------------------------------------------------ 3D geometry (floating drone + trail)
  function off(lat, lon, dx, dy) { return [lon + dx / (111320 * Math.cos(rad(lat))), lat + dy / M_LAT]; }
  function ring(lat, lon, r, n) { const c = []; for (let i = 0; i <= n; i++) { const a = i / n * 2 * Math.PI; c.push(off(lat, lon, r * Math.sin(a), r * Math.cos(a))); } return c; }
  function box(lat, lon, len, wid, deg) {
    const a = rad(deg), ux = Math.sin(a), uy = Math.cos(a), vx = Math.cos(a), vy = -Math.sin(a);
    return [[1, 1], [1, -1], [-1, -1], [-1, 1], [1, 1]].map(([p, q]) => off(lat, lon, ux * len / 2 * p + vx * wid / 2 * q, uy * len / 2 * p + vy * wid / 2 * q));
  }
  const poly = (coords, props) => ({ type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [coords] } });
  function mpp() { const c = map.getCenter(); return 40075016.686 * Math.cos(rad(c.lat)) / (512 * Math.pow(2, map.getZoom())); }

  function droneModel(d, h, s, live) {
    const f = [], hd = iconHeading(d) || 0, body = live ? dcol(d) : '#94a3b8', arm = '#1d232c';
    const base = Math.max(h, 1), top = base + s * 0.1;
    f.push(poly(box(d.lat, d.lon, s * 1.3, s * 0.11, hd + 45), { base, top, color: arm }));
    f.push(poly(box(d.lat, d.lon, s * 1.3, s * 0.11, hd - 45), { base, top, color: arm }));
    f.push(poly(box(d.lat, d.lon, s * 0.44, s * 0.28, hd), { base: base - s * 0.05, top: top + s * 0.07, color: body }));
    for (const k of [45, 135, 225, 315]) {
      const a = rad(hd + k), [lo, la] = off(d.lat, d.lon, Math.sin(a) * s * 0.62, Math.cos(a) * s * 0.62);
      f.push(poly(ring(la, lo, s * 0.27, 20), { base: top, top: top + s * 0.03, color: live ? '#ffd2b0' : '#cbd5e1' }));
    }
    const [nlo, nla] = off(d.lat, d.lon, Math.sin(rad(hd)) * s * 0.3, Math.cos(rad(hd)) * s * 0.3);
    f.push(poly(box(nla, nlo, s * 0.12, s * 0.16, hd), { base, top: top + s * 0.08, color: '#ffffff' }));
    return f;
  }
  function trailColor(f) {
    const a = [110, 82, 18], b = [255, 214, 10], m = Math.pow(f, 0.7);
    return `rgb(${a.map((x, j) => Math.round(x + (b[j] - x) * m)).join(',')})`;
  }
  // ---------- smooth flight paths: drop hover jitter and bad fixes, simplify, then round the corners
  function cleanTrack(tr) {
    const out = [];
    for (const p of tr) {
      const q = out[out.length - 1];
      if (q) {
        const dm = dist(q[1], q[2], p[1], p[2]), dt = Math.max(0.5, p[0] - q[0]);
        if (dm < 1.5 && Math.abs((p[3] || 0) - (q[3] || 0)) < 2) continue;   // hovering: GPS wander
        if (dm / dt > 45) continue;                                           // > 100 mph jump = bad fix
      }
      out.push(p);
    }
    const last = tr[tr.length - 1], end = out[out.length - 1];
    if (last && end !== last && dist(end[1], end[2], last[1], last[2]) < 1.5) out[out.length - 1] = last;   // end exactly at the drone
    return out;
  }
  function simplify(P, tol) {   // Douglas-Peucker in local metres (x, y, height)
    if (P.length < 3) return P;
    const keep = new Uint8Array(P.length), stack = [[0, P.length - 1]];
    keep[0] = keep[P.length - 1] = 1;
    while (stack.length) {
      const [a, b] = stack.pop(), A = P[a], B = P[b];
      const dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2], L2 = dx * dx + dy * dy + dz * dz || 1e-9;
      let md = 0, mi = -1;
      for (let i = a + 1; i < b; i++) {
        const p = P[i];
        let t = ((p[0] - A[0]) * dx + (p[1] - A[1]) * dy + (p[2] - A[2]) * dz) / L2;
        t = Math.max(0, Math.min(1, t));
        const ex = A[0] + t * dx - p[0], ey = A[1] + t * dy - p[1], ez = A[2] + t * dz - p[2], dd = ex * ex + ey * ey + ez * ez;
        if (dd > md) { md = dd; mi = i; }
      }
      if (mi >= 0 && md > tol * tol) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
    }
    return P.filter((_, i) => keep[i]);
  }
  function chaikin(P, iters) {
    let Q = P;
    for (let k = 0; k < iters && Q.length > 2; k++) {
      const R = [Q[0]];
      for (let i = 0; i < Q.length - 1; i++) {
        const a = Q[i], b = Q[i + 1];
        R.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1], 0.75 * a[2] + 0.25 * b[2]],
               [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1], 0.25 * a[2] + 0.75 * b[2]]);
      }
      R.push(Q[Q.length - 1]);
      Q = R;
    }
    return Q;
  }
  const smoothCache = new Map();
  function smoothPath(d) {
    const tr = d.track;
    if (!tr || tr.length < 2) return null;
    const key = tr.length + ':' + tr[tr.length - 1][0] + ':' + tr[0][0];
    const c = smoothCache.get(d.id);
    if (c && c.key === key) return c;
    const clean = cleanTrack(tr);
    if (clean.length < 2) return null;
    const lat0 = clean[0][1], lon0 = clean[0][2], kx = 111320 * Math.cos(rad(lat0));
    const local = clean.map(p => [(p[2] - lon0) * kx, (p[1] - lat0) * M_LAT, p[3] == null ? 0 : p[3]]);
    const P = chaikin(simplify(local, 0.8), 3);
    const r = { key, lat0, lon0, kx, P, coords: P.map(p => [lon0 + p[0] / kx, lat0 + p[1] / M_LAT]) };
    smoothCache.set(d.id, r);
    return r;
  }
  /** Direction of travel over the last ~12 m of the smoothed path (deg), or null when hovering. */
  function courseOf(d) {
    const r = smoothPath(d);
    if (!r || r.P.length < 2 || !isLive(d) || (d.speed || 0) < 1.2) return null;
    const P = r.P, end = P[P.length - 1];
    let k = P.length - 2, acc = 0;
    for (; k > 0; k--) { acc += Math.hypot(P[k + 1][0] - P[k][0], P[k + 1][1] - P[k][1]); if (acc > 12) break; }
    const dx = end[0] - P[k][0], dy = end[1] - P[k][1];
    if (Math.hypot(dx, dy) < 4) return null;
    return (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
  }
  /** Icon direction: travel direction while moving (so the path leaves from the tail), nose direction while hovering. */
  function iconHeading(d) { const c = courseOf(d); return c != null ? c : hdgOf(d); }

  // ---------- 3D flight path drawn on the GPU: a thin, smooth line at the drone's real height,
  // constant width in screen pixels, darker in the middle with a lighter edge, fading with age.
  const PATH3D = {
    id: 'path3d', type: 'custom', renderingMode: '3d', count: 0,
    onAdd(m, gl) {
      const vs = `
        uniform mat4 u_matrix; uniform vec2 u_half; uniform float u_width; uniform float u_zoff;
        attribute vec3 a_pos; attribute vec3 a_prev; attribute vec3 a_next; attribute float a_side; attribute float a_t; attribute vec3 a_col;
        varying float v_side; varying float v_t; varying vec3 v_col;
        vec2 scr(vec4 c) { return c.xy / c.w * u_half; }
        void main() {
          vec3 z = vec3(0.0, 0.0, u_zoff);
          vec4 c = u_matrix * vec4(a_pos - z, 1.0);
          vec2 cs = scr(c), ps = scr(u_matrix * vec4(a_prev - z, 1.0)), ns = scr(u_matrix * vec4(a_next - z, 1.0));
          vec2 d1 = cs - ps, d2 = ns - cs;
          d1 = length(d1) < 1e-4 ? d2 : normalize(d1);
          d2 = length(d2) < 1e-4 ? d1 : normalize(d2);
          vec2 dir = d1 + d2; dir = length(dir) < 1e-4 ? d1 : normalize(dir);
          vec2 nrm = vec2(-dir.y, dir.x);
          float miter = 1.0 / max(dot(nrm, vec2(-d1.y, d1.x)), 0.6);
          vec2 off = nrm * a_side * u_width * 0.5 * miter;
          gl_Position = c + vec4(off / u_half * c.w, 0.0, 0.0);
          v_side = a_side; v_t = a_t; v_col = a_col;
        }`;
      const fs = `
        precision mediump float;
        varying float v_side; varying float v_t; varying vec3 v_col;
        void main() {
          float e = abs(v_side);
          vec3 core = v_col * 0.55, edge = mix(v_col * 0.85, vec3(1.0), 0.12);
          vec3 col = mix(core, edge, smoothstep(0.35, 0.8, e));
          float a = (1.0 - smoothstep(0.78, 1.0, e)) * mix(0.3, 0.92, v_t);
          gl_FragColor = vec4(col * a, a);
        }`;
      const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) log('JS', 'path3d shader: ' + gl.getShaderInfoLog(s)); return s; };
      const p = this.prog = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
      this.loc = {};
      for (const a of ['a_pos', 'a_prev', 'a_next', 'a_side', 'a_t', 'a_col']) this.loc[a] = gl.getAttribLocation(p, a);
      for (const u of ['u_matrix', 'u_half', 'u_width', 'u_zoff']) this.loc[u] = gl.getUniformLocation(p, u);
      this.vbo = gl.createBuffer(); this.ibo = gl.createBuffer();
    },
    upload(gl, verts, idx) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo); gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.DYNAMIC_DRAW);
      this.count = idx.length;
    },
    render(gl, matrix) {
      if (!S.mode3d || !this.count) return;
      if (this.pending) { this.upload(gl, this.pending.v, this.pending.i); this.pending = null; }
      const L = this.loc, F = 4, stride = 15 * F;
      if (gl.bindVertexArray) gl.bindVertexArray(null);   // never touch the map's own vertex arrays
      gl.useProgram(this.prog);
      gl.uniformMatrix4fv(L.u_matrix, false, matrix);
      gl.uniform2f(L.u_half, gl.drawingBufferWidth / 2, gl.drawingBufferHeight / 2);
      gl.uniform1f(L.u_width, 2.6 * (window.devicePixelRatio || 1));
      gl.uniform1f(L.u_zoff, maplibregl.MercatorCoordinate.fromLngLat(map.getCenter(), map.transform.elevation || 0).z);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
      const attr = (n, size, off) => { gl.enableVertexAttribArray(L[n]); gl.vertexAttribPointer(L[n], size, gl.FLOAT, false, stride, off * F); };
      attr('a_pos', 3, 0); attr('a_prev', 3, 3); attr('a_next', 3, 6); attr('a_side', 1, 9); attr('a_t', 1, 10); attr('a_col', 3, 11);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(false);
      gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_SHORT, 0);
      gl.depthMask(true);
      for (const n of ['a_pos', 'a_prev', 'a_next', 'a_side', 'a_t', 'a_col']) gl.disableVertexAttribArray(L[n]);
    },
  };
  /** Rebuild the GPU path buffers from every drone's smoothed path (called once a second). */
  function updatePath3d() {
    if (!S.mode3d || !map.getLayer('path3d') || !S.st) { PATH3D.count = 0; PATH3D.pending = null; return; }
    const V = [], I = [];
    const groundOf = (lon, lat) => {
      let g = null;
      try { if (map.terrain) g = map.terrain.getElevationForLngLatZoom(maplibregl.LngLat.convert([lon, lat]), map.transform.tileZoom); } catch (e) { }
      if (g == null || g === 0) g = groundAt(lat, lon);
      return g;
    };
    for (const d of S.st.drones) {
      if (!hasPos(d) || S.t - d.lastSeen > SHOW_S) continue;
      const r = smoothPath(d);
      if (!r || r.P.length < 2) continue;
      let P = r.P;
      if (P.length > 1500) { const st = Math.ceil(P.length / 1500), Q = []; for (let i = 0; i < P.length; i += st) Q.push(P[i]); if (Q[Q.length - 1] !== P[P.length - 1]) Q.push(P[P.length - 1]); P = Q; }
      const g0 = groundOf(d.lon, d.lat);
      if (g0 == null) continue;   // terrain not loaded yet: wait rather than draw the path at sea level
      const hexToRgb = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
      const col = isLive(d) ? hexToRgb(dcol(d)) : [0.58, 0.64, 0.72];
      const pts = P.map(p => {
        const lon = r.lon0 + p[0] / r.kx, lat = r.lat0 + p[1] / M_LAT, g = groundOf(lon, lat);
        const mc = maplibregl.MercatorCoordinate.fromLngLat([lon, lat], (g == null ? g0 : g) + Math.max(1, p[2]));
        return [mc.x, mc.y, mc.z];
      });
      const n = pts.length, base = V.length / 15;
      if (base + n * 2 > 65000) break;
      for (let i = 0; i < n; i++) {
        const c = pts[i], pv = pts[Math.max(0, i - 1)], nx = pts[Math.min(n - 1, i + 1)], t = i / (n - 1);
        for (const side of [-1, 1]) V.push(c[0], c[1], c[2], pv[0], pv[1], pv[2], nx[0], nx[1], nx[2], side, t, col[0], col[1], col[2], 0);
        if (i < n - 1) { const a = base + i * 2; I.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
    }
    PATH3D.pending = { v: new Float32Array(V), i: new Uint16Array(I) };
    PATH3D.count = I.length;
    map.triggerRepaint();
  }

  /** 3D path (old block version, no longer drawn): one continuous ribbon at the drone's height, sharing edges between pieces (no gaps, no overlaps). */
  function ribbon3d(d, w, live) {
    const r = smoothPath(d);
    if (!r || r.P.length < 2) return [];
    let P = r.P;
    if (P.length > 900) { const st = Math.ceil(P.length / 900), Q = []; for (let i = 0; i < P.length; i += st) Q.push(P[i]); if (Q[Q.length - 1] !== P[P.length - 1]) Q.push(P[P.length - 1]); P = Q; }
    const m = P.length, Lf = [], Rt = [], t = Math.max(0.35, w * 0.4);
    for (let i = 0; i < m; i++) {
      const a = P[Math.max(0, i - 1)], b = P[Math.min(m - 1, i + 1)];
      let dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
      Lf.push([P[i][0] - dy * w / 2, P[i][1] + dx * w / 2]);
      Rt.push([P[i][0] + dy * w / 2, P[i][1] - dx * w / 2]);
    }
    const ll = q => [r.lon0 + q[0] / r.kx, r.lat0 + q[1] / M_LAT], out = [];
    for (let i = 0; i < m - 1; i++) {
      const h = Math.max(1, (P[i][2] + P[i + 1][2]) / 2);
      out.push(poly([Lf[i], Lf[i + 1], Rt[i + 1], Rt[i], Lf[i]].map(ll), { base: h - t, top: h + t,
        color: live ? shade(dcol(d), 0.38 + 0.62 * Math.pow(i / Math.max(1, m - 2), 0.7)) : '#8792a3' }));
    }
    return out;
  }

  function render3d() {
    if (!S.mapReady || !S.st) return;
    const set = (id, f) => { const s = map.getSource(id); if (s) s.setData(fc(f)); };
    if (!S.mode3d) { ['shadow', 'stalk', 'trail3d', 'drone3d'].forEach(id => set(id, [])); return; }
    const m = mpp(), s = Math.min(120, Math.max(3, m * 34)), w = Math.min(10, Math.max(0.6, m * 3.2));
    const drones = [], trail = [], stalk = [], shadow = [];
    for (const d of S.st.drones) {
      if (!hasPos(d) || S.t - d.lastSeen > SHOW_S) continue;
      const live = isLive(d), h = Math.max(0, d.height || 0);
      drones.push(...droneModel(d, h, s, live));
      // (the floating path is now drawn by PATH3D)
      if (h > 2) stalk.push(poly(box(d.lat, d.lon, w * 0.4, w * 0.4, 0), { base: 0, top: Math.max(h, 1), color: live ? '#ffb37a' : '#94a3b8' }));
      shadow.push(poly(ring(d.lat, d.lon, s * 0.55, 28), {}));
    }
    set('drone3d', drones); set('trail3d', trail); set('stalk', stalk); set('shadow', shadow);
    if (S.settings.trail3d) updatePath3d(); else { PATH3D.count = 0; PATH3D.pending = null; }
  }

  function apply3d() {
    $('#btn-3d').classList.toggle('on', S.mode3d);
    $('#btn-3d span').textContent = S.mode3d ? '2D' : '3D';
    for (const m of mk.drone.values()) m.el.classList.toggle('flat', S.mode3d);
    if (!S.mapReady) return;
    try {
      if (S.mode3d && !map.getTerrain()) map.setTerrain({ source: 'dem', exaggeration: 1 });
      if (!S.mode3d && map.getTerrain()) map.setTerrain(null);
    } catch (e) { log('JS', 'terrain: ' + e); }
    for (const id of ['shadow', 'stalk', 'trail3d', 'drone3d']) map.setLayoutProperty(id, 'visibility', S.mode3d ? 'visible' : 'none');
    // in 3D only the floating path shows (no second copy on the ground)
    for (const id of [...PAL.map((_, i) => 'trail-' + i), 'trail-case', 'trailold', 'trailold-case']) map.setLayoutProperty(id, 'visibility', S.mode3d ? 'none' : 'visible');
    render3d();
  }
  function applyLabels() {
    if (!S.mapReady) return;
    for (const id of ['roads', 'places']) map.setLayoutProperty(id, 'visibility', S.settings.labels ? 'visible' : 'none');
  }

  // ------------------------------------------------------------------ imagery: latest, Ohio leaf-off, history by date
  function tileXY(lat, lon, z) {
    const n = 2 ** z, x = Math.floor((lon + 180) / 360 * n);
    const y = Math.floor((1 - Math.log(Math.tan(rad(lat)) + 1 / Math.cos(rad(lat))) / Math.PI) / 2 * n);
    return [x, y];
  }
  const tileUrl = (tpl, z, x, y) => tpl.replace('{z}', z).replace('{y}', y).replace('{x}', x);
  const inOhio = (lat, lon) => lon >= OHIO[0] && lon <= OHIO[2] && lat >= OHIO[1] && lat <= OHIO[3];

  function setHist(h) {
    if (map.getLayer('hist')) map.removeLayer('hist');
    if (map.getSource('hist')) map.removeSource('hist');
    map.addSource('hist', { type: 'raster', tiles: [h.url], tileSize: 256, maxzoom: 19,
      attribution: 'Imagery © Esri World Imagery Wayback' + (h.provider ? ', ' + h.provider : '') });
    map.addLayer({ id: 'hist', type: 'raster', source: 'hist' }, 'roads');
  }
  // ---------- Google satellite through Google's official Map Tiles API (your own key, kept on the phone)
  const GOOG = { key: store.get('gkey') || '', session: store.get('gsession'), shown: null };
  async function googleSession() {
    if (!GOOG.key) throw new Error('No Google Maps key yet. Paste it in Settings.');
    const s = GOOG.session;
    if (s && s.key === GOOG.key && s.expiry * 1000 > Date.now() + 3600e3) return s.token;
    const r = await fetch('https://tile.googleapis.com/v1/createSession?key=' + encodeURIComponent(GOOG.key), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mapType: 'satellite', language: 'en-US', region: 'US' }) });
    const j = await r.json();
    if (!j.session) throw new Error((j.error && j.error.message) || 'Google did not start a map session');
    GOOG.session = { token: j.session, expiry: +j.expiry, key: GOOG.key };
    store.set('gsession', GOOG.session);
    return j.session;
  }
  const googleUrl = token => `https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=${token}&key=${encodeURIComponent(GOOG.key)}`;
  async function setGoogle() {
    try {
      const url = googleUrl(await googleSession());
      if (S.base !== 'google') return;
      if (map.getLayer('goog') && GOOG.shown === url) return;
      if (map.getLayer('goog')) map.removeLayer('goog');
      if (map.getSource('goog')) map.removeSource('goog');
      map.addSource('goog', { type: 'raster', tiles: [url], tileSize: 256, maxzoom: 21, attribution: 'Imagery © Google' });
      map.addLayer({ id: 'goog', type: 'raster', source: 'goog' }, 'roads');
      GOOG.shown = url;
      $('#google-mark').classList.remove('hidden');
    } catch (e) {
      toast(esc(String(e.message || e)), 7000);
      log('GOOGLE', String(e.message || e));
      S.base = 'latest'; store.set('base', S.base); applyBase();
    }
  }
  function applyBase() {
    if (!S.mapReady) return;
    if (S.base === 'hist' && !S.hist) S.base = 'latest';
    if (S.base === 'google') setGoogle();
    else {
      if (map.getLayer('goog')) map.removeLayer('goog');
      if (map.getSource('goog')) map.removeSource('goog');
      GOOG.shown = null;
      $('#google-mark').classList.add('hidden');
    }
    map.setLayoutProperty('osip', 'visibility', S.base === 'ohio' ? 'visible' : 'none');
    if (S.base === 'hist') { if (!map.getLayer('hist') || S.histShown !== S.hist.url) { setHist(S.hist); S.histShown = S.hist.url; } }
    else if (map.getLayer('hist')) { map.removeLayer('hist'); map.removeSource('hist'); S.histShown = null; }
    markImagery();
  }
  function markImagery() {
    for (const b of document.querySelectorAll('#imagery [data-base]')) b.classList.toggle('on', S.base === b.dataset.base);
    for (const b of document.querySelectorAll('#imagery [data-num]')) b.classList.toggle('on', S.base === 'hist' && !!S.hist && S.hist.num === +b.dataset.num);
  }

  let WB = null;
  async function wayback() {
    if (WB) return WB;
    const cfg = await (await fetch(IMG.wbCfg)).json();
    WB = Object.entries(cfg).map(([k, v]) => ({
      num: +k, rel: (v.itemTitle.match(/\d{4}-\d{2}-\d{2}/) || [''])[0], meta: v.metadataLayerUrl,
      url: v.itemURL.replace('{level}', '{z}').replace('{row}', '{y}').replace('{col}', '{x}'),
    })).filter(r => r.rel).sort((a, b) => b.rel.localeCompare(a.rel));
    return WB;
  }
  /** Capture date, resolution and provider of the photo under a point, from Esri's imagery metadata. */
  async function captureInfo(r, lat, lon, z) {
    // Metadata layer n covers map scales 106*2^(n-1) .. 106*2^n (layer 0 = 1.9 cm ... layer 6 = 1.2 m);
    // pick the one matching zoom z, then its neighbours.
    const scale = 591657527.59 / Math.pow(2, z);
    const L0 = Math.max(0, Math.min(13, Math.ceil(Math.log2(scale / 106))));
    for (const L of [L0, L0 - 1, L0 + 1].filter(n => n >= 0 && n <= 13)) {
      try {
        const u = `${r.meta}/${L}/query?geometry=${lon.toFixed(6)},${lat.toFixed(6)}&geometryType=esriGeometryPoint&inSR=4326` +
          '&spatialRel=esriSpatialRelIntersects&outFields=SRC_DATE2,SRC_RES,NICE_NAME,NICE_DESC&returnGeometry=false&f=json';
        const d = await (await fetch(u)).json();
        const a = d.features && d.features[0] && d.features[0].attributes;
        if (a) return { date: a.SRC_DATE2, res: a.SRC_RES, name: a.NICE_NAME, provider: a.NICE_DESC };
      } catch (e) { }
    }
    return {};
  }
  function describe(h) {
    const d = h.date ? new Date(h.date) : null, m = d ? d.getUTCMonth() + 1 : null;
    return {
      title: d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : 'Published ' + h.rel,
      sub: [h.provider, h.name, h.res ? Math.round(h.res * 100) + ' cm' : null].filter(Boolean).join(' · '),
      leafOff: !!m && (m >= 11 || m <= 4),
    };
  }
  let histToken = 0;
  async function loadImagery() {
    const c = map.getCenter(), tok = ++histToken;
    const [tx, ty] = tileXY(c.lat, c.lng, 16);
    $('#imagery [data-thumb="latest"]').src = tileUrl(IMG.latest, 16, tx, ty);
    const oh = inOhio(c.lat, c.lng);
    const gT = $('#imagery [data-thumb="google"]');
    if (GOOG.key) {
      $('#cap-google').textContent = 'Google satellite, usually the newest photos';
      googleSession().then(t => { gT.style.visibility = ''; gT.src = tileUrl(googleUrl(t), 16, tx, ty); })
        .catch(e => { $('#cap-google').textContent = String(e.message || e); gT.style.visibility = 'hidden'; });
    } else {
      gT.style.visibility = 'hidden';
      $('#cap-google').textContent = 'Add your Google Maps API key in Settings to use this.';
    }
    const ohT = $('#imagery [data-thumb="ohio"]');
    ohT.style.visibility = oh ? '' : 'hidden';
    if (oh) ohT.src = tileUrl(IMG.ohio, 16, tx, ty);
    $('#cap-ohio').textContent = oh ? 'Statewide aerial photos (OSIP III, 2017–2024). Sharpest close-up; Ohio only.' : 'Only covers Ohio. Outside Ohio the latest satellite shows instead.';
    const box = $('#hist-list');
    box.innerHTML = '<div class="set-sub">Finding the photo dates for this spot…</div>';
    try {
      const rel = await wayback();
      const z = 17, [x, y] = tileXY(c.lat, c.lng, z), found = [];
      let i = 0, guard = 0;
      while (i < rel.length && found.length < 8 && guard++ < 20) {
        const tm = await (await fetch(`${IMG.wbMap}${rel[i].num}/${z}/${y}/${x}`)).json();
        if (tok !== histToken) return;
        if (!tm.data || tm.data[0] !== 1) break;
        const k = rel.findIndex(r => r.num === ((tm.select && tm.select[0]) || rel[i].num));
        const r = k >= 0 ? rel[k] : rel[i];
        if (!found.includes(r)) found.push(r);
        box.innerHTML = `<div class="set-sub">Finding the photo dates for this spot… ${found.length} found</div>`;
        i = (k >= 0 ? k : i) + 1;
      }
      const metas = await Promise.all(found.map(r => captureInfo(r, c.lat, c.lng, z)));
      if (tok !== histToken) return;
      // one row per real photo: drop releases that only re-published the same capture
      S.histList = [];
      found.forEach((r, j) => {
        const h = Object.assign({}, r, metas[j]), prev = S.histList[S.histList.length - 1];
        if (prev && h.date && prev.date === h.date) return;   // same capture (Maxar was renamed Vantor)
        S.histList.push(h);
      });
      if (S.histList[0]) {
        const t = describe(S.histList[0]);
        $('#cap-latest').innerHTML = `Taken ${esc(t.title)}${t.sub ? ' · ' + esc(t.sub) : ''} ${t.leafOff ? '<span class="pill leaf">LEAF-OFF</span>' : ''}`;
      }
      box.innerHTML = S.histList.length ? S.histList.map((h, j) => {
        const t = describe(h);
        return `<button class="img-opt" data-num="${h.num}"><img class="thumb" src="${tileUrl(h.url, 16, tx, ty)}" alt="">
          <div class="img-txt"><div class="set-name">${esc(t.title)}${j === 0 ? ' <span class="pill now">NEWEST</span>' : ''}${t.leafOff ? ' <span class="pill leaf">LEAF-OFF</span>' : ''}</div>
          <div class="set-sub">${esc(t.sub || 'Esri World Imagery')}</div></div><span class="radio"></span></button>`;
      }).join('') : '<div class="set-sub">No older imagery for this spot.</div>';
      markImagery();
    } catch (e) {
      if (tok === histToken) box.innerHTML = '<div class="set-sub">Could not load the imagery history (no internet?).</div>';
    }
  }

  const imgModal = $('#imagery');
  $('#btn-layers').addEventListener('click', () => { haptic(); markImagery(); imgModal.classList.remove('hidden'); loadImagery(); });
  imgModal.addEventListener('click', e => {
    if (e.target === imgModal || e.target.closest('[data-close]')) { imgModal.classList.add('hidden'); return; }
    const b = e.target.closest('[data-base]'), h = e.target.closest('[data-num]');
    if (b && b.dataset.base === 'google' && !GOOG.key) { toast('Paste your Google Maps API key in Settings first.'); return; }
    if (b) { S.base = b.dataset.base; }
    else if (h) {
      const it = S.histList.find(x => x.num === +h.dataset.num);
      if (!it) return;
      S.hist = { num: it.num, url: it.url, provider: it.provider || '' };
      S.base = 'hist';
      store.set('hist', S.hist);
    } else return;
    store.set('base', S.base);
    haptic();
    applyBase();
  });

  // ------------------------------------------------------------------ airspace (B/C/D/E) + airports, FAA open data
  const FAA = 'https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/';
  const AV = { box: null, busy: false, airspace: [], airports: [] };
  const AV_LAYERS = ['sua-hatch', 'sua-line', 'sua-label', 'nofly-fill', 'nofly-line', 'nofly-label', 'stad-fill', 'stad-line', 'stad-label',
    'as-fill', 'as-E5', 'as-E', 'as-D', 'as-C', 'as-B', 'as-label', 'as-alt', 'ap-dot', 'hp-dot', 'ap-label', 'ap-label2'];
  const LAANC_LAYERS = ['laanc-fill', 'laanc-line', 'laanc-label'];
  const AS_COL = { B: '#3b82f6', C: '#d946ef', D: '#60a5fa', E: '#e879f9', E5: '#e879f9' };
  const SUA_NAME = { R: 'Restricted', P: 'Prohibited', W: 'Warning area', A: 'Alert area', MOA: 'MOA', D: 'Danger area' };
  const AVX = { laanc: store.get('laanc') !== false, stadiums: store.get('stadiums') !== false };
  function hatch(col) {   // diagonal hatching like a sectional chart
    const c = document.createElement('canvas'); c.width = c.height = 16;
    const g = c.getContext('2d'); g.strokeStyle = col; g.lineWidth = 2.2; g.beginPath();
    g.moveTo(-4, 20); g.lineTo(20, -4); g.moveTo(-4, 4); g.lineTo(4, -4); g.moveTo(12, 20); g.lineTo(20, 12); g.stroke();
    return g.getImageData(0, 0, 16, 16);
  }
  function addAviationLayers() {
    const f = k => ['==', ['get', 'k'], k];
    map.addImage('hatch-red', hatch('rgba(248,113,113,.75)'));
    map.addImage('hatch-org', hatch('rgba(251,146,60,.7)'));
    map.addImage('hatch-mag', hatch('rgba(232,121,249,.6)'));
    const halo = { 'text-halo-color': '#0a0d12', 'text-halo-width': 1.8 };
    // LAANC grid: the most a drone can be approved for in each square near an airport (FAA UAS facility maps)
    map.addLayer({ id: 'laanc-fill', type: 'fill', source: 'laanc', minzoom: 11, paint: {
      'fill-color': ['step', ['get', 'CEILING'], '#ef4444', 1, '#f97316', 101, '#eab308', 201, '#a3e635', 301, '#22c55e'],
      'fill-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.13, 15, 0.2] } });
    map.addLayer({ id: 'laanc-line', type: 'line', source: 'laanc', minzoom: 11, paint: { 'line-color': 'rgba(255,255,255,.4)', 'line-width': 0.7 } });
    map.addLayer({ id: 'laanc-label', type: 'symbol', source: 'laanc', minzoom: 11.5, layout: { 'text-field': ['to-string', ['get', 'CEILING']],
      'text-font': ['Open Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 11.5, 10, 15, 15] },
      paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,.8)', 'text-halo-width': 1.5 } });
    // special use airspace: restricted / prohibited red hatch, warning / danger orange, MOA / alert magenta
    const red = ['match', ['get', 'TYPE_CODE'], ['P', 'R'], 1, 0];
    map.addLayer({ id: 'sua-hatch', type: 'fill', source: 'sua', paint: {
      'fill-pattern': ['match', ['get', 'TYPE_CODE'], ['P', 'R'], 'hatch-red', ['W', 'D'], 'hatch-org', 'hatch-mag'],
      'fill-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0.35, 11, ['match', ['get', 'TYPE_CODE'], ['P', 'R'], 0.55, 0.3]] } });
    map.addLayer({ id: 'sua-line', type: 'line', source: 'sua', paint: {
      'line-color': ['match', ['get', 'TYPE_CODE'], ['P', 'R'], '#f87171', ['W', 'D'], '#fb923c', '#e879f9'],
      'line-width': ['case', ['==', red, 1], 2.6, 1.8] } });
    map.addLayer({ id: 'sua-label', type: 'symbol', source: 'sua', minzoom: 7.5, layout: { 'text-field': ['get', 'label'],
      'text-font': ['Open Sans Bold'], 'text-size': 11.5, 'text-max-width': 11 },
      paint: Object.assign({ 'text-color': ['match', ['get', 'TYPE_CODE'], ['P', 'R'], '#fecaca', ['W', 'D'], '#fed7aa', '#f5d0fe'] }, halo) });
    // drone no-fly: national security UAS restrictions (full and part time), prohibited areas, national defense TFRs
    map.addLayer({ id: 'nofly-fill', type: 'fill', source: 'nofly', filter: ['==', ['geometry-type'], 'Polygon'], paint: {
      'fill-color': ['match', ['get', 'kind'], 'nsufr-pt', '#f97316', '#ef4444'], 'fill-opacity': 0.2 } });
    map.addLayer({ id: 'nofly-line', type: 'line', source: 'nofly', paint: {
      'line-color': ['match', ['get', 'kind'], 'nsufr-pt', '#fb923c', '#f87171'], 'line-width': 2.2 } });
    map.addLayer({ id: 'nofly-label', type: 'symbol', source: 'nofly', minzoom: 9.5, layout: { 'text-field': ['get', 'label'],
      'text-font': ['Open Sans Bold'], 'text-size': 11, 'text-max-width': 10 },
      paint: Object.assign({ 'text-color': ['match', ['get', 'kind'], 'nsufr-pt', '#fed7aa', '#fecaca'] }, halo) });
    // stadiums: 3 NM / 3,000 ft no-drone ring during events
    map.addLayer({ id: 'stad-fill', type: 'fill', source: 'stadium', minzoom: 8, paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.06 } });
    map.addLayer({ id: 'stad-line', type: 'line', source: 'stadium', minzoom: 8, paint: { 'line-color': '#fbbf24', 'line-width': 1.6, 'line-dasharray': [2, 2] } });
    map.addLayer({ id: 'stad-label', type: 'symbol', source: 'stadium', minzoom: 10, layout: { 'text-field': ['get', 'label'],
      'text-font': ['Open Sans Bold'], 'text-size': 11, 'text-max-width': 10 }, paint: Object.assign({ 'text-color': '#fde68a' }, halo) });
    map.addLayer({ id: 'as-fill', type: 'fill', source: 'airspace', paint: {
      'fill-color': ['match', ['get', 'k'], 'B', '#2563eb', 'C', '#c026d3', 'D', '#2563eb', '#c026d3'],
      'fill-opacity': ['match', ['get', 'k'], 'B', 0.07, 'C', 0.07, 'D', 0.06, 'E', 0.04, 0] } });
    map.addLayer({ id: 'as-E5', type: 'line', source: 'airspace', filter: f('E5'), minzoom: 9, paint: { 'line-color': AS_COL.E5, 'line-width': 1, 'line-opacity': 0.35, 'line-dasharray': [1, 2] } });
    map.addLayer({ id: 'as-E', type: 'line', source: 'airspace', filter: f('E'), paint: { 'line-color': AS_COL.E, 'line-width': 1.6, 'line-opacity': 0.9, 'line-dasharray': [3, 2] } });
    map.addLayer({ id: 'as-D', type: 'line', source: 'airspace', filter: f('D'), paint: { 'line-color': AS_COL.D, 'line-width': 2, 'line-dasharray': [3, 2] } });
    map.addLayer({ id: 'as-C', type: 'line', source: 'airspace', filter: f('C'), paint: { 'line-color': AS_COL.C, 'line-width': 2.6 } });
    map.addLayer({ id: 'as-B', type: 'line', source: 'airspace', filter: f('B'), paint: { 'line-color': AS_COL.B, 'line-width': 2.6 } });
    map.addLayer({ id: 'as-label', type: 'symbol', source: 'airspace', filter: ['!=', ['get', 'k'], 'E5'], minzoom: 8.5,
      layout: { 'symbol-placement': 'line', 'symbol-spacing': 420, 'text-field': ['get', 'label'], 'text-font': ['Open Sans Bold'], 'text-size': 11.5, 'text-max-angle': 30 },
      paint: { 'text-color': ['match', ['get', 'k'], 'B', '#93c5fd', 'D', '#bfdbfe', '#f5d0fe'], 'text-halo-color': '#0a0d12', 'text-halo-width': 1.8 } });
    map.addLayer({ id: 'as-alt', type: 'symbol', source: 'airspace', minzoom: 8, filter: ['in', ['get', 'k'], ['literal', ['B', 'C', 'D']]],
      layout: { 'text-field': ['get', 'alt'], 'text-font': ['Open Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 8, 11, 12, 15], 'text-line-height': 1.05 },
      paint: { 'text-color': ['match', ['get', 'k'], 'C', '#f5d0fe', '#bfdbfe'], 'text-halo-color': '#0a0d12', 'text-halo-width': 2 } });
    map.addLayer({ id: 'ap-dot', type: 'circle', source: 'airports', filter: ['!=', ['get', 'kind'], 'heli'], paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 3, 12, 6.5],
      'circle-color': ['match', ['get', 'kind'], 'public', '#38bdf8', '#94a3b8'],
      'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.6 } });
    map.addLayer({ id: 'hp-dot', type: 'circle', source: 'airports', filter: ['==', ['get', 'kind'], 'heli'], minzoom: 11, paint: {
      'circle-radius': 5, 'circle-color': '#f472b6', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.4 } });
    const apLabel = { 'text-field': ['step', ['zoom'], ['get', 'code'], 11.5, ['concat', ['get', 'code'], '\n', ['get', 'NAME']]],
      'text-font': ['Open Sans Bold'], 'text-size': 11.5, 'text-offset': [0, 0.9], 'text-anchor': 'top', 'text-max-width': 12 };
    const apPaint = { 'text-color': '#e0f2fe', 'text-halo-color': '#0a0d12', 'text-halo-width': 1.8 };
    map.addLayer({ id: 'ap-label', type: 'symbol', source: 'airports', minzoom: 8, filter: ['==', ['get', 'kind'], 'public'], layout: apLabel, paint: apPaint });
    map.addLayer({ id: 'ap-label2', type: 'symbol', source: 'airports', minzoom: 11, filter: ['!=', ['get', 'kind'], 'public'], layout: apLabel, paint: apPaint });
  }
  const ftv = v => Number(v).toLocaleString('en-US');
  function asText(p) {
    if (p.k === 'E5') return 'Class E from 700 ft above ground';
    const lo = p.LOWER_CODE === 'SFC' || !p.LOWER_VAL ? 'surface' : ftv(p.LOWER_VAL) + ' ft' + (p.LOWER_CODE === 'MSL' ? ' MSL' : '');
    const hi = p.UPPER_VAL > 0 ? ftv(p.UPPER_VAL) + ' ft' + (p.UPPER_CODE === 'MSL' ? ' MSL' : '') : null;
    return `Class ${p.CLASS}${p.IDENT ? ' (' + p.IDENT + ')' : ''} · ${hi ? lo + ' to ' + hi : 'from ' + lo}`;
  }
  function faaQuery(svc, where, fields, b, extra) {
    return fetch(`${FAA}${svc}/FeatureServer/0/query?where=${encodeURIComponent(where)}&geometry=${b.join(',')}` +
      `&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=${fields}&outSR=4326${extra || ''}&f=geojson`)
      .then(r => r.json());
  }
  async function loadAviation(force) {
    if (!S.mapReady) return;
    const on = S.settings.airspace !== false, z = map.getZoom();
    const vis = (id, v) => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v ? 'visible' : 'none'); };
    for (const id of AV_LAYERS) vis(id, on && (!id.startsWith('stad') || AVX.stadiums));
    for (const id of LAANC_LAYERS) vis(id, on && AVX.laanc);
    if (on && AVX.laanc) loadLaanc(force);
    if (!on || z < 7 || AV.busy) return;
    const bb = map.getBounds(), w = bb.getWest(), s = bb.getSouth(), e = bb.getEast(), n = bb.getNorth();
    if (!force && AV.box && w >= AV.box[0] && s >= AV.box[1] && e <= AV.box[2] && n <= AV.box[3]) return;
    const dx = Math.max(0.15, (e - w) * 0.6), dy = Math.max(0.12, (n - s) * 0.6);
    const box = [w - dx, s - dy, e + dx, n + dy].map(v => +v.toFixed(3));
    AV.busy = true;
    try {
      const simp = '&maxAllowableOffset=0.0002', ok = r => r.status === 'fulfilled' && r.value && r.value.features ? r.value : { features: [] };
      const res = await Promise.allSettled([
        faaQuery('Class_Airspace', "CLASS IN ('B','C','D','E')", 'NAME,CLASS,LOCAL_TYPE,LOWER_VAL,LOWER_CODE,UPPER_VAL,UPPER_CODE,IDENT', box, simp),
        faaQuery('US_Airport', '1=1', 'IDENT,NAME,TYPE_CODE,PRIVATEUSE,ICAO_ID,ELEVATION,SERVCITY,STATE', box, ''),
        faaQuery('Special_Use_Airspace', '1=1', 'NAME,TYPE_CODE,LOWER_VAL,LOWER_CODE,UPPER_VAL,UPPER_CODE,TIMESOFUSE,CITY,STATE', box, simp),
        faaQuery('DoD_Mar_13', '1=1', 'Base,Facility,Reason,Floor,Ceiling,State', box, simp),
        faaQuery('Part_Time_National_Security_UAS_Flight_Restrictions', '1=1', 'Base,Facility,Reason,Floor,Ceiling,State,ACTIVETIME,ENDTIME', box, simp),
        faaQuery('Prohibited_Areas', '1=1', 'NAME,LOWER_VAL,LOWER_CODE,UPPER_VAL,UPPER_CODE', box, simp),
        faaQuery('National_Defense_Airspace_TFR_Areas', '1=1', 'NAME,CITY,STATE,WKHR_RMK', box, simp),
        faaQuery('Stadiums', '1=1', 'NAME,CITY,STATE', box, ''),
      ]);
      const [as, ap, sua, ns, nspt, pro, nda, st] = res.map(ok);
      res.forEach((r, i) => { if (r.status !== 'fulfilled') log('AIRSPACE', `layer ${i} failed: ${r.reason}`); });
      const hund = v => Math.round(v / 100);
      for (const g of sua.features) {
        const p = g.properties, lo = p.LOWER_CODE === 'SFC' || !p.LOWER_VAL ? 'SFC' : ftv(p.LOWER_VAL), hi = p.UPPER_VAL > 0 ? ftv(p.UPPER_VAL) : '';
        p.label = `${p.NAME || SUA_NAME[p.TYPE_CODE] || ''}\n${hi ? lo + '–' + hi : lo}`;
        p.av = 'sua';
      }
      const nofly = [];
      for (const g of ns.features) { const p = g.properties; p.kind = 'nsufr'; p.av = 'nofly'; p.label = 'NO DRONES\n' + (p.Facility || p.Base || ''); nofly.push(g); }
      for (const g of nspt.features) { const p = g.properties; p.kind = 'nsufr-pt'; p.av = 'nofly'; p.label = 'NO DRONES (part time)\n' + (p.Facility || p.Base || ''); nofly.push(g); }
      for (const g of pro.features) { const p = g.properties; p.kind = 'prohib'; p.av = 'nofly'; p.label = 'PROHIBITED\n' + (p.NAME || ''); nofly.push(g); }
      for (const g of nda.features) { const p = g.properties; p.kind = 'nda'; p.av = 'nofly'; p.label = 'TFR\n' + (p.NAME || '').replace(/ NATIONAL DEFENSE AIRSPACE TFR/i, ''); nofly.push(g); }
      const ring = (lon, lat, m) => { const pts = []; for (let i = 0; i <= 72; i++) { const a = i / 72 * 2 * Math.PI;
        pts.push([lon + m * Math.sin(a) / (111320 * Math.cos(lat * Math.PI / 180)), lat + m * Math.cos(a) / 110540]); } return pts; };
      const stad = st.features.filter(g => g.geometry && g.geometry.type === 'Point').map(g => ({ type: 'Feature',
        properties: Object.assign({}, g.properties, { av: 'stadium', label: (g.properties.NAME || 'Stadium') + '\n3 NM during events' }),
        geometry: { type: 'Polygon', coordinates: [ring(g.geometry.coordinates[0], g.geometry.coordinates[1], 5556)] } }));
      map.getSource('sua').setData(fc(sua.features));
      map.getSource('nofly').setData(fc(nofly));
      map.getSource('stadium').setData(fc(stad));
      for (const f of as.features || []) {
        const p = f.properties;
        p.k = p.LOCAL_TYPE === 'CLASS_E5' ? 'E5' : p.CLASS;
        const lo = p.LOWER_CODE === 'SFC' || !p.LOWER_VAL ? 'SFC' : ftv(p.LOWER_VAL), hi = p.UPPER_VAL > 0 ? ftv(p.UPPER_VAL) : '';
        p.label = `${p.CLASS}${p.IDENT ? ' ' + p.IDENT : ''}  ${hi ? lo + '–' + hi : lo}`;
        // sectional-style block: ceiling over floor in hundreds of feet MSL; class D shows its ceiling in brackets
        const lo100 = p.LOWER_CODE === 'SFC' || !p.LOWER_VAL ? 'SFC' : String(Math.round(p.LOWER_VAL / 100));
        p.alt = p.CLASS === 'D' ? (p.UPPER_VAL > 0 ? `[${Math.round(p.UPPER_VAL / 100)}]` : '') :
          p.UPPER_VAL > 0 ? `${Math.round(p.UPPER_VAL / 100)}\n${lo100}` : '';
        p.av = 'class';
      }
      for (const f of ap.features || []) {
        const p = f.properties;
        p.kind = p.TYPE_CODE === 'HP' ? 'heli' : String(p.PRIVATEUSE) === '1' ? 'private' : 'public';
        p.code = p.ICAO_ID || p.IDENT || '';
      }
      AV.airspace = as.features || []; AV.airports = ap.features || []; AV.box = box;
      map.getSource('airspace').setData(fc(AV.airspace));
      map.getSource('airports').setData(fc(AV.airports));
    } catch (err) { log('AIRSPACE', 'load failed: ' + err); }
    AV.busy = false;
  }
  let avTimer = 0;
  map.on('moveend', () => { clearTimeout(avTimer); avTimer = setTimeout(() => loadAviation(false), 400); });
  // LAANC grid squares (only when zoomed in: ~0.9 km squares, thousands per county)
  const LA = { box: null, busy: false };
  async function loadLaanc(force) {
    if (!S.mapReady || LA.busy || map.getZoom() < 11) return;
    const bb = map.getBounds(), w = bb.getWest(), s = bb.getSouth(), e = bb.getEast(), n = bb.getNorth();
    if (!force && LA.box && w >= LA.box[0] && s >= LA.box[1] && e <= LA.box[2] && n <= LA.box[3]) return;
    const dx = (e - w) * 0.35, dy = (n - s) * 0.35, box = [w - dx, s - dy, e + dx, n + dy].map(v => +v.toFixed(4));
    LA.busy = true;
    try {
      const d = await faaQuery('FAA_UAS_FacilityMap_Data', '1=1', 'CEILING,APT1_FAAID,APT1_NAME,APT1_LAANC', box, '&resultRecordCount=2000');
      for (const g of d.features || []) g.properties.av = 'laanc';
      map.getSource('laanc').setData(fc(d.features || [])); LA.box = box;
    } catch (err) { log('AIRSPACE', 'LAANC load failed: ' + err); }
    LA.busy = false;
  }
  // tap the map: what airspace is here (and the clouds, when that layer is on)
  function avLines(pt) {
    const lay = ids => ids.filter(id => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none');
    const hits = map.queryRenderedFeatures(pt, { layers: lay(['nofly-fill', 'sua-hatch', 'stad-fill', 'as-fill', 'laanc-fill']) });
    const out = [], seen = new Set(), dot = c => `<i style="background:${c}"></i>`;
    const add = (c, t) => { if (!seen.has(t)) { seen.add(t); out.push(dot(c) + t); } };
    const altOf = (lo, loC, hi, hiC) => { const l = loC === 'SFC' || !lo ? 'surface' : ftv(lo) + ' ft' + (loC === 'MSL' ? ' MSL' : '');
      return hi > 0 ? `${l} to ${ftv(hi)} ft${hiC === 'MSL' ? ' MSL' : ''}` : 'from ' + l; };
    for (const h of hits) {
      const p = h.properties;
      if (p.av === 'nofly') {
        if (p.kind === 'nsufr') add('#ef4444', `<b>No drones</b> · ${esc(p.Facility || p.Base)} (national security) · ${esc(p.Floor || 'surface')} to ${esc(p.Ceiling || '400 ft')}`);
        else if (p.kind === 'nsufr-pt') add('#f97316', `<b>No drones when active</b> · ${esc(p.Facility || p.Base)} (part-time national security)`);
        else if (p.kind === 'prohib') add('#ef4444', `<b>Prohibited</b> ${esc(p.NAME)} · ${altOf(p.LOWER_VAL, p.LOWER_CODE, p.UPPER_VAL, p.UPPER_CODE)}`);
        else add('#ef4444', `<b>TFR</b> ${esc(p.NAME)}${p.WKHR_RMK ? ' · ' + esc(p.WKHR_RMK) : ''}`);
      } else if (p.av === 'sua') add(p.TYPE_CODE === 'R' || p.TYPE_CODE === 'P' ? '#ef4444' : p.TYPE_CODE === 'W' || p.TYPE_CODE === 'D' ? '#f97316' : '#d946ef',
        `<b>${SUA_NAME[p.TYPE_CODE] || p.TYPE_CODE}</b> ${esc(p.NAME)} · ${altOf(p.LOWER_VAL, p.LOWER_CODE, p.UPPER_VAL, p.UPPER_CODE)}${p.TIMESOFUSE ? ' · ' + esc(p.TIMESOFUSE) : ''}`);
      else if (p.av === 'stadium') add('#f59e0b', `<b>Stadium</b> ${esc(p.NAME)} · no drones within 3 NM up to 3,000 ft from 1 h before to 1 h after events`);
      else if (p.av === 'laanc') add(p.CEILING > 0 ? '#a3e635' : '#ef4444', p.CEILING > 0 ? `<b>LAANC up to ${p.CEILING} ft</b> here${p.APT1_FAAID ? ' (' + esc(p.APT1_FAAID) + ')' : ''}` : `<b>LAANC 0 ft</b> here: needs a full FAA authorization`);
      else if (p.av === 'class' && p.k !== 'E5') add(AS_COL[p.k] || '#60a5fa', `<b>Class ${esc(p.CLASS)}</b>${p.IDENT ? ' ' + esc(p.IDENT) : ''} · ${altOf(p.LOWER_VAL, p.LOWER_CODE, p.UPPER_VAL, p.UPPER_CODE)}`);
    }
    return out;
  }
  function pip(lon, lat, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function airspaceAt(lat, lon) {
    return AV.airspace.filter(f => {
      const g = f.geometry; if (!g) return false;
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
      return polys.some(p => pip(lon, lat, p[0]) && !p.slice(1).some(h => pip(lon, lat, h)));
    }).map(f => f.properties);
  }
  function airspaceSummary(lat, lon) {
    if (!AV.box) return null;
    const hits = airspaceAt(lat, lon), order = { B: 0, C: 1, D: 2, E: 3, E5: 4 };
    hits.sort((a, b) => order[a.k] - order[b.k]);
    const main = hits.filter(p => p.k !== 'E5');
    if (main.length) return main.map(asText).join(' · ');
    if (hits.length) return 'Class G at the surface · Class E from 700 ft above ground';
    return 'Class G (uncontrolled) at the surface';
  }

  // ------------------------------------------------------------------ wind (Open-Meteo, location rounded to ~1 km)
  const WIND = { data: null, at: 0, open: false };
  // sky icon for a cloud-cover percentage: sun, sun behind a cloud, or cloud
  const SKY = {
    sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.6" fill="#fcd34d"/><path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" stroke="#fcd34d" stroke-width="1.8" stroke-linecap="round"/></svg>',
    part: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8.5" r="4" fill="#fcd34d"/><path d="M9 1.8v1.6M2.3 8.5h1.6M4.3 3.8l1.1 1.1M13.7 3.8l-1.1 1.1" stroke="#fcd34d" stroke-width="1.6" stroke-linecap="round"/><path d="M8 20h9.5a3.8 3.8 0 0 0 .5-7.56A5.2 5.2 0 0 0 8.2 11.4 4.3 4.3 0 0 0 8 20z" fill="#e5e9ef"/></svg>',
    cloud: '<svg viewBox="0 0 24 24"><path d="M6.6 19.5h10.6a4.3 4.3 0 0 0 .6-8.55A5.9 5.9 0 0 0 6.8 9.9a4.8 4.8 0 0 0-.2 9.6z" fill="#e5e9ef"/></svg>',
  };
  const skyOf = cc => cc < 20 ? SKY.sun : cc < 65 ? SKY.part : SKY.cloud;
  async function loadWind() {
    if (S.settings.wind === false) { $('#wind').classList.add('hidden'); return; }
    const p = me(), c = p ? [p.lat, p.lon] : S.mapReady ? [map.getCenter().lat, map.getCenter().lng] : null;
    if (!c) return;
    try {
      const u = `https://api.open-meteo.com/v1/forecast?latitude=${c[0].toFixed(2)}&longitude=${c[1].toFixed(2)}` +
        '&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m,cloud_cover' +
        '&hourly=wind_speed_120m,wind_direction_120m,wind_speed_10m,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,precipitation_probability' +
        '&forecast_hours=13&wind_speed_unit=mph&temperature_unit=fahrenheit&timezone=auto';
      const d = await (await fetch(u)).json();
      if (!d.current) throw new Error('no current weather');
      WIND.data = d; WIND.at = Date.now();
      renderWind();
    } catch (e) { log('WIND', 'load failed: ' + e); }
  }
  function renderWind() {
    const el = $('#wind'), d = WIND.data;
    if (!d || S.settings.wind === false) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const c = d.current, from = c.wind_direction_10m, spd = Math.round(c.wind_speed_10m), gust = Math.round(c.wind_gusts_10m);
    const b = S.mapReady ? map.getBearing() : 0;
    $('#wind-rose').style.transform = `rotate(${-b}deg)`;
    $('#wind-arrow').style.transform = `rotate(${(from + 180) % 360}deg)`;   // arrow points the way the wind is blowing
    $('#wind-spd').textContent = spd;
    $('#wind-sub').textContent = spd < 1 ? 'Calm' : `from ${compass(from)} ${Math.round(from)}°`;   // gusts + cloud % live in the opened view
    const h = d.hourly || {}, s120 = h.wind_speed_120m && h.wind_speed_120m[0], d120 = h.wind_direction_120m && h.wind_direction_120m[0];
    const mins = Math.round((Date.now() - WIND.at) / 60000);
    // clouds now (chip beside the wind) and the next 12 hours (strip when the widget is opened)
    const cc = c.cloud_cover;
    $('#wind-sky').classList.toggle('hidden', cc == null);
    if (cc != null) $('#wind-sky').innerHTML = skyOf(cc);
    const n = (h.cloud_cover || []).length, pct = (a, i) => a && a[i] != null ? Math.round(a[i]) : null;
    let strip = '';
    for (let i = 0; i < Math.min(n, 13); i += 2) {
      const t = new Date(h.time[i]), lbl = i === 0 ? 'Now' : t.toLocaleTimeString('en-US', { hour: 'numeric' }).replace(':00', '').replace(' AM', 'a').replace(' PM', 'p');
      const v = pct(h.cloud_cover, i), rain = pct(h.precipitation_probability, i), w = pct(h.wind_speed_10m, i);
      strip += `<div class="wc"><em>${lbl}</em><div class="wc-bar"><i style="height:${Math.max(6, v || 0)}%"></i></div><b>${v == null ? '—' : v + '%'}</b>` +
        `<span>${w == null ? '' : w + ' mph'}</span>${rain >= 30 ? `<span class="wc-rain">${rain}% rain</span>` : ''}</div>`;
    }
    const lo = pct(h.cloud_cover_low, 0), mid = pct(h.cloud_cover_mid, 0), hi = pct(h.cloud_cover_high, 0);
    $('#wind-more').innerHTML = (gust > spd ? `Gusts <b>${gust} mph</b><br>` : '') + (s120 != null ? `At 400 ft: <b>${Math.round(s120)} mph</b> from ${compass(d120)} ${Math.round(d120)}°<br>` : '') +
      (cc != null ? `Clouds <b>${Math.round(cc)}%</b>${lo != null ? ` · low ${lo}% · mid ${mid}% · high ${hi}%` : ''}<br>` : '') +
      (strip ? `<div class="wc-strip">${strip}</div>` : '') +
      `<div class="wind-upd">${Math.round(c.temperature_2m)}°F · Open-Meteo · updated ${mins < 1 ? 'just now' : mins + ' min ago'}</div>`;
    $('#wind-more').classList.toggle('hidden', !WIND.open);
    el.classList.toggle('open', WIND.open);
  }
  $('#wind').addEventListener('click', () => { WIND.open = !WIND.open; haptic(); renderWind(); });
  map.on('rotate', () => { if (WIND.data) renderWind(); });
  setInterval(loadWind, 10 * 60 * 1000);


  // ------------------------------------------------------------------ moving clouds: NASA GIBS, GOES-East GeoColor (true colour by day,
  // infrared clouds at night), a frame every 10 minutes, about 30 minutes behind real time. White/grey = cloud; coloured or dark ground is
  // made see-through. (Plain infrared was tried first: cold ground and low cloud are the same grey, so it could not be separated.)
  const CLOUDS = { on: !!store.get('clouds'), frames: [], i: 0, timer: 0, busy: false, at: 0 };
  const GIBS_LAYER = 'GOES-East_ABI_GeoColor', GIBS_MATRIX = 'GoogleMapsCompatible_Level7', GIBS_Z = 7;
  const GIBS = `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${GIBS_LAYER}/default/`;
  maplibregl.addProtocol('cloudir', async (params, ac) => {
    const r = await fetch(params.url.replace('cloudir://', 'https://'), { signal: ac.signal });
    if (!r.ok) return { data: await blankTile() };   // a square not published yet for that time: leave it clear
    const bmp = await createImageBitmap(await r.blob());
    const cv = new OffscreenCanvas(bmp.width, bmp.height), g = cv.getContext('2d');
    g.drawImage(bmp, 0, 0);
    const im = g.getImageData(0, 0, bmp.width, bmp.height), px = im.data;
    for (let k = 0; k < px.length; k += 4) {
      const r = px[k], gg = px[k + 1], b = px[k + 2], mn = Math.min(r, gg, b), mx = Math.max(r, gg, b), sat = mx ? (mx - mn) / mx : 0;
      const a = Math.max(0, Math.min(1, (mn - 80) / 110)) * Math.max(0, Math.min(1, 1.25 - sat * 2.2));   // bright and colourless -> cloud
      const v = 255 - Math.round((1 - a) * 35);                      // white, a touch grey at thin edges
      px[k] = v; px[k + 1] = v; px[k + 2] = v; px[k + 3] = Math.round(a * 230 * px[k + 3] / 255);
    }
    g.putImageData(im, 0, 0);
    return { data: await (await cv.convertToBlob({ type: 'image/png' })).arrayBuffer() };
  });
  const tenMin = d => d.toISOString().slice(0, 15) + '0:00Z';
  let blankBuf = null;
  async function blankTile() { if (!blankBuf) blankBuf = await (await new OffscreenCanvas(1, 1).convertToBlob({ type: 'image/png' })).arrayBuffer(); return blankBuf.slice(0); }
  async function newestCloudTime() {
    const c = map.getCenter(), n = 64, lr = c.lat * Math.PI / 180;
    const x = Math.floor((c.lng + 180) / 360 * n), y = Math.floor((1 - Math.log(Math.tan(lr) + 1 / Math.cos(lr)) / Math.PI) / 2 * n);
    for (let back = 10; back <= 150; back += 10) {
      const t = tenMin(new Date(Date.now() - back * 60000));
      try { const r = await fetch(`${GIBS}${t}/${GIBS_MATRIX}/6/${y}/${x}.png`); if (r.ok) return new Date(t); } catch (e) { return null; }
    }
    return null;
  }
  function clearClouds() {
    clearInterval(CLOUDS.timer); CLOUDS.timer = 0;
    for (const f of CLOUDS.frames) { if (map.getLayer(f.id)) map.removeLayer(f.id); if (map.getSource(f.id)) map.removeSource(f.id); }
    CLOUDS.frames = [];
    $('#cloud-time').classList.add('hidden');
  }
  function placeCloudTime() {
    const el = $('#cloud-time'); el.style.bottom = Math.round(window.innerHeight - sheetTop() + 10) + 'px';
  }
  async function loadClouds() {
    if (!S.mapReady || CLOUDS.busy) return;
    if (!CLOUDS.on) { clearClouds(); return; }
    CLOUDS.busy = true;
    try {
      const found = await newestCloudTime(), newest = found && new Date(found.getTime() - 600000);
      if (!newest) { toast('Could not reach the cloud pictures (no internet?)', 3000); return; }
      clearClouds();
      const before = map.getLayer('meacc') ? 'meacc' : undefined;
      for (let k = 11; k >= 0; k--) {                                  // 12 frames = the last 2 hours
        const t = new Date(newest.getTime() - k * 600000), id = 'cloud-' + k;
        map.addSource(id, { type: 'raster', tileSize: 256, maxzoom: GIBS_Z, attribution: 'Clouds: NASA GIBS / NOAA GOES-East',
          tiles: [`cloudir://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${GIBS_LAYER}/default/${tenMin(t)}/${GIBS_MATRIX}/{z}/{y}/{x}.png`] });
        map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': 0, 'raster-opacity-transition': { duration: 350 }, 'raster-fade-duration': 0, 'raster-resampling': 'linear' } }, before);
        CLOUDS.frames.push({ id, t });
      }
      CLOUDS.i = CLOUDS.frames.length - 1; CLOUDS.at = Date.now();
      let hold = 0;
      const show = () => {
        const f = CLOUDS.frames; if (!f.length) return;
        if (CLOUDS.i === f.length - 1 && hold++ < 3) return;             // linger on the newest picture
        hold = 0;
        const prev = CLOUDS.i; CLOUDS.i = (CLOUDS.i + 1) % f.length;
        if (map.getLayer(f[prev].id)) map.setPaintProperty(f[prev].id, 'raster-opacity', 0);
        if (map.getLayer(f[CLOUDS.i].id)) map.setPaintProperty(f[CLOUDS.i].id, 'raster-opacity', 0.9);
        const el = $('#cloud-time'), newestNow = CLOUDS.i === f.length - 1;
        el.innerHTML = `<b>Clouds</b> ${clock(f[CLOUDS.i].t.getTime() / 1000)}${newestNow ? ' · newest' : ''}`;
        el.classList.remove('hidden'); placeCloudTime();
      };
      map.setPaintProperty(CLOUDS.frames[CLOUDS.i].id, 'raster-opacity', 0.9);
      CLOUDS.timer = setInterval(show, 450);
    } finally { CLOUDS.busy = false; }
  }
  // tap the map with clouds on: cloud cover at that spot now and the next 3 hours (Open-Meteo, spot rounded to ~1 km)
  let cloudPop = null;
  async function cloudAt(ll, lines) {
    if (cloudPop) cloudPop.remove();
    const head = lines && lines.length ? `<div class="ip">${lines.map(l => `<div class="ip-row">${l}</div>`).join('')}</div>` : '';
    const pop = cloudPop = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: 'cloud-pop', offset: 10, maxWidth: '270px' })
      .setLngLat(ll).setHTML(head + (CLOUDS.on ? '<div class="cp-sub">Checking the clouds here…</div>' : '')).addTo(map);
    if (!CLOUDS.on) return;
    try {
      const u = `https://api.open-meteo.com/v1/forecast?latitude=${ll.lat.toFixed(2)}&longitude=${ll.lng.toFixed(2)}` +
        '&current=cloud_cover&hourly=cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high&forecast_hours=4&timezone=auto';
      const d = await (await fetch(u)).json(), c = d.current, h = d.hourly || {};
      if (!c || c.cloud_cover == null) throw new Error('no cloud data');
      const r0 = a => a && a[0] != null ? Math.round(a[0]) : '—';
      const next = (h.cloud_cover || []).slice(1, 4).map(v => Math.round(v) + '%').join(' → ');
      if (pop !== cloudPop) return;
      pop.setHTML(head + `<div class="cp-big">${skyOf(c.cloud_cover)}<b>${Math.round(c.cloud_cover)}%</b><span>cloud cover here</span></div>` +
        `<div class="cp-sub">Low ${r0(h.cloud_cover_low)}% · mid ${r0(h.cloud_cover_mid)}% · high ${r0(h.cloud_cover_high)}%</div>` +
        (next ? `<div class="cp-sub">Next 3 hours: ${next}</div>` : ''));
    } catch (e) { if (pop === cloudPop) pop.setHTML(head + '<div class="cp-sub">Could not get the cloud cover here (no internet?)</div>'); }
  }
  $('#clouds-toggle').checked = CLOUDS.on;
  // airspace extras in the layers sheet
  $('#laanc-toggle').checked = AVX.laanc; $('#stadium-toggle').checked = AVX.stadiums;
  $('#laanc-toggle').addEventListener('change', e => { AVX.laanc = e.target.checked; store.set('laanc', AVX.laanc); haptic(); loadAviation(true);
    if (AVX.laanc && map.getZoom() < 11) toast('Zoom in near an airport to see the LAANC ceiling squares', 3500); });
  $('#stadium-toggle').addEventListener('change', e => { AVX.stadiums = e.target.checked; store.set('stadiums', AVX.stadiums); haptic(); loadAviation(true); });
  $('#clouds-toggle').addEventListener('change', e => {
    CLOUDS.on = e.target.checked; store.set('clouds', CLOUDS.on); haptic(); loadClouds();
    if (CLOUDS.on) toast('Tap anywhere on the map to see the cloud cover there', 3500); else if (cloudPop) { cloudPop.remove(); cloudPop = null; }
  });
  setInterval(() => { if (CLOUDS.on && Date.now() - CLOUDS.at > 10 * 60000) loadClouds(); }, 60000);   // pick up new pictures

  // ------------------------------------------------------------------ toast, problem log, report
  let toastTimer = 0;
  function toast(html, ms) {
    const t = $('#toast');
    t.innerHTML = html; t.classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), ms || 4000);
  }
  function log(tag, msg) { try { if (A && A.log) A.log(tag, String(msg)); else console.warn(tag, msg); } catch (e) { } }
  window.addEventListener('error', e => log('JS', `${e.message} (${(e.filename || '').split('/').pop()}:${e.lineno})`));
  window.addEventListener('unhandledrejection', e => log('JS', 'promise: ' + (e.reason && e.reason.message || e.reason)));
  let reportName = '';
  $('#btn-report').addEventListener('click', () => {
    haptic();
    if (!A) { toast('Reports save on the phone app only.'); return; }
    $('#settings').classList.add('hidden');   // close Settings first so the screenshot shows the map
    setTimeout(() => { toast('Saving a screenshot…', 1500); setTimeout(() => A.report(''), 150); }, 450);
  });
  const repModal = $('#report');
  repModal.addEventListener('click', e => { if (e.target === repModal || e.target.closest('[data-close]')) repModal.classList.add('hidden'); });
  $('#btn-report-save').addEventListener('click', () => {
    const note = $('#report-note').value.trim();
    if (note && A && reportName) A.reportNote(reportName, note);
    repModal.classList.add('hidden');
    $('#report-note').value = '';
    toast('Report saved. Plug the phone into the Mac and I can see it.');
  });

  // ------------------------------------------------------------------ markers
  function rotateMarkers() {
    const b = map.getBearing();
    for (const m of mk.drone.values()) if (m.hd != null) m.img.style.transform = `rotate(${m.hd - b}deg)`;
    for (const m of mk.ac.values()) if (m.hd != null) m.img.style.transform = `rotate(${m.hd - b}deg)`;
  }

  function droneMarker(d) {
    let m = mk.drone.get(d.id);
    if (!m) {
      const el = document.createElement('div');
      el.className = 'm-drone';
      el.innerHTML = `<div class="ring"></div><div class="dwrap">${DRONE_SVG}</div><div class="dot3d"></div><div class="tag"></div>`;
      el.addEventListener('click', e => { e.stopPropagation(); select('drone', d.id, true); });
      m = { el, img: el.querySelector('.dwrap'), tag: el.querySelector('.tag') };
      m.marker = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([d.lon, d.lat]).addTo(map);
      mk.drone.set(d.id, m);
    }
    return m;
  }
  function pilotMarker(d) {
    let m = mk.pilot.get(d.id);
    if (!m) {
      const el = document.createElement('div');
      el.className = 'm-pilot';
      el.innerHTML = `<div class="pin">${ICON.person}</div><div class="tag"></div>`;
      el.addEventListener('click', e => { e.stopPropagation(); select('drone', d.id, false); flyTo(d.pilotLat, d.pilotLon, 16); });
      m = { el, tag: el.querySelector('.tag') };
      m.marker = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([d.pilotLon, d.pilotLat]).addTo(map);
      mk.pilot.set(d.id, m);
    }
    return m;
  }
  function acMarker(a) {
    let m = mk.ac.get(a.hex);
    if (!m) {
      const el = document.createElement('div');
      el.className = 'm-ac';
      el.innerHTML = '<img alt=""><div class="tag"></div>';
      el.addEventListener('click', e => { e.stopPropagation(); select('ac', a.hex, false); });
      m = { el, img: el.querySelector('img'), tag: el.querySelector('.tag'), src: '' };
      m.marker = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([a.lon, a.lat]).addTo(map);
      mk.ac.set(a.hex, m);
    }
    return m;
  }
  function prune(store, keep) {
    for (const [k, m] of store) if (!keep.has(k)) { m.marker.remove(); store.delete(k); }
  }

  function updToPilot() {
    const p = me(), src = map.getSource('topilot'); if (!src) return;
    const d = selDrone() || (S.heroId && S.st ? S.st.drones.find(x => x.id === S.heroId) : null);
    const show = p && d && hasPilot(d) && S.t - d.lastSeen <= SHOW_S;
    const key = show ? [p.lat.toFixed(5), p.lon.toFixed(5), d.pilotLat.toFixed(5), d.pilotLon.toFixed(5), dcol(d)].join() : '';
    if (key === S.toPilotKey) return;
    S.toPilotKey = key;
    src.setData(show ? { type: 'Feature', properties: { color: dcol(d) }, geometry: { type: 'LineString', coordinates: [[p.lon, p.lat], [d.pilotLon, d.pilotLat]] } } : EMPTY);
  }
  function renderMap() {
    if (!S.mapReady) return;
    updToPilot();
    const st = S.st, b = map.getBearing();
    // me
    const p = me();
    if (p) {
      if (!mk.me) {
        const el = document.createElement('div');
        el.className = 'm-me';
        el.innerHTML = '<div class="cone"></div><div class="core"></div>';
        // lies flat on the map like a navigation-app blue dot, so the heading cone reads in 2D and 3D
        mk.me = { el, cone: el.querySelector('.cone'), marker: new maplibregl.Marker({ element: el, anchor: 'center', pitchAlignment: 'map', rotationAlignment: 'map' }).setLngLat([p.lon, p.lat]).addTo(map) };
      }
      mk.me.marker.setLngLat([p.lon, p.lat]);
      mk.me.cone.style.display = p.heading == null ? 'none' : '';
      if (p.heading != null) mk.me.cone.style.transform = `rotate(${p.heading}deg)`;
      map.getSource('meacc').setData(fc(p.acc && p.acc > 12 ? [poly(ring(p.lat, p.lon, p.acc, 40), {})] : []));
    }
    // drones, pilots, trails, links
    const keepD = new Set(), keepP = new Set(), trailLive = [], trailOld = [], links = [];
    for (const d of st.drones) {
      if (!hasPos(d) || S.t - d.lastSeen > SHOW_S) continue;
      const live = isLive(d), sel = S.kind === 'drone' && S.sel === d.id;
      keepD.add(d.id);
      const m = droneMarker(d);
      m.marker.setLngLat([d.lon, d.lat]);
      m.el.classList.toggle('live', live);
      m.el.classList.toggle('stale', !live);
      m.el.classList.toggle('sel', sel);
      m.el.classList.toggle('flat', S.mode3d);
      m.el.style.zIndex = sel ? 5 : live ? 3 : 1;
      m.hd = iconHeading(d);
      if (m.hd != null) m.img.style.transform = `rotate(${m.hd - b}deg)`;
      const tag = `<b>${esc(shortModel(d))}</b> · ${ft(d.height)} ft`;
      if (m.tag.innerHTML !== tag) m.tag.innerHTML = tag;
      m.el.style.setProperty('--dc', dcol(d));
      const sp = smoothPath(d);
      if (sp && sp.coords.length > 1) (live ? trailLive : trailOld).push({ type: 'Feature', properties: { ci: ci(d), edge: lighten(shade2hex(dcol(d), 0.85), 0.12) }, geometry: { type: 'LineString', coordinates: sp.coords } });
      if (hasPilot(d)) {
        keepP.add(d.id);
        const pm = pilotMarker(d);
        pm.marker.setLngLat([d.pilotLon, d.pilotLat]);
        pm.el.classList.toggle('stale', !live);
        pm.el.style.setProperty('--dc', dcol(d));
        const pt = st.drones.filter(hasPilot).length > 1 ? `Pilot · ${esc(shortModel(d))}` : 'Pilot';
        if (pm.tag.innerHTML !== pt) pm.tag.innerHTML = pt;
        if (live) links.push({ type: 'Feature', properties: { color: dcol(d) }, geometry: { type: 'LineString', coordinates: [[d.pilotLon, d.pilotLat], [d.lon, d.lat]] } });
      }
    }
    prune(mk.drone, keepD);
    prune(mk.pilot, keepP);
    map.getSource('trail').setData(fc(trailLive));
    map.getSource('trailold').setData(fc(trailOld));
    map.getSource('links').setData(fc(links));
    // aircraft
    const keepA = new Set(), airTrails = [];
    if (S.settings.aircraft) {
      for (const a of st.aircraft || []) {
        if (a.ground) continue;
        keepA.add(a.hex);
        const m = acMarker(a), heli = a.cat === 'A7';
        m.marker.setLngLat([a.lon, a.lat]);
        m.el.classList.toggle('heli', heli);
        const src = heli ? 'img/heli.png' : 'img/plane.png';
        if (m.src !== src) { m.img.src = src; m.src = src; }
        m.hd = a.track;
        if (a.track != null) m.img.style.transform = `rotate(${a.track - b}deg)`;
        const tag = `${esc(a.flight || a.reg || a.hex.toUpperCase())} · ${a.altFt != null ? Math.round(a.altFt).toLocaleString('en-US') + ' ft' : '—'}`;
        if (m.tag.innerHTML !== tag) m.tag.innerHTML = tag;
        if (a.trail && a.trail.length > 1) airTrails.push({ type: 'Feature', properties: { color: heli ? '#fbbf24' : '#7dd3fc' }, geometry: { type: 'LineString', coordinates: a.trail } });
      }
    }
    prune(mk.ac, keepA);
    map.getSource('airtrails').setData(fc(airTrails));
    render3d();
  }

  // ------------------------------------------------------------------ camera
  function flyTo(lat, lon, zoom) {
    map.easeTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), zoom || 15), duration: 900, padding: pad() });
  }
  function fitAll(onlyLive) {
    const st = S.st; if (!st) return;
    const pts = [];
    for (const d of st.drones) {
      if (!hasPos(d) || (onlyLive && !isLive(d)) || S.t - d.lastSeen > SHOW_S) continue;
      pts.push([d.lon, d.lat]);
      if (hasPilot(d)) pts.push([d.pilotLon, d.pilotLat]);
    }
    const p = me(); if (p) pts.push([p.lon, p.lat]);
    if (!pts.length) return false;
    if (pts.length === 1) { map.easeTo({ center: pts[0], zoom: 15, duration: 800, padding: pad() }); return true; }
    const bb = pts.reduce((b, q) => [Math.min(b[0], q[0]), Math.min(b[1], q[1]), Math.max(b[2], q[0]), Math.max(b[3], q[1])], [180, 90, -180, -90]);
    map.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]], { padding: pad(), maxZoom: 16, duration: 900 });
    return true;
  }
  function firstFit() {
    if (S.fitted || !S.mapReady) return;
    const anyDrone = S.st.drones.some(hasPos);
    if (anyDrone) { S.fitted = fitAll(false); return; }
    const p = me();
    if (p) { map.jumpTo({ center: [p.lon, p.lat], zoom: 14 }); S.fitted = true; }
  }
  function followCam() {
    if (!S.follow || S.kind !== 'drone') return;
    const d = S.st.drones.find(x => x.id === S.sel);
    if (d && hasPos(d)) map.easeTo({ center: [d.lon, d.lat], duration: 900, padding: pad() });
  }

  // ------------------------------------------------------------------ bottom sheet
  const sheet = $('#sheet'), inner = $('#sheet-inner');
  function sheetTop() { return sheet.getBoundingClientRect().top; }
  function stops() {
    const H = sheet.offsetHeight, vh = window.innerHeight;
    return { peek: Math.max(0, H - (S.view === 'list' && S.peekH ? S.peekH : 150)), half: Math.max(0, H - vh * 0.52), full: 0 };   // the sheet sits above Android's nav buttons
  }
  // The part of the sheet slid below its resting edge is clipped off, so a closed sheet floats above
  // Android's navigation buttons with rounded corners instead of showing through behind them.
  const placeSheet = y => { sheet.style.transform = `translateY(${y}px)`; sheet.style.clipPath = `inset(0 0 ${y}px 0 round 30px)`; };
  function setSheet(name) {
    if (S.sheet !== name && drag === null) haptic();   // one light tick per snap
    S.sheet = name;
    placeSheet(stops()[name]);
    inner.style.overflowY = name === 'peek' ? 'hidden' : 'auto';
    if (name === 'peek') inner.scrollTop = 0;
  }
  let drag = null;
  sheet.addEventListener('pointerdown', e => {
    if (e.target.closest('button, .row, input, label')) return;
    const handle = e.target.closest('.grab, .sh-head, .det-head') || S.sheet === 'peek';
    if (!handle) return;
    const m = new DOMMatrix(getComputedStyle(sheet).transform);
    drag = { y0: e.clientY, t0: performance.now(), base: m.m42, y: m.m42, moved: false, id: e.pointerId, grab: !!e.target.closest('.grab') };
  });
  sheet.addEventListener('pointermove', e => {
    if (!drag) return;
    const dy = e.clientY - drag.y0;
    if (!drag.moved && Math.abs(dy) > 6) { drag.moved = true; sheet.classList.add('dragging'); try { sheet.setPointerCapture(drag.id); } catch (x) { } }
    if (drag.moved) { drag.y = Math.max(0, drag.base + dy); placeSheet(drag.y); }
  });
  const endDrag = e => {
    if (!drag) return;
    const d = drag; drag = null;
    sheet.classList.remove('dragging');
    if (!d.moved) { if (d.grab) setSheet(S.sheet === 'peek' ? 'half' : S.sheet === 'half' ? 'full' : 'half'); return; }
    const v = (e.clientY - d.y0) / Math.max(1, performance.now() - d.t0), st = stops();
    let target;
    if (v > 0.55) target = S.sheet === 'full' ? 'half' : 'peek';
    else if (v < -0.55) target = S.sheet === 'peek' ? 'half' : 'full';
    else target = ['peek', 'half', 'full'].reduce((b, k) => Math.abs(st[k] - d.y) < Math.abs(st[b] - d.y) ? k : b, 'peek');
    setSheet(target);
  };
  sheet.addEventListener('pointerup', endDrag);
  sheet.addEventListener('pointercancel', endDrag);
  window.addEventListener('resize', () => setSheet(S.sheet));

  inner.addEventListener('click', e => {
    const act = e.target.closest('[data-act]');
    if (act) { e.stopPropagation(); doAct(act.dataset.act); return; }
    const row = e.target.closest('.row[data-id]');
    if (row) { select(row.dataset.kind, row.dataset.id, true); }
  });

  function select(kind, id, fly) {
    S.kind = kind; S.sel = id; S.view = '';
    haptic();
    if (S.sheet === 'peek') setSheet('half');
    inner.scrollTop = 0;
    renderSheet();
    if (S.mapReady) renderMap();
    if (fly) {
      if (kind === 'drone') { const d = S.st.drones.find(x => x.id === id); if (d && hasPos(d)) flyTo(d.lat, d.lon, 15); }
      if (kind === 'ac') { const a = (S.st.aircraft || []).find(x => x.hex === id); if (a) flyTo(a.lat, a.lon, 12); }
    }
  }
  function deselect() { S.sel = null; S.kind = null; S.follow = false; S.view = ''; renderSheet(); if (S.mapReady) renderMap(); }

  function selDrone() { return S.kind === 'drone' && S.st ? S.st.drones.find(x => x.id === S.sel) : null; }
  function doAct(a) {
    const d = selDrone();
    haptic();
    if (a === 'back') return deselect();
    if (a === 'drive' && d && hasPilot(d)) {
      if (A) A.navigate(d.pilotLat, d.pilotLon);
      else window.open(`https://www.google.com/maps/dir/?api=1&destination=${d.pilotLat},${d.pilotLon}&travelmode=driving`);
    }
    if (a === 'pilotmap' && d && hasPilot(d)) flyTo(d.pilotLat, d.pilotLon, 16);
    if (a === 'gmap' && d && hasPos(d)) {
      if (A) A.openMap(d.lat, d.lon, shortModel(d));
      else window.open(`https://www.google.com/maps/search/?api=1&query=${d.lat},${d.lon}`);
    }
    if (a === 'follow') { S.follow = !S.follow; S.view = ''; renderSheet(); followCam(); }
    if (a === 'view3d' && d && hasPos(d)) {
      const p = me();
      const brg = p ? bearing(p.lat, p.lon, d.lat, d.lon) : map.getBearing();
      go3d({ center: [d.lon, d.lat], zoom: Math.max(map.getZoom(), 16), bearing: brg, duration: 1400, padding: pad() });
    }
    if (a === 'fitdrone' && d) {
      const pts = [[d.lon, d.lat]]; if (hasPilot(d)) pts.push([d.pilotLon, d.pilotLat]);
      const p = me(); if (p) pts.push([p.lon, p.lat]);
      const bb = pts.reduce((b, q) => [Math.min(b[0], q[0]), Math.min(b[1], q[1]), Math.max(b[2], q[0]), Math.max(b[3], q[1])], [180, 90, -180, -90]);
      map.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]], { padding: pad(), maxZoom: 16, duration: 900 });
    }
    if (a === 'location' && A) A.requestLocation();
    if (a === 'aptmap' && S.aptLL) {
      const [lo, la] = S.aptLL, nm = (S.apt && S.apt.NAME) || 'Airport';
      if (A) A.openMap(la, lo, nm); else window.open(`https://www.google.com/maps/search/?api=1&query=${la},${lo}`);
    }
  }

  // ---------- list view
  const LIST = `
    <div class="sh-head"><div class="sh-title">Drones</div><div class="sh-sub" data-f="count"></div></div>
    <div class="empty hidden" data-f="empty"><div class="radar"></div><div><div class="empty-title">Listening for Remote ID</div>
      <div class="empty-sub" data-f="emptysub">Drones show up here the moment the receiver hears them.</div></div></div>
    <div class="row hero-card hidden" data-f="hero" data-kind="drone">
      <div class="hc-top"><span class="hc-arrow"><svg viewBox="0 0 24 24"><path d="M12 3l6.5 17-6.5-3.6L5.5 20z" fill="currentColor"/></svg></span><div class="hc-dist" data-h="to"></div>
        <div class="hc-dir"><div class="hc-cardinal" data-h="dir"></div><div class="hc-to" data-h="tolbl"></div></div>
        <div class="r-icon hc-icon">${DRONE_SVG}</div></div>
      <div class="hc-name"><span data-h="name"></span><span class="pill" data-h="pill"></span></div>
      <div class="hc-stats">
        <div><div class="v" data-h="h"></div><div class="l">ft up</div></div>
        <div><div class="v" data-h="mph"></div><div class="l" data-h="mphl">mph</div></div>
        <div><div class="v" data-h="p2d"></div><div class="l">from pilot</div></div>
      </div>
    </div>
    <div data-f="drones"></div>
    <div class="sh-section hidden" data-f="achead">Aircraft nearby</div>
    <div data-f="acs"></div>`;

  function syncRows(box, items, keyOf, make, update) {
    const have = new Map([...box.children].map(c => [c.dataset.id, c]));
    items.forEach((it, i) => {
      const k = keyOf(it);
      let el = have.get(k);
      if (!el) { el = make(it); el.dataset.id = k; }
      have.delete(k);
      update(el, it);
      if (box.children[i] !== el) box.insertBefore(el, box.children[i] || null);
    });
    for (const el of have.values()) el.remove();
  }
  function makeDroneRow() {
    const el = document.createElement('div');
    el.className = 'row'; el.dataset.kind = 'drone';
    el.innerHTML = `<div class="r-icon">${DRONE_SVG}</div>
      <div class="r-main"><div class="r-title"><span data-f="name"></span><span class="pill" data-f="pill"></span></div>
        <div class="r-stats">
          <div class="rs rs-to"><div class="rs-v"><span class="rs-arrow"><svg viewBox="0 0 24 24"><path d="M12 3l6.5 17-6.5-3.6L5.5 20z" fill="currentColor"/></svg></span><span data-f="to"></span></div><div class="rs-l" data-f="tolbl"></div></div>
          <div class="rs"><div class="rs-v" data-f="h"></div><div class="rs-l">ft up</div></div>
          <div class="rs"><div class="rs-v" data-f="mph"></div><div class="rs-l" data-f="mphlbl">mph</div></div>
        </div></div>`;
    return el;
  }
  function updDroneRow(el, d) {
    const live = isLive(d), p = me();
    el.classList.toggle('stale', !live);
    el.style.setProperty('--dc', dcol(d));
    setF(el, 'mph', live ? mph(d.speed) : '—');
    setF(el, 'name', esc(modelOf(d)));
    const pill = el.querySelector('[data-f="pill"]');
    const pc = d.demo ? 'pill demo' : live ? 'pill live' : 'pill lost', pt = d.demo ? 'DEMO' : live ? 'LIVE' : 'LOST';
    if (pill.className !== pc) pill.className = pc;
    if (pill.textContent !== pt) pill.textContent = pt;
    // the number that matters in the truck: how far to the pilot (the drone if no pilot yet) and which way
    const pil = hasPilot(d), tLat = pil ? d.pilotLat : d.lat, tLon = pil ? d.pilotLon : d.lon;
    const arrow = el.querySelector('.rs-arrow');
    if (p && (pil || hasPos(d))) {
      const br = bearing(p.lat, p.lon, tLat, tLon);
      setF(el, 'to', fmtDist(dist(p.lat, p.lon, tLat, tLon)).replace(/ (mi|ft)$/, '<small>$1</small>'));
      setF(el, 'tolbl', `${pil ? 'to pilot' : 'to drone'} · ${compass(br)}`);
      arrow.style.transform = `rotate(${Math.round(br - (p.heading != null ? p.heading : 0))}deg)`;
      arrow.classList.remove('hidden');
    } else {
      setF(el, 'to', '—'); setF(el, 'tolbl', pil ? 'to pilot' : 'to drone'); arrow.classList.add('hidden');
    }
    setF(el, 'mphlbl', live ? 'mph' : ago(S.t - d.lastSeen));
    setF(el, 'h', ft(d.height));
  }
  function makeAcRow() {
    const el = document.createElement('div');
    el.className = 'row ac'; el.dataset.kind = 'ac';
    el.innerHTML = `<div class="r-icon ac"><img src="img/plane.png" alt=""></div>
      <div class="r-main"><div class="r-title"><span data-f="name"></span><span class="pill lost" data-f="type"></span></div><div class="r-sub" data-f="sub"></div></div>
      <div class="r-right"><div class="r-big" data-f="alt"></div><div class="r-unit">ft</div></div>`;
    return el;
  }
  function updAcRow(el, a) {
    const heli = a.cat === 'A7', p = me();
    el.classList.toggle('heli', heli);
    const img = el.querySelector('img'), src = heli ? 'img/heli.png' : 'img/plane.png';
    if (!img.src.endsWith(src)) img.src = src;
    setF(el, 'name', esc(a.flight || a.reg || a.hex.toUpperCase()));
    setF(el, 'type', esc(a.type || (heli ? 'HELI' : 'PLANE')));
    const bits = [];
    if (p) bits.push(`${fmtDist(dist(p.lat, p.lon, a.lat, a.lon))} ${compass(bearing(p.lat, p.lon, a.lat, a.lon))}`);
    if (a.gsKt != null) bits.push(Math.round(a.gsKt * 1.15078) + ' mph');
    if (a.reg && a.flight && a.reg !== a.flight) bits.push(esc(a.reg));
    setF(el, 'sub', bits.join(' · '));
    setF(el, 'alt', a.altFt != null ? Math.round(a.altFt).toLocaleString('en-US') : '—');
  }
  // ---------- the top drone, big: distance and direction to its pilot (to the drone itself until a pilot position arrives)
  const setH = (el, k, html) => { const n = el.querySelector(`[data-h="${k}"]`); if (n && n.innerHTML !== html) n.innerHTML = html; };
  const distHtml = m => fmtDist(m).replace(/ (mi|ft)$/, '<small>$1</small>');
  function updHero(el, d) {
    const live = isLive(d), p = me(), pil = hasPilot(d);
    el.dataset.id = d.id;
    el.classList.toggle('stale', !live);
    el.style.setProperty('--dc', dcol(d));
    const tLat = pil ? d.pilotLat : d.lat, tLon = pil ? d.pilotLon : d.lon, arrow = el.querySelector('.hc-arrow');
    if (p && (pil || hasPos(d))) {
      const br = bearing(p.lat, p.lon, tLat, tLon);
      setH(el, 'to', distHtml(dist(p.lat, p.lon, tLat, tLon)));
      setH(el, 'dir', compass(br));
      arrow.style.transform = `rotate(${Math.round(br - (p.heading != null ? p.heading : 0))}deg)`;
      arrow.classList.remove('hidden');
    } else { setH(el, 'to', '—'); setH(el, 'dir', ''); arrow.classList.add('hidden'); }
    setH(el, 'tolbl', pil ? 'to pilot' : 'to drone');
    setH(el, 'name', esc(modelOf(d)));
    const pill = el.querySelector('[data-h="pill"]');
    const pc = d.demo ? 'pill demo' : live ? 'pill live' : 'pill lost', pt = d.demo ? 'DEMO' : live ? 'LIVE' : 'LOST';
    if (pill.className !== pc) pill.className = pc;
    if (pill.textContent !== pt) pill.textContent = pt;
    setH(el, 'h', ft(d.height));
    setH(el, 'mph', live ? mph(d.speed) : '—');
    setH(el, 'mphl', live ? 'mph' : esc(ago(S.t - d.lastSeen)));
    setH(el, 'p2d', pil && hasPos(d) ? distHtml(dist(d.pilotLat, d.pilotLon, d.lat, d.lon)) : '—');
  }
  // the closed sheet shows the whole top card
  function fitPeek() {
    const h = inner.querySelector('[data-f="hero"]:not(.hidden)');
    const want = h ? Math.max(150, Math.min(300, Math.round(h.getBoundingClientRect().bottom - sheet.getBoundingClientRect().top + 12))) : 150;
    if (want !== S.peekH) {
      const first = S.peekH == null; S.peekH = want;
      if (S.sheet === 'peek' && drag === null) placeSheet(stops().peek);
      if (first && S.fitted && !S.sel) setTimeout(() => fitAll(false), 60);   // first card: re-fit so the pilot isn't under it
    }
  }
  function renderList() {
    const st = S.st, p = me();
    const drones = st.drones.filter(d => S.t - d.lastSeen <= SHOW_S || !hasPos(d) && S.t - d.lastSeen < 120);
    drones.sort((a, b) => (isLive(b) - isLive(a)) || (b.lastSeen - a.lastSeen));
    const nLive = drones.filter(isLive).length;
    setF(inner, 'count', drones.length ? `${nLive} live${drones.length > nLive ? ` · ${drones.length - nLive} earlier` : ''}` : '');
    const empty = inner.querySelector('[data-f="empty"]');
    empty.classList.toggle('hidden', drones.length > 0);
    const u = st.usb || {};
    let es = 'Drones show up here the moment the receiver hears them.';
    if (!st.demo && u.state !== 'connected') es = u.state === 'no-permission' ? 'Tap Allow on the USB prompt to read the receiver.' : 'Plug the receiver into the phone’s USB-C port.';
    if (!p) es += ' Location is off, so distances are hidden.';
    setF(inner, 'emptysub', esc(es));
    const hero = drones[0] || null, hbox = inner.querySelector('[data-f="hero"]');
    S.heroId = hero ? hero.id : null;
    hbox.classList.toggle('hidden', !hero);
    if (hero) updHero(hbox, hero);
    syncRows(inner.querySelector('[data-f="drones"]'), drones.slice(1), d => d.id, makeDroneRow, updDroneRow);
    fitPeek();
    let acs = S.settings.aircraft ? (st.aircraft || []).filter(a => !a.ground) : [];
    if (p) acs = acs.map(a => [a, dist(p.lat, p.lon, a.lat, a.lon)]).sort((x, y) => x[1] - y[1]).map(x => x[0]);
    inner.querySelector('[data-f="achead"]').classList.toggle('hidden', !acs.length);
    syncRows(inner.querySelector('[data-f="acs"]'), acs.slice(0, 12), a => a.hex, makeAcRow, updAcRow);
  }

  // ---------- drone detail
  function detailHtml() {
    return `
    <div class="det-head"><button class="back" data-act="back" aria-label="Back">${ICON.back}</button>
      <div class="det-title"><div class="t1" data-f="model"></div><div class="t2"><span data-f="pill"></span><span class="mono" data-f="serial"></span></div></div>
      <div data-f="sig"></div></div>
    <div class="hero">
      <div class="card hero-main"><div class="lbl">Height above takeoff</div><div class="val"><span data-f="h"></span><small>ft</small></div><div class="sub" data-f="climb"></div></div>
      <div class="card spark"><div class="lbl" data-f="sparklbl">Height, last 10 min</div><div data-f="spark"></div></div>
    </div>
    <div class="grid3">
      <div class="card"><div class="lbl">Above ground</div><div class="val md" data-f="agl"></div></div>
      <div class="card"><div class="lbl">Sea level</div><div class="val md" data-f="msl"></div></div>
      <div class="card"><div class="lbl">Ground elev.</div><div class="val md" data-f="gnd"></div></div>
      <div class="card"><div class="lbl">Speed</div><div class="val md" data-f="speed"></div></div>
      <div class="card"><div class="lbl">Heading</div><div class="val md hdg" data-f="hdg"></div></div>
      <div class="card"><div class="lbl">Signal</div><div class="val md" data-f="rssi"></div></div>
    </div>
    <div class="card where"><div class="arrow" data-f="arrow">${ICON.arrow}</div>
      <div class="grow"><div class="lbl">Drone from you</div><div class="val md" data-f="fromme"></div><div class="sub" data-f="fromsub"></div></div>
      <button class="btn" style="flex:none;width:52px" data-act="fitdrone" aria-label="Show drone, pilot and me">${ICON.fit}</button></div>
    <div class="card as-card" style="margin-bottom:12px"><div class="lbl">Airspace at the drone</div><div class="v" data-f="airspace"></div></div>
    <div class="card pilot-card"><div class="pc-top"><div class="pc-icon">${ICON.person}</div>
      <div class="pc-main"><div class="lbl">Pilot</div><div class="v" data-f="pilot"></div><div class="sub" data-f="pilotsub"></div></div></div>
      <div class="btn-row"><button class="btn primary" data-act="drive" data-f="drivebtn">${ICON.nav}Drive to pilot</button><button class="btn" style="flex:.55" data-act="pilotmap">${ICON.pin}Show</button></div></div>
    <div class="actions">
      <button class="btn" data-act="follow" data-f="followbtn">${ICON.follow}Follow</button>
      <button class="btn" data-act="view3d">${ICON.cube}3D view</button>
      <button class="btn" data-act="gmap" style="grid-column:span 2">${ICON.pin}Open drone in Google Maps</button>
    </div>
    <div class="meta" data-f="meta"></div>`;
  }
  function spark(d) {
    const tr = d.track.filter(p => p[3] != null && S.t - p[0] < 600);
    if (tr.length < 2) return '<div class="sub" style="margin-top:22px">Waiting for more points…</div>';
    const t0 = tr[0][0], t1 = tr[tr.length - 1][0], hmax = Math.max(15, ...tr.map(p => p[3])) * 1.12, W = 300, H = 74;
    const X = t => ((t1 > t0 ? (t - t0) / (t1 - t0) : 1) * W).toFixed(1), Y = h => (H - 3 - (h / hmax) * (H - 8)).toFixed(1);
    const pts = tr.map(p => `${X(p[0])},${Y(p[3])}`).join(' L');
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#9fc928" stop-opacity=".55"/><stop offset="1" stop-color="#9fc928" stop-opacity="0"/></linearGradient></defs>
      <path d="M${X(t0)},${H} L${pts} L${X(t1)},${H} Z" fill="url(#sg)"/>
      <path d="M${pts}" fill="none" stroke="#b8e04a" stroke-width="2.4" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
  }
  function renderDetail(d) {
    const live = isLive(d), p = me();
    inner.style.setProperty('--dc', dcol(d));
    setF(inner, 'model', esc(modelOf(d)));
    setF(inner, 'pill', d.demo ? '<span class="pill demo">DEMO</span>' : live ? '<span class="pill live">LIVE</span>' : `<span class="pill lost">LOST · ${ago(S.t - d.lastSeen)}</span>`);
    setF(inner, 'serial', esc(d.serial || d.id));
    setF(inner, 'sig', sigBars(live ? d.rssi : null));
    setF(inner, 'h', ft(d.height));
    const vs = d.vspeed;
    const climb = setF(inner, 'climb', vs == null ? 'Climb rate unknown' : Math.abs(vs) < 0.3 ? 'Holding height' : `${vs > 0 ? '▲' : '▼'} ${Math.abs(Math.round(vs * FT * 60)).toLocaleString('en-US')} ft/min`);
    climb.className = 'sub' + (vs == null || Math.abs(vs) < 0.3 ? '' : vs > 0 ? ' up' : ' down');
    const tr = d.track.filter(q => q[3] != null && S.t - q[0] < 600);
    setF(inner, 'sparklbl', tr.length > 1 ? `Last 10 min · peak ${ft(Math.max(...tr.map(q => q[3])))} ft` : 'Height, last 10 min');
    setF(inner, 'spark', spark(d));
    const gnd = hasPos(d) ? groundAt(d.lat, d.lon) : null;
    const agl = d.altMsl != null && gnd != null ? d.altMsl - gnd : null;
    setF(inner, 'agl', agl == null ? '—' : `${ft(Math.max(0, agl))}<small>ft</small>`);
    setF(inner, 'msl', d.altMsl == null ? '—' : `${ft(d.altMsl)}<small>ft</small>`);
    setF(inner, 'gnd', gnd == null ? '—' : `${ft(gnd)}<small>ft</small>`);
    setF(inner, 'speed', d.speed == null ? '—' : `${mph(d.speed)}<small>mph</small>`);
    const hd = hdgOf(d);
    setF(inner, 'hdg', hd == null ? '—' : `<span>${compass(hd)}</span><span style="display:inline-block;transform:rotate(${Math.round(hd)}deg)">${ICON.hdg}</span>`);
    setF(inner, 'rssi', d.rssi == null ? '—' : `${Math.round(d.rssi)}<small>dBm</small>`);
    if (p && hasPos(d)) {
      const m = dist(p.lat, p.lon, d.lat, d.lon), br = bearing(p.lat, p.lon, d.lat, d.lon);
      setF(inner, 'fromme', `${fmtDist(m)} <span style="color:var(--muted);font-size:.7em">${compass(br)}</span>`);
      setF(inner, 'fromsub', p.heading != null ? 'Arrow points from the way you are facing' : `Bearing ${Math.round(br)}° from north`);
      const a = inner.querySelector('[data-f="arrow"] svg');
      if (a) a.style.transform = `rotate(${Math.round(br - (p.heading != null ? p.heading : 0))}deg)`;
    } else {
      setF(inner, 'fromme', '—');
      setF(inner, 'fromsub', p ? 'No drone position yet' : 'Turn on location to see distance');
    }
    setF(inner, 'airspace', esc(S.settings.airspace === false ? 'Turn on "Airspace and airports" in settings' :
      hasPos(d) ? (airspaceSummary(d.lat, d.lon) || 'Loading FAA airspace…') : '—'));
    const drive = inner.querySelector('[data-f="drivebtn"]');
    if (hasPilot(d)) {
      const pd = hasPos(d) ? dist(d.pilotLat, d.pilotLon, d.lat, d.lon) : null;
      setF(inner, 'pilot', pd != null ? `${fmtDist(pd)} from the drone` : 'Pilot located');
      setF(inner, 'pilotsub', p ? `${fmtDist(dist(p.lat, p.lon, d.pilotLat, d.pilotLon))} ${compass(bearing(p.lat, p.lon, d.pilotLat, d.pilotLon))} of you` : 'Take-off point when the pilot position is not sent');
      drive.disabled = false;
    } else {
      setF(inner, 'pilot', 'Not broadcast');
      setF(inner, 'pilotsub', 'This drone is not sending its pilot position');
      drive.disabled = true;
    }
    const fb = inner.querySelector('[data-f="followbtn"]');
    fb.classList.toggle('on', S.follow);
    const bits = [`<b>First seen</b> ${clock(d.firstSeen)}`, `<b>Last seen</b> ${ago(S.t - d.lastSeen)}`, `<b>${d.count.toLocaleString('en-US')}</b> messages`];
    if (d.freq) bits.push(`<b>${(d.freq / 1000).toFixed(3)}</b> GHz`);
    if (d.mac) bits.push(`<b>MAC</b> <span class="mono">${esc(d.mac)}</span>`);
    if (d.altGeo != null) bits.push(`<b>GPS alt</b> ${ft(d.altGeo)} ft`);
    setF(inner, 'meta', bits.join(' · '));
  }

  // ---------- aircraft detail
  function acHtml() {
    return `
    <div class="det-head"><button class="back" data-act="back" aria-label="Back">${ICON.back}</button>
      <div class="det-title"><div class="t1" data-f="name"></div><div class="t2" data-f="sub"></div></div></div>
    <div class="grid3">
      <div class="card"><div class="lbl">Altitude</div><div class="val md" data-f="alt"></div></div>
      <div class="card"><div class="lbl">Speed</div><div class="val md" data-f="spd"></div></div>
      <div class="card"><div class="lbl">From you</div><div class="val md" data-f="dist"></div></div>
    </div>
    <div class="meta">Manned aircraft from ADS-B (adsb.lol), updated every 10 s. Altitude is barometric, above sea level.</div>`;
  }
  function renderAc(a) {
    const p = me(), heli = a.cat === 'A7';
    setF(inner, 'name', esc(a.flight || a.reg || a.hex.toUpperCase()));
    setF(inner, 'sub', esc([heli ? 'Helicopter' : 'Aircraft', a.type, a.reg, a.hex.toUpperCase()].filter(Boolean).join(' · ')));
    setF(inner, 'alt', a.altFt != null ? `${Math.round(a.altFt).toLocaleString('en-US')}<small>ft</small>` : '—');
    setF(inner, 'spd', a.gsKt != null ? `${Math.round(a.gsKt * 1.15078)}<small>mph</small>` : '—');
    setF(inner, 'dist', p ? fmtDist(dist(p.lat, p.lon, a.lat, a.lon)) : '—');
  }

  // ---------- airport detail
  function aptHtml() {
    return `
    <div class="det-head"><button class="back" data-act="back" aria-label="Back">${ICON.back}</button>
      <div class="det-title"><div class="t1" data-f="name"></div><div class="t2" data-f="sub"></div></div></div>
    <div class="grid3">
      <div class="card"><div class="lbl">Identifier</div><div class="val md" data-f="code"></div></div>
      <div class="card"><div class="lbl">Elevation</div><div class="val md" data-f="elev"></div></div>
      <div class="card"><div class="lbl">From you</div><div class="val md" data-f="dist"></div></div>
    </div>
    <div class="card as-card" style="margin-bottom:12px"><div class="lbl">Airspace over the field</div><div class="v" data-f="airspace"></div></div>
    <div class="actions"><button class="btn" data-act="aptmap" style="grid-column:span 2">${ICON.pin}Open in Google Maps</button></div>
    <div class="meta">FAA airport data. Drone flights near airports may need FAA authorization (LAANC).</div>`;
  }
  function renderApt(p) {
    const ll = S.aptLL, pm = me();
    setF(inner, 'name', esc(p.NAME || p.code));
    setF(inner, 'sub', esc([p.kind === 'heli' ? 'Heliport' : p.kind === 'private' ? 'Private airport' : 'Public airport', [p.SERVCITY, p.STATE].filter(Boolean).join(', ')].filter(Boolean).join(' · ')));
    setF(inner, 'code', esc(p.code || '—'));
    setF(inner, 'elev', p.ELEVATION != null ? `${ftv(Math.round(p.ELEVATION))}<small>ft</small>` : '—');
    setF(inner, 'dist', pm && ll ? fmtDist(dist(pm.lat, pm.lon, ll[1], ll[0])) : '—');
    setF(inner, 'airspace', esc(ll ? airspaceSummary(ll[1], ll[0]) || '—' : '—'));
  }

  function renderSheet() {
    if (!S.st) return;
    let key = 'list', d = null, a = null, ap = null;
    if (S.kind === 'drone') { d = selDrone(); if (d) key = 'drone:' + d.id; }
    if (S.kind === 'ac') { a = (S.st.aircraft || []).find(x => x.hex === S.sel); if (a) key = 'ac:' + a.hex; }
    if (S.kind === 'apt' && S.apt) { ap = S.apt; key = 'apt:' + S.sel; }
    if (key === 'list' && S.sel) { S.sel = null; S.kind = null; }
    if (key !== S.view) {
      inner.innerHTML = key === 'list' ? LIST : key.startsWith('drone') ? detailHtml() : key.startsWith('apt') ? aptHtml() : acHtml();
      S.view = key;
    }
    if (d) renderDetail(d); else if (a) renderAc(a); else if (ap) renderApt(ap); else renderList();
  }

  // ------------------------------------------------------------------ status + banner
  function renderStatus() {
    const st = S.st, u = st.usb || {};
    const nLive = st.drones.filter(isLive).length, nAc = S.settings.aircraft ? (st.aircraft || []).filter(a => !a.ground).length : 0;
    let cls, txt;
    if (st.demo) { cls = 'demo'; txt = ''; }   // the DEMO chip already says it
    else if (u.state === 'connected') { if (st.t - (u.lastLine || 0) < 6) { cls = 'ok'; txt = 'Receiver live'; } else { cls = 'warn'; txt = 'Receiver quiet · tap RSET'; } }
    else if (u.state === 'no-permission') { cls = 'warn'; txt = 'Allow USB access'; }
    else if (u.state === 'error') { cls = 'bad'; txt = 'Receiver error'; }
    else if (u.state === 'starting') { cls = ''; txt = 'Starting…'; }
    else { cls = 'bad'; txt = 'Plug in the receiver'; }
    txt += (txt ? ' · ' : '') + (nLive === 1 ? '1 drone' : nLive + ' drones');
    if (nAc) txt += ' · ' + nAc + (nAc === 1 ? ' plane' : ' planes');
    $('#st-dot').className = 'dot ' + cls;
    $('#st-text').textContent = txt;
    $('#demo-chip').classList.toggle('hidden', !st.demo);
  }
  let bannerTimer = 0;
  function showBanner(a) {
    $('#banner-title').textContent = a.title;
    $('#banner-body').textContent = a.body;
    const b = $('#banner');
    b.classList.remove('hidden'); b.style.animation = 'none'; void b.offsetWidth; b.style.animation = '';
    b.onclick = () => { b.classList.add('hidden'); select('drone', a.id, true); };
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => b.classList.add('hidden'), 8000);
  }

  // ------------------------------------------------------------------ settings
  const modal = $('#settings');
  $('#btn-settings').addEventListener('click', () => { syncSettings(); modal.classList.remove('hidden'); haptic(); });
  modal.addEventListener('click', e => { if (e.target === modal || e.target.closest('[data-close]')) modal.classList.add('hidden'); });
  function syncSettings() {
    for (const cb of modal.querySelectorAll('[data-set]')) cb.checked = !!S.settings[cb.dataset.set];
    try { if (A && A.updateStatus) renderUpdate(JSON.parse(A.updateStatus())); } catch (e) { }
    const v = A ? A.version() : 'browser preview', lp = A ? A.logsPath() : '';
    $('#set-foot').innerHTML = `Version ${esc(v)}<br>${lp ? 'Logs: ' + esc(lp) + '<br>' : ''}Imagery © Esri, Maxar, Earthstar Geographics · Terrain: Mapzen / AWS · Aircraft: adsb.lol`;
  }
  modal.addEventListener('change', e => {
    const cb = e.target.closest('[data-set]'); if (!cb) return;
    const k = cb.dataset.set, v = cb.checked;
    S.settings[k] = v;
    if (A) A.setSetting(k, String(v)); else if (k === 'demo') DEV.demo = v;
    if (k === 'labels') applyLabels();
    if (k === 'trail3d') render3d();
    if (k === 'aircraft' && S.st) renderMap();
    if (k === 'airspace') loadAviation(true);
    if (k === 'wind') { if (v) loadWind(); else renderWind(); }
    haptic();
  });
  // ---------- glass tone: one slider from really light (0) through clear (50) to almost black (100); saved on this phone.
  // Left of the middle the panels are white glass with dark text, right of it dark glass with white text.
  let tone = store.get('glassTone');
  if (tone == null) {   // carry over the older light/dark switch and see-through slider
    const g = store.get('glass'), gv = g == null ? 40 : +g;
    tone = store.get('theme') === 'light' ? 50 - gv * 0.45 : 50 + gv * 0.45;
  }
  function applyTone(v) {
    tone = Math.max(0, Math.min(100, +v));
    const root = document.documentElement, st = root.style, light = tone < 50, d = Math.abs(tone - 50) / 50;
    if (light) root.dataset.theme = 'light'; else delete root.dataset.theme;
    st.setProperty('--gt', light ? '247, 249, 252' : `${Math.round(14 - 11 * d)}, ${Math.round(18 - 14 * d)}, ${Math.round(26 - 20 * d)}`);
    // light glass keeps some white even near the middle so dark text stays readable over the aerial photos
    st.setProperty('--ga', (light ? 0.30 + 0.64 * d : 0.05 + 0.90 * d).toFixed(3));   // small floating panels
    st.setProperty('--gs', (light ? 0.55 + 0.42 * d : 0.30 + 0.67 * d).toFixed(3));   // bottom sheet and settings
    st.setProperty('--gb', Math.round(10 + 20 * d) + 'px');                             // blur
    st.setProperty('--gsh', (light ? 1 : 1 - 0.7 * d).toFixed(3));                      // white sheen fades out toward black
    for (const btn of document.querySelectorAll('[data-theme-opt]')) {
      const on = (btn.dataset.themeOpt === 'light') === light; btn.classList.toggle('on', on); btn.setAttribute('aria-checked', on);
    }
  }
  applyTone(tone);
  $('#glass-slider').value = tone;
  $('#glass-slider').addEventListener('input', e => applyTone(e.target.value));
  $('#glass-slider').addEventListener('change', e => { store.set('glassTone', +e.target.value); haptic(); });
  $('#theme-seg').addEventListener('click', e => {   // Light / Dark jump the slider to that side
    const btn = e.target.closest('[data-theme-opt]'); if (!btn) return;
    const v = btn.dataset.themeOpt === 'light' ? 18 : 78;
    $('#glass-slider').value = v; applyTone(v); store.set('glassTone', v); haptic();
  });
  $('#gkey').value = GOOG.key ? '••••••••' + GOOG.key.slice(-4) : '';
  $('#gkey').addEventListener('change', e => {
    const v = e.target.value.trim();
    if (v.startsWith('••••')) return;
    GOOG.key = v; GOOG.session = null; store.set('gkey', v); store.set('gsession', null);
    e.target.value = v ? '••••••••' + v.slice(-4) : '';
    toast(v ? 'Google key saved. Pick "Google satellite" under the layers button.' : 'Google key removed.');
    if (S.base === 'google') applyBase();
  });
  $('#btn-reconnect').addEventListener('click', () => { if (A) A.reconnect(); haptic(); });
  // ---------- over-the-air updates (GitHub)
  function renderUpdate(u) {
    if (!u) return;
    const st = { checking: 'checking…', 'up-to-date': 'up to date', 'web-ready': 'new screens downloaded, reloading…', 'app-ready': `version ${u.appReadyName} ready to install`,
      error: 'could not check (' + u.message + ')', idle: 'checks every 2 minutes' }[u.state] || u.state;
    $('#upd-sub').textContent = `App ${u.app} · screens ${u.web} · ${st}`;
    $('#btn-upd-install').classList.toggle('hidden', !u.appReady);
  }
  $('#btn-upd-check').addEventListener('click', () => { haptic(); if (A && A.checkUpdates) { A.checkUpdates(); $('#upd-sub').textContent = 'Checking for updates…'; } else toast('Updates work in the phone app.'); });
  $('#btn-upd-install').addEventListener('click', () => { haptic(); if (A && A.installUpdate) A.installUpdate(); });
  $('#btn-clear').addEventListener('click', () => { if (A) A.clearTracks(); haptic(); modal.classList.add('hidden'); });

  // ------------------------------------------------------------------ buttons
  $('#btn-3d').addEventListener('click', () => {
    haptic();
    if (S.mode3d) map.easeTo({ pitch: 0, bearing: 0, duration: 900 });
    else go3d({ bearing: map.getBearing() || -20, zoom: Math.max(map.getZoom(), 14.5) });
  });
  $('#btn-locate').addEventListener('click', () => {
    haptic();
    const p = me();
    if (p) { S.follow = false; flyTo(p.lat, p.lon, 15); } else if (A) A.requestLocation();
  });
  $('#btn-fit').addEventListener('click', () => {
    haptic();
    if (fitAll(true) || fitAll(false)) toast('Showing all drones, pilots and you', 1600);
    else toast('No drones to show yet', 1600);
  });

  // ------------------------------------------------------------------ entry points from Android
  window.RID = {
    onState(st) {
      if (!st || !st.drones) return;
      S.st = st; S.t = st.t;
      assignColors(st.drones);
      if (st.settings) {
        const lab = S.settings.labels;
        Object.assign(S.settings, st.settings);
        if (lab !== S.settings.labels) applyLabels();
      }
      renderStatus();
      if (S.mapReady) { renderMap(); firstFit(); followCam(); }
      renderSheet();
      if (!WIND.at && !WIND.asked && (me() || S.mapReady)) { WIND.asked = true; loadWind(); }
      if (S.mapReady && !AV.box && !AV.busy && S.fitted) loadAviation(false);
    },
    onAlert(a) { showBanner(a); },
    onUpdate(u) {
      renderUpdate(u);
      if (u.webUpdated) toast('New screens downloaded. Reloading…', 2500);
      else if (u.appReady && S.updToasted !== u.appReadyName) { S.updToasted = u.appReadyName; toast(`Update ${esc(u.appReadyName)} is ready. Open Settings and tap Install update.`, 7000); }
    },
    onReport(ok, name) {
      if (!ok) { toast('Could not save the report.'); return; }
      reportName = name;
      repModal.classList.remove('hidden');
    },
    setInsets(t, b) {
      setTimeout(placeAttrib, 50);
      S.safeTop = t; S.safeBottom = b;
      document.documentElement.style.setProperty('--safe-top', t + 'px');
      document.documentElement.style.setProperty('--safe-bottom', b + 'px');
      setSheet(S.sheet);
    },
    select(id) { select('drone', id, true); },
    back() {
      if (!modal.classList.contains('hidden')) { modal.classList.add('hidden'); return true; }
      if (!imgModal.classList.contains('hidden')) { imgModal.classList.add('hidden'); return true; }
      if (!repModal.classList.contains('hidden')) { repModal.classList.add('hidden'); return true; }
      if (S.sel) { deselect(); return true; }
      if (S.sheet !== 'peek') { setSheet('peek'); return true; }
      return false;
    },
  };
  setSheet('peek');

  // ------------------------------------------------------------------ browser preview (no Android): replay the demo flight
  const DEV = { demo: true };
  if (!A) {
    // iPhone / web page: notch and home-bar room from the browser, and the phone's own GPS when allowed (else the demo spot)
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;visibility:hidden;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)';
    document.body.appendChild(probe);
    const insets = () => { const cs = getComputedStyle(probe); RID.setInsets(parseFloat(cs.paddingTop) || 0, parseFloat(cs.paddingBottom) || 0); };
    insets(); addEventListener('resize', () => setTimeout(insets, 150));
    let gps = null;
    if (navigator.geolocation) navigator.geolocation.watchPosition(
      p => { gps = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, heading: p.coords.heading, age: 0 }; },
      () => { }, { enableHighAccuracy: true, maximumAge: 5000 });
    fetch('../demo.jsonl').then(r => r.text()).then(txt => {
      const rows = txt.trim().split('\n').map(l => JSON.parse(l));
      const drones = new Map(), me0 = { lat: 40.6702, lon: -81.4447, acc: 6, heading: 25, age: 0 };
      let i = 0, simT = Date.parse(rows[0].t) / 1000;
      const num = v => (typeof v === 'number' && isFinite(v)) ? v : null;
      function ingest(line, now) {
        let o; try { o = JSON.parse(line); } catch (e) { return; }
        for (const u of o.uav || []) {
          const id = u.serial || u.MAC || 'unknown';
          let d = drones.get(id);
          if (!d) { d = { id, firstSeen: now, count: 0, track: [], demo: true }; drones.set(id, d); }
          d.lastSeen = now; d.count++;
          d.serial = u.serial; d.model = u.model; d.mac = u.MAC; d.rssi = num(u.rssi); d.freq = num(u.freq);
          d.height = num(u.Height_AGL) != null && u.Height_AGL > -1000 ? u.Height_AGL : null;
          d.altGeo = num(u.AltitudeG) != null && u.AltitudeG > -1000 ? u.AltitudeG : null;
          d.altMsl = d.altGeo != null ? d.altGeo + 33.5 : null;
          d.speed = num(u.speed); d.vspeed = num(u.Vspeed) != null && u.Vspeed > -50 ? u.Vspeed : null;
          d.heading = num(u.direc) != null && u.direc < 361 ? u.direc : null; if (d.heading != null) d.lastHeading = d.heading;
          if (num(u.lat) && num(u.lon)) { d.lat = u.lat; d.lon = u.lon; d.track.push([now, u.lat, u.lon, d.height, d.altMsl]); }
          if (num(u.pilot_lat) && num(u.pilot_lon)) { d.pilotLat = u.pilot_lat; d.pilotLon = u.pilot_lon; }
        }
      }
      setInterval(() => {
        const now = Date.now() / 1000;
        if (DEV.demo) {
          const target = simT + (+(new URLSearchParams(location.search).get('speed')) || 3);
          while (i < rows.length && Date.parse(rows[i].t) / 1000 <= target) { ingest(rows[i].line, now); i++; }
          simT = target;
          if (i >= rows.length) { i = 0; simT = Date.parse(rows[0].t) / 1000; drones.clear(); }
        }
        RID.onState({ t: now, demo: DEV.demo, usb: { state: 'no-device' }, me: gps || me0, drones: [...drones.values()], aircraft: [], settings: Object.assign({}, S.settings, { demo: DEV.demo }) });
      }, 1000);
    });
  }
})();
