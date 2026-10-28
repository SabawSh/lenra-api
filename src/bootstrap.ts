import { applyAppTimeZone } from "./lib/time/appTimeZone.js";
import { loadLenraEnv } from "./loadEnv.js";

loadLenraEnv();
applyAppTimeZone();
