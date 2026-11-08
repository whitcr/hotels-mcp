import assert from "node:assert/strict";
import { it } from "node:test";
import { z } from "zod";
import { mapHotelDetails } from "../src/mappers/hotel.mapper.js";
import { matchesProximity } from "../src/tools/proximity.js";
import { searchHotelsInput } from "../src/schemas/hotel.schemas.js";
import { registerSearchHotels } from "../src/tools/search-hotels.js";

it("maps API geo tags in meters; missing/invalid distances are never nearby", () => {
  const [hotel] = mapHotelDetails([{hotel_id:1,name:"Test",tags:{geo:[
    {name:"railway",distance:2500,valueLang:{uk:"Головний вокзал"}},
    {name:"railway",distance:null}, {name:"railway",distance:""}, {name:"railway",distance:-1},
    {name:"downtown",distance:100},
  ]}}], "uk", "https://hotels24.ua");
  assert(hotel);
  assert.equal(hotel.landmarks?.length,2);
  assert(matchesProximity(hotel,{type:"railway",max_distance_m:3000}));
  assert(!matchesProximity(hotel,{type:"railway",max_distance_m:2000}));
  assert(!matchesProximity(hotel,{type:"railway",max_distance_m:3000,name:"Інший"}));
});

it("filters 17km/unknown/wrong landmark before limiting and does not choose only cheap hotels", async () => {
  let callback: any;
  registerSearchHotels({registerTool: (_n: string,_c: unknown,fn: any) => callback=fn} as any, {
    maxResults:1,hotelPublicBaseUrl:"https://hotels24.ua",
    client:{
      getAvailability:async()=>({result:[1,2,3,4].map(id=>({_id:id,block:[{block_id:id,block_price:id*100,min_price:{price:id*100,currency:"UAH"}}]}))}),
      getHotelDetails:async(ids:number[])=>ids.map(id=>({hotel_id:id,name:"Hotel "+id,tags:{geo:[
        {name:id===2?"downtown":"railway",distance:id===1?17000:id===3?null:2500,valueLang:{uk:"Головний"}},
      ]}})),
    },
  } as any);
  const args=z.object(searchHotelsInput).parse({city_id:1,check_in:"2099-01-01",check_out:"2099-01-02",guests:2,budget_max:3000,budget_type:"total",budget_currency:"UAH",proximity:{type:"railway",max_distance_m:3000}});
  const result=await callback(args);
  assert.equal(result.isError,undefined);
  assert.deepEqual(result.structuredContent.hotels.map((h:any)=>h.id),[4]);
  const empty=await callback({...args,proximity:{type:"railway",max_distance_m:500}});
  assert.deepEqual(empty.structuredContent.hotels,[]);
  const omitted=await callback({...args,proximity:undefined,customer_request:"поруч з жд вокзалом"});
  assert.equal(omitted.isError,true);
});
