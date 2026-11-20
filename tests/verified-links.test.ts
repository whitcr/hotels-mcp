import assert from "node:assert/strict";
import { it } from "node:test";
import { collectHotelLinks, normalizeHotelLinks, readLinkStay } from "../src/chat/verified-links.js";

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

it("adds the requested stay in dd.mm.yyyy to verified links, preserving language, other parameters and fragments", () => {
  const url = "https://hotels24.ua/uk/Vyshneve/Hotel-Ukrainskiy-Tenisniy-Centr-Viccourt-14807.html";
  const stay = {check_in:"2026-12-09",check_out:"2026-12-17"};
  assert.equal(normalizeHotelLinks(`[Hotel](${url})`,new Map([[14807,url]]),stay).text,
    `[Hotel](${url}?dateArrival=09.12.2026&dateDeparture=17.12.2026)`);
  const original = url+"?utm_source=chat&dateArrival=01.01.2025&dateArrival=02.01.2025&dateDeparture=03.01.2025#rooms";
  const result = normalizeHotelLinks(original,new Map([[14807,original]]),stay);
  const parsed = new URL(result.text);
  assert.deepEqual(parsed.searchParams.getAll("dateArrival"),["09.12.2026"]);
  assert.equal(parsed.searchParams.get("dateDeparture"),"17.12.2026");
  assert.equal(parsed.searchParams.get("utm_source"),"chat"); assert.equal(parsed.hash,"#rooms");
  assert.equal(result.unverified,false);
});

it("overrides dates invented by the model and rejects foreign/unverified hotel links", () => {
  const url = "https://hotels24.ua/uk/Hotel-14807.html";
  const stay = {check_in:"2026-12-31",check_out:"2027-01-02"};
  const result = normalizeHotelLinks(`[Hotel](${url}?dateArrival=01.01.2020&dateDeparture=02.01.2020).`,new Map([[14807,url]]),stay);
  assert.equal(result.text,`[Hotel](${url}?dateArrival=31.12.2026&dateDeparture=02.01.2027).`);
  assert.equal(normalizeHotelLinks("https://evil.example/Hotel-14807.html",new Map([[14807,url]]),stay).unverified,true);
  assert.equal(normalizeHotelLinks(url,new Map(),stay).unverified,true);
});

it("does not invent dates when they are absent, incomplete, invalid or reversed", () => {
  for (const data of [undefined,{}, {check_in:"2027-01-01"}, {check_in:"2027-02-30",check_out:"2027-03-02"},
    {check_in:"2027-01-02",check_out:"2027-01-01"}, {check_in:"2027-01-01",check_out:"2027-01-01"}]) {
    assert.equal(readLinkStay(data),undefined);
  }
  assert.deepEqual(readLinkStay({check_in:"2028-02-29",check_out:"2028-03-01"}), {check_in:"2028-02-29",check_out:"2028-03-01"});
  const url="https://hotels24.ua/uk/hotel-without-id";
  assert.equal(normalizeHotelLinks(url,new Map([[1,url]])).text,url);
  assert.equal(normalizeHotelLinks(`[Hotel](${url})`,new Map([[1,url]]),{check_in:"2027-01-01",check_out:"2027-01-02"}).text,
    `[Hotel](${url}?dateArrival=01.01.2027&dateDeparture=02.01.2027)`);
});
