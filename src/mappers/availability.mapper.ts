import type { AvailabilityBlock, HotelAvailability } from "../types.js";
import { array, number, object, string, textList, unwrap } from "./mapper.helpers.js";

export function mapAvailability(payload: unknown, guests = 1): HotelAvailability[] {
  if (!Number.isInteger(guests) || guests < 1 || guests > 30) throw new Error("Invalid guest count");
  return array(unwrap(payload)).flatMap((item) => {
    const record = object(item);
    if (!record) return [];
    const hotelId = number(record.hotel_id ?? record._id ?? record.hotelId);
    if (hotelId === undefined) return [];
    const rooms = array(record.block ?? record.blocks).flatMap((rawBlock): AvailabilityBlock[] => {
      const block = object(rawBlock);
      if (!block) return [];
      const minPrice = object(block.min_price);
      const priceType = number(block.price_type);
      const currency = string(minPrice?.currency ?? block.currency)?.toUpperCase();
      // Unknown units/currencies must never become apparently cheap UAH offers.
      if ((priceType !== 1 && priceType !== 2) || currency !== "UAH") return [];
      const maxOccupancy = number(block.max_occupancy);
      const placesAvailable = number(block.placesAvailable ?? block.places_available);
      if (priceType === 1 && maxOccupancy !== undefined && maxOccupancy < guests) return [];
      if (placesAvailable !== undefined && placesAvailable < (priceType === 2 ? guests : 1)) return [];
      // Legacy filters availability for all guests, then removes placesAvailable.
      // maxOccupancy on a bed tariff is NOT the number of available beds.
      const quantity = priceType === 2 ? guests : 1;
      const unitTotalPrice = number(minPrice?.price ?? block.total_price);
      const unitPricePerNight = number(block.block_price ?? block.price_per_night);
      if (unitTotalPrice === undefined || unitPricePerNight === undefined || unitTotalPrice <= 0 || unitPricePerNight <= 0) return [];
      const totalPrice = Math.round(unitTotalPrice * quantity * 100) / 100;
      const pricePerNight = Math.round(unitPricePerNight * quantity * 100) / 100;
      if (!Number.isFinite(totalPrice) || !Number.isFinite(pricePerNight)) return [];
      return [{
        blockId: number(block.block_id ?? block.id) ?? 0,
        tariffId: string(block.tariff_id),
        name: string(block.name),
        maxOccupancy,
        placesAvailable,
        priceBasis: priceType === 2 ? "bed" : "room",
        pricedGuests: guests,
        quantity,
        unitTotalPrice,
        unitPricePerNight,
        totalPrice,
        pricePerNight,
        currency,
        facilities: textList(block.facilities, "uk"),
      }];
    });
    return rooms.length ? [{
      hotelId,
      checkIn: string(record.arrival_date),
      checkOut: string(record.departure_date),
      rooms,
    }] : [];
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
      return room.currency === "UAH" && price !== undefined && Number.isFinite(price) && price > 0 && price <= budgetMax;
    });
    return rooms.length ? [{ ...hotel, rooms }] : [];
  });
}
