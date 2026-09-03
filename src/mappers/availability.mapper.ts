import type { AvailabilityBlock, HotelAvailability } from "../types.js";
import { array, number, object, string, textList, unwrap } from "./mapper.helpers.js";

export function mapAvailability(payload: unknown): HotelAvailability[] {
  return array(unwrap(payload)).flatMap((item) => {
    const record = object(item);
    if (!record) return [];
    const hotelId = number(record.hotel_id ?? record._id ?? record.hotelId);
    if (hotelId === undefined) return [];
    const rooms = array(record.block ?? record.blocks).flatMap((rawBlock): AvailabilityBlock[] => {
      const block = object(rawBlock);
      if (!block) return [];
      const minPrice = object(block.min_price);
      return [{
        blockId: number(block.block_id ?? block.id) ?? 0,
        tariffId: string(block.tariff_id),
        name: string(block.name),
        maxOccupancy: number(block.max_occupancy),
        placesAvailable: number(block.placesAvailable ?? block.places_available),
        totalPrice: number(minPrice?.price ?? block.total_price),
        pricePerNight: number(block.block_price ?? block.price_per_night),
        currency: string(minPrice?.currency ?? block.currency) ?? "UAH",
        facilities: textList(block.facilities, "uk"),
      }];
    });
    return [{
      hotelId,
      checkIn: string(record.arrival_date),
      checkOut: string(record.departure_date),
      ratingConversion: number(record.hotel_rating_conversion),
      rooms,
    }];
  });
}

export function filterAvailabilityByBudget(
  availability: HotelAvailability[],
  budgetMax: number,
  budgetType: "total" | "per_night",
): HotelAvailability[] {
  return availability.flatMap((hotel) => {
    const rooms = hotel.rooms.filter((room) => {
      const price = budgetType === "per_night" ? room.pricePerNight : room.totalPrice;
      return price !== undefined && price <= budgetMax;
    });
    return rooms.length ? [{ ...hotel, rooms }] : [];
  });
}
