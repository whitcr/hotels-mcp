import assert from "node:assert/strict";
import { it } from "node:test";
import { collectHotelLinks, normalizeHotelLinks } from "../src/chat/verified-links.js";

it("repairs an invented hotel slug using the same hotel ID and exact returned URL", () => {
  const url="https://hotels24.ua/Kyiv/Hostel-Karma-hause-Osokorki-8234.html";
  const links=new Map<number,string>();
  collectHotelLinks({hotels:[{id:8234,url}]},links);
  const result=normalizeHotelLinks("[Karma](https://hotels24.ua/Kyiv/Hostel-Karma-hause-Osokorki-Kiev-8234.html).",links);
  assert.deepEqual(result,{text:`[Karma](${url}).`,unverified:false});
});

it("does not authorize external domains or unknown hotels", () => {
  const links=new Map([[123,"https://hotels24.ua/hotel/123"]]);
  assert.equal(normalizeHotelLinks("https://evil.example/hotel/123",links).unverified,true);
  assert.equal(normalizeHotelLinks("https://hotels24.ua/hotel/999",links).unverified,true);
  assert.equal(normalizeHotelLinks("https://hotels24.ua/hotel/123",new Map()).unverified,true);
});

it("preserves exact URLs, query parameters, punctuation and internal parentheses", () => {
  const url="https://hotels24.ua/Hotel-A(B)-123.html?check_in=2027-01-02";
  const text=`[Hotel](${url}). ${url}!`;
  assert.deepEqual(normalizeHotelLinks(text,new Map([[123,url]])),{text,unverified:false});
  const links=new Map<number,string>();
  collectHotelLinks({hotels:[{id:1,url:"javascript:alert(1)"},{id:2,url:"invalid"}]},links);
  assert.equal(links.size,0);
});
