// Flips true when the preloader finishes, so the notches slide in after it rather than
// sitting under it. The layout persists across client navigations, so this happens once.
export const boot = $state({ ready: false });
