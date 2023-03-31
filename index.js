"use strict";

import TelegramBot from "node-telegram-bot-api";
import { Configuration, OpenAIApi } from "openai";
import Replicate from "replicate-js";
import { TranslationServiceClient } from "@google-cloud/translate";
import { SpeechClient } from "@google-cloud/speech";
import dotenv from "dotenv-safe";
import fetch from "node-fetch";
import {
  writeContext,
  readContext,
  writeMoney,
  readMoney,
  writeTemp,
  readTemp,
} from "./db.js";
import google from "./search.js";
import bing from "./bing.js";

dotenv.config({ override: true });

let CONTEXT_SIZE = 4000;
let MAX_TOKENS = 2000;

let OPENAI_PRICE = 0.002;
let IMAGE_PRICE = 0.002;
let OCR_PRICE = 0.02;

const bot = new TelegramBot(process.env.TELEGRAM_KEY, { polling: true });
const openai = new OpenAIApi(
  new Configuration({ apiKey: process.env.OPENAI_KEY })
);
const replicate = new Replicate({ token: process.env.REPLICATE_KEY });
const translation = new TranslationServiceClient();
const speech = new SpeechClient();

const temp = readTemp();
const messages = readContext();
const money = readMoney();

const last = {};

const trimContext = (context) => {
  if (!context) {
    return context;
  }
  let new_context;
  let context_size = 0;
  let index = 0;
  let first_length = -1;
  for (let i = context.length - 1; i >= 0; i--) {
    if (!context[i].content) continue;
    if (context[i].content.length + context_size > CONTEXT_SIZE) {
      index = i;
      first_length = CONTEXT_SIZE - context_size;
      break;
    }
    context_size += context[i].content.length;
  }
  new_context = [context[0]]; // preserve system message
  if (index > 0) {
    if (first_length > 0) {
      new_context.push({
        role: context[index].role,
        content: context[index].content.slice(-first_length),
      });
    } else {
      new_context.push(context[index]);
    }
  }
  new_context.push(...context.slice(index + 1));
  return new_context;
};

bot.on("message", async (msg) => {
  console.log(msg);
  if (msg.from.username !== "Snusnumrick") {
    return;
  }
  const chatId = msg.chat.id;
  let text = msg.text?.toLowerCase() ?? "";

  if (text) {
    if (processCommand(chatId, text, msg.from?.language_code)) {
      return;
    }
  }

  // Brain activity
  if (!messages[chatId] || messages[chatId].length === 0) {
    messages[chatId] = [
      {
        role: "system",
        content: "You are a helpful assistant. Your name is Robie",
      },
    ];
  } else {
    messages[chatId] = trimContext(messages[chatId]);
  }
  writeContext(messages);

  if (msg.photo) {
    // visual hemisphere (left)
    await visualToText(chatId, msg);
  }

  if (msg.voice) {
    // audio hemisphere (left)
    await voiceToText(chatId, msg);
  }

  if (!text) {
    return;
  }

  if (text.startsWith("google")) {
    await textToGoogle(chatId, msg.text.slice(7), msg.from?.language_code);
  } else if (text.startsWith("bing")) {
    await textToBing(chatId, msg.text.slice(5), msg.from?.language_code);
  } else {
    if (text.startsWith("draw") || text.startsWith("paint")) {
      // visual hemisphere (left)
      await textToVisual(chatId, text, msg.from?.language_code);
    } else {
      // audio hemisphere (right)
      await textToText(chatId, msg.text);
    }
  }
});

const processCommand = (chatId, msg, language_code) => {
  if (msg.startsWith("/command") || msg.startsWith("/help")) {
    bot.sendMessage(chatId, "Commands:\n\n").then();
    return true;
  }
  if (msg.startsWith("/start")) {
    bot.sendMessage(chatId, "Hello!").then();
    return true;
  }
  if (msg === "reset") {
    bot.sendMessage(chatId, "Context cleared").then();
    messages[chatId] = [];
    return true;
  }

  if (msg.startsWith("temperature ")) {
    temp[chatId] = +msg.slice(12)?.replace(",", ".");
    writeTemp(temp);
    bot.sendMessage(chatId, "Temperature set to " + temp[chatId]).then();
    return true;
  }

  return false;
};

const getText = async (prompt, temperature, max_tokens, chatId) => {
  let response;
  try {
    const completion = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      // model: "gpt-4",
      messages: prompt,
      max_tokens: max_tokens,
      temperature: temperature,
    });
    console.log(completion);
    response = completion?.data?.choices?.[0]?.message;
    const spent = (completion?.data?.usage?.total_tokens / 1000) * OPENAI_PRICE;
    if (spent) {
      money[chatId] = (money[chatId] ?? 0) + spent;
      writeMoney(money);
    }
  } catch (e) {
    let content = "request to openai failed with: " + e.message;
    const data_error = e.response?.data?.error?.message;
    if (data_error) {
      content += " " + data_error;
    }
    response = { role: "system", content: content };
  }
  return response;
};

