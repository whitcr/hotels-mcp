import type { HotelDetails } from "../types.js";

export interface Proximity { type: string; max_distance_m: number; name?: string; point?: { latitude: number; longitude: number } }
export function findProximity(hotel: HotelDetails, proximity: Proximity) {
  if (proximity.type === "map_point") {
    const point = proximity.point;
    const { latitude, longitude } = hotel;
    if (!point || latitude === undefined || longitude === undefined
        || Math.abs(latitude) > 90 || Math.abs(longitude) > 180
        || (latitude === 0 && longitude === 0)) return undefined;
    const radians = Math.PI / 180;
    const latDelta = (latitude - point.latitude) * radians;
    const lonDelta = (longitude - point.longitude) * radians;
    const arc = Math.sin(latDelta / 2) ** 2
      + Math.cos(latitude * radians) * Math.cos(point.latitude * radians) * Math.sin(lonDelta / 2) ** 2;
    const distance = 12_742_000 * Math.asin(Math.sqrt(Math.min(1, arc)));
    return distance <= proximity.max_distance_m
      ? { name: proximity.name || "Map point", distanceMeters: Math.round(distance) }
      : undefined;
  }
  if (proximity.type === "landmark" && !proximity.name) return undefined;
  return hotel.landmarks?.find(place =>
    (proximity.type === "landmark" || place.type === proximity.type) &&
    place.distanceMeters <= proximity.max_distance_m &&
    (!proximity.name || place.name.toLocaleLowerCase().includes(proximity.name.toLocaleLowerCase()))
  );
}

export function matchesProximity(hotel: HotelDetails, proximity: Proximity): boolean {
  return Boolean(findProximity(hotel, proximity));
}

// Conservative fallback if the model accidentally omits the structured railway constraint.
// It must not invent a distance: ambiguous text requests are rejected for clarification.
export function mentionsRailway(text: string): boolean {
  return /(?:ж\s*[/.]?\s*д|залізнич|железнодорож|railway|train station)/iu.test(text);
}
