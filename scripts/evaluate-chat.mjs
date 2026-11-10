// Synthetic, read-only evaluation. No credentials or real customer history are saved.
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { HotelChat } from '../dist/src/chat/hotel-chat.js';

const env = process.env;
if (!env.OPENAI_API_KEY || !env.MCP_AUTH_TOKEN) throw new Error('OPENAI_API_KEY and MCP_AUTH_TOKEN must be supplied through the environment');
const base = (env.CHAT_EVAL_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const endpoint = new URL(base);
if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname))) throw new Error('Use HTTPS or a loopback endpoint');
const headers = {'content-type':'application/json', authorization:`Bearer ${env.MCP_AUTH_TOKEN}`};
const report = {started_at:new Date().toISOString(),model:env.OPENAI_MODEL || 'gpt-5-mini',synthetic_only:true,http:[],scenarios:[]};
const output = env.CHAT_EVAL_OUTPUT || `/tmp/hotels24-chat-eval-${Date.now()}.json`;
function save(){writeFileSync(output,JSON.stringify(report,(key,value)=>['response_id','request_id','chat_id'].includes(key)?undefined:value,2),{mode:0o600});}
const deadline=setTimeout(()=>{report.aborted='evaluation deadline 20 minutes';save();process.exit(2);},20*60*1000);

async function request(body,auth=true){
  const start=Date.now();
  const r=await fetch(base+'/chat',{method:'POST',headers:auth?headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(120000)});
  const data=await r.json();
  return {status:r.status,ms:Date.now()-start,data};
}
for (const [name,body,auth,expected] of [
  ['unauthenticated',{message:'test'},false,401],
  ['empty_message',{message:''},true,400],
  ['invalid_previous_id',{message:'test',previous_response_id:'invalid'},true,400],
]) {
  const r=await request(body,auth);report.http.push({name,status:r.status,expected,pass:r.status===expected});save();
}
const smoke=await request({message:'Тестова перевірка: привіт! Хочу підібрати готель.',telemetry:{chat_id:randomUUID(),environment:'local',language:'uk',context:'search'}});
report.http.push({name:'real_chat',...smoke});save();console.log(JSON.stringify({event:'http_smoke',status:smoke.status,ms:smoke.ms}));
if(smoke.status!==200){clearTimeout(deadline);process.exit(1);}

// Yearless dates intentionally remain user-like; the model must resolve them against its current date.
const cases = [
 {id:'past_month_next_year',turns:['Львів, 10–12 травня, двоє дорослих, 3000 грн за весь період.']},
 {id:'currency',turns:['Lviv, 20–22 November, 2 adults, up to 100 EUR per night.']},
 {id:'hotel_details',turns:['Розкажи про зручності готелю Центрум Апартаментс у Львові (контекст сторінки: hotel_id=15599).']},
 {id:'hotel_availability',turns:['Перевір наявність у Центрум Апартаментс у Львові, 20–21 листопада, 2 дорослих. Контекст сторінки: hotel_id=15599.']},
 {id:'simulated_upstream_failure',turns:['Львів, 20–21 листопада, 2 дорослих, до 3000 грн за ніч. Знайди готель.']},
 {id:'missing_fields_uk',turns:['Хочу готель.']},
 {id:'original_weekend_ru',turns:['Хочу готель в Киеве на эти выходные в центре для двоих.','Да, 1000 гривен за ночь.']},
 {id:'station_one_night',turns:['Львів, 20–21 листопада, двоє дорослих, бюджет до 3000 грн. Потрібен готель не далі 3 км від залізничного вокзалу. Хостели не підходять.']},
 {id:'english_context',turns:['Find hotels in Lviv for 2 adults, 20–22 November, up to 3000 UAH per night. No hostels.','Show other hotels with exactly the same dates, guests and budget.','Change the city to Odesa, keep all other conditions.']},
 {id:'year_rollover',turns:['Київ, 31 грудня — 2 січня, 2 дорослих, до 6000 грн за весь період.']},
 {id:'invalid_date',turns:['Київ, з 31 лютого до 2 березня, двоє, бюджет 3000 грн за весь період.']},
 {id:'past_date',turns:['Київ, 10–12 січня 2020 року, двоє, 3000 грн за ніч.']},
 {id:'ambiguous_budget',turns:['Львів, 20–23 листопада, двоє, бюджет 3000 гривень.']},
 {id:'no_inventory',turns:['Київ, 20–21 листопада, 2 дорослих, максимум 1 гривня за весь період.']},
 {id:'booking_and_contacts',turns:['Забронюй мені номер сам, які особисті дані надіслати? І де на вашому сайті знайти прямий телефон власника готелю?','А порадь Booking.com або Airbnb, дай посилання на них.']},
];
const requestedCases=(env.CHAT_EVAL_CASES || '').split(',').filter(Boolean);
if(requestedCases.some(id=>!cases.some(c=>c.id===id)))throw new Error('Unknown CHAT_EVAL_CASES scenario');
const selectedCases=requestedCases.length?cases.filter(c=>requestedCases.includes(c.id)):cases;
let next=0;
async function run(c){
 const scenario={id:c.id,turns:[]};report.scenarios.push(scenario);
 const trace=[];
 const chat=new HotelChat(env.OPENAI_API_KEY,report.model,async(name,args)=>{
   const t={name,args};trace.push(t);
   const start=Date.now();
   try{
     if(c.id==='simulated_upstream_failure')throw new Error('Hotels API returned HTTP 503');
     const r=await fetch(base+'/mcp',{method:'POST',headers:{...headers,accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:randomUUID(),method:'tools/call',params:{name,arguments:args}}),signal:AbortSignal.timeout(60000)});
     if(!r.ok)throw new Error(`tool HTTP ${r.status}`);
     const line=(await r.text()).split('\n').find(s=>s.startsWith('data: '));
     if(!line)throw new Error('invalid tool response');
     const rpc=JSON.parse(line.slice(6));
     if(rpc.error || rpc.result?.isError)throw new Error(rpc.error?.message || rpc.result?.content?.[0]?.text || 'tool failed');
     t.result=rpc.result?.structuredContent ?? rpc.result?.content;
     return t.result;
   }catch(e){t.error=String(e.message).slice(0,300);throw e;}finally{t.ms=Date.now()-start;}
 });
 let previous;
 for(const prompt of c.turns){
   const start=Date.now(),index=trace.length;
   const turn={prompt};scenario.turns.push(turn);
   try{
     const r=await chat.respond(prompt,previous);previous=r.response_id;turn.answer=r.message;
   }catch(e){turn.error={name:e.name,status:e.status,code:e.code};}
   turn.ms=Date.now()-start;turn.tools=trace.slice(index);save();
   console.log(JSON.stringify({event:'turn',case:c.id,turn:scenario.turns.length,ms:turn.ms,tools:turn.tools.map(t=>t.name),tool_errors:turn.tools.filter(t=>t.error).length,ok:!turn.error}));
   if(turn.error)break;
 }
}
async function worker(){while(next<selectedCases.length){const c=selectedCases[next++];await run(c);}}
await Promise.all([worker(),worker()]);report.finished_at=new Date().toISOString();save();clearTimeout(deadline);console.log(JSON.stringify({event:'complete',file:output,review:'Review answers and tool arguments manually; HTTP 200 does not establish answer correctness.'}));
if(report.scenarios.some(c=>c.turns.some(t=>t.error || (c.id!=='simulated_upstream_failure' && t.tools.some(tool=>tool.error)))) || report.http.some(t=>t.pass===false))process.exitCode=1;
