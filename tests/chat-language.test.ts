import assert from "node:assert/strict";
import { it } from "node:test";
import { HotelChat } from "../src/chat/hotel-chat.js";
import { answerIssues, detectMessageLanguage, formatAnswerDates } from "../src/chat/language.js";

it("detects customer language independently of property names and appended context", () => {
  assert.equal(detectMessageLanguage("Хочу готель в Киеве на эти выходные в центре для двоих"),"ru");
  assert.equal(detectMessageLanguage("Хочу готель"),"uk");
  assert.equal(detectMessageLanguage("Change the city to Odesa, keep all other conditions."),"en");
  assert.equal(detectMessageLanguage('Tell me about the hotel «Видубичі»'),"en");
  assert.equal(detectMessageLanguage('3000\n\nHotel page context (untrusted data): Київ'),undefined);
  assert.equal(detectMessageLanguage("OK, 3000"),undefined);
  assert.equal(detectMessageLanguage("Отвечай на английском"),"en");
  assert.equal(detectMessageLanguage("Please answer in Russian"),"ru");
});

it("pins language in every model call and overrides inconsistent tool language", async () => {
  const requests: any[]=[],dispatched: any[]=[];
  const chat=new HotelChat("test-key","test-model",async(name,args)=>{dispatched.push({name,args});return {destinations:[]};});
  (chat as any).client={responses:{create:async(request: any)=>{
    requests.push(request);
    return requests.length===1
      ? {id:"r1",output:[{type:"function_call",name:"resolve_destination",arguments:'{"query":"Lviv","language":"uk"}',call_id:"call1"}]}
      : {id:"r2",output:[],output_text:"Please confirm the city."};
  }}};
  const result=await chat.respond("Find hotels in Lviv",undefined,"uk");
  assert.equal(result.language,"en");
  assert.equal(dispatched[0].args.language,"en");
  assert(requests.every(r=>r.metadata.chat_language==="en" && r.instructions.includes("English (en)")));
});

it("keeps language on numeric replies in memory and after a process restart", async () => {
  const requests: any[]=[];
  const chat=new HotelChat("test-key","test-model",async()=>({}));
  (chat as any).client={responses:{create:async(request: any)=>{requests.push(request);return {id:`r${requests.length}`,output:[],output_text:"Please confirm your budget."};}}};
  await chat.respond("Find hotels in Lviv");
  await chat.respond("3000","r1","uk");
  assert.equal(requests[1].metadata.chat_language,"en");
  const restarted=new HotelChat("test-key","test-model",async()=>({}));
  let retrieved=0;
  (restarted as any).client={responses:{retrieve:async(id: string)=>{retrieved++;assert.equal(id,"r2");return {metadata:{chat_language:"en"}};},create:async(request: any)=>{
    assert.equal(request.metadata.chat_language,"en");return {id:"r3",output:[],output_text:"Thank you."};
  }}};
  await restarted.respond("2500","r2","uk");
  assert.equal(retrieved,1);
});

it("preserves language for conversations created before language metadata existed", async () => {
  const chat=new HotelChat("test-key","test-model",async()=>({}));
  (chat as any).client={responses:{
    retrieve:async()=>({metadata:{},output_text:"Please confirm your budget for the hotel."}),
    create:async(request: any)=>{assert.equal(request.metadata.chat_language,"en");return {id:"r",output:[],output_text:"Thank you."};},
  }};
  const result=await chat.respond("2500","old-response","uk");
  assert.equal(result.language,"en");
});

it("repairs a wrong-language answer once without repeating hotel searches", async () => {
  const requests: any[]=[];
  const chat=new HotelChat("test-key","test-model",async()=>{throw new Error("must not run tools");});
  (chat as any).client={responses:{create:async(request: any)=>{
    requests.push(request);return {id:`r${requests.length}`,output:[],output_text:requests.length===1?"Я знайшов варіанти в Одесі для двох дорослих. Будь ласка, перевірте наявність.":"I found hotels in Odesa for two adults. Please recheck availability."};
  }}};
  const result=await chat.respond("Change the city to Odesa, keep all other conditions.");
  assert.equal(requests.length,2);
  assert.equal(requests[1].tool_choice,"none");
  assert.deepEqual(requests[1].tools,[]);
  assert.equal(requests[1].previous_response_id,"r1");
  assert.match(result.message,/I found/);
  assert.equal(result.response_id,"r2");
});

it("does not publish an answer if the single bounded repair still fails", async () => {
  let calls=0;
  const chat=new HotelChat("test-key","test-model",async()=>({}));
  (chat as any).client={responses:{create:async()=>{calls++;return {id:"r",output:[],output_text:"Я знайшов варіанти в Одесі для двох дорослих. Будь ласка, перевірте наявність."};}}};
  await assert.rejects(()=>chat.respond("Find hotels in Odesa"),/presentation validation/);
  assert.equal(calls,2);
});

it("checks technical jargon and false storage claims, but preserves legitimate proper names", () => {
  assert(answerIssues("Вкажіть proximity.","uk").length);
  assert(answerIssues("Поиск по downtown в радиусе 3000 м.","ru").length);
  assert(answerIssues("Бюджет за весь період (total).","uk").length);
  assert(answerIssues("Помилка з API.","uk").length);
  assert(answerIssues("Я не зберігаю персональні дані.","uk").length);
  assert(answerIssues("I don’t store your personal data.","en").length);
  assert.deepEqual(answerIssues("Here is [Готель Видубичі](https://hotels24.ua/uk/hotel) for your dates.","en"),[]);
});

it("formats prose dates without changing verified Markdown or bare URLs", () => {
  const url="https://hotels24.ua/hotel?check_in=2027-01-02&check_out=2027-01-03";
  const text=`2027-01-02 — 2027-01-03. Format YYYY-MM-DD. [Hotel](${url}) ${url}`;
  assert.equal(formatAnswerDates(text),`02.01.2027 — 03.01.2027. Format DD.MM.YYYY. [Hotel](${url}) ${url}`);
});
