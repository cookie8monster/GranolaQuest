mapboxgl.accessToken = 'pk.eyJ1IjoibXdpbGxjb3g5MCIsImEiOiJjbTdjOHRjd2gwbmExMmtwbmJ3bGc1aDU2In0.lUKKhOSqsgRW1sYtfGM1dQ';

let allStores = [];
let upcData = {};
let map;
let userLocation = null;
const minZoomToShowMarkers = 8;

// --- IMPORTANT: Use stable raw URLs + cache busters to avoid GitHub CDN caching issues
const UPC_URL_BASE = "https://raw.githubusercontent.com/cookie8monster/GranolaQuest/main/UPC%20June%202025%20v2.json";
const STORES_URL_BASE = "https://raw.githubusercontent.com/cookie8monster/GranolaQuest/main/CostcoJan26.json";

// Cache buster: forces a fresh fetch each page load (great for development)
const CACHE_BUSTER = `v=${Date.now()}`;

// Optional: if you want it less aggressive, replace Date.now() with a manual version string:
// const CACHE_BUSTER = "v=2026-01-15-1";

function normalizeUPC(upc) {
    // Normalizes UPC values so numeric vs string mismatches don't break lookups.
    // Keeps digits as-is, and pads to 12 digits when it's purely numeric.
    const s = String(upc).trim();
    if (/^\d+$/.test(s)) return s.padStart(12, "0");
    return s;
}

navigator.geolocation.getCurrentPosition(
    position => {
        userLocation = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
        };
        const isMobile = window.innerWidth <= 768;
        const initialZoom = isMobile ? 10 : 13;
        initMap([userLocation.lng, userLocation.lat], initialZoom);
    },
    () => {
        userLocation = { lat: 39.4015, lng: -76.6053 };
        const isMobile = window.innerWidth <= 768;
        const fallbackZoom = isMobile ? 9 : 10;
        initMap([userLocation.lng, userLocation.lat], fallbackZoom);
    }
);

async function fetchUPCData() {
    try {
        const response = await fetch(`${UPC_URL_BASE}?${CACHE_BUSTER}`, { cache: "no-store" });

        if (!response.ok) {
            throw new Error(`UPC fetch failed: ${response.status} ${response.statusText}`);
        }

        const upcArray = await response.json();

        // Build lookup table: normalized UPC -> product info
        upcData = upcArray.reduce((acc, item) => {
            const key = normalizeUPC(item.UPC);
            acc[key] = {
                name: item.Name,
                image_url: item.Image,
                url: item.URL // optional; may be undefined
            };
            return acc;
        }, {});

        console.log("✅ UPC data loaded:", upcArray.length, "items");
    } catch (error) {
        console.error("Error loading UPC data:", error);
        upcData = {}; // fail safe
    }
}

async function initMap(center, zoomLevel) {
    map = new mapboxgl.Map({
        container: 'map',
        style: 'mapbox://styles/mapbox/streets-v12',
        center: center,
        zoom: zoomLevel
    });

    await fetchUPCData();
    fetchStores();
    map.on('moveend', renderVisibleStores);

    const zoomInBtn = document.getElementById("zoom-in");
    const zoomOutBtn = document.getElementById("zoom-out");

    if (zoomInBtn && zoomOutBtn) {
        zoomInBtn.addEventListener("click", () => map.zoomIn());
        zoomOutBtn.addEventListener("click", () => map.zoomOut());
    }
}

async function fetchStores() {
    try {
        const response = await fetch(`${STORES_URL_BASE}?${CACHE_BUSTER}`, { cache: "no-store" });

        if (!response.ok) {
            throw new Error(`Stores fetch failed: ${response.status} ${response.statusText}`);
        }

        allStores = await response.json();
        console.log("✅ Store data loaded:", allStores.length, "stores");
        renderVisibleStores();
    } catch (error) {
        console.error("Error loading stores:", error);
        allStores = []; // fail safe
    }
}

