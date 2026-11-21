import type { Metadata } from "next";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = { title: "Create your account" };

export default function Page() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Create your account</CardTitle>
        <CardDescription>
          Firm registration and onboarding are built in P1.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Link href="/login" className="text-primary text-sm hover:underline">
          Back to sign in
        </Link>
      </CardContent>
    </Card>
  );
}
