// common.js — Shared store locator logic for all pages
// Each page calls: initStoreLocator({ storeFile: "MyStores.json" })

function initStoreLocator(config) {
    const MAPBOX_TOKEN = 'pk.eyJ1IjoibXdpbGxjb3g5MCIsImEiOiJjbTdjOHRjd2gwbmExMmtwbmJ3bGc1aDU2In0.lUKKhOSqsgRW1sYtfGM1dQ';
    const BASE_URL     = "https://raw.githubusercontent.com/cookie8monster/GranolaQuest/main/";
    const UPC_URL      = BASE_URL + "UPC%20June%202025%20v2.json";
    const STORE_URL    = BASE_URL + encodeURIComponent(config.storeFile);
    const CACHE_BUSTER = `v=${Date.now()}`;

    mapboxgl.accessToken = MAPBOX_TOKEN;

    let allStores   = [];
    let upcData     = {};
    let map;
    let userLocation = null;
    const minZoomToShowMarkers = 8;

    // ── Product filter categories ──────────────────────────────────────────────
    const CDN = 'https://cdn.shopify.com/s/files/1/0264/3725/5250/files/';
    const PRODUCT_CATEGORIES = [
        { id: 'protein-granola',  name: 'Protein Granola',  color: '#c0a0a8',
          image: CDN + 'Protein_G_DarkChocolateBlueberry_V1_Hero.webp?v=1774023806',
          upcs: new Set(['810589032596','810589032602','810589032619']) },
        { id: 'cookie-granola',   name: 'Cookie Granola',   color: '#d4b080',
          image: CDN + 'CCCookieV2_Hero_fa495c2c-94ee-488f-a8bb-6ee7b885f3bc.webp?v=1750098618',
          upcs: new Set(['081058903201','081058903224','810589031971','810589031964',
                         '810589031988','810589032039','810589032015','810589032220',
                         '810589032244','810589032183','810589032541']) },
        { id: 'ancient-grain',    name: 'Ancient Grain',    color: '#a8b88c',
          image: CDN + 'OriginalAncientGrain_Hero_864e40ed-1495-401c-bb53-71d82f600b43.webp?v=1737667868',
          upcs: new Set(['081058903124','085514000266','855140002168','810589031216',
                         '855140002687','855140002984','855140002144','855140002175',
                         '810589031575','855140002151','855140002991','810589031094',
                         '810589030271','810589031247','810589031438','810589031223',
                         '810589031933','810589031872','810589032312','855140002656',
                         '855140002663']) },
        { id: 'grain-free',       name: 'Grain-Free',       color: '#c4b898',
          image: CDN + '8ozHero_vanilla-almond-butter-grain-free-granola.png?v=1740067438',
          upcs: new Set(['810589030295','810589030301','855140002724','855140002700']) },
        { id: 'oatmeal',          name: 'Oatmeal',           color: '#d4c480',
          image: CDN + 'blueberry-walnut-collagen-protein-oats-pouch.png?v=1715395484',
          upcs: new Set(['081058903034','081058903167','081058903174','810589031735',
                         '810589031742','810589031070','810589031087','810589030332',
                         '810589031629','810589031636','810589031711','810589031704',
                         '810589030004','810589032046','855140002298','855140002304',
                         '810589031278','810589031674','810589031650','810589030349']) },
        { id: 'protein-oatmeal',  name: 'Protein Oatmeal',  color: '#b0a0c4',
          image: CDN + 'Maple_Cinnamon_Roll_V1_Hero.webp?v=1746544396',
          upcs: new Set(['810589032411','810589032435','810589032459',
                         '810589032794','810589032800']) },
        { id: 'cereal',           name: 'Cereal',            color: '#90b4c8',
          image: CDN + '11oz_vanilla-blueberry-almond-superfood-cereal-with-vitamin-d.png?v=1737680578',
          upcs: new Set(['810589030035','810589031698','810589031940',
                         '810589031957','810589032688']) },
    ];

    let activeCategories = new Set();

    // Normalizes UPC: strips whitespace, pads pure-numeric UPCs to 12 digits
    function normalizeUPC(upc) {
        const s = String(upc).trim();
        return /^\d+$/.test(s) ? s.padStart(12, "0") : s;
    }

    // --- Geolocation ---
    navigator.geolocation.getCurrentPosition(
        position => {
            userLocation = { lat: position.coords.latitude, lng: position.coords.longitude };
            const isMobile = window.innerWidth <= 768;
            initMap([userLocation.lng, userLocation.lat], isMobile ? 10 : 13);
        },
        () => {
            userLocation = { lat: 39.4015, lng: -76.6053 }; // Baltimore fallback
            const isMobile = window.innerWidth <= 768;
            initMap([userLocation.lng, userLocation.lat], isMobile ? 9 : 10);
        }
    );

    // --- Data fetching ---
    async function fetchUPCData() {
        try {
            const response = await fetch(`${UPC_URL}?${CACHE_BUSTER}`, { cache: "no-store" });
            if (!response.ok) throw new Error(`UPC fetch failed: ${response.status}`);
            const upcArray = await response.json();
            upcData = upcArray.reduce((acc, item) => {
                acc[normalizeUPC(item.UPC)] = {
                    name:      item.Name,
                    image_url: item.Image,
                    url:       item.URL  // optional product link
                };
                return acc;
            }, {});
            console.log("✅ UPC data loaded:", upcArray.length, "items");
        } catch (error) {
            console.error("Error loading UPC data:", error);
            upcData = {};
        }
    }

    async function fetchStores() {
        try {
            const response = await fetch(`${STORE_URL}?${CACHE_BUSTER}`, { cache: "no-store" });
            if (!response.ok) throw new Error(`Stores fetch failed: ${response.status}`);
            allStores = await response.json();
            console.log("✅ Store data loaded:", allStores.length, "stores");
            renderVisibleStores();
        } catch (error) {
            console.error("Error loading stores:", error);
            allStores = [];
        }
    }

    // --- Map init ---
    async function initMap(center, zoomLevel) {
        map = new mapboxgl.Map({
            container: 'map',
            style:     'mapbox://styles/mapbox/streets-v12',
            center,
            zoom: zoomLevel
        });

        await fetchUPCData();
        fetchStores();
        map.on('moveend', renderVisibleStores);

        document.getElementById("zoom-in")?.addEventListener("click",  () => map.zoomIn());
        document.getElementById("zoom-out")?.addEventListener("click", () => map.zoomOut());
    }

    // --- Rendering ---
    function renderVisibleStores() {
        if (!allStores.length || !userLocation || !map) return;

        const bounds      = map.getBounds();
        const zoom        = map.getZoom();
        const storeListEl = document.getElementById('store-list');
        const mapEl       = document.getElementById('map');

        const visibleStores = allStores.filter(store =>
            store.latitude  >= bounds.getSouth() &&
            store.latitude  <= bounds.getNorth() &&
            store.longitude >= bounds.getWest()  &&
            store.longitude <= bounds.getEast()  &&
            storeMatchesFilter(store)
        );

        document.querySelectorAll('.mapboxgl-marker').forEach(m => m.remove());

        if (zoom < minZoomToShowMarkers || visibleStores.length === 0) {
            storeListEl.classList.add("hidden");
            mapEl.classList.add("full-height");
            return;
        }
        storeListEl.classList.remove("hidden");
        mapEl.classList.remove("full-height");

        // Spread markers that share the same (or nearly identical) coordinates
        // so logos don't pile on top of each other
        const spreadStores = spreadCoLocated(visibleStores);

        // Add map markers
        spreadStores.forEach(store => {
            const el = document.createElement("div");
            Object.assign(el.style, {
                backgroundImage:    `url(${store.logo_url})`,
                width:              "35px",
                height:             "35px",
                backgroundSize:     "contain",
                backgroundRepeat:   "no-repeat",
                backgroundPosition: "center",
                borderRadius:       "50%",
                border:             "2px solid #FFD700",
                backgroundColor:    "white"
            });

            new mapboxgl.Marker(el)
                .setLngLat([store.longitude, store.latitude])
                .setPopup(new mapboxgl.Popup().setHTML(`
                    <div style="text-align:center;">
                        <img src="${store.logo_url}" alt="${store.name}" width="40"><br>
                        <strong>${store.name}</strong><br>
                        ${store.address}<br>
                        <b>Phone:</b> ${store.phone}
                    </div>
                `))
                .addTo(map)
                .getElement().addEventListener("click", () => flyToStore(store.longitude, store.latitude));
        });

        // Sidebar: 10 closest stores
        const closestStores = visibleStores
            .map(store => ({
                ...store,
                distance: getDistance(userLocation.lat, userLocation.lng, store.latitude, store.longitude)
            }))
            .sort((a, b) => a.distance - b.distance)
            .slice(0, 10);

        storeListEl.innerHTML = closestStores.map((store, index) => {
            // Split comma-separated UPC strings into individual UPCs
            const upcs = store.available_upcs
                .flatMap(u => u.split(",").map(s => s.trim()))
                .filter(Boolean);

            const products = upcs.map(rawUpc => {
                const product = upcData[normalizeUPC(rawUpc)];
                if (!product) return '';
                const inner = `
                    <div class="product-item">
                        <img src="${product.image_url}" alt="${product.name}" class="product-image">
                        <div class="product-name">${product.name}</div>
                    </div>`;
                return product.url
                    ? `<a href="${product.url}" target="_blank" rel="noopener" class="product-item-link" onclick="event.stopPropagation()">${inner}</a>`
                    : inner;
            }).join('');

            return `
                <div class="store-item" onclick="flyToStore(${store.longitude}, ${store.latitude})">
                    <img class="store-logo" src="${store.logo_url}" alt="${store.retailer}">
                    <div style="flex-grow:1;">
                        <strong>${store.retailer}</strong><br>
                        ${store.address}<br>
                        <b>Phone:</b> ${store.phone}<br>
                        <div class="available-items">
                            <span class="toggle-items" onclick="toggleItems(event, ${index})">&#9656; Available Items</span>
                            <div id="items-list-${index}" class="items-list" style="display:none;">${products}</div>
                        </div>
                    </div>
                    <div class="distance-label">${store.distance.toFixed(1)} mi</div>
                </div>`;
        }).join('');
    }

    // --- Utilities ---
    function getDistance(lat1, lon1, lat2, lon2) {
        const R    = 3958.8;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a    = Math.sin(dLat/2)**2 +
                     Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLon/2)**2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    async function handleSearch() {
        const query = document.getElementById("search-input").value.trim();
        if (!query) return;
        try {
            const url  = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${mapboxgl.accessToken}&limit=1`;
            const data = await fetch(url).then(r => r.json());
            if (data.features.length > 0) {
                const [lng, lat] = data.features[0].center;
                map.flyTo({ center: [lng, lat], zoom: 12 });
                renderVisibleStores();
            } else {
                alert("Location not found.");
            }
        } catch (error) {
            console.error("Error fetching location:", error);
        }
    }

    // Exposed globally for inline onclick handlers
    window.flyToStore   = (lng, lat) => map.flyTo({ center: [lng, lat], zoom: 14 });
    window.toggleItems  = (event, index) => {
        event.stopPropagation();
        const list = document.getElementById(`items-list-${index}`);
        list.style.display = list.style.display === "none" ? "grid" : "none";
    };

    document.getElementById("search-btn").addEventListener("click", handleSearch);
    document.getElementById("search-input").addEventListener("keypress", e => {
        if (e.key === "Enter") handleSearch();
    });

    // ── Filter logic ───────────────────────────────────────────────────────────

    function spreadCoLocated(stores) {
        const THRESHOLD = 0.001;   // ~100 m — treat as same spot
        const RADIUS    = 0.0005;  // ~50 m spread radius
        const used = new Array(stores.length).fill(false);
        const out  = stores.map(s => ({ ...s }));

        for (let i = 0; i < stores.length; i++) {
            if (used[i]) continue;
            const group = [i];
            for (let j = i + 1; j < stores.length; j++) {
                if (used[j]) continue;
                if (Math.abs(stores[i].latitude  - stores[j].latitude)  < THRESHOLD &&
                    Math.abs(stores[i].longitude - stores[j].longitude) < THRESHOLD) {
                    group.push(j);
                    used[j] = true;
                }
            }
            used[i] = true;
            if (group.length > 1) {
                const clat = group.reduce((s, k) => s + stores[k].latitude,  0) / group.length;
                const clng = group.reduce((s, k) => s + stores[k].longitude, 0) / group.length;
                group.forEach((idx, pos) => {
                    const angle = (2 * Math.PI * pos / group.length) - Math.PI / 2;
                    out[idx].latitude  = clat + RADIUS * Math.cos(angle);
                    out[idx].longitude = clng + RADIUS * Math.sin(angle);
                });
            }
        }
        return out;
    }

    function storeMatchesFilter(store) {
        if (activeCategories.size === 0) return true;
        const storeUpcs = store.available_upcs
            .flatMap(u => u.split(',').map(s => normalizeUPC(s.trim())))
            .filter(Boolean);
        return PRODUCT_CATEGORIES
            .filter(c => activeCategories.has(c.id))
            .some(c => storeUpcs.some(u => c.upcs.has(u)));
    }

    function updateFilterCount() {
        const el = document.getElementById('filter-active-count');
        if (!el) return;
        if (activeCategories.size > 0) {
            el.textContent = `${activeCategories.size} active`;
            el.style.display = 'inline-block';
        } else {
            el.textContent = '';
            el.style.display = 'none';
        }
    }

    function initFilterPanel() {
        const panel = document.getElementById('filter-panel');
        if (!panel) return;
        const tilesHtml = PRODUCT_CATEGORIES.map(cat => `
            <div class="cat-tile" data-cat="${cat.id}"
                 onclick="toggleCategory('${cat.id}')"
                 style="background-color:${cat.color};">
                <img src="${cat.image}" alt="${cat.name}" loading="lazy">
                <div class="cat-checkmark">&#10003;</div>
                <div class="cat-name">${cat.name}</div>
            </div>`).join('');
        panel.innerHTML = `
            <button id="filter-toggle" onclick="toggleFilterPanel()" aria-expanded="false">
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
                     fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
                </svg>
                Find Products
                <span id="filter-active-count" style="display:none;"></span>
            </button>
            <div id="filter-content" class="hidden">
                <div id="filter-tiles">${tilesHtml}</div>
                <button id="filter-clear-btn" onclick="clearFilter()">Clear All</button>
            </div>`;
    }

    window.toggleCategory = (catId) => {
        if (activeCategories.has(catId)) activeCategories.delete(catId);
        else activeCategories.add(catId);
        document.querySelectorAll('.cat-tile').forEach(t =>
            t.classList.toggle('active', activeCategories.has(t.dataset.cat))
        );
        updateFilterCount();
        renderVisibleStores();
    };

    window.clearFilter = () => {
        activeCategories.clear();
        document.querySelectorAll('.cat-tile').forEach(t => t.classList.remove('active'));
        updateFilterCount();
        renderVisibleStores();
    };

    window.toggleFilterPanel = () => {
        const content = document.getElementById('filter-content');
        if (!content) return;
        const isHidden = content.classList.toggle('hidden');
        document.getElementById('filter-toggle')
            ?.setAttribute('aria-expanded', String(!isHidden));
    };

    initFilterPanel();
}