function renderVisibleStores() {
    if (!allStores.length || !userLocation || !map) return;

    const zoom = map.getZoom();
    const bounds = map.getBounds();
    const storeListEl = document.getElementById('store-list');
    const mapEl = document.getElementById('map');

    let visibleStores = allStores.filter(store =>
        store.latitude >= bounds.getSouth() &&
        store.latitude <= bounds.getNorth() &&
        store.longitude >= bounds.getWest() &&
        store.longitude <= bounds.getEast()
    );

    document.querySelectorAll('.mapboxgl-marker').forEach(marker => marker.remove());

    if (zoom < minZoomToShowMarkers || visibleStores.length === 0) {
        storeListEl.classList.add("hidden");
        mapEl.classList.add("full-height");
        return;
    } else {
        storeListEl.classList.remove("hidden");
        mapEl.classList.remove("full-height");
    }

    visibleStores.forEach(store => {
        const markerElement = document.createElement("div");
        markerElement.style.backgroundImage = `url(${store.logo_url})`;
        markerElement.style.width = "35px";
        markerElement.style.height = "35px";
        markerElement.style.backgroundSize = "contain";
        markerElement.style.backgroundRepeat = "no-repeat";
        markerElement.style.backgroundPosition = "center";
        markerElement.style.borderRadius = "50%";
        markerElement.style.border = "2px solid #FFD700";
        markerElement.style.backgroundColor = "white";

        const marker = new mapboxgl.Marker(markerElement)
            .setLngLat([store.longitude, store.latitude])
            .setPopup(new mapboxgl.Popup().setHTML(`
                <div style="text-align: center;">
                    <img src="${store.logo_url}" alt="${store.name}" width="40"><br>
                    <strong>${store.name}</strong><br>
                    ${store.address}<br>
                    <b>Phone:</b> ${store.phone}
                </div>
            `))
            .addTo(map);

        marker.getElement().addEventListener("click", () => {
            flyToStore(store.longitude, store.latitude);
        });
    });

    let closestStores = visibleStores
        .map(store => ({
            ...store,
            distance: getDistance(userLocation.lat, userLocation.lng, store.latitude, store.longitude)
        }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 10);

    storeListEl.innerHTML = closestStores.map((store, index) => `
        <div class="store-item" onclick="flyToStore(${store.longitude}, ${store.latitude})">
            <img class="store-logo" src="${store.logo_url}" alt="${store.retailer}">
            <div style="flex-grow: 1;">
                <strong>${store.retailer}</strong><br>
                ${store.address}<br>
                <b>Phone:</b> ${store.phone}<br>
                <div class="available-items">
                    <span class="toggle-items" onclick="toggleItems(event, ${index})">
                        &#9656; Available Items
                    </span>
                    <div id="items-list-${index}" class="items-list" style="display: none;">
                        ${store.available_upcs.map(rawUpc => {
                            const upc = normalizeUPC(rawUpc);
                            const product = upcData[upc];

                            if (!product) {
                                return `<div class="product-item">Unknown UPC: ${rawUpc}</div>`;
                            }

                            // If URL exists, make the product card clickable
                            const inner = `
                                <div class="product-item">
                                    <img src="${product.image_url}" alt="${product.name}" class="product-image">
                                    <div class="product-name">${product.name}</div>
                                </div>
                            `;

                            return product.url
                                ? `<a href="${product.url}"
                                      target="_blank"
                                      rel="noopener"
                                      class="product-item-link"
                                      onclick="event.stopPropagation()">
                                      ${inner}
                                   </a>`
                                : inner;
                        }).join('')}
                    </div>
                </div>
            </div>
            <div class="distance-label">${store.distance.toFixed(1)} mi</div>
        </div>
    `).join('');
}

function getDistance(lat1, lon1, lat2, lon2) {
    const R = 3958.8;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function flyToStore(lng, lat) {
    map.flyTo({ center: [lng, lat], zoom: 14 });
}

document.getElementById("search-btn").addEventListener("click", handleSearch);
document.getElementById("search-input").addEventListener("keypress", event => {
    if (event.key === "Enter") handleSearch();
});

async function handleSearch() {
    const query = document.getElementById("search-input").value.trim();
    if (!query) return;

    const geocodeUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${mapboxgl.accessToken}&limit=1`;

    try {
        const response = await fetch(geocodeUrl);
        const data = await response.json();

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

function toggleItems(event, index) {
    event.stopPropagation();
    const itemList = document.getElementById(`items-list-${index}`);
    itemList.style.display = itemList.style.display === "none" ? "grid" : "none";
}