const textToText = async (chatId, text) => {
  messages[chatId].push({ role: "user", content: text });
  await bot.sendChatAction(chatId, "typing").then();
  const intervalId = setInterval(() => {
    bot.sendChatAction(chatId, "typing").then();
  }, 2000);
  const response = await getText(
    messages[chatId],
    ((temp[chatId] ?? 36.5) - 36.5) / 10 + 0.5,
    MAX_TOKENS,
    chatId
  );
  console.log("response: ", response);
  clearInterval(intervalId);
  if (response) {
    if (response.role === "assistant") {
      last[chatId] = response.content;
      messages[chatId].push(response);
      writeContext(messages);
    }
    bot
      .sendMessage(chatId, response.content)
      .then(() => {})
      .catch((e) => {
        console.error(e.message);
      });
  }
};

const voiceToText = async (chatId, msg) => {
  await bot.sendChatAction(chatId, "typing").then();
  let prompt = await transcribe(msg.voice);
  if (prompt) {
    // money[chatId] = (money[chatId] ?? 0) + ???;
    // writeMoney(money);

    // link between left and right hemisphere
    last[chatId] = prompt;

    messages[chatId].push({ role: "user", content: prompt });
    writeContext(messages);
    bot
      .sendMessage(chatId, prompt)
      .then(() => {})
      .catch((e) => {
        console.error(e.message);
      });
  }
  return prompt;
};

const visualToText = async (chatId, msg) => {
  bot
    .sendChatAction(chatId, "typing")
    .then(() => {})
    .catch((e) => {
      console.error(e.message);
    });
  const intervalId = setInterval(() => {
    bot
      .sendChatAction(chatId, "typing")
      .then(() => {})
      .catch((e) => {
        console.error(e.message);
      });
  }, 2000);
  let prompt = await getPrompt(msg.photo);
  clearInterval(intervalId);
  if (prompt) {
    // link between left and right hemisphere (computer vision)
    money[chatId] = (money[chatId] ?? 0) + OCR_PRICE;
    writeMoney(money);
    bot.sendChatAction(chatId, "typing").then();
    last[chatId] = prompt;

    if (prompt) {
      messages[chatId].push({ role: "user", content: prompt });
      writeContext(messages);
      bot
        .sendMessage(chatId, prompt)
        .then(() => {})
        .catch((e) => {
          console.error(e.message);
        });
    }
  }
};

const textToVisual = async (chatId, text, language_code) => {
  if (text === "draw" || text === "paint") {
    // link between right and left hemisphere (painting)
    text = last[chatId]?.replace("child", "");
  } else {
    last[chatId] = text;
  }

  if (!text) {
    return;
  }

  messages[chatId].push({ role: "user", content: text });
  writeContext(messages);

  bot.sendChatAction(chatId, "typing").then();
  const intervalId = setInterval(() => {
    bot.sendChatAction(chatId, "typing").then();
  }, 2000);

  let negative_text = null;
  if (text?.startsWith("paint")) {
    text = text.slice(5);

    const positive_request = `In a short sentence, create the ultimate ${text} image description. 
    using descriptive language create a vivid and evocative image in the mind of the viewer, 
    give extremely intricate details, portray it hyper-realistically, high-resolution image, 
    add the perfect artist for the job, add art movements, 
    styles and techniques that would match the artwork, 
    with luxury of attention to every small detail, hyper-maximalist, 
    featuring uniqueness and originality, sense of awe, must be a perfect, groundbreaking, breathtaking, 
    amazing, incredible, stunning, epic masterpiece.`;

    const prompt = [
      {
        role: "user",
        content: positive_request,
      },
    ];
    const prompt_response = await getText(
      prompt,
      ((temp[chatId] ?? 36.5) - 36.5) / 10 + 0.5,
      MAX_TOKENS,
      chatId
    );
    text = prompt_response.content;
    let bot_response = "";
    if (prompt_response.role === "assistant") {
      bot_response = "I rephrased your description as \n\n" + text;
      messages[chatId].push({ role: "assistant", content: text });
      writeContext(messages);
    } else {
      bot_response = "Sorry: \n\n" + text;
    }
    bot
      .sendMessage(chatId, bot_response)
      .then(() => {})
      .catch((e) => {
        console.error(e.message);
      });
  }

  if (text.startsWith("draw")) {
    text = text.slice(4);
  }

  const art = await getArt(text, negative_text);

  clearInterval(intervalId);

  if (art.status === "ok") {
    money[chatId] = (money[chatId] ?? 0) + IMAGE_PRICE;
    writeMoney(money);
    bot
      .sendPhoto(chatId, art.data)
      .then()
      .catch((e) => {
        console.error(e.message);
      });
  } else {
    bot.sendMessage(chatId, art.status).then();
  }
};

const transcribe = async (voice) => {
  const file_id = voice.file_id;
  const fileUri = await bot.getFileLink(file_id);
  console.log(fileUri);
  return "";
};

const getPrompt = async (photo) => {
  const file_id = photo[photo.length - 1].file_id;
  const fileUri = await bot.getFileLink(file_id);
  const img2prompt = await replicate.models.get("methexis-inc/img2prompt");
  return img2prompt.predict({ image: fileUri });
};

