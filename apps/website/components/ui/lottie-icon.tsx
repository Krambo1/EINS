"use client";

import Lottie from "lottie-react";
import aiIcon from "@/public/ai-icon.json";

export function AiIcon({ className }: { className?: string }) {
  return <Lottie animationData={aiIcon} loop autoplay className={className} />;
}
