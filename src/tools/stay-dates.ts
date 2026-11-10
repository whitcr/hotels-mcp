import { dateSchema } from "../schemas/hotel.schemas.js";

export function validateStayDates(checkIn: string, checkOut: string, today = new Date().toISOString().slice(0, 10)): void {
  dateSchema.parse(checkIn);
  dateSchema.parse(checkOut);
  if (checkIn >= checkOut) throw new Error("check_out must be after check_in");
  if (checkIn < today) throw new Error(`check_in must not be in the past; today is ${today}`);
}
