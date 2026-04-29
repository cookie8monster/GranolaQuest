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
            store.longitude <= bounds.getEast()
        );

        document.querySelectorAll('.mapboxgl-marker').forEach(m => m.remove());

        if (zoom < minZoomToShowMarkers || visibleStores.length === 0) {
            storeListEl.classList.add("hidden");
            mapEl.classList.add("full-height");
            return;
        }
        storeListEl.classList.remove("hidden");
        mapEl.classList.remove("full-height");

        // Add map markers
        visibleStores.forEach(store => {
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
}
