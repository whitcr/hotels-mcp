import type { HotelDetails } from "../types.js";

export interface Proximity { type: string; max_distance_m: number; name?: string }
export function matchesProximity(hotel: HotelDetails, proximity: Proximity): boolean {
  return Boolean(hotel.landmarks?.some(place =>
    place.type === proximity.type &&
    place.distanceMeters <= proximity.max_distance_m &&
    (!proximity.name || place.name.toLocaleLowerCase().includes(proximity.name.toLocaleLowerCase()))
  ));
}

// Conservative fallback if the model accidentally omits the structured railway constraint.
// It must not invent a distance: ambiguous text requests are rejected for clarification.
export function mentionsRailway(text: string): boolean {
  return /(?:ж\s*[/.]?\s*д|залізнич|железнодорож|railway|train station)/iu.test(text);
}
