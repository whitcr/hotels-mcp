export interface Destination {
  id: number;
  type: "hotel" | "city" | "region" | "unknown";
  name: string;
  cityId?: number;
  regionId?: number;
}

export interface AvailabilityBlock {
  blockId: number;
  tariffId?: string;
  name?: string;
  maxOccupancy?: number;
  placesAvailable?: number;
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
  photos: string[];
  checkIn?: string;
  checkOut?: string;
  url?: string;
  shortDescription?: string;
  matchReasons: string[];
}

export interface HotelSearchResult extends HotelDetails {
  checkIn: string;
  checkOut: string;
  currency: string;
  totalPrice?: number;
  pricePerNight?: number;
  availableRooms: number;
  rooms: AvailabilityBlock[];
  matchScore: number;
}
