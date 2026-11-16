import type { Metadata } from "next";
import { MyProfile } from "@/components/my-profile";

export const metadata: Metadata = { title: "Meu perfil" };
export default function Page() { return <MyProfile />; }
