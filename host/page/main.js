import { startAtmos } from "../core.js";

const atmos = startAtmos({ checkpoint: window.ATMOS_CHECKPOINT });
window.atmosHandle = atmos.handle;
window.atmosStatus = atmos.status;
