"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import aiIcon from "@/public/ai-icon.json";

const Lottie = dynamic(() => import("lottie-react"), { ssr: false });

export function AiIcon({ className }: { className?: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return <div className={className} aria-hidden />;
  return <Lottie animationData={aiIcon} loop autoplay className={className} />;
}
