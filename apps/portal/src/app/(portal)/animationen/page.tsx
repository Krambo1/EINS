import { redirect } from "next/navigation";

export default function AnimationenLegacyRedirect() {
  redirect("/medien?kind=animationen");
}
