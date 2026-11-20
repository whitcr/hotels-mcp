import assert from "node:assert/strict";
import { it } from "node:test";
import { HotelChat } from "../src/chat/hotel-chat.js";

const url="https://hotels24.ua/uk/Hotel-14807.html";
const hotel={hotels:[{id:14807,url}]};
const answer=(id:string)=>({id,output:[],output_text:`Here is [Hotel](${url}).`});
const tool=(id:string,name:string,args:unknown)=>({id,output:[{type:"function_call",name,arguments:JSON.stringify(args),call_id:id}]});
function fake(responses:unknown[], previous:unknown={metadata:{}}) {
  const requests:any[]=[], dispatched:any[]=[];
  const chat=new HotelChat("test-key","test-model",async(name,args)=>{dispatched.push({name,args});return hotel;});
  (chat as any).client={responses:{retrieve:async()=>previous,create:async(request:any)=>{
    requests.push(request);assert(responses.length,"Unexpected model call");return responses.shift();
  }}};
  return {chat,requests,dispatched};
}

it("adds dates after a search, retains them for details and replaces them when the customer changes the stay",async()=>{
  const first={check_in:"2026-12-09",check_out:"2026-12-17"};
  const next={check_in:"2026-12-31",check_out:"2027-01-02"};
  const {chat,requests}=fake([
    tool("t1","search_hotels",first),answer("r1"),
    tool("t2","get_hotel_details",{hotel_ids:[14807]}),answer("r2"),
    tool("t3","check_hotel_availability",{hotel_id:14807,...next}),answer("r3"),
  ]);
  const a=await chat.respond("Find hotels for my travel dates");
  assert(a.message.includes("?dateArrival=09.12.2026&dateDeparture=17.12.2026"));
  const b=await chat.respond("Tell me more about this hotel",a.response_id);
  assert(b.message.includes("?dateArrival=09.12.2026&dateDeparture=17.12.2026"));
  const c=await chat.respond("Change my dates",b.response_id);
  assert(c.message.includes("?dateArrival=31.12.2026&dateDeparture=02.01.2027"));
  assert(!c.message.includes("09.12.2026"));
  assert.deepEqual(requests.at(-1).metadata,{chat_language:"en",...next});
});

it("restores stay metadata after restart even when the new message determines its language",async()=>{
  const stay={check_in:"2027-01-02",check_out:"2027-01-04"};
  const {chat}=fake([tool("t","get_hotel_details",{hotel_ids:[14807]}),answer("r")],{metadata:{chat_language:"uk",...stay}});
  const result=await chat.respond("Please repeat the hotel link", "previous-response");
  assert.equal(result.language,"en");
  assert(result.message.includes("dateArrival=02.01.2027&dateDeparture=04.01.2027"));
});

it("can attach dates on a details-only turn without sending new fields to the MCP details tool",async()=>{
  const stay={check_in:"2027-02-01",check_out:"2027-02-03"};
  const {chat,dispatched}=fake([tool("t","get_hotel_details",{hotel_ids:[14807],...stay}),answer("r")]);
  const result=await chat.respond("Tell me about this hotel for my dates");
  assert(result.message.includes("dateArrival=01.02.2027&dateDeparture=03.02.2027"));
  assert.deepEqual(dispatched[0].args,{hotel_ids:[14807],language:"en"});
});

it("keeps links date-free when the customer has not specified a stay",async()=>{
  const {chat}=fake([tool("t","get_hotel_details",{hotel_ids:[14807]}),answer("r")]);
  assert.equal((await chat.respond("Tell me about this hotel")).message,answer("r").output_text);
});
