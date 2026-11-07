import { startAtmos } from "../../sdk/core.js";

const atmos = startAtmos({ checkpoint: window.ATMOS_CHECKPOINT, shape: Boolean(window.ATMOS_SHAPE), bal: Boolean(window.ATMOS_BAL) });
window.atmosHandle = atmos.handle;
window.atmosStatus = atmos.status;
