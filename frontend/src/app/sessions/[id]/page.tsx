import { redirect } from "next/navigation";

export default async function SessionDetailRedirectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    redirect("/lab");
  }
  redirect(`/lab?session=${encodeURIComponent(id)}`);
}
