"use strict";

const UPDATE_INTERVAL = 60000; // en gång i minuten

const map = L.map("map", { preferCanvas: true }).setView([57.7826, 14.1618], 10);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

const statusElement = document.getElementById("status");

// id -> { marker, lineNumber, ... }
const vehicles = new Map();

// GTFS (statisk data) för att översätta tripId -> linjenummer
let routesById = new Map();
let tripToRoute = new Map();

/* ------------------------------------------------------------
 * CSV (routes.txt / trips.txt)
 * ------------------------------------------------------------ */

function parseCSVLine(line) {
    const cells = [];
    let value = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const c = line[i];

        if (c === '"') {
            if (inQuotes && line[i + 1] === '"') {
                value += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (c === "," && !inQuotes) {
            cells.push(value);
            value = "";
        } else {
            value += c;
        }
    }

    cells.push(value);
    return cells;
}

function parseCSV(text) {
    const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(l => l.trim() !== "");
    if (lines.length === 0) return [];

    const headers = parseCSVLine(lines[0]).map(h => h.trim());

    return lines.slice(1).map(line => {
        const cells = parseCSVLine(line);
        const item = {};
        headers.forEach((h, i) => (item[h] = (cells[i] || "").trim()));
        return item;
    });
}

async function loadGTFS() {
    try {
        const [routesRes, tripsRes] = await Promise.all([
            fetch("/routes.txt"),
            fetch("/trips.txt")
        ]);

        if (!routesRes.ok || !tripsRes.ok) {
            throw new Error("routes.txt/trips.txt saknas");
        }

        for (const r of parseCSV(await routesRes.text())) {
            if (r.route_id) routesById.set(r.route_id, r);
        }

        for (const t of parseCSV(await tripsRes.text())) {
            if (t.trip_id) tripToRoute.set(t.trip_id, t.route_id);
        }
    } catch (error) {
        // Utan GTFS visas route_id istället för linjenummer.
        console.warn("Kunde inte läsa GTFS-filer:", error);
    }
}

function getLineNumber(vehicle) {
    const routeId = tripToRoute.get(vehicle.tripId) || vehicle.routeId;
    const route = routeId ? routesById.get(routeId) : null;

    return (
        route?.route_short_name ||
        route?.route_long_name ||
        routeId ||
        "?"
    );
}

/* ------------------------------------------------------------
 * Ikon
 * ------------------------------------------------------------ */

const TATORT_LINES = new Set([
    "11", "15", "16", "17", "27", "28", "31", "35", "37", "50",
    "61", "62", "63", "64", "67", "71", "72"
]);

function getLineClass(lineNumber) {
    const line = String(lineNumber).trim().toLowerCase();

    if (line === "1") return "line-1";
    if (line === "2") return "line-2";
    if (line === "3") return "line-3";
    if (line === "4") return "line-4";
    if (TATORT_LINES.has(line)) return "tatort";

    return "line-other";
}

function escapeHTML(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function normalizeBearing(bearing) {
    if (!Number.isFinite(bearing)) return 0;
    return ((bearing % 360) + 360) % 360;
}

function createBusIcon(lineNumber, bearing) {
    return L.divIcon({
        className: "bus-icon",
        iconSize: [42, 42],
        iconAnchor: [21, 21],
        popupAnchor: [0, -24],
        html: `
            <div class="bus-marker-container">
                <div class="bus-circle ${getLineClass(lineNumber)}">
                    <div class="direction-arrow"
                         style="transform: translateX(-50%) rotate(${normalizeBearing(bearing)}deg)"></div>
                    <span class="line-number">${escapeHTML(lineNumber)}</span>
                </div>
            </div>
        `
    });
}

function createPopupContent(v) {
    const speed = Number.isFinite(v.speed)
        ? `${(v.speed * 3.6).toFixed(1)} km/h`
        : "Okänd";

    return `
        <div class="popup-title">Buss linje ${escapeHTML(v.lineNumber)}</div>
        <div class="popup-row">
            <span class="popup-label">Fordon:</span>
            ${escapeHTML(v.label || v.vehicleId || "?")}
        </div>
        <div class="popup-row">
            <span class="popup-label">Riktning:</span>
            ${Math.round(normalizeBearing(v.bearing))}°
        </div>
        <div class="popup-row">
            <span class="popup-label">Hastighet:</span>
            ${speed}
        </div>
    `;
}

/* ------------------------------------------------------------
 * Uppdatering
 * ------------------------------------------------------------ */

let isFirstUpdate = true;

async function updateVehicles() {
    try {
        const response = await fetch("/api/vehicle-positions");

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const activeIds = new Set();

        for (const v of data.vehicles) {
            if (v.latitude == null || v.longitude == null) continue;

            const id = v.id;
            activeIds.add(id);

            const lineNumber = getLineNumber(v);
            const bearing = Number.isFinite(v.bearing) ? v.bearing : 0;

            const info = {
                lineNumber,
                bearing,
                speed: v.speed,
                label: v.vehicleLabel,
                vehicleId: v.vehicleId
            };

            let vehicle = vehicles.get(id);

            if (!vehicle) {
                const marker = L.marker([v.latitude, v.longitude], {
                    icon: createBusIcon(lineNumber, bearing),
                    riseOnHover: true
                }).addTo(map);

                marker.bindPopup(createPopupContent(info), { maxWidth: 300 });

                vehicles.set(id, { marker, lineNumber, bearing });
            } else {
                vehicle.marker.setLatLng([v.latitude, v.longitude]);

                // Byt ikon om linje eller riktning ändrats
                if (vehicle.lineNumber !== lineNumber || vehicle.bearing !== bearing) {
                    vehicle.marker.setIcon(createBusIcon(lineNumber, bearing));
                    vehicle.lineNumber = lineNumber;
                    vehicle.bearing = bearing;
                }

                vehicle.marker.setPopupContent(createPopupContent(info));
            }
        }

        for (const [id, vehicle] of vehicles) {
            if (!activeIds.has(id)) {
                map.removeLayer(vehicle.marker);
                vehicles.delete(id);
            }
        }

        statusElement.textContent =
            `Uppdaterad ${new Date().toLocaleTimeString("sv-SE")} · ${vehicles.size} bussar`;

        if (isFirstUpdate && vehicles.size > 0) {
            const bounds = L.latLngBounds(
                Array.from(vehicles.values()).map(v => v.marker.getLatLng())
            );

            if (bounds.isValid()) {
                map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
            }

            isFirstUpdate = false;
        }
    } catch (error) {
        console.error("Kunde inte uppdatera fordon:", error);
        statusElement.textContent = "Kunde inte hämta fordonspositioner";
    }
}

(async function init() {
    await loadGTFS();
    updateVehicles();
    setInterval(updateVehicles, UPDATE_INTERVAL);
})();
