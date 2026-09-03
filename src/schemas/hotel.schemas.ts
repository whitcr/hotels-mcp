import { z } from "zod";

export const languageSchema = z.enum(["uk", "ru", "en"]).default("uk");
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
export const idArraySchema = z.array(z.number().int().positive()).min(1).max(50);

export const resolveDestinationInput = {
  query: z.string().trim().min(2).max(120),
  language: languageSchema,
};

export const searchHotelsInput = {
  city_id: z.number().int().positive().describe("Resolved Hotels24 city ID. Resolve the customer's city before calling this tool."),
  check_in: dateSchema,
  check_out: dateSchema,
  guests: z.number().int().min(1).max(30),
  budget_max: z.number().positive().describe("Maximum customer budget in UAH."),
  budget_type: z.enum(["total", "per_night"]).describe("Whether budget_max applies to the entire stay or one night."),
  budget_currency: z.literal("UAH").describe("The legacy API returns UAH. Ask the customer to confirm a UAH budget; do not convert implicitly."),
  stars: z.array(z.number().int().min(1).max(5)).max(5).optional(),
  hotel_types: z.array(z.number().int().positive()).max(20).optional(),
  exclude_hostels: z.boolean().default(false),
  customer_request: z.string().trim().min(2).max(500).optional(),
  preferences: z.array(z.string().trim().min(2).max(80)).max(15).default([]),
  language: languageSchema,
  limit: z.number().int().min(1).max(50).default(10),
};

export const getHotelDetailsInput = {
  hotel_ids: idArraySchema,
  language: languageSchema,
};

export const checkAvailabilityInput = {
  hotel_id: z.number().int().positive(),
  check_in: dateSchema,
  check_out: dateSchema,
  guests: z.number().int().min(1).max(30),
};

const destinationOutput = z.object({
  id: z.number().int(),
  type: z.enum(["hotel", "city", "region", "unknown"]),
  name: z.string(),
  cityId: z.number().int().optional(),
  regionId: z.number().int().optional(),
});

const roomOutput = z.object({
  blockId: z.number().int(),
  tariffId: z.string().optional(),
  name: z.string().optional(),
  maxOccupancy: z.number().optional(),
  placesAvailable: z.number().optional(),
  totalPrice: z.number().optional(),
  pricePerNight: z.number().optional(),
  currency: z.string(),
  facilities: z.array(z.string()),
});

const hotelDetailsOutput = z.object({
  id: z.number().int(),
  name: z.string().optional(),
  cityId: z.number().int().optional(),
  city: z.string().optional(),
  address: z.string().optional(),
  description: z.string().optional(),
  shortDescription: z.string().optional(),
  stars: z.number().optional(),
  rating: z.number().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  facilities: z.array(z.string()),
  photos: z.array(z.string()),
  checkIn: z.string().optional(),
  checkOut: z.string().optional(),
  url: z.string().url().optional(),
  matchReasons: z.array(z.string()),
});

export const resolveDestinationOutput = {
  destinations: z.array(destinationOutput),
};

export const searchHotelsOutput = {
  currency: z.literal("UAH"),
  check_in: dateSchema,
  check_out: dateSchema,
  customer_request: z.string().nullable(),
  budget: z.object({
    max: z.number().positive(),
    type: z.enum(["total", "per_night"]),
    currency: z.literal("UAH"),
  }),
  result_count: z.number().int().nonnegative(),
  response_guidance: z.array(z.string()),
  hotels: z.array(hotelDetailsOutput.extend({
    checkIn: dateSchema,
    checkOut: dateSchema,
    currency: z.string(),
    totalPrice: z.number().optional(),
    pricePerNight: z.number().optional(),
    availableRooms: z.number().int().nonnegative(),
    rooms: z.array(roomOutput),
    matchScore: z.number().int().nonnegative(),
  })),
};

export const hotelDetailsListOutput = {
  hotels: z.array(hotelDetailsOutput),
};

export const availabilityOutput = {
  currency: z.literal("UAH"),
  hotels: z.array(z.object({
    hotelId: z.number().int(),
    checkIn: z.string().optional(),
    checkOut: z.string().optional(),
    ratingConversion: z.number().optional(),
    rooms: z.array(roomOutput),
  })),
};
