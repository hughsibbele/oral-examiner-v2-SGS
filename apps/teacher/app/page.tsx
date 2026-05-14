import { redirect } from "next/navigation";
import { getTeacher } from "@/lib/auth/teacher";

export default async function RootPage() {
  const result = await getTeacher();
  if (result) {
    redirect("/dashboard");
  }
  redirect("/login");
}