const getArt = async (prompt, negative_prompt) => {
  const engineId = "stable-diffusion-512-v2-1";
  const apiHost = process.env.API_HOST ?? "https://api.stability.ai";
  const apiKey = process.env.STABILITY_KEY;
  const inputWidth = 512;
  const inputHeight = 512;
  const numberSteps = 50;
  // const universalNegativePrompt =
  //   "ugly, tiling, poorly drawn hands, poorly drawn feet, poorly drawn face, out of frame, extra limbs, disfigured, " +
  //   "deformed, body out of frame, bad anatomy, watermark, signature, cut off, low contrast, underexposed, " +
  //   "overexposed, bad art, beginner, amateur, distorted face, too many fingers";
  const universalNegativePrompt =
    "tiling, poorly drawn hands, poorly drawn feet, poorly drawn face, out of frame, extra limbs, disfigured, " +
    "deformed, body out of frame, bad anatomy, watermark, signature, cut off, low contrast, underexposed, " +
    "overexposed, bad art, beginner, amateur, distorted face, too many fingers";
  negative_prompt = negative_prompt ?? universalNegativePrompt;

  let text_prompts = [];
  if (prompt.startsWith("[")) {
    prompt = prompt.slice(1, -1);
    prompt.split("|").forEach((line) => {
      const elements = line.split(":");
      text_prompts.push({
        text: elements[0],
        weight: Number(elements[1]),
      });
    });
  } else {
    let weight = 1;
    prompt.split("\n\n").forEach((line) => {
      if (line.length > 0) {
        text_prompts.push({
          text: line,
          weight: weight,
        });
        weight *= 0.5;
      }
    });
    text_prompts.push({
      text: negative_prompt,
      weight: -1, // negative prompt
    });
  }

  const response = await fetch(
    `${apiHost}/v1beta/generation/${engineId}/text-to-image`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "image/png",
        Authorization: `${apiKey}`,
      },
      body: JSON.stringify({
        cfg_scale: 7,
        clip_guidance_preset: "FAST_BLUE",
        height: inputHeight,
        width: inputWidth,
        samples: 1,
        steps: numberSteps,
        text_prompts: text_prompts,
      }),
    }
  );

  let status = "ok";
  let data = null;
  if (!response.ok) {
    const text = await response.text().then();
    const message = JSON.parse(text).message;
    status = `Stability AI error: ${message}`;
    console.error(status);
  } else {
    data = await response.buffer().then();
  }

  return { status: status, data: data };
};

const textToGoogle = async (chatId, msg, language_code) => {
  await bot
    .sendChatAction(chatId, "typing")
    .then(() => {})
    .catch((e) => {
      console.error(e.message);
    });
  if (!msg) {
    // use the last user message - from messages[chatId] select most recent message with role: "user", leave messages intact
    msg = messages[chatId]
      .filter((m) => m.role === "user")
      .slice(-1)[0].content;
  }
  let response = await google(msg, language_code);
  if (response) {
    // trim response, leaving only first CONTEXT_SIZE characters
    response = response.slice(0, CONTEXT_SIZE);
    const saved_messages = [...messages[chatId]];
    messages[chatId].push({ role: "user", content: response });
    messages[chatId] = trimContext(messages[chatId]);
    await textToText(chatId, msg);
    messages[chatId] = saved_messages ?? messages[chatId].slice(-2);
    writeContext(messages);
  } else {
    bot
      .sendMessage(chatId, "I don't know what you mean")
      .then(() => {})
      .catch((e) => {
        console.error(e.message);
      });
  }
};

async function textToBing(chatId, msg, language_code) {
  if (!msg) {
    // use the last user message - from messages[chatId] select most recent message with role: "user", leave messages intact
    msg = messages[chatId]
      .filter((m) => m.role === "user")
      .slice(-1)[0].content;
  }
  if (!msg) {
    return;
  }
  bot
    .sendChatAction(chatId, "typing")
    .then(() => {})
    .catch((e) => {
      console.error(e.message);
    });
  const intervalId = setInterval(() => {
    bot.sendChatAction(chatId, "typing").then();
  }, 1000);
  const response_text = await bing(msg, language_code);
  clearInterval(intervalId);

  // replace **..** in response_text with <b> ... </b>
  let html_text = response_text.replace(/\*\*(.*?)\*\*/g, "<b>$1</b>");
  // replace markdown links with html links
  html_text = html_text.replace(/\[(.*?)\]\((.*?)\)/g, "<a href='$2'>$1</a>");

  // replace **..** in response_text with just ...
  const plain_text = response_text.replace(/\*\*(.*?)\*\*/g, "$1");

  last[chatId] = plain_text;
  messages[chatId].push({ role: "assistant", content: plain_text });
  writeContext(messages);
  bot
    .sendMessage(chatId, html_text, { parse_mode: "HTML" })
    .then()
    .catch((e) => {
      console.error(e.message);
    });
}
