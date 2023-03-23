import fs from "fs";

const write = (file, value) => {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
};

const read = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file));
  } catch {
    return {};
  }
};

export const writeOpened = (opened) => {
  write("opened.json", opened);
};

export const readOpened = () => {
  return read("opened.json");
};

export const writeTrial = (trial) => {
  write("trials.json", trial);
};

export const writeContext = (context) => {
  write("context.json", context);
};

export const readContext = () => {
  return read("context.json");
};

export const writeChatSuffix = (suffix) => {
  write("suffix.json", suffix);
};

export const readChatSuffix = () => {
  return read("suffix.json");
};

export const writeMoney = (money) => {
  write("money.json", money);
};

export const readMoney = () => {
  return read("money.json");
};

export const writeTemp = (temp) => {
  write("temp.json", temp);
};

export const readTemp = () => {
  return read("temp.json");
};
