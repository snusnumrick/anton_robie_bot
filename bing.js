"use strict";
import { BingChat } from "bing-chat";

async function bing(term, lang) {
  // ask bing chat and return the answer
  const api = new BingChat({ cookie: process.env.BING_COOKIE });
  return new Promise((resolve, reject) => {
    api
      .sendMessage(term)
      .then((reply) => {
        let response = reply.text;
        // Remove the ^[number]^ from the response
        response = response.replace(/\s*\[\^\d+\^\]/g, "");
        resolve(response);
      })
      .catch((error) => {
        reject(error);
      });
  });
}

export default bing;
