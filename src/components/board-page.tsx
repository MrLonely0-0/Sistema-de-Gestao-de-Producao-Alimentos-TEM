"use client";

import { useAuth } from "@/components/auth-provider";
import { Board } from "@/components/board";

export function BoardPage() {
  const user = useAuth();
  return <Board user={user} />;
}
