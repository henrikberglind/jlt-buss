const map = L.map("map").setView(
    [57.7826, 14.1618],
    10
);

L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
        attribution: "&copy; OpenStreetMap contributors"
    }
).addTo(map);


// Alla aktiva fordonsmarkers.
// key = vehicle/entity ID
const vehicleMarkers = new Map();


// Enkel bussikon
const busIcon = L.divIcon({
    className: "bus-icon",
    html: "🚌",
    iconSize: [28, 28],
    iconAnchor: [14, 14]
});


async function updateVehicles() {
    try {
        const response = await fetch(
            "/api/vehicle-positions"
        );

        if (!response.ok) {
            throw new Error(
                `HTTP ${response.status}`
            );
        }

        const data = await response.json();

        const activeVehicles = new Set();

        for (const vehicle of data.vehicles) {

            if (
                vehicle.latitude == null ||
                vehicle.longitude == null
            ) {
                continue;
            }

            const id = vehicle.id;

            activeVehicles.add(id);

            let marker = vehicleMarkers.get(id);

            if (!marker) {

                marker = L.marker(
                    [
                        vehicle.latitude,
                        vehicle.longitude
                    ],
                    {
                        icon: busIcon
                    }
                ).addTo(map);

                vehicleMarkers.set(
                    id,
                    marker
                );
            }
            else {

                marker.setLatLng([
                    vehicle.latitude,
                    vehicle.longitude
                ]);
            }


            const vehicleName =
                vehicle.vehicleLabel ||
                vehicle.vehicleId ||
                vehicle.id;

            const route =
                vehicle.routeId ||
                "-";

            const speed =
                vehicle.speed != null
                    ? `${Math.round(
                        vehicle.speed * 3.6
                    )} km/h`
                    : "-";


            marker.bindPopup(`
                <strong>
                    Buss ${vehicleName}
                </strong>
                <br>
                Linje: ${route}
                <br>
                Hastighet: ${speed}
            `);
        }


        /*
         * Ta bort fordon som inte längre finns
         * i den aktuella feeden.
         */

        for (
            const [id, marker]
            of vehicleMarkers
        ) {

            if (!activeVehicles.has(id)) {

                map.removeLayer(marker);

                vehicleMarkers.delete(id);
            }
        }


        document.getElementById("status").textContent =
            `${data.vehicles.length} fordon`;
    }
    catch (error) {

        console.error(
            "Kunde inte uppdatera fordon:",
            error
        );

        document.getElementById("status").textContent =
            "Kunde inte hämta fordonspositioner";
    }
}


// Hämta direkt
updateVehicles();


// Uppdatera var femte sekund, ändrat till en gång i minuten
setInterval(
    updateVehicles,
    60000
);
