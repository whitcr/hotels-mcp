import type { Destination, HotelAvailability, HotelDetails, HotelSearchResult } from "../types.js";
import { absolutePublicUrl, array, conciseText, localized, number, object, string, textList, unwrap } from "./mapper.helpers.js";

export function mapDestinations(payload: unknown, language: string): Destination[] {
  const root = object(unwrap(payload));
  if (!root) return [];
  const sections: Array<[Destination["type"], unknown]> = [
    ["hotel", root.hotels],
    ["city", root.cities],
    ["region", root.regions],
  ];
  return sections.flatMap(([type, items]) => array(items).flatMap((item) => {
    const record = object(item);
    if (!record) return [];
    const id = number(record.id ?? record._id ?? record.hotelId ?? record.cityId ?? record.regionId);
    const name = localized(record.name ?? record.title ?? record.cityName, language);
    if (id === undefined || !name) return [];
    return [{
      id,
      type,
      name,
      cityId: number(record.city_id ?? record.cityId),
      regionId: number(record.region_id ?? record.regionId),
    }];
  }));
}

export function mapHotelDetails(payload: unknown, language: string, publicBaseUrl: string): HotelDetails[] {
  return array(unwrap(payload)).flatMap((item) => {
    const record = object(item);
    if (!record) return [];
    const id = number(record.id ?? record._id ?? record.hotelId ?? record.hotel_id);
    if (id === undefined) return [];
    const location = object(record.loc ?? record.location);
    const coordinates = array(location?.coordinates);
    const descriptions = object(record.descriptions);
    const description = object(descriptions?.description ?? descriptions?.main);
    const media = object(record.media);
    const photos = array(media?.photos ?? record.photos ?? [record.hotel_photo, record.our_url_original]).flatMap((photo) => {
      const photoRecord = object(photo);
      const url = string(photoRecord?.url ?? photoRecord?.src ?? photo);
      return url ? [url] : [];
    }).slice(0, 5);
    return [{
      id,
      name: localized(record.name, language),
      cityId: number(record.city_id ?? record.cityId),
      city: localized(record.city ?? record.cityName, language),
      address: localized(record.address, language),
      description: conciseText(localized(description?.text ?? descriptions?.shortInfo ?? descriptions?.info ?? descriptions?.text ?? record.description, language), 1_500),
      stars: number(record.class ?? record.stars),
      rating: number(record.rating ?? record.grade ?? record.ratingConversion),
      longitude: number(coordinates[0] ?? location?.longitude ?? record.longitude),
      latitude: number(coordinates[1] ?? location?.latitude ?? record.latitude),
      facilities: textList(record.facilities, language),
      photos,
      checkIn: string(record.checkIn ?? record.check_in ?? record.checkin_to),
      checkOut: string(record.checkOut ?? record.check_out ?? record.checkout_to),
      url: absolutePublicUrl(
        record.link_word ?? record.sitemap_link_word ?? record.seoUrl,
        publicBaseUrl,
        `/hotel/${id}`,
      ),
      shortDescription: conciseText(localized(description?.text ?? descriptions?.shortInfo ?? descriptions?.info ?? descriptions?.text ?? record.description, language), 280),
      matchReasons: [],
    }];
  });
}

const STOP_WORDS = new Set([
  "hotel", "отель", "готель", "для", "или", "with", "that", "this", "and", "the", "щоб", "чтобы",
  "мне", "мені", "нужен", "потрібен", "найди", "знайди", "рядом", "біля", "около", "хочу", "want",
]);

function preferenceTokens(customerRequest: string | undefined, preferences: string[]): string[] {
  const phrases = preferences.map((item) => item.toLocaleLowerCase().trim()).filter((item) => item.length >= 2);
  const words = `${customerRequest ?? ""} ${preferences.join(" ")}`
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
  return [...new Set([...phrases, ...words])];
}

function relevantFeatures(hotel: HotelDetails, tokens: string[]): string[] {
  if (!tokens.length) return [];
  return hotel.facilities.filter((facility) => {
    const normalized = facility.toLocaleLowerCase();
    return tokens.some((token) => normalized.includes(token) || token.includes(normalized));
  }).slice(0, 4);
}

export function mergeSearchResults(
  availability: HotelAvailability[],
  details: HotelDetails[],
  checkIn: string,
  checkOut: string,
  limit: number,
  customerRequest?: string,
  preferences: string[] = [],
  budgetMax?: number,
  budgetType: "total" | "per_night" = "total",
): HotelSearchResult[] {
  const detailsById = new Map(details.map((hotel) => [hotel.id, hotel]));
  const tokens = preferenceTokens(customerRequest, preferences);
  return availability
    .map((entry): HotelSearchResult => {
      const hotel: HotelDetails = detailsById.get(entry.hotelId) ?? {
        id: entry.hotelId,
        facilities: [],
        photos: [],
        matchReasons: [],
      };
      const rooms = entry.rooms.filter((room) => room.totalPrice !== undefined);
      const cheapest = rooms.sort((a, b) => (a.totalPrice ?? Infinity) - (b.totalPrice ?? Infinity))[0] ?? entry.rooms[0];
      const matchReasons = relevantFeatures(hotel, tokens);
      return {
        ...hotel,
        matchReasons,
        matchScore: matchReasons.length,
        checkIn,
        checkOut,
        currency: cheapest?.currency ?? "UAH",
        totalPrice: cheapest?.totalPrice,
        pricePerNight: cheapest?.pricePerNight,
        availableRooms: entry.rooms.length,
        rooms: entry.rooms.slice(0, 3),
        rating: hotel.rating ?? entry.ratingConversion,
      };
    })
    .filter((hotel) => {
      if (budgetMax === undefined) return true;
      const price = budgetType === "per_night" ? hotel.pricePerNight : hotel.totalPrice;
      return price !== undefined && price <= budgetMax;
    })
    .sort((a, b) => b.matchScore - a.matchScore || (a.totalPrice ?? Infinity) - (b.totalPrice ?? Infinity))
    .slice(0, limit);
}
