import { load } from "cheerio";
import fetch from "node-fetch";

const userAgents = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/74.0.3729.169 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/72.0.3626.121 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/74.0.3729.157 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.45 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/97.0.4692.71 Safari/537.36",
];

async function google(term, lang) {
  const $ = await fetchData(term, lang);
  const brief = $(".sXLaOe")
    .map((i, element) => $(element).text())
    .get()
    .join(" ");
  const extract = $(".hgKElc")
    .map((i, element) => $(element).text())
    .get()
    .join(" ");
  const denotion = $(".wx62f")
    .map((i, element) => $(element).text())
    .get()
    .join(" ");
  const place = $(".HwtpBd")
    .map((i, element) => $(element).text())
    .get()
    .join(" ");
  // const wiki = $(".kno-rdesc span")
  const wiki = $(".yxjZuf span")
    .map((i, element) => $(element).text())
    .get()
    .join(" ");
  const a1 =
    $(".UDZeY span")
      .map((i, element) => $(element).text())
      .get()
      .join(" ")
      .replaceAll("Описание", "")
      .replaceAll("ЕЩЁ", "") + $(".LGOjhe span").text();
  const a2 = $(".yXK7lf span")
    .map((i, element) => $(element).text())
    .get()
    .join(" ");

  // concatenate all non-empty results, separated by semicolons
  const brief_result = [brief, extract, denotion, place, wiki]
    .filter((r) => r)
    .join("; ");
  const result = brief_result || a2 || a1;
  console.log(result);
  return result;
}

async function fetchData(term, lang) {
  const result = await fetch(
    `https://www.google.com/search?q=${encodeURIComponent(term)}&hl=${lang}`,
    {
      headers: {
        "User-Agent": userAgents[Math.floor(Math.random() * userAgents.length)],
      },
    }
  );
  return load(await result.text());
}

export default google;
//console.log(await google("Java", "en"));
