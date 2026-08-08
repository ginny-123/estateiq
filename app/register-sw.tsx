"use client";

import { useEffect } from "react";

export default function RegisterSW() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Silently ignore — PWA install still works without a live SW
        // on the very first visit; this just skips offline caching.
      });
    }
  }, []);
  return null;
}
