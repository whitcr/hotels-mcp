export interface Destination {
  id: number;
  type: "hotel" | "city" | "region" | "unknown";
  name: string;
  cityId?: number;
  regionId?: number;
}

export interface AvailabilityBlock {
  blockId: number;
  minNights?: number;
  tariffId?: string;
  name?: string;
  maxOccupancy?: number;
  placesAvailable?: number;
  priceBasis?: "bed" | "room";
  pricedGuests?: number;
  quantity?: number;
  unitTotalPrice?: number;
  unitPricePerNight?: number;
  totalPrice?: number;
  pricePerNight?: number;
  currency: string;
  facilities: string[];
}

export interface HotelAvailability {
  hotelId: number;
  checkIn?: string;
  checkOut?: string;
  ratingConversion?: number;
  rooms: AvailabilityBlock[];
}

export interface HotelDetails {
  propertyType?: string;
  hotelTypeId?: number;
  isHostel?: boolean;
  landmarks?: Array<{ type: string; name: string; distanceMeters: number }>;
  id: number;
  name?: string;
  cityId?: number;
  city?: string;
  address?: string;
  description?: string;
  stars?: number;
  rating?: number;
  latitude?: number;
  longitude?: number;
  facilities: string[];
  poolTypes?: Array<"indoor" | "outdoor">;
  locationMatch?: { name: string; distanceMeters: number };
  photos: string[];
  checkIn?: string;
  checkOut?: string;
  url?: string;
  shortDescription?: string;
  matchReasons: string[];
}

export interface HotelSearchResult extends HotelDetails {
  priceBasis?: "bed" | "room";
  pricedGuests?: number;
  quantity?: number;
  checkIn: string;
  checkOut: string;
  currency: string;
  totalPrice?: number;
  pricePerNight?: number;
  availableRooms: number;
  rooms: AvailabilityBlock[];
  matchScore: number;
  rankScore?: number;
  priceTier?: "economy" | "mid" | "comfort";
  descriptionMatches?: string[];
  missingPreferences?: string[];
  minimumStayNights?: number;
}
