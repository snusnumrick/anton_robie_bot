import TelegramBot from "node-telegram-bot-api";
import {Configuration, OpenAIApi} from "openai";
import Replicate from "replicate-js";
import dotenv from "dotenv";
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

dotenv.config({override: true});

let CONTEXT_SIZE = 800;
let MAX_TOKENS = 2000;

let OPENAI_PRICE = 0.002;
let IMAGE_PRICE = 0.002;
let OCR_PRICE = 0.02;

const bot = new TelegramBot(process.env.TELEGRAM_KEY, {polling: true});
const openai = new OpenAIApi(new Configuration({apiKey: process.env.OPENAI_KEY}));
const replicate = new Replicate({token: process.env.REPLICATE_KEY});

const temp = readTemp();
const messages = readContext();
const money = readMoney();

const last = {};

const trimContext = (context) => {
    let new_context;
    let context_size = 0;
    let index = 0;
    let first_length = -1;
    for (let i = context.length - 1; i >= 0; i--) {
        if (context[i].length + context_size > CONTEXT_SIZE) {
            index = i;
            first_length = CONTEXT_SIZE - context_size;
            break;
        }
        context_size += context[i].length;
    }
    new_context = [context[0]];   // preserve system message
    if (index > 0) {
        if (first_length > 0) {
            new_context.push(context[index].slice(-first_length));
        } else {
            new_context.push(context[index]);
        }
    }
    new_context.push(...context.slice(index + 1));
    return new_context;
};

bot.on("message", async (msg) => {
    console.log(msg);
    const chatId = msg.chat.id;
    const text = msg.text?.toLowerCase();

    if (text) {
        if (processCommand(chatId, text, msg.from?.language_code)) {
            return;
        }
    }

    // Brain activity
    if (!messages[chatId]) {
        messages[chatId] = [{"role": "system", "content": "You are a helpful assistant. Your name is Robie"}];
    } else {
        messages[chatId] = trimContext(messages[chatId]);
    }
    writeContext(messages);

    if (msg.photo) {
        // visual hemisphere (left)
        await visualToText(chatId, msg);
    }

    if (!text) {
        return;
    }

    if (text.startsWith("google")) {
        await textToGoogle(chatId, msg.text.slice(7), msg.from?.language_code);
    } else {
        if (text.startsWith("draw") || text.startsWith("paint")) {
            // visual hemisphere (left)
            await textToVisual(chatId, text, msg.from?.language_code);
        } else {
            // audio hemisphere (right)
            await textToText(chatId, msg);
        }
    }
});

const processCommand = (chatId, msg, language_code) => {
    if (msg.startsWith("/command") || msg.startsWith("/help")) {
        bot.sendMessage(
            chatId,
            "Commands:\n\n"
        ).then();
        return true;
    }
    if (msg.startsWith("/start")) {
        bot.sendMessage(
            chatId,
            "Hello!"
        ).then();
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

const getText = async (messages, temperature, max_tokens, chatId) => {
    let response;
    try {
        const completion = await openai.createChatCompletion({
            model: "gpt-3.5-turbo",
            messages: messages[chatId],
            max_tokens: max_tokens,
            temperature: temperature,
        });
        console.log(completion);
        response = completion?.data?.choices?.[0]?.message?.content;
        const spent = (completion?.data?.usage?.total_tokens / 1000) * OPENAI_PRICE;
        if (spent) {
            money[chatId] = (money[chatId] ?? 0) + spent;
            writeMoney(money);
        }

    } catch (e) {
        response = e.message + " " + e.response?.data?.error?.message;
    }
    return response;
};

const textToText = async (chatId, msg) => {
    messages[chatId].push({role: "user", "content": msg.text});
    await bot.sendChatAction(chatId, "typing");
    const intervalId = setInterval(() => {
        bot.sendChatAction(chatId, "typing")
            .then(() => {
            })
            .catch((e) => {
                console.error(e.message);
            });
    }, 2000);
    let response;
    response = await getText(
        messages,
        ((temp[chatId] ?? 36.5) - 36.5) / 10 + 0.5,
        MAX_TOKENS,
        chatId
    );
    console.log("response\n", response);
    clearInterval(intervalId);
    if (response) {
        last[chatId] = response;
        messages[chatId].push({role: "assistant", content: response})
        writeContext(messages);
        bot.sendMessage(chatId, response)
            .then(() => {
            })
            .catch((e) => {
                console.error(e.message);
            });
    }
};

const visualToText = async (chatId, msg) => {
    bot.sendChatAction(chatId, "typing").then();
    const intervalId = setInterval(() => {
        bot.sendChatAction(chatId, "typing")
            .then(() => {
            })
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
            messages[chatId].push({role: "user", "content": prompt});
            writeContext(messages);
            bot.sendMessage(chatId, prompt)
                .then(() => {
                })
                .catch((e) => {
                    console.error(e.message);
                });
        }
    }
};

const textToVisual = async (chatId, text, language_code) => {
    bot.sendChatAction(chatId, "typing").then();
    if (text === "draw" || text === "paint") {
        // link between right and left hemisphere (painting)
        text = last[chatId]?.replace("child", "");
    } else {
        last[chatId] = text;
    }

    if (!text) {
        return;
    }

    bot.sendChatAction(chatId, "typing").then();
    const photo = await getArt(
        text +
        (text?.startsWith("draw")
            ? ""
            : ", deep focus, highly detailed, digital painting, artstation, 4K, smooth, sharp focus, illustration")
    );
    if (photo) {
        money[chatId] = (money[chatId] ?? 0) + IMAGE_PRICE;
        writeMoney(money);
        bot.sendPhoto(chatId, photo).then().catch((e) => {
            console.error(e.message);
        });
    }
};

const getPrompt = async (photo) => {
    const file_id = photo[photo.length - 1].file_id;
    const fileUri = await bot.getFileLink(file_id);
    const img2prompt = await replicate.models.get("methexis-inc/img2prompt");
    return img2prompt.predict({image: fileUri});
};

const getArt = async (prompt) => {
    const response = await fetch(
        "https://api.stability.ai/v1alpha/generation/stable-diffusion-512-v2-1/text-to-image",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "image/png",
                Authorization: process.env.STABILITY_KEY,
            },
            body: JSON.stringify({
                cfg_scale: 7,
                clip_guidance_preset: "FAST_BLUE",
                height: 512,
                width: 512,
                samples: 1,
                steps: 30,
                text_prompts: [
                    {
                        text: prompt,
                        weight: 1,
                    },
                ],
            }),
        }
    );

    if (!response.ok) {
        console.error(`Stability AI error: ${(await response.text())?.split("\n")?.[0]?.substring(0, 200)}`);
        return;
    }

    return response.buffer();
};

const textToGoogle = async (chatId, msg, language_code) => {
    await bot.sendChatAction(chatId, "typing");
    const response = await google(msg, language_code);
    if (response) {
        last[chatId] = response;
        messages[chatId].push({role: "user", "content": response});
        writeContext(messages);
        bot.sendMessage(chatId, response)
            .then(() => {
            })
            .catch((e) => {
                console.error(e.message);
            });
    }
};





