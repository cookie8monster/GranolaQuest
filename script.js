mapboxgl.accessToken = 'pk.eyJ1IjoibXdpbGxjb3g5MCIsImEiOiJjbTdjOHRjd2gwbmExMmtwbmJ3bGc1aDU2In0.lUKKhOSqsgRW1sYtfGM1dQ';

let allStores = [];
let upcData = {};
let map;
let userLocation = null;
const minZoomToShowMarkers = 8;

// Get user location
navigator.geolocation.getCurrentPosition(
    position => {
        userLocation = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
        };
        initMap([userLocation.lng, userLocation.lat], 13);
    },
    () => {
        userLocation = { lat: 39.4015, lng: -76.6053 }; // fallback
        initMap([userLocation.lng, userLocation.lat], 10);
    }
);

// Fetch UPC Data and Convert it to a Key-Value Object
async function fetchUPCData() {
    try {
        const response = await fetch("https://raw.githubusercontent.com/cookie8monster/GranolaQuest/refs/heads/main/UPC June 2025 v2.json");
        const upcArray = await response.json();

        upcData = upcArray.reduce((acc, item) => {
            acc[item.UPC] = { name: item.Name, image_url: item.Image };
            return acc;
        }, {});
    } catch (error) {
        console.error("Error loading UPC data:", error);
    }
}

// Initialize Map
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
}

// Fetch Store Data
async function fetchStores() {
    try {
        const response = await fetch("https://raw.githubusercontent.com/cookie8monster/GranolaQuest/refs/heads/main/June 2025 Store List v4.json");
        allStores = await response.json();
        renderVisibleStores();
    } catch (error) {
        console.error("Error loading stores:", error);
    }
}

function renderVisibleStores() {
    if (!allStores.length || !userLocation) return;

    const zoom = map.getZoom();
    const bounds = map.getBounds();
    const storeListEl = document.getElementById('store-list');

    // Filter stores visible in map bounds
    let visibleStores = allStores.filter(store =>
        store.latitude >= bounds.getSouth() &&
        store.latitude <= bounds.getNorth() &&
        store.longitude >= bounds.getWest() &&
        store.longitude <= bounds.getEast()
    );

    // Remove all existing markers
    document.querySelectorAll('.mapboxgl-marker').forEach(marker => marker.remove());

    // Hide sidebar if too zoomed out or no visible stores
    if (zoom < minZoomToShowMarkers || visibleStores.length === 0) {
        storeListEl.style.display = "none";
        return;
    } else {
        storeListEl.style.display = "block";
    }

    // Add new markers to map
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

    // Show up to 10 closest stores in sidebar
    let closestStores = visibleStores
        .map(store => ({
            ...store,
            distance: getDistance(userLocation.lat, userLocation.lng, store.latitude, store.longitude)
        }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 10); // changed from 5 to 10

    // Populate sidebar
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
                        ${store.available_upcs.map(upc => {
                            const product = upcData[upc];
                            return product
                                ? `<div class="product-item">
                                        <img src="${product.image_url}" alt="${product.name}" class="product-image">
                                        <div class="product-name">${product.name}</div>
                                   </div>`
                                : `<div class="product-item">Unknown UPC: ${upc}</div>`;
                        }).join('')}
                    </div>
                </div>
            </div>
            <div class="distance-label">${store.distance.toFixed(1)} mi</div>
        </div>
    `).join('');
}

// Haversine distance function (miles)
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 3958.8; // miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// Fly to Store on Map Click
function flyToStore(lng, lat) {
    map.flyTo({ center: [lng, lat], zoom: 14 });
}

// Search Functionality
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

// Toggle Available Items Section
function toggleItems(event, index) {
    event.stopPropagation();
    const itemList = document.getElementById(`items-list-${index}`);
    itemList.style.display = itemList.style.display === "none" ? "grid" : "none";
}
