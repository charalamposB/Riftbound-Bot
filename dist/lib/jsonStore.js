"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readJson = readJson;
exports.writeJsonAtomic = writeJsonAtomic;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
/**
 * Διαβάζει JSON αρχείο με fallback.
 */
async function readJson(file, fallback = null) {
    try {
        const data = await fs_1.promises.readFile(file, 'utf8');
        return JSON.parse(data);
    }
    catch {
        return fallback;
    }
}
/**
 * Γράφει JSON με atomic write (πρώτα tmp αρχείο, μετά rename).
 */
async function writeJsonAtomic(file, obj) {
    const dir = path_1.default.dirname(file);
    const tmp = path_1.default.join(dir, `.${path_1.default.basename(file)}.tmp`);
    const data = JSON.stringify(obj, null, 2);
    await fs_1.promises.writeFile(tmp, data, 'utf8');
    await fs_1.promises.rename(tmp, file);
}
