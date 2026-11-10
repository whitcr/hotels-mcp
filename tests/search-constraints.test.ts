import assert from "node:assert/strict";
import { it } from "node:test";
import { z } from "zod";
import { dateSchema, searchHotelsInput } from "../src/schemas/hotel.schemas.js";
import { mapHotelDetails } from "../src/mappers/index.js";
import { registerSearchHotels } from "../src/tools/search-hotels.js";
import { registerCheckAvailability } from "../src/tools/check-availability.js";
import { validateStayDates } from "../src/tools/stay-dates.js";

it("validates real calendar dates, leap years, past dates and date order", () => {
  for(const date of ["2027-02-31","2027-13-01","2027-02-29","1900-02-29","2100-02-29","2027-04-31","2027-00-01","0000-01-01"]){
    assert.equal(dateSchema.safeParse(date).success,false,date);
  }
  for(const date of ["2028-02-29","2000-02-29","2026-12-31","2027-01-01"])assert.equal(dateSchema.safeParse(date).success,true,date);
  assert.doesNotThrow(()=>validateStayDates("2026-12-31","2027-01-01","2026-12-31"));
  assert.throws(()=>validateStayDates("2026-12-30","2027-01-01","2026-12-31"));
  assert.throws(()=>validateStayDates("2027-01-01","2027-01-01","2026-12-31"));
});

it("classifies hostels using property data, without treating a bed tariff as a property type", () => {
  const result=mapHotelDetails([
    {hotel_id:1,hoteltype_id:13,hotel_type_name:"Hostel"},
    {hotel_id:2,hoteltype_id:3,hotel_type_name:"Hotel"},
    {hotel_id:3,hotel_type:{uk:"Хостел"}},
    {hotel_id:4},
  ],"uk","https://hotels24.ua");
  assert.deepEqual(result.map(h=>h.isHostel),[true,false,true,undefined]);
  assert.equal(mapHotelDetails([{hotel_id:5,rating:68.6,ratingConversion:68.6}],"uk","https://hotels24.ua")[0]!.rating,undefined);
});

it("excludes hostel properties and unknown types before limiting results, including private rooms in hostels", async () => {
  let callback: any;
  const deps={maxResults:1,hotelPublicBaseUrl:"https://hotels24.ua",client:{
    getAvailability:async()=>({result:[1,2,3,4].map(id=>({_id:id,block:[{block_id:id,price_type:1,max_occupancy:2,block_price:500,min_price:{price:500,currency:"UAH"}}]}))}),
    getHotelDetails:async()=>[
      {hotel_id:1,hoteltype_id:13,name:"Hostel with private room",link_word:"/hostel"},
      {hotel_id:2,name:"Unknown type",link_word:"/unknown"},
      {hotel_id:3,hoteltype_id:13,name:"Second hostel",link_word:"/second"},
      {hotel_id:4,hoteltype_id:3,name:"Hotel",link_word:"/hotel"},
    ],
  }};
  registerSearchHotels({registerTool:(_n: string,_c: unknown,cb: any)=>{callback=cb;}} as any,deps as any);
  const args=z.object(searchHotelsInput).parse({city_id:1,check_in:"2099-01-01",check_out:"2099-01-02",guests:2,budget_max:1000,budget_type:"total",budget_currency:"UAH",exclude_hostels:true,limit:1});
  const result=await callback(args);
  assert.equal(result.isError,undefined);
  assert.deepEqual(result.structuredContent.hotels.map((h: any)=>h.id),[4]);
});

it("both availability tools reject impossible dates before invoking the upstream", async () => {
  for(const register of [registerSearchHotels,registerCheckAvailability]){
    let callback: any,calls=0;
    register({registerTool:(_n: string,_c: unknown,cb: any)=>{callback=cb;}} as any,{
      maxResults:1,hotelPublicBaseUrl:"https://hotels24.ua",client:{getAvailability:async()=>{calls++;return [];}}
    } as any);
    const result=await callback({check_in:"2099-02-31",check_out:"2099-03-03"});
    assert.equal(result.isError,true);
    assert.equal(calls,0);
  }
});
