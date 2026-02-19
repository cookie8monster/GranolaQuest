// ChaCha.js (fixed)
// Key fixes:
// 1) Correct raw.githubusercontent.com URLs (remove /refs/heads/main)
// 2) Proper marker cleanup (store Marker objects + remove())
// 3) Defensive checks for DOM + data shape (available_upcs might be missing / string / null)
// 4) Render on moveend + after flyTo completes
// 5) Safer popup fields + default fallbacks

mapboxgl.accessToken =
  "pk.eyJ1IjoibXdpbGxjb3g5MCIsImEiOiJjbTdjOHRjd2gwbmExMmtwbmJ3bGc1aDU2In0.lUKKhOSqsgRW1sYtfGM1dQ";

const STORES_URL =
  "https://raw.githubusercontent.com/cookie8monster/GranolaQuest/main/ChaCha.json";
const UPC_URL =
  "https://raw.githubusercontent.com/cookie8monster/GranolaQuest/main/UPC%20June%202025%20v2.json";

let allStores = [];
let upcData = {};
let map;
let userLocation = null;

const minZoomToShowMarkers = 8;
let markers = []; // store Mapbox Marker instances so we can remove cleanly

function clearMarkers() {
  markers.forEach((m) => m.remove());
  markers = [];
}

function safeText(v, fallback = "") {
  if (v === null || v === undefined) return fallback;
  const s = String(v).trim();
  return s.length ? s : fallback;
}

// Some sheets export UPCs as numbers; normalize to string keys
function normalizeUPC(u) {
  if (u === null || u === undefined) return null;
  // If it’s a number like 12345, String() is fine. If it's float-like, this will keep decimals,
  // but UPCs should be ints/strings; best effort:
  return String(u).trim();
}

function normalizeAvailableUPCs(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(normalizeUPC).filter(Boolean);

  // If it’s a comma-separated string
  if (typeof value === "string") {
    return value
      .split(",")
      .map((s) => normalizeUPC(s))
      .filter(Boolean);
  }

  // If it’s a single number
  return [normalizeUPC(value)].filter(Boolean);
}

navigator.geolocation.getCurrentPosition(
  (position) => {
    userLocation = {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
    };
    const isMobile = window.innerWidth <= 768;
    const initialZoom = isMobile ? 10 : 13;
    initMap([userLocation.lng, userLocation.lat], initialZoom);
  },
  () => {
    // fallback: Towson-ish
    userLocation = { lat: 39.4015, lng: -76.6053 };
    const isMobile = window.innerWidth <= 768;
    const fallbackZoom = isMobile ? 9 : 10;
    initMap([userLocation.lng, userLocation.lat], fallbackZoom);
  }
);

async function fetchUPCData() {
  try {
    const response = await fetch(UPC_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`UPC fetch failed: ${response.status}`);
    const upcArray = await response.json();

    upcData = (Array.isArray(upcArray) ? upcArray : []).reduce((acc, item) => {
      const key = normalizeUPC(item.UPC);
      if (!key) return acc;
      acc[key] = {
        name: safeText(item.Name, "Unknown product"),
        image_url: safeText(item.Image, ""),
      };
      return acc;
    }, {});
  } catch (error) {
    console.error("Error loading UPC data:", error);
    upcData = {};
  }
}

async function fetchStores() {
  try {
    const response = await fetch(STORES_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`Stores fetch failed: ${response.status}`);
    const stores = await response.json();

    allStores = Array.isArray(stores) ? stores : [];
    renderVisibleStores();
  } catch (error) {
    console.error("Error loading stores:", error);
    allStores = [];
  }
}

async function initMap(center, zoomLevel) {
  map = new mapboxgl.Map({
    container: "map",
    style: "mapbox://styles/mapbox/streets-v12",
    center,
    zoom: zoomLevel,
  });

  // optional: show nav controls (nice during debugging)
  // map.addControl(new mapboxgl.NavigationControl(), "bottom-right");

  // Wait until the map is ready, then load data
  map.on("load", async () => {
    await fetchUPCData();
    await fetchStores();
    renderVisibleStores();
  });

  map.on("moveend", renderVisibleStores);

  const zoomInBtn = document.getElementById("zoom-in");
  const zoomOutBtn = document.getElementById("zoom-out");

  if (zoomInBtn) zoomInBtn.addEventListener("click", () => map.zoomIn());
  if (zoomOutBtn) zoomOutBtn.addEventListener("click", () => map.zoomOut());
}

