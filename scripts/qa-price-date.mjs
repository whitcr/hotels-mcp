// Regression acceptance probes. Nonzero exit means a confirmed quality gate still fails.
// Build first; this script makes no network requests and uses no credentials.
import { dateSchema } from '../dist/src/schemas/hotel.schemas.js';
import { mapAvailability, filterAvailabilityByBudget } from '../dist/src/mappers/index.js';

const checks=[];
function check(name,actual,expected){checks.push({name,actual,expected,pass:actual===expected});}
for(const date of ['2027-02-31','2027-13-01','2027-02-29']){
  check(`Відхилення неможливої дати ${date}`,dateSchema.safeParse(date).success,false);
}
check('Прийняття дійсної високосної дати',dateSchema.safeParse('2028-02-29').success,true);
const mapped=mapAvailability({result:[{_id:3046,block:[{
  block_id:11917,price_type:2,max_occupancy:2,block_price:240,
  min_price:{price:480,currency:'UAH'},
}]}]},2);
check('Ціна за весь період для двох гостей, а не за одне місце',mapped[0].rooms[0].totalPrice,960);
check('Ціна за ніч для двох гостей, а не за одне місце',mapped[0].rooms[0].pricePerNight,480);
const otherCurrency=mapAvailability({result:[{_id:1,block:[{
  block_id:1,block_price:100,min_price:{price:200,currency:'EUR'},
}]}]});
check('Ціна EUR не порівнюється з бюджетом UAH',filterAvailabilityByBudget(otherCurrency,1000,'total').length,0);
for(const item of checks)console.log(JSON.stringify(item));
if(checks.some(item=>!item.pass))process.exitCode=1;
