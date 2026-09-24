import GtfsRealtimeBindings from "gtfs-realtime-bindings";

export async function GET() {
    const apiKey = process.env.TRAFIKLAB_API_KEY;

    if (!apiKey) {
        return Response.json(
            {
                error: "TRAFIKLAB_API_KEY saknas"
            },
            {
                status: 500
            }
        );
    }

    const url =
        "https://opendata.samtrafiken.se/gtfs-rt/jlt/VehiclePositions.pb" +
        `?key=${encodeURIComponent(apiKey)}`;

    try {
        const response = await fetch(url, {
            headers: {
                Accept: "application/x-protobuf"
            },

            // Hindra Next.js från att cacha själva Trafiklab-anropet.
            cache: "no-store"
        });

        if (!response.ok) {
            console.error(
                "Trafiklab svarade:",
                response.status,
                response.statusText
            );

            return Response.json(
                {
                    error: "Trafiklab svarade med ett fel",
                    status: response.status
                },
                {
                    status: 502
                }
            );
        }

        const buffer = await response.arrayBuffer();

        const feed =
            GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
                new Uint8Array(buffer)
            );

        const vehicles = [];

        for (const entity of feed.entity) {
            const vehicle = entity.vehicle;

            if (!vehicle || !vehicle.position) {
                continue;
            }

            const position = vehicle.position;

            vehicles.push({
                id: entity.id,

                vehicleId: vehicle.vehicle?.id ?? null,
                vehicleLabel: vehicle.vehicle?.label ?? null,

                tripId: vehicle.trip?.tripId ?? null,
                routeId: vehicle.trip?.routeId ?? null,

                latitude: position.latitude ?? null,
                longitude: position.longitude ?? null,

                bearing: position.bearing ?? null,
                speed: position.speed ?? null,

                timestamp: vehicle.timestamp
                    ? Number(vehicle.timestamp)
                    : null,

                currentStopSequence:
                    vehicle.currentStopSequence ?? null,

                stopId: vehicle.stopId ?? null,

                currentStatus:
                    vehicle.currentStatus ?? null,

                occupancyStatus:
                    vehicle.occupancyStatus ?? null
            });
        }

        return Response.json(
            {
                timestamp: Math.floor(Date.now() / 1000),
                vehicles
            },
            {
                headers: {
                    /*
                     * CDN/Vercel får använda resultatet i 5 sekunder.
                     *
                     * stale-while-revalidate innebär att ett något äldre
                     * resultat kan användas medan ett nytt hämtas.
                     */
                    "Cache-Control":
                        "public, s-maxage=5, stale-while-revalidate=5"
                }
            }
        );
    } catch (error) {
        console.error("Kunde inte läsa VehiclePositions:", error);

        return Response.json(
            {
                error: "Kunde inte läsa fordonspositioner"
            },
            {
                status: 500
            }
        );
    }
}
