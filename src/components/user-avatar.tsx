"use client";

import { useState } from "react";
import { authorizedAssetUrl } from "@/lib/client";
import { cn } from "@/components/ui";

export function UserAvatar({ name, url, className }: { name: string; url?: string | null; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const src = url?.startsWith("data:image/") || url?.startsWith("blob:") ? url : url ? authorizedAssetUrl(url) : null;
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
  return <span className={cn("relative grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-paper-deep text-[12px] font-semibold text-ink", className)}>
    {src && failed !== src ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img className="h-full w-full object-cover" src={src} alt="" onError={() => setFailed(src)} />
    ) : <span aria-hidden>{initials}</span>}
  </span>;
}
