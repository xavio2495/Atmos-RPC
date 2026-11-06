import { startAtmos } from "../core.js";

const atmos = startAtmos({ checkpoint: window.ATMOS_CHECKPOINT, shape: Boolean(window.ATMOS_SHAPE) });
window.atmosHandle = atmos.handle;
window.atmosStatus = atmos.status;