function renderVisibleStores() {
  if (!map || !userLocation || !Array.isArray(allStores) || allStores.length === 0) return;

  const storeListEl = document.getElementById("store-list");
  const mapEl = document.getElementById("map");
  if (!storeListEl || !mapEl) return;

  const zoom = map.getZoom();
  const bounds = map.getBounds();

  const visibleStores = allStores.filter((store) => {
    const lat = Number(store.latitude);
    const lng = Number(store.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;

    return (
      lat >= bounds.getSouth() &&
      lat <= bounds.getNorth() &&
      lng >= bounds.getWest() &&
      lng <= bounds.getEast()
    );
  });

  clearMarkers();

  if (zoom < minZoomToShowMarkers || visibleStores.length === 0) {
    storeListEl.classList.add("hidden");
    mapEl.classList.add("full-height");
    storeListEl.innerHTML = "";
    return;
  } else {
    storeListEl.classList.remove("hidden");
    mapEl.classList.remove("full-height");
  }

  // Add markers
  visibleStores.forEach((store) => {
    const lat = Number(store.latitude);
    const lng = Number(store.longitude);

    const logoUrl = safeText(store.logo_url, "");
    const name = safeText(store.name, safeText(store.retailer, "Store"));
    const retailer = safeText(store.retailer, name);
    const address = safeText(store.address, "");
    const phone = safeText(store.phone, "");

    const markerElement = document.createElement("div");
    if (logoUrl) markerElement.style.backgroundImage = `url(${logoUrl})`;
    markerElement.style.width = "35px";
    markerElement.style.height = "35px";
    markerElement.style.backgroundSize = "contain";
    markerElement.style.backgroundRepeat = "no-repeat";
    markerElement.style.backgroundPosition = "center";
    markerElement.style.borderRadius = "50%";
    markerElement.style.border = "2px solid #FFD700";
    markerElement.style.backgroundColor = "white";

    const popupHtml = `
      <div style="text-align:center;max-width:220px;">
        ${logoUrl ? `<img src="${logoUrl}" alt="${name}" width="40"><br>` : ""}
        <strong>${name}</strong><br>
        ${address ? `${address}<br>` : ""}
        ${phone ? `<b>Phone:</b> ${phone}` : ""}
      </div>
    `;

    const marker = new mapboxgl.Marker(markerElement)
      .setLngLat([lng, lat])
      .setPopup(new mapboxgl.Popup({ offset: 25 }).setHTML(popupHtml))
      .addTo(map);

    marker.getElement().addEventListener("click", () => {
      flyToStore(lng, lat);
    });

    markers.push(marker);
  });

  // Closest 10 among visible
  const closestStores = visibleStores
    .map((store) => {
      const lat = Number(store.latitude);
      const lng = Number(store.longitude);
      return {
        ...store,
        distance: getDistance(userLocation.lat, userLocation.lng, lat, lng),
      };
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 10);

  storeListEl.innerHTML = closestStores
    .map((store, index) => {
      const lat = Number(store.latitude);
      const lng = Number(store.longitude);

      const retailer = safeText(store.retailer, safeText(store.name, "Store"));
      const address = safeText(store.address, "");
      const phone = safeText(store.phone, "");
      const logoUrl = safeText(store.logo_url, "");

      const upcs = normalizeAvailableUPCs(store.available_upcs);

      const productsHtml = upcs
        .map((u) => {
          const key = normalizeUPC(u);
          const product = key ? upcData[key] : null;

          if (product && (product.name || product.image_url)) {
            const img = product.image_url
              ? `<img src="${product.image_url}" alt="${product.name}" class="product-image">`
              : "";
            return `
              <div class="product-item">
                ${img}
                <div class="product-name">${safeText(product.name, "Product")}</div>
              </div>
            `;
          }
          return `<div class="product-item">Unknown UPC: ${safeText(key, "—")}</div>`;
        })
        .join("");

      return `
        <div class="store-item" onclick="flyToStore(${lng}, ${lat})">
          ${logoUrl ? `<img class="store-logo" src="${logoUrl}" alt="${retailer}">` : ""}
          <div style="flex-grow:1;">
            <strong>${retailer}</strong><br>
            ${address ? `${address}<br>` : ""}
            ${phone ? `<b>Phone:</b> ${phone}<br>` : ""}
            <div class="available-items">
              <span class="toggle-items" onclick="toggleItems(event, ${index})">
                &#9656; Available Items
              </span>
              <div id="items-list-${index}" class="items-list" style="display:none;">
                ${productsHtml || `<div class="product-item">No UPCs listed</div>`}
              </div>
            </div>
          </div>
          <div class="distance-label">${Number(store.distance).toFixed(1)} mi</div>
        </div>
      `;
    })
    .join("");
}

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 3958.8; // miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function flyToStore(lng, lat) {
  if (!map) return;
  map.flyTo({ center: [lng, lat], zoom: 14, essential: true });
  // ensure list/markers update after animation
  map.once("moveend", renderVisibleStores);
}

// Search handlers (guard if elements missing)
const searchBtn = document.getElementById("search-btn");
const searchInput = document.getElementById("search-input");

if (searchBtn) searchBtn.addEventListener("click", handleSearch);
if (searchInput) {
  searchInput.addEventListener("keypress", (event) => {
    if (event.key === "Enter") handleSearch();
  });
}

async function handleSearch() {
  if (!map || !searchInput) return;

  const query = searchInput.value.trim();
  if (!query) return;

  const geocodeUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
    query
  )}.json?access_token=${mapboxgl.accessToken}&limit=1`;

  try {
    const response = await fetch(geocodeUrl);
    if (!response.ok) throw new Error(`Geocode failed: ${response.status}`);
    const data = await response.json();

    if (data.features && data.features.length > 0) {
      const [lng, lat] = data.features[0].center;
      map.flyTo({ center: [lng, lat], zoom: 12, essential: true });
      map.once("moveend", renderVisibleStores);
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
  if (!itemList) return;
  itemList.style.display = itemList.style.display === "none" ? "grid" : "none";
}
